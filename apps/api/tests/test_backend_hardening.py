"""Tests for the backend-hardening audit fixes (H1/H2/H3/M8/etc.)."""

import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings


def _prod(**over: object) -> dict[str, object]:
    base = dict(ORBIT_ENV="production", ORBIT_JWT_SECRET="x" * 40, ORBIT_SMTP_HOST="smtp.example.com",
                ORBIT_DATABASE_URL="postgresql+asyncpg://u:p@db/orbit", DEEPSEEK_API_KEY="sk-x",
                DEEPGRAM_API_KEY="dg-x", ORBIT_LLM_PROVIDER="auto", ORBIT_STT_PROVIDER="auto")
    base.update(over)
    return base


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
    with pytest.raises(ValueError, match="SMTP"):
        Settings(**_prod(ORBIT_SMTP_HOST=None))


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

    async def _exhausted(_db: object, _uid: str) -> float:
        return 0.0

    monkeypatch.setattr(routes, "live_minutes_remaining", _exhausted)
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
