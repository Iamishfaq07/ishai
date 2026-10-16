"""Plans as server-side config, the entitlement service, separate mock minutes, feature gates, session ceiling."""

import asyncio
import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api import entitlements
from orbit_api.config import get_settings
from tests.test_phase1 import _add_usage, _collect, _live, _session, _user


@contextmanager
def app_with(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.main import create_app

    monkeypatch.setenv("ORBIT_LIVE_HEARTBEAT_S", "0.1")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            _user(c)  # never the dev-mode "first user = admin"
            yield c
    finally:
        for k in env:
            monkeypatch.delenv(k, raising=False)
        get_settings.cache_clear()


# ---- configuration --------------------------------------------------------------------------------------


def test_defaults_and_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    p = entitlements.plans()
    assert p["free"].credits and p["free"].max_session_minutes == 60  # interview time comes from credits
    assert not p["pro"].credits and p["pro"].live_minutes == 600
    assert p["unlimited"].live_minutes is None and p["unlimited"].max_session_minutes == 240  # still a ceiling
    monkeypatch.setenv("ORBIT_PLANS_JSON", json.dumps({
        "pro": {"live_minutes": 900, "price_usd_month": 29, "stripe_price_id": "price_123"},
        "free": {"features": ["live", "documents"]}}))
    monkeypatch.setenv("UNLIMITED_MAX_SESSION_MINUTES", "300")
    get_settings.cache_clear()
    try:
        p = entitlements.plans()
        assert p["pro"].live_minutes == 900 and p["pro"].price_usd_month == 29
        assert p["pro"].stripe_price_id == "price_123"
        assert not p["free"].has("vision") and p["unlimited"].max_session_minutes == 300
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("bad", [
    {"platinum": {"live_minutes": 1}},
    {"pro": {"live_minutes": -5}},
    {"pro": {"live_minutes": "lots"}},
    {"pro": {"price": 10}},
    {"pro": {"features": ["teleport"]}},
    {"free": {"max_session_minutes": 0}},
])
def test_invalid_plan_config_fails_fast(monkeypatch: pytest.MonkeyPatch, bad: dict[str, Any]) -> None:
    from orbit_api.main import create_app

    monkeypatch.setenv("ORBIT_PLANS_JSON", json.dumps(bad))
    get_settings.cache_clear()
    try:
        with pytest.raises(ValueError):
            create_app()
    finally:
        get_settings.cache_clear()


# ---- service + endpoints --------------------------------------------------------------------------------


def test_plans_endpoint_is_public_and_hides_stripe_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_PLANS_JSON=json.dumps({"pro": {"stripe_price_id": "price_secret"}})) as c:
        plans = c.get("/v1/plans").json()
        assert [p["name"] for p in plans] == ["free", "basic", "pro", "premium", "unlimited"]
        assert plans[0]["welcome"] == {"resume_credits": 1, "interview_minutes": 20}
        assert "price_secret" not in json.dumps(plans) and all("stripe_price_id" not in p for p in plans)


def test_entitlements_report_limits_usage_and_features(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch) as c:
        h, uid = _user(c)
        _add_usage(uid, "live_seconds", 600)
        _add_usage(uid, "mock_seconds", 120)
        c.post("/v1/documents/text", headers=h,
               json={"kind": "notes", "title": "n", "text": "some notes here about the role"})
        e = c.get("/v1/entitlements", headers=h).json()
        # Free: one interview balance (the 20 welcome minutes) that live and mock both draw on.
        assert e["plan"] == "free" and e["limits"]["live_minutes"] == 20 and e["limits"]["max_session_minutes"] == 60
        assert e["usage"] == {"live_minutes": 12.0, "mock_minutes": 12.0, "screenshots": 0, "documents": 1}
        assert e["credits"] == {"resume": 1, "interview_minutes_left": 8.0, "interview_minutes_total": 20.0,
                                "welcome_missed": False}
        assert e["features"]["vision"] is True and e["features"]["system_design"] is False


def test_mock_and_live_share_the_interview_credits(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch) as c:
        h, uid = _user(c)
        _add_usage(uid, "mock_seconds", 20 * 60)  # the 20 welcome minutes, spent on mock interviews
        for kind in ("mock", "interview"):
            r = c.post("/v1/sessions", headers=h, json={"title": "x", "type": kind})
            assert r.status_code == 402 and "Buy a pack" in r.text


def test_plans_with_their_own_allowance_keep_mock_and_live_apart(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_PLANS_JSON=json.dumps({"pro": {"mock_minutes": 1}})) as c:
        h, uid = _user(c)
        _grant(c, uid, "pro")
        _add_usage(uid, "mock_seconds", 60)  # pro: 1 mock minute here, all used
        r = c.post("/v1/sessions", headers=h, json={"title": "m", "type": "mock"})
        assert r.status_code == 402 and "mock minutes" in r.text
        assert c.post("/v1/sessions", headers=h, json={"title": "i"}).status_code == 201  # live minutes untouched


def test_mock_session_time_is_metered_as_mock_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch) as c:
        h, _ = _user(c)
        sid = _session(c, h, type="mock")
        with _live(c, h, sid) as ws:
            _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
            import time

            time.sleep(1.3)
            ws.send_text(json.dumps({"type": "session.end", "data": {}}))
            _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
        rows = _metric_rows(c, sid)
        assert rows.get("mock_seconds", 0) >= 1 and "live_seconds" not in rows


def test_features_gate_screenshots_and_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_PLANS_JSON=json.dumps({"free": {"features": ["live", "documents"]}})) as c:
        h, _ = _user(c)
        r = c.post("/v1/sessions", headers=h, json={"title": "m", "type": "mock"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "feature_unavailable"
        sid = _session(c, h)
        with _live(c, h, sid) as ws:
            _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
            png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
            r = c.post(f"/v1/sessions/{sid}/screenshots", headers=h, files={"image": ("s.png", png, "image/png")})
            assert r.status_code == 403 and r.json()["detail"]["code"] == "feature_unavailable"
            ws.send_text(json.dumps({"type": "session.end", "data": {}}))
            _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))


def _grant(c: TestClient, uid: str, plan: str) -> None:
    from datetime import UTC, datetime, timedelta

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    async def go() -> None:
        async with sessionmaker()() as db:
            u = await db.get(User, uid)
            assert u is not None
            u.grant_plan, u.grant_until = plan, datetime.now(UTC) + timedelta(days=1)
            await db.commit()

    assert c.portal is not None
    c.portal.call(go)


def _metric_rows(c: TestClient, sid: str) -> dict[str, float]:
    from sqlalchemy import func, select

    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    async def go() -> dict[str, float]:
        async with sessionmaker()() as db:
            rows = (await db.execute(select(UsageEvent.metric, func.sum(UsageEvent.quantity))
                                     .where(UsageEvent.session_id == sid).group_by(UsageEvent.metric))).all()
            return {m: float(q) for m, q in rows}

    assert c.portal is not None
    return c.portal.call(go)


# ---- per-session ceiling --------------------------------------------------------------------------------


def _set_duration(c: TestClient, sid: str, seconds: int) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow

    async def go() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.duration_s = seconds
            await db.commit()

    assert c.portal is not None
    c.portal.call(go)


def test_session_is_warned_then_ended_at_its_ceiling_and_cannot_reopen(monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.websockets import WebSocketDisconnect

    with app_with(monkeypatch) as c:
        h, _ = _user(c)
        sid = _session(c, h)
        _set_duration(c, sid, 60 * 60 - 2)  # free ceiling 60 min; earlier connections used all but 2 s
        events: list[dict[str, Any]] = []
        try:
            with _live(c, h, sid) as ws:
                events = _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev), timeout_s=10)
        except WebSocketDisconnect:
            pass
        statuses = [e["data"] for e in events if e["type"] == "usage.status"]
        assert statuses[0]["reason"] == "session" and statuses[0]["limit_reached"] is False
        assert statuses[-1] == {"minutes_remaining": 0, "limit_reached": True, "reason": "session"}
        assert c.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["status"] == "ended"

        sid2 = _session(c, h)
        _set_duration(c, sid2, 60 * 60)
        r = c.post(f"/v1/sessions/{sid2}/live-ticket", headers=h)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "session_time_limit"


def test_meter_prefers_the_nearer_limit() -> None:
    """Unit check of the choice: a session near its ceiling ends for "session" even with minutes to spare."""
    from orbit_api.sessions import routes
    from orbit_api.sessions.recorder import InterviewTime

    sent: list[tuple[str, dict[str, Any]]] = []

    class Eng:
        ended = False

        def now_ms(self) -> int:
            return 58_000

        async def send(self, t: str, d: dict[str, Any]) -> None:
            sent.append((t, d))

        async def end(self, *, final: bool) -> None:
            return None

    class WS:
        async def close(self, code: int, reason: str) -> None:
            sent.append(("close", {"code": code, "reason": reason}))

    async def plenty(*_a: Any, **_k: Any) -> float:
        return 3600.0

    orig = routes._commit_live_seconds
    routes._commit_live_seconds = plenty  # type: ignore[assignment]
    try:
        asyncio.run(routes._meter_live_minutes(WS(), Eng(), "u", "s", InterviewTime("k"),  # type: ignore[arg-type]
                                               asyncio.Event(), prior_session_s=2, max_session_s=60))
    finally:
        routes._commit_live_seconds = orig  # type: ignore[assignment]
    assert ("usage.status", {"minutes_remaining": 0, "limit_reached": True, "reason": "session"}) in sent
    assert sent[-1][1]["reason"] == "session time limit reached"
