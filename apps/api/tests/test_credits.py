"""Credits: a new account's welcome credits (one per network, capped a day), resume credits spent per AI action, and
credit packs bought over UPI (order, the payer's UTR, the admin's approval). The signed-out resume maker is gone."""

import importlib.util
import json
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select, update

from orbit_api import credits
from orbit_api.billing.packs import DEFAULT_PACKS
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import CreditEntry, UsageEvent
from orbit_api.providers.llm.base import LLMError
from orbit_api.resumes import allowance
from orbit_api.sessions import routes
from orbit_api.sessions.recorder import DbRecorder, InterviewTime
from tests.test_api import _collect, _live, _register
from tests.test_phase1 import _add_usage
from tests.test_resumes import JOB, strong_resume
from tests.test_signup_approval import _client, _outbox, _set_grant_until
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
    # Other suites create hundreds of accounts in the shared test DB. Network/credit tests must not depend on
    # collection order; the daily-cap test below installs its own explicit cap.
    monkeypatch.setattr(get_settings(), "welcome_daily_limit", 100_000)
    _register(client)  # with no ORBIT_ADMIN_EMAIL the first account stands in as admin (unlimited): not ours
    yield


# ---- welcome credits ----------------------------------------------------------------------------------------------


def test_a_new_account_gets_the_welcome_credits_once_per_network(client: TestClient, enforce: None) -> None:
    ip = _new_ip()
    first = _signup(client, ip)
    assert _wallet(client, first) == {"resume": 1, "interview_minutes_left": 20.0, "interview_minutes_total": 20.0,
                                      "welcome_missed": False}
    # Another account from the same network starts at zero (it can still buy a pack), and the app is told why.
    second = _signup(client, ip)
    assert _wallet(client, second) == {"resume": 0, "interview_minutes_left": 0.0, "interview_minutes_total": 0.0,
                                       "welcome_missed": True}
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
    assert before["upgrade"]["pack"] == "mini" and before["upgrade"]["price_inr"] == 499  # the cheapest pack

    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 200
    assert client.get("/v1/resumes/allowance", headers=h).json()["credits_left"] == 0
    again = client.post("/v1/resumes/cover-letter", headers=h, json=_letter())
    assert again.status_code == 402
    detail = again.json()["detail"]
    assert detail["code"] == "upgrade_required" and detail["pack"] == "mini" and "₹499" in detail["message"]
    assert detail["price_text"] == "₹499"
    # Out of credits abroad: the same pack, priced the way the visitor pays (the country Cloudflare saw).
    abroad = client.post("/v1/resumes/cover-letter", headers={**h, "X-Orbit-Client-Country": "US"}, json=_letter())
    assert abroad.status_code == 402
    assert abroad.json()["detail"]["price_text"] == "$7.99" and "₹" not in abroad.json()["detail"]["message"]
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


def test_one_credit_covers_several_single_fixes(client: TestClient, enforce: None,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.resumes import routes

    h = _signup(client, _new_ip())
    fix = {"data": strong_resume().model_dump(mode="json"), "focus": "basics.summary"}
    per = get_settings().resume_fixes_per_credit
    assert per == 5 and client.get("/v1/resumes/allowance", headers=h).json()["fixes_per_credit"] == 5

    from orbit_api.providers.llm.mock import MockLLMProvider

    class Down(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    with monkeypatch.context() as m:  # a failed fix spends nothing, the prepaid fixes included
        m.setattr(routes, "get_llm_provider", lambda: Down())
        assert client.post("/v1/resumes/suggest", headers=h, json=fix).status_code == 503
    a = client.get("/v1/resumes/allowance", headers=h).json()
    assert (a["credits_left"], a["fixes_left"]) == (1, 0)

    for done in range(1, per + 1):
        r = client.post("/v1/resumes/suggest", headers=h, json=fix)
        assert r.status_code == 200, r.text
        a = client.get("/v1/resumes/allowance", headers=h).json()
        assert (a["credits_left"], a["fixes_left"]) == (0, per - done)  # the first fix spent the credit
    assert client.post("/v1/resumes/suggest", headers=h, json=fix).status_code == 402
    # Prepaid fixes don't pay for a big action: a cover letter still needs a whole credit.
    assert client.post("/v1/resumes/cover-letter", headers=h, json=_letter()).status_code == 402


def test_there_is_no_signed_out_resume_maker(client: TestClient) -> None:
    client.cookies.clear()
    for path in ("/v1/resume-maker/score", "/v1/resume-maker/suggest", "/v1/resume-maker/allowance"):
        assert client.post(path, json={}).status_code in (404, 405)
    assert client.post("/v1/resumes/score", json={"data": {}}).status_code == 401


# ---- packs over UPI -----------------------------------------------------------------------------------------------


def test_packs_are_listed_and_need_a_upi_id(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upi_id", None)
    packs = {p["id"]: p for p in client.get("/v1/billing/packs").json()}
    assert packs["starter"] == {"id": "starter", "label": "3 credits", "price_inr": 3599, "resume_credits": 30,
                                "interview_minutes": 180, "bonus_minutes": 0, "total_minutes": 180, "badge": None,
                                "buyable": False, "checkout": None, "international": False,
                                "currency": "INR", "price": 3599.0, "price_text": "₹3,599"}
    assert packs["mini"] == {"id": "mini", "label": "AI credits", "price_inr": 499, "resume_credits": 25,
                             "interview_minutes": 0, "bonus_minutes": 0, "total_minutes": 0, "badge": None,
                             "buyable": False, "checkout": None, "international": False,
                             "currency": "INR", "price": 499.0, "price_text": "₹499"}
    assert (packs["plus"]["total_minutes"], packs["plus"]["badge"]) == (480, "Most popular")  # 6 credits + 2 free
    assert (packs["pro"]["total_minutes"], packs["pro"]["badge"]) == (900, "Best value")  # 9 credits + 6 free
    assert list(packs) == ["mini", "single", "starter", "plus", "pro"]
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
        assert (o["amount_inr"], o["resume_credits"], o["interview_minutes"]) == (3599, 30, 180)
        assert o["label"] == "3 interview credits" and o["status"] == "awaiting_payment"
        assert o["reference"].startswith("ORB")
        assert o["upi_uri"].startswith("upi://pay?pa=owner%40okicici")
        assert "am=3599.00" in o["upi_uri"]
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
        assert w["resume"] == 31 and w["interview_minutes_left"] == 200.0  # welcome + the pack
        mail = next(m for m in reversed(_outbox().sent) if m.subject.startswith("Payment received"))
        assert "30 resume AI credits and 180 interview minutes" in mail.subject
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


# ---- which balance interview time comes out of ---------------------------------------------------------------------


def _grant(client: TestClient, admin: dict[str, str], user_id: str, plan: str = "pro") -> None:
    r = client.post(f"/v1/admin/users/{user_id}/access", headers=admin,
                    json={"action": "grant", "plan": plan, "hours": 48})
    assert r.status_code == 200, r.text


def _spend(client: TestClient, user_id: str, seconds: float, pool: str, metric: str = "live_seconds") -> None:
    """Interview time already metered on `pool` (an earlier session)."""
    async def go() -> None:
        async with sessionmaker()() as db:
            db.add(UsageEvent(user_id=user_id, metric=metric, quantity=seconds, pool=pool))
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]


def _pools(client: TestClient, session_id: str) -> dict[str | None, float]:
    async def go() -> dict[str | None, float]:
        async with sessionmaker()() as db:
            rows = (await db.scalars(select(UsageEvent).where(UsageEvent.session_id == session_id,
                                                              UsageEvent.metric == "live_seconds"))).all()
            out: dict[str | None, float] = {}
            for r in rows:
                out[r.pool] = out.get(r.pool, 0) + r.quantity
            return out

    return client.portal.call(go)  # type: ignore[union-attr, no-any-return]


def test_time_on_a_grant_never_comes_out_of_the_credits(monkeypatch: pytest.MonkeyPatch) -> None:
    """20 welcome minutes, then Pro for 48 hours and a 45-minute interview on it: when the grant ends the 20 minutes
    are still there (the interview used to be charged to them too, leaving 0 and a 402)."""
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        _grant(client, admin, user["id"])
        sid = client.post("/v1/sessions", headers=h, json={"title": "on the grant"}).json()["id"]
        # 45 minutes of it, metered as the live socket's heartbeat meters it.
        left = client.portal.call(routes._commit_live_seconds, user["id"], sid,  # type: ignore[union-attr]
                                  InterviewTime(f"live:{uuid.uuid4()}"), 45 * 60)
        assert left == (600 - 45) * 60
        during = client.get("/v1/entitlements", headers=h).json()
        assert during["plan"] == "pro" and during["usage"]["live_minutes"] == 45.0
        assert _pools(client, sid) == {"pro": 45 * 60}

        _set_grant_until(client, user["id"], datetime.now(UTC) - timedelta(minutes=1))
        assert _wallet(client, h) == {"resume": 1, "interview_minutes_left": 20.0, "interview_minutes_total": 20.0,
                                      "welcome_missed": False}
        assert client.post("/v1/sessions", headers=h, json={"title": "after the grant"}).status_code == 201
    finally:
        gen.close()


def test_when_the_plan_changes_mid_interview_the_rest_goes_to_the_new_balance(monkeypatch: pytest.MonkeyPatch) -> None:
    """One connection, metered while a grant runs out: its time so far stays on the grant, and from the next beat
    on (and in the final write at teardown) it's metered on the credits, as a row of its own."""
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        uid = user["id"]
        _grant(client, admin, uid)
        sid = client.post("/v1/sessions", headers=h, json={"title": "grant runs out"}).json()["id"]
        minutes = InterviewTime(f"live:{uuid.uuid4()}", pool="pro")
        run = client.portal.call  # type: ignore[union-attr]
        run(routes._commit_live_seconds, uid, sid, minutes, 30 * 60)
        _set_grant_until(client, uid, datetime.now(UTC) - timedelta(seconds=1))
        # The beat after the grant ran out: the 20 credit minutes are all there, nothing cut off.
        assert run(routes._commit_live_seconds, uid, sid, minutes, 30 * 60 + 15) == 20 * 60
        assert (minutes.pool, minutes.row, minutes.since_s) == ("credits", 2, 30 * 60 + 15)

        async def teardown() -> None:
            rec = DbRecorder(sid, uid, store_transcripts=True, minutes=minutes)
            await rec.detached(30 * 60 + 45, 0.0, "")
            await rec.close()

        run(teardown)
        assert _pools(client, sid) == {"pro": 30 * 60 + 15, "credits": 30}
        assert _wallet(client, h)["interview_minutes_left"] == 19.5
    finally:
        gen.close()


def test_a_grant_running_out_mid_interview_keeps_it_going_on_the_credits(monkeypatch: pytest.MonkeyPatch) -> None:
    """Over the socket: an hour already used on a Pro grant, more than the 20 credit minutes. The grant runs out
    mid-interview; the next heartbeat used to cut the interview off ("out of minutes")."""
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_LIVE_HEARTBEAT_S="0.1")
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        _grant(client, admin, user["id"])
        _spend(client, user["id"], 60 * 60, "pro")
        sid = client.post("/v1/sessions", headers=h, json={"title": "live"}).json()["id"]
        with _live(client, h, sid) as ws:
            _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
            time.sleep(1.1)
            _set_grant_until(client, user["id"], datetime.now(UTC) - timedelta(seconds=1))
            time.sleep(2.1)  # heartbeats on the credits now (over a second of them: usage counts whole seconds)
            ws.send_text(json.dumps({"type": "session.end", "data": {}}))
            events = _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
        assert not [e for e in events if e["type"] == "usage.status" and e["data"]["limit_reached"]]
        pools = _pools(client, sid)
        assert set(pools) == {"pro", "credits"} and pools["pro"] >= 1 and 1 <= pools["credits"] < 60
        assert _wallet(client, h)["interview_minutes_left"] >= 19  # the hour on Pro didn't come out of them
    finally:
        gen.close()


def test_credits_spent_earlier_dont_shrink_a_plan_allowance(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email,
                  ORBIT_PLANS_JSON=json.dumps({"pro": {"live_minutes": 15}}))
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        _spend(client, user["id"], 15 * 60, credits.POOL)  # on Free, earlier this month
        _grant(client, admin, user["id"])
        e = client.get("/v1/entitlements", headers=h).json()
        assert e["plan"] == "pro" and e["usage"]["live_minutes"] == 0.0
        assert client.post("/v1/sessions", headers=h, json={"title": "on Pro"}).status_code == 201
        _set_grant_until(client, user["id"], datetime.now(UTC) - timedelta(minutes=1))
        assert _wallet(client, h)["interview_minutes_left"] == 5.0
    finally:
        gen.close()


def test_a_beat_racing_the_final_usage_write_is_not_an_error(client: TestClient,
                                                             monkeypatch: pytest.MonkeyPatch) -> None:
    """session.end right after connecting: the recorder's final write can insert the connection's row while the first
    heartbeat is inserting it too. The beat failed with an IntegrityError (logged as a failed heartbeat)."""
    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    sid = client.post("/v1/sessions", headers=h, json={"title": "quick end"}).json()["id"]
    key = f"live:{uuid.uuid4()}"
    final = UsageEvent(user_id=uid, session_id=sid, metric="live_seconds", quantity=30, pool=credits.POOL,
                       idempotency_key=key)

    async def final_write_first() -> None:
        async with sessionmaker()() as db:
            db.add(final)
            await db.commit()

    async def looked_before_it_landed(db: Any, event: UsageEvent) -> None:
        db.add(event)  # the beat's lookup ran before the final write's insert: it inserts too

    client.portal.call(final_write_first)  # type: ignore[union-attr]
    monkeypatch.setattr(routes, "upsert_usage", looked_before_it_landed)
    left = client.portal.call(routes._commit_live_seconds, uid, sid,  # type: ignore[union-attr]
                              InterviewTime(key, pool=credits.POOL), 5)
    assert left == 20 * 60 - 30  # the final write's 30 seconds are what counts

def test_existing_usage_is_given_the_grant_it_was_metered_on() -> None:
    """The migration that added usage.pool replays the admin's grants from the audit log, as set_access applied them."""
    path = Path(__file__).parents[1] / "alembic" / "versions" / "45a95e374d53_usage_pool.py"
    spec = importlib.util.spec_from_file_location("usage_pool_migration", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    t0 = datetime(2026, 10, 3, 12, 0)  # naive, as SQLite returns it
    windows = migration.grant_windows([
        (t0, "admin.access.grant", "u1 pro 2.0h"),
        (t0 + timedelta(hours=1), "admin.access.grant", "u1 pro 2.0h"),  # extends the running grant to t0+4h
        (t0 + timedelta(hours=5), "admin.access.grant", "u1 unlimited 10.0h"),
        (t0 + timedelta(hours=6), "admin.access.revoke", "u1"),
        (t0, "admin.access.grant", "u2 pro 1.0h"),
        (t0 + timedelta(minutes=30), "admin.access.grant", "u2 unlimited 1.0h"),  # replaces it from then
        (t0, "admin.access.approve", "u3"),
        (t0, "admin.access.grant", "garbage"),
    ])
    at = t0.replace(tzinfo=UTC)
    assert windows["u1"] == [[at, at + timedelta(hours=4), "pro"],
                             [at + timedelta(hours=5), at + timedelta(hours=6), "unlimited"]]
    assert windows["u2"] == [[at, at + timedelta(minutes=30), "pro"],
                             [at + timedelta(minutes=30), at + timedelta(minutes=90), "unlimited"]]
    assert windows["u3"] == []


def test_bigger_credit_packs_cost_less_an_hour_and_stay_30_percent_under_parakeet() -> None:
    """1, 3, 6 + 2 free and 9 + 6 free credits (1 credit = 1 hour), each cheaper an hour than the one before, and
    about 30% under Parakeet AI's $38 / $59 / $118 / $177 at ≈ ₹88 to the dollar."""
    interview = sorted((p for p in DEFAULT_PACKS if p.interview_minutes), key=lambda p: p.price_inr)
    per_hour = [p.price_inr / (p.total_minutes / 60) for p in interview]
    assert per_hour == sorted(per_hour, reverse=True) and len(set(per_hour)) == len(per_hour)
    for p, usd in zip(interview, (38, 59, 118, 177), strict=True):
        assert p.price_inr <= usd * 88 * 0.7
    assert all(p.resume_credits == p.total_minutes // 6 for p in interview)  # 10 Resume AI credits an hour


def test_no_welcome_credits_in_production_without_the_proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    # Without it the network can be spoofed, so "one welcome per network" can't hold: nothing is granted.
    from orbit_api.models import User

    monkeypatch.setattr(get_settings(), "env", "production")
    monkeypatch.setattr(get_settings(), "proxy_secret", None)

    async def grant() -> bool:
        async with sessionmaker()() as db:
            user = User(email=f"held-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
            return await credits.grant_welcome(db, user, _new_ip())

    import asyncio

    assert asyncio.run(grant()) is False


def test_readiness_and_the_admin_flag_a_missing_proxy_secret(client: TestClient,
                                                             monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.admin.overview import setup_warnings

    monkeypatch.setattr(get_settings(), "env", "production")
    monkeypatch.setattr(get_settings(), "proxy_secret", None)
    r = client.get("/ready")
    assert r.status_code == 503 and r.json()["checks"]["proxy_secret"] == "missing"
    assert setup_warnings() == ["proxy_secret"]
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    r = client.get("/ready")
    assert r.status_code == 200 and r.json()["checks"]["proxy_secret"] == "ok"
    assert setup_warnings() == []


def test_the_admin_is_told_when_the_web_worker_sends_no_proxy_secret(client: TestClient,
                                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import ratelimit
    from orbit_api.admin.overview import setup_warnings

    monkeypatch.setattr(ratelimit, "_last_signed", 0)
    monkeypatch.setattr(ratelimit, "_last_unsigned_site", 0)
    monkeypatch.setattr(get_settings(), "env", "production")
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    monkeypatch.setattr(get_settings(), "web_url", "https://orbitanswer.com")
    worker = {"CF-Worker": "orbitanswer.com", "X-Orbit-Client-Country": "US"}

    def packs(headers: dict[str, str]) -> str:
        return str(client.get("/v1/billing/packs", headers=headers).json()[0]["currency"])

    # A direct caller without the secret is any outside caller; the Worker with it is believed.
    assert packs({"X-Orbit-Client-Country": "US"}) == "INR" and setup_warnings() == []
    assert packs({**worker, "X-Orbit-Proxy-Secret": PROXY}) == "USD" and setup_warnings() == []
    # The Worker without it (no PROXY_SECRET there): the visitor abroad is priced as in India, and the admin hears.
    assert packs(worker) == "INR" and setup_warnings() == ["proxy_unsigned"]
    # Fixed (the secret arrives again): the warning goes at once, without a restart.
    assert packs({**worker, "X-Orbit-Proxy-Secret": PROXY}) == "USD" and setup_warnings() == []
    # A branch preview runs on workers.dev without the secret by design: not a warning.
    assert packs({**worker, "CF-Worker": "ishfaq.workers.dev"}) == "INR" and setup_warnings() == []
