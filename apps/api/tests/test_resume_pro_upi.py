"""Resume Pro: without it, one free AI action per account (for good) and per IP address (per 30 days); with it,
unlimited. Resume Pro is bought over UPI: an order with a QR and reference, the payer's UTR, the admin's approval."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import update

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import FreeAiUse
from orbit_api.providers.llm.base import LLMError
from orbit_api.resumes import allowance
from tests.test_api import _register
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


@pytest.fixture
def enforce(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(allowance, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    _register(client)  # with no ORBIT_ADMIN_EMAIL the first account stands in as admin (unlimited): not ours
    yield


def test_one_free_ai_action_per_account_then_upgrade(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    h = _ip(ip, _register(client))
    before = client.get("/v1/resumes/allowance", headers=h).json()
    assert before["unlimited"] is False and before["free_left"] == 1
    assert before["upgrade"]["plan"] == "resume_pro" and before["upgrade"]["price_inr_month"] == 299

    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 200
    assert client.get("/v1/resumes/allowance", headers=h).json()["free_left"] == 0

    again = client.post("/v1/resumes/cover-letter", headers=h, json=_letter())
    assert again.status_code == 402
    detail = again.json()["detail"]
    assert detail["code"] == "upgrade_required" and detail["plan"] == "resume_pro" and "₹299" in detail["message"]
    # Every AI tool is behind the same allowance...
    assert client.post("/v1/resumes/import", headers=h, json={"source": "text", "text": "x" * 200}).status_code == 402
    # ...but fixes worked out without the AI stay free, and say what upgrading adds.
    s = client.post("/v1/resumes/suggest", headers=h, json={"data": strong_resume().model_dump(mode="json"),
                                                            "job_text": JOB})
    assert s.status_code in (200, 402)
    if s.status_code == 200:
        assert s.json()["upgrade_required"] is True and s.json()["suggestions"]
    # Scoring and Word downloads never count.
    body = {"data": strong_resume().model_dump(mode="json")}
    assert client.post("/v1/resumes/score", headers=h, json=body).status_code == 200
    assert client.post("/v1/resumes/docx", headers=h, json=body).status_code == 200


def test_the_free_use_is_per_ip_too_for_new_accounts_and_signed_out(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    first = _ip(ip, _register(client))
    assert client.post("/v1/resumes/cover-letter", headers=first, json=_letter()).status_code == 200
    # Another account (or signing out) on the same network: already used.
    second = _ip(ip, _register(client))
    assert client.get("/v1/resumes/allowance", headers=second).json()["free_left"] == 0
    assert client.post("/v1/resumes/cover-letter", headers=second, json=_letter()).status_code == 402
    guest = client.post("/v1/resume-maker/cover-letter", headers=_ip(ip), json=_letter())
    assert guest.status_code == 402 and "Create a free account" in guest.json()["detail"]["message"]
    # A different network: its own free use, once.
    other = _new_ip()
    assert client.get("/v1/resume-maker/allowance", headers=_ip(other)).json()["free_left"] == 1
    assert client.post("/v1/resume-maker/cover-letter", headers=_ip(other), json=_letter()).status_code == 200
    assert client.post("/v1/resume-maker/cover-letter", headers=_ip(other), json=_letter()).status_code == 402
    # The first account stays used up on any network.
    assert client.post("/v1/resumes/cover-letter", headers=_ip(_new_ip(), first), json=_letter()).status_code == 402


def test_the_ip_window_runs_out_but_the_account_never_does(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    used = _ip(ip, _register(client))
    assert client.post("/v1/resumes/cover-letter", headers=used, json=_letter()).status_code == 200

    async def age() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(FreeAiUse).where(FreeAiUse.ip_hash == allowance.ip_hash(ip))
                             .values(created_at=datetime.now(UTC) - timedelta(days=31)))
            await db.commit()

    client.portal.call(age)  # type: ignore[union-attr]
    fresh = _ip(ip, _register(client))
    assert client.get("/v1/resumes/allowance", headers=fresh).json()["free_left"] == 1
    assert client.get("/v1/resumes/allowance", headers=used).json()["free_left"] == 0


def test_a_failed_ai_call_gives_the_free_use_back(client: TestClient, enforce: None,
                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    class Down:
        name = "down"

        async def generate(self, req: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    from orbit_api.resumes import routes

    h = _ip(_new_ip(), _register(client))
    with monkeypatch.context() as m:
        m.setattr(routes, "get_llm_provider", lambda: Down())
        assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 503
    assert client.get("/v1/resumes/allowance", headers=h).json()["free_left"] == 1
    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 200


# ---- UPI ------------------------------------------------------------------------------------------------------------


def test_upi_needs_a_upi_id_before_anything_can_be_bought(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upi_id", None)
    plans = {p["name"]: p for p in client.get("/v1/plans").json()}
    assert plans["resume_pro"]["price_inr_month"] == 299 and plans["resume_pro"]["buyable"] is False
    h = _register(client)
    assert client.post("/v1/billing/upi/orders", headers=h, json={"plan": "resume_pro"}).status_code == 503
    monkeypatch.setattr(get_settings(), "upi_id", "owner@okicici")
    assert {p["name"]: p for p in client.get("/v1/plans").json()}["resume_pro"]["buyable"] is True
    # Plans without a rupee price (or Free) can't be bought.
    assert client.post("/v1/billing/upi/orders", headers=h, json={"plan": "unlimited"}).status_code == 422
    assert client.post("/v1/billing/upi/orders", headers=h, json={"plan": "free"}).status_code == 422


def test_the_upi_id_is_validated() -> None:
    from orbit_api.config import Settings

    assert Settings(ORBIT_UPI_ID=" me@okaxis ").upi_id == "me@okaxis"  # type: ignore[call-arg]
    assert Settings(ORBIT_UPI_ID="").upi_id is None  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="name@bank"):
        Settings(ORBIT_UPI_ID="9876543210")  # type: ignore[call-arg]


def test_buying_resume_pro_over_upi(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Ishfaq")
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, _ = _register_named(client, f"buyer-{uuid.uuid4().hex[:8]}@example.com")
        assert client.get("/v1/entitlements", headers=h).json()["plan"] == "free"

        order = client.post("/v1/billing/upi/orders", headers=h, json={"plan": "resume_pro"})
        assert order.status_code == 201
        o = order.json()
        assert o["amount_inr"] == 299 and o["days"] == 30 and o["status"] == "awaiting_payment"
        assert o["reference"].startswith("ORB") and o["upi_id"] == "owner@okicici" and o["payee_name"] == "Ishfaq"
        assert o["upi_uri"].startswith("upi://pay?pa=owner%40okicici") and "am=299.00" in o["upi_uri"]
        assert o["reference"] in o["upi_uri"] and "cu=INR" in o["upi_uri"] and "pn=Ishfaq" in o["upi_uri"]
        # Opening the page again hands back the same order.
        assert client.post("/v1/billing/upi/orders", headers=h, json={"plan": "resume_pro"}).json()["id"] == o["id"]

        utr = f"{uuid.uuid4().int % 10**12:012d}"
        bad = client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": "12345"})
        assert bad.status_code == 422 and "12-digit" in bad.json()["detail"]
        sent = client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h,
                           json={"utr": f"{utr[:4]} {utr[4:8]} {utr[8:]}"})
        assert sent.status_code == 200 and sent.json()["status"] == "submitted" and sent.json()["utr"] == utr
        assert sent.json()["upi_uri"] is None  # nothing left to pay
        alert = next(m for m in reversed(_outbox().sent) if m.to == admin_email)
        assert utr in alert.text and o["reference"] in alert.text and "/admin/payments" in alert.text
        # Submitting doesn't unlock anything by itself.
        assert client.get("/v1/entitlements", headers=h).json()["plan"] == "free"

        # A UTR counts once, for anyone.
        other, _ = _register_named(client, f"other-{uuid.uuid4().hex[:8]}@example.com")
        o2 = client.post("/v1/billing/upi/orders", headers=other, json={"plan": "resume_pro"}).json()
        dup = client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other, json={"utr": utr})
        assert dup.status_code == 409
        # Someone else's order is invisible.
        assert client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=other,
                           json={"utr": "111122223333"}).status_code == 404

        # Only the admin sees and decides payments.
        assert client.get("/v1/admin/payments", headers=h).status_code == 403
        waiting = client.get("/v1/admin/payments", headers=admin).json()
        assert waiting["upi_configured"] and waiting["waiting"] >= 1
        row = next(p for p in waiting["payments"] if p["id"] == o["id"])
        assert row["utr"] == utr and row["email"].startswith("buyer-") and row["current_plan"] is None

        ok = client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve"})
        assert ok.status_code == 200 and ok.json()["status"] == "approved"
        ent = client.get("/v1/entitlements", headers=h).json()
        assert ent["plan"] == "resume_pro" and ent["features"]["resume_ai"] is True
        until = datetime.fromisoformat(ent["until"])
        assert timedelta(days=29, hours=23) < until - datetime.now(UTC) <= timedelta(days=30)
        assert client.get("/v1/resumes/allowance", headers=h).json()["unlimited"] is True
        mail = next(m for m in reversed(_outbox().sent) if m.subject.startswith("Payment received"))
        assert "Resume Pro" in mail.subject
        assert client.post(f"/v1/admin/payments/{o['id']}", headers=admin,
                           json={"action": "approve"}).status_code == 409  # decided once

        # A second month is added on to the first.
        o3 = client.post("/v1/billing/upi/orders", headers=h, json={"plan": "resume_pro"}).json()
        assert o3["id"] != o["id"]
        utr3 = f"{(uuid.uuid4().int + 1) % 10**12:012d}"
        client.post(f"/v1/billing/upi/orders/{o3['id']}/utr", headers=h, json={"utr": utr3})
        client.post(f"/v1/admin/payments/{o3['id']}", headers=admin, json={"action": "approve"})
        until2 = datetime.fromisoformat(client.get("/v1/entitlements", headers=h).json()["until"])
        assert timedelta(days=29, hours=23) < until2 - until <= timedelta(days=30, minutes=1)

        # Rejected: the payer sees why, and can send the right UTR again.
        bad_utr = f"{(uuid.uuid4().int + 2) % 10**12:012d}"
        client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other, json={"utr": bad_utr})
        no = client.post(f"/v1/admin/payments/{o2['id']}", headers=admin,
                         json={"action": "reject", "note": "No payment with this UTR"})
        assert no.status_code == 200 and no.json()["status"] == "rejected"
        mine = client.get("/v1/billing/upi/orders", headers=other).json()[0]
        assert mine["status"] == "rejected" and mine["note"] == "No payment with this UTR" and mine["upi_uri"]
        assert client.get("/v1/entitlements", headers=other).json()["plan"] == "free"
        again = client.post(f"/v1/billing/upi/orders/{o2['id']}/utr", headers=other,
                            json={"utr": f"{(uuid.uuid4().int + 3) % 10**12:012d}"})
        assert again.json()["status"] == "submitted" and again.json()["note"] is None
    finally:
        gen.close()


def test_the_admin_can_grant_resume_pro_for_a_while(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        r = client.post(f"/v1/admin/users/{user['id']}/access", headers=admin,
                        json={"action": "grant", "plan": "resume_pro", "hours": 48})
        assert r.status_code == 200 and r.json()["plan_label"] == "Resume Pro"
        assert client.get("/v1/entitlements", headers=h).json()["features"]["resume_ai"] is True
    finally:
        gen.close()
