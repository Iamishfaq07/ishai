"""Credits: a new account's welcome credits (one per network, capped a day), resume credits spent per AI action, and
credit packs bought over UPI (order, the payer's UTR, the admin's approval). The signed-out resume maker is gone."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import update

from orbit_api import credits
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import CreditEntry
from orbit_api.providers.llm.base import LLMError
from orbit_api.resumes import allowance
from tests.test_api import _register
from tests.test_phase1 import _add_usage
from tests.test_resumes import JOB, strong_resume
from tests.test_signup_approval import _client, _outbox
from tests.test_signup_approval import _register as _register_named

PROXY = "p" * 32


def _letter() -> dict[str, Any]:
    return {"data": strong_resume().model_dump(mode="json"), "job_text": JOB}


def _ip(ip: str, h: dict[str, str] | None = None) -> dict[str, str]:
    """Requests that come from `ip` (through the web app's edge proxy, which states the client IP)."""
    return {**(h or {}), "X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-IP": ip}


def _new_ip() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250 + 1}"


def _signup(client: TestClient, ip: str) -> dict[str, str]:
    email = f"c-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", headers=_ip(ip), json={"email": email, "password": "correct horse battery"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return _ip(ip, {"Authorization": f"Bearer {r.json()['access_token']}"})


def _wallet(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    w = client.get("/v1/entitlements", headers=h).json()["credits"]
    assert w is not None
    return dict(w)


@pytest.fixture
def enforce(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(allowance, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(credits, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    _register(client)  # with no ORBIT_ADMIN_EMAIL the first account stands in as admin (unlimited): not ours
    yield


# ---- welcome credits ----------------------------------------------------------------------------------------------


def test_a_new_account_gets_the_welcome_credits_once_per_network(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    first = _signup(client, ip)
    assert _wallet(client, first) == {"resume": 1, "interview_minutes_left": 20.0, "interview_minutes_total": 20.0}
    # Another account from the same network starts at zero (it can still buy a pack).
    second = _signup(client, ip)
    assert _wallet(client, second) == {"resume": 0, "interview_minutes_left": 0.0, "interview_minutes_total": 0.0}
    assert client.post("/v1/sessions", headers=second, json={"title": "x"}).status_code == 402
    # Another network: its own welcome.
    assert _wallet(client, _signup(client, _new_ip()))["resume"] == 1


def test_the_network_window_runs_out(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    _signup(client, ip)

    async def age() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(CreditEntry).where(CreditEntry.ip_hash == credits.ip_hash(ip))
                             .values(created_at=datetime.now(UTC) - timedelta(days=31)))
            await db.commit()

    client.portal.call(age)  # type: ignore[union-attr]
    assert _wallet(client, _signup(client, ip))["interview_minutes_total"] == 20.0


def test_welcome_credits_have_a_daily_cap(client: TestClient, enforce: None, monkeypatch: pytest.MonkeyPatch) -> None:
    async def welcomed_today() -> int:
        from sqlalchemy import func, select

        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count(func.distinct(CreditEntry.user_id))).where(
                CreditEntry.reason == "welcome", CreditEntry.ip_hash.is_not(None),
                CreditEntry.created_at >= datetime.now(UTC) - timedelta(days=1))) or 0)

    monkeypatch.setattr(get_settings(), "welcome_daily_limit",
                        client.portal.call(welcomed_today))  # type: ignore[union-attr]
    assert _wallet(client, _signup(client, _new_ip()))["resume"] == 0


# ---- resume credits -----------------------------------------------------------------------------------------------


def test_each_resume_ai_action_spends_a_credit_then_offers_a_pack(client: TestClient, enforce: None) -> None:
    h = _signup(client, _new_ip())
    before = client.get("/v1/resumes/allowance", headers=h).json()
    assert before["unlimited"] is False and before["credits_left"] == 1
    assert before["upgrade"]["pack"] == "starter" and before["upgrade"]["price_inr"] == 1499

    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 200
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0
    again = client.post("/v1/resumes/cover-letter", headers=h, json=_letter())
    assert again.status_code == 402
    detail = again.json()["detail"]
    assert detail["code"] == "upgrade_required" and detail["pack"] == "starter" and "₹1499" in detail["message"]
    assert client.post("/v1/resumes/import", headers=h, json={"source": "text", "text": "x" * 200}).status_code == 402
    # Fixes that need no AI stay free, and say what a pack adds.
    s = client.post("/v1/resumes/suggest", headers=h, json={"data": strong_resume().model_dump(mode="json"),
                                                            "job_text": JOB})
    assert s.status_code in (200, 402)
    if s.status_code == 200:
        assert s.json()["upgrade_required"] is True and s.json()["suggestions"]
    body = {"data": strong_resume().model_dump(mode="json")}
    assert client.post("/v1/resumes/score", headers=h, json=body).status_code == 200
    assert client.post("/v1/resumes/docx", headers=h, json=body).status_code == 200


def test_a_failed_ai_call_gives_the_credit_back(client: TestClient, enforce: None,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    class Down:
        name = "down"

        async def generate(self, req: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    from orbit_api.resumes import routes

    h = _signup(client, _new_ip())
    with monkeypatch.context() as m:
        m.setattr(routes, "get_llm_provider", lambda: Down())
        assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 503
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 1
    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 200


def test_there_is_no_signed_out_resume_maker(client: TestClient) -> None:
    client.cookies.clear()
    for path in ("/v1/resume-maker/score", "/v1/resume-maker/suggest", "/v1/resume-maker/allowance"):
        assert client.post(path, json={}).status_code in (404, 405)
    assert client.post("/v1/resumes/score", json={"data": {}}).status_code == 401


# ---- packs over UPI -----------------------------------------------------------------------------------------------


def test_packs_are_listed_and_need_a_upi_id(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upi_id", None)
    packs = {p["id"]: p for p in client.get("/v1/billing/packs").json()}
    assert packs["starter"] == {"id": "starter", "label": "Starter", "price_inr": 1499, "resume_credits": 30,
                                "interview_minutes": 60, "buyable": False}
    assert set(packs) == {"starter", "plus", "pro"}
    h = _register(client)
    assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"}).status_code == 503
    monkeypatch.setattr(get_settings(), "upi_id", "owner@okicici")
    assert all(p["buyable"] for p in client.get("/v1/billing/packs").json())
    assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "gold"}).status_code == 422


def test_the_upi_id_is_validated() -> None:
    from orbit_api.config import Settings

    assert Settings(ORBIT_UPI_ID=" me@okaxis ").upi_id == "me@okaxis"  # type: ignore[call-arg]
    assert Settings(ORBIT_UPI_ID="").upi_id is None  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="name@bank"):
        Settings(ORBIT_UPI_ID="9876543210")  # type: ignore[call-arg]


def test_custom_packs_are_validated(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.billing.packs import packs

    monkeypatch.setattr(get_settings(), "credit_packs_json",
                        '[{"id": "mini", "label": "Mini", "price_inr": 199, "resume_credits": 10, '
                        '"interview_minutes": 0}]')
    assert list(packs()) == ["mini"]
    for bad in ('[]', '[{"id": "x", "label": "X", "price_inr": 0, "resume_credits": 1, "interview_minutes": 1}]',
                '[{"id": "x", "label": "X", "price_inr": 9, "resume_credits": -1, "interview_minutes": 1}]',
                '[{"id": "x", "label": "X", "price_inr": 9}]'):
        monkeypatch.setattr(get_settings(), "credit_packs_json", bad)
        with pytest.raises(ValueError):
            packs()


def test_buying_a_pack_over_upi(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Ishfaq")
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, _user = _register_named(client, f"buyer-{uuid.uuid4().hex[:8]}@example.com")
        assert _wallet(client, h)["resume"] == 1  # the welcome credit

        order = client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"})
        assert order.status_code == 201
        o = order.json()
        assert (o["amount_inr"], o["resume_credits"], o["interview_minutes"]) == (1499, 30, 60)
        assert o["label"] == "Starter pack" and o["status"] == "awaiting_payment" and o["reference"].startswith("ORB")
        assert o["upi_uri"].startswith("upi://pay?pa=owner%40okicici") and "am=1499.00" in o["upi_uri"]
        assert o["reference"] in o["upi_uri"] and "pn=Ishfaq" in o["upi_uri"]
        # Opening the page again hands back the same order.
        assert client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"}).json()["id"] == o["id"]

        utr = f"{uuid.uuid4().int % 10**12:012d}"
        bad = client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": "12345"})
        assert bad.status_code == 422 and "12-digit" in bad.json()["detail"]
        sent = client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h,
                           json={"utr": f"{utr[:4]} {utr[4:8]} {utr[8:]}"})
        assert sent.status_code == 200 and sent.json()["status"] == "submitted" and sent.json()["utr"] == utr
        assert sent.json()["upi_uri"] is None  # nothing left to pay
        alert = next(m for m in reversed(_outbox().sent) if m.to == admin_email)
        assert utr in alert.text and o["reference"] in alert.text and "/admin/payments" in alert.text
        assert _wallet(client, h)["resume"] == 1  # submitting doesn't add anything by itself

        # A UTR counts once, for anyone; someone else's order is invisible.
        other, _ = _register_named(client, f"other-{uuid.uuid4().hex[:8]}@example.com")
        o2 = client.post("/v1/billing/upi/orders", headers=other, json={"pack": "plus"}).json()
        assert client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other,
                           json={"utr": utr}).status_code == 409
        assert client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=other,
                           json={"utr": "111122223333"}).status_code == 404

        # Only the admin sees and decides payments.
        assert client.get("/v1/admin/payments", headers=h).status_code == 403
        row = next(p for p in client.get("/v1/admin/payments", headers=admin).json()["payments"] if p["id"] == o["id"])
        assert row["utr"] == utr and row["email"].startswith("buyer-")

        ok = client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve"})
        assert ok.status_code == 200 and ok.json()["status"] == "approved"
        w = _wallet(client, h)
        assert w["resume"] == 31 and w["interview_minutes_left"] == 80.0  # welcome + the pack
        mail = next(m for m in reversed(_outbox().sent) if m.subject.startswith("Payment received"))
        assert "30 resume AI credits and 60 interview minutes" in mail.subject
        assert client.post(f"/v1/admin/payments/{o['id']}", headers=admin,
                           json={"action": "approve"}).status_code == 409  # decided once

        # Rejected: the payer sees why, gets nothing, and can send the right UTR again.
        client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other,
                    json={"utr": f"{(uuid.uuid4().int + 2) % 10**12:012d}"})
        no = client.post(f"/v1/admin/payments/{o2['id']}", headers=admin,
                         json={"action": "reject", "note": "No payment with this UTR"})
        assert no.status_code == 200 and no.json()["status"] == "rejected"
        mine = client.get("/v1/billing/upi/orders", headers=other).json()[0]
        assert mine["status"] == "rejected" and mine["note"] == "No payment with this UTR" and mine["upi_uri"]
        assert _wallet(client, other)["resume"] == 1
        again = client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other,
                            json={"utr": f"{(uuid.uuid4().int + 3) % 10**12:012d}"})
        assert again.json()["status"] == "submitted" and again.json()["note"] is None
    finally:
        gen.close()


def test_interview_minutes_from_the_admin_reopen_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"m-{uuid.uuid4().hex[:8]}@example.com")
        _add_usage(user["id"], "live_seconds", 20 * 60)  # the welcome minutes, used up
        assert client.post("/v1/sessions", headers=h, json={"title": "x"}).status_code == 402
        r = client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin,
                        json={"resume": 5, "interview_minutes": 30})
        assert r.status_code == 200 and r.json()["resume_credits"] == 6 and r.json()["interview_minutes_left"] == 30
        assert client.post("/v1/sessions", headers=h, json={"title": "x"}).status_code == 201
        assert client.post(f"/v1/admin/users/{user['id']}/credits", headers=h,
                           json={"resume": 5}).status_code == 403  # admin only
        assert client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin, json={}).status_code == 422
    finally:
        gen.close()


def test_the_admin_and_pro_grants_dont_use_credits(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        e = client.get("/v1/entitlements", headers=admin).json()
        assert e["plan"] == "unlimited" and e["credits"] is None
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        r = client.post(f"/v1/admin/users/{user['id']}/access", headers=admin,
                        json={"action": "grant", "plan": "pro", "hours": 48})
        assert r.status_code == 200 and r.json()["plan_label"] == "Pro"
        e = client.get("/v1/entitlements", headers=h).json()
        assert e["features"]["resume_ai"] is True and e["credits"] is None and e["limits"]["live_minutes"] == 600
    finally:
        gen.close()
