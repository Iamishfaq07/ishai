"""Tests for the backend-hardening audit fixes (H1/H2/H3/M8/etc.)."""

import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings


def _prod(**over: object) -> dict[str, object]:
    base = dict(ORBIT_ENV="production", ORBIT_JWT_SECRET="Q8f2LmZr7Tq1VbN4xKc9WsYe3HpJd6Ug",
                ORBIT_SMTP_HOST="smtp.example.com",
                ORBIT_DATABASE_URL="postgresql+asyncpg://u:p@db/orbit", DEEPSEEK_API_KEY="sk-x",
                DEEPGRAM_API_KEY="dg-x", ORBIT_LLM_PROVIDER="auto", ORBIT_STT_PROVIDER="auto",
                ORBIT_ADMIN_EMAIL="owner@example.com")
    base.update(over)
    return base


def test_production_requires_an_explicit_admin() -> None:
    with pytest.raises(ValueError, match="ORBIT_ADMIN_EMAIL"):
        Settings(**_prod(ORBIT_ADMIN_EMAIL=None))
    with pytest.raises(ValueError, match="ORBIT_ADMIN_EMAIL"):
        Settings(**_prod(ORBIT_ADMIN_EMAIL="  "))
    Settings(**_prod(ORBIT_ENV="development", ORBIT_ADMIN_EMAIL=None))  # optional outside production


def test_first_user_is_never_admin_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    from types import SimpleNamespace

    from orbit_api import entitlements
    from orbit_api.models import User

    first = User(id="u1", email="first@example.com", password_hash="x")

    class _DB:
        async def scalar(self, _q: object) -> str:
            return "u1"  # the queried "first registered user" is `first`

    def run(**cfg: object) -> bool:
        monkeypatch.setattr(entitlements, "get_settings", lambda: SimpleNamespace(**cfg))
        return asyncio.run(entitlements.is_admin(_DB(), first))  # type: ignore[arg-type]

    assert run(env="development", admin_email=None)  # local convenience only
    assert not run(env="production", admin_email=None)
    assert not run(env="production", admin_email="owner@example.com")
    # the admin address must be verified whenever mail can be delivered (else the first registrant would win)
    admin = dict(env="production", admin_email=" FIRST@example.com ")
    assert run(**admin, verification_required=False)
    assert not run(**admin, verification_required=True)
    first.email_verified = True
    assert run(**admin, verification_required=True)


def test_production_requires_real_providers_and_postgres() -> None:
    # H1: auto + missing key must fail, not silently mock.
    Settings(**_prod())  # valid baseline
    with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
        Settings(**_prod(DEEPSEEK_API_KEY=None))
    with pytest.raises(ValueError, match="DEEPGRAM_API_KEY"):
        Settings(**_prod(DEEPGRAM_API_KEY=None))
    with pytest.raises(ValueError, match="mock"):
        Settings(**_prod(ORBIT_LLM_PROVIDER="mock"))
    with pytest.raises(ValueError, match="Postgres"):
        Settings(**_prod(ORBIT_DATABASE_URL="sqlite+aiosqlite:///./x.db"))
    # SMTP is optional in production (email features just turn off) — must NOT raise.
    Settings(**_prod(ORBIT_SMTP_HOST=None))


def test_production_without_smtp_disables_email_instead_of_leaking_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings
    from orbit_api.providers.email import DevOutbox, NoEmailSender, get_email_sender

    get_email_sender.cache_clear()
    monkeypatch.setattr(get_settings(), "env", "production")
    monkeypatch.setattr(get_settings(), "smtp_host", None)
    sender = get_email_sender()
    # Prod without SMTP → NoEmailSender (drops + logs, never logs the token), not DevOutbox.
    assert isinstance(sender, NoEmailSender) and not isinstance(sender, DevOutbox)
    get_email_sender.cache_clear()


def test_ready_probe_checks_db(client: TestClient) -> None:
    r = client.get("/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready" and body["checks"]["database"] == "ok"


def _register(client: TestClient) -> dict[str, str]:
    email = f"hard-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": "hardening test pw"})
    assert r.status_code == 201
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_live_ticket_and_ws_enforce_quota(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.websockets import WebSocketDisconnect

    from orbit_api.sessions import routes

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "quota"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]  # ok while under cap

    async def _exhausted(_db: object, _uid: str, _type: str = "interview") -> float:
        return 0.0

    monkeypatch.setattr(routes, "minutes_remaining", _exhausted)
    # H2: over quota → ticket issuance blocked (was only checked at session create).
    assert client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).status_code == 402
    # ...and the WS accept re-checks too (a pre-issued ticket can't stream after the cap).
    try:
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
            ws.receive_text()
        raise AssertionError("over-quota WS accepted")
    except WebSocketDisconnect as e:
        assert e.code == 4003


async def test_generate_report_is_idempotent() -> None:
    from orbit_api.db import create_all, sessionmaker
    from orbit_api.models import LiveSessionRow, SessionTurn, User
    from orbit_api.sessions.report import generate_report

    await create_all()
    async with sessionmaker()() as db:
        user = User(email=f"rep-{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
        db.add(user)
        await db.flush()
        row = LiveSessionRow(user_id=user.id, type="interview", title="r", status="ended")
        db.add(row)
        await db.flush()
        db.add(SessionTurn(id=uuid.uuid4().hex, session_id=row.id, speaker="interviewer",
                           text="Tell me about yourself.", start_ms=0, end_ms=100))
        await db.commit()
        sid = row.id

    r1 = await generate_report(sid)
    r2 = await generate_report(sid)  # second run must not crash on the unique(session_id)
    assert r1["questions_asked"] == r2["questions_asked"]
    async with sessionmaker()() as db:
        from orbit_api.models import SessionSummary
        rows = (await db.scalars(SessionSummary.__table__.select().where(SessionSummary.session_id == sid))).all()
        # exactly one summary row despite two runs
        assert len([x for x in rows]) == 1
