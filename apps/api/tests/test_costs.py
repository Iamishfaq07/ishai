"""Admin cost dashboard (brief §40): exact numbers from seeded rows; unpriced is counted, never $0."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings


@contextmanager
def app_with(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.main import create_app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        for k in env:
            monkeypatch.delenv(k, raising=False)
        get_settings.cache_clear()


def _register(c: TestClient, email: str) -> tuple[str, dict[str, str]]:
    r = c.post("/v1/auth/register", json={"email": email, "password": "cost dashboard pw 1"})
    c.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return c.get("/v1/auth/me", headers=h).json()["id"], h


def _seed(c: TestClient, uid: str, sid: str) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import ProviderRequest, UsageEvent

    def pr(provider: str, model: str, rtype: str, i: int, cached: int, o: int, usd: float | None) -> ProviderRequest:
        return ProviderRequest(user_id=uid, session_id=sid, provider=provider, model=model, request_type=rtype,
                               input_tokens=i, cached_input_tokens=cached, output_tokens=o, latency_ms=500,
                               estimated_cost_usd=usd, ok=True)

    async def go() -> None:
        async with sessionmaker()() as db:
            db.add_all([
                pr("deepseek", "deepseek-flash", "answer", 1000, 800, 200, 0.0010),
                pr("deepseek", "deepseek-flash", "answer", 1000, 200, 400, 0.0020),
                pr("deepseek", "deepseek-flash", "vision", 2000, 0, 300, 0.0030),
                pr("backup", "gpt-x", "answer", 1000, 0, 200, None),  # unpriced backup call
                UsageEvent(user_id=uid, session_id=sid, metric="live_seconds", quantity=1800),
                UsageEvent(user_id=uid, session_id=sid, metric="stt_seconds", quantity=3600),  # 2 channels
                UsageEvent(user_id=uid, session_id=sid, metric="screenshots", quantity=1),
            ])
            await db.commit()

    assert c.portal is not None
    c.portal.call(go)


def test_cost_report_numbers(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = f"cost-admin-{uuid.uuid4().hex[:6]}@example.com"
    with app_with(monkeypatch, ORBIT_ADMIN_EMAIL=admin, ORBIT_STT_PRICE_PER_MINUTE="0.01") as c:
        _, ah = _register(c, admin)
        uid, h = _register(c, f"cost-user-{uuid.uuid4().hex[:6]}@example.com")
        sid = c.post("/v1/sessions", headers=h, json={"title": "c"}).json()["id"]
        _seed(c, uid, sid)
        assert c.get("/v1/admin/costs", headers=h).status_code == 403  # admins only
        r = c.get("/v1/admin/costs?days=30", headers=ah).json()

    t, live, llm = r["totals"], r["live"], r["llm"]
    assert t["llm_usd"] == pytest.approx(0.006) and t["stt_usd"] == pytest.approx(0.6)  # 60 min × $0.01
    assert t["usd"] == pytest.approx(0.606) and t["vision_usd"] == pytest.approx(0.003)
    assert t["unpriced_llm_requests"] == 1  # the backup call isn't silently $0
    assert live["hours"] == 0.5 and live["sessions"] == 1 and live["stt_minutes"] == 60.0
    assert live["usd_per_hour"] == pytest.approx(0.606 / 0.5) and live["usd_per_session"] == pytest.approx(0.606)
    assert live["screenshots"] == 1
    assert llm["requests"] == 4 and llm["cache_hit_ratio"] == pytest.approx(1000 / 5000)
    assert llm["tokens_per_answer"] == {"input": 1250, "output": 275}  # answers + chat + vision, ok ones
    assert llm["fallback_requests"] == 1
    backup = next(m for m in llm["by_model"] if m["provider"] == "backup")
    assert backup["unpriced"] == 1 and backup["usd"] == 0
    user = next(u for u in r["per_user"] if u["user_id"] == uid)
    assert user["usd"] == pytest.approx(0.606) and user["plan"] == "free"
    assert r["per_plan"]["free"]["users"] >= 1


def test_unknown_stt_price_is_unknown_not_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = f"cost-admin-{uuid.uuid4().hex[:6]}@example.com"
    with app_with(monkeypatch, ORBIT_ADMIN_EMAIL=admin, ORBIT_STT_PRICE_PER_MINUTE="") as c:
        _, ah = _register(c, admin)
        r = c.get("/v1/admin/costs", headers=ah).json()
    assert r["totals"]["stt_usd"] is None and r["notes"]["stt_price_per_minute"] is None
