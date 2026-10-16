"""Phase 1 correctness: LLM cost accounting, live-minute enforcement, screenshot credits, durable writes,
durable report jobs."""

import asyncio
import json
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.llm.base import LLMError, Usage
from orbit_api.providers.llm.pricing import estimate_cost, is_deepseek_peak, price_table

PEAK = datetime(2026, 9, 23, 2, 0, tzinfo=UTC)  # Wednesday 02:00 UTC
OFFPEAK = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)  # Wednesday 12:00 UTC
WEEKEND = datetime(2026, 9, 26, 2, 0, tzinfo=UTC)  # Saturday


# ---- cost accounting ---------------------------------------------------------------------------------------


def test_deepseek_flash_is_priced_with_cache_hits_and_peak_windows() -> None:
    u = Usage(input_tokens=1_000_000, output_tokens=1_000_000, cached_input_tokens=400_000)
    # peak: 0.4M hit x $0.006 + 0.6M miss x $0.30 + 1M out x $1.20
    assert estimate_cost("deepseek-flash", u, PEAK) == pytest.approx(0.0024 + 0.18 + 1.20)
    assert estimate_cost("deepseek-flash", u, OFFPEAK) == pytest.approx((0.0024 + 0.18 + 1.20) / 2)
    assert not is_deepseek_peak(WEEKEND) and is_deepseek_peak(PEAK)
    # legacy aliases bill as Flash; uncached-only and output-only requests
    assert estimate_cost("deepseek-chat", Usage(1_000_000, 0), PEAK) == pytest.approx(0.30)
    assert estimate_cost("deepseek-flash", Usage(0, 1_000_000), PEAK) == pytest.approx(1.20)


def test_naive_times_from_sqlite_are_utc_not_local() -> None:
    # SQLite hands back naive datetimes; astimezone() would read them in the machine's zone (IST: 02:00 -> 20:30 UTC)
    assert is_deepseek_peak(PEAK.replace(tzinfo=None))
    assert not is_deepseek_peak(OFFPEAK.replace(tzinfo=None))


def test_zero_tokens_cost_zero_and_unknown_models_are_unknown_not_free(caplog: Any) -> None:
    assert estimate_cost("deepseek-flash", Usage(), PEAK) == 0.0
    with caplog.at_level("WARNING"):
        assert estimate_cost(f"some-new-model-{uuid.uuid4().hex[:4]}", Usage(1000, 1000)) is None
    assert "no price configured" in caplog.text
    # cached count can never exceed input (bad provider data doesn't produce negative misses)
    assert estimate_cost("deepseek-flash", Usage(10, 0, cached_input_tokens=50), PEAK) == pytest.approx(
        10 * 0.006 / 1_000_000)


def test_pricing_can_be_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings

    monkeypatch.setenv("ORBIT_LLM_PRICING_JSON", json.dumps({"house-model": {"cache_miss": 2.0, "output": 4.0}}))
    get_settings.cache_clear()
    price_table.cache_clear()
    try:
        assert estimate_cost("house-model", Usage(500_000, 250_000, 100_000)) == pytest.approx(1.0 + 1.0)
    finally:
        monkeypatch.delenv("ORBIT_LLM_PRICING_JSON")
        get_settings.cache_clear()
        price_table.cache_clear()


def test_streamed_deepseek_usage_reports_cache_hits() -> None:
    import httpx

    from orbit_api.providers.llm.base import LLMMessage, LLMRequest
    from orbit_api.providers.llm.deepseek import DeepSeekProvider

    body = (
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'
        'data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":12,'
        '"prompt_cache_hit_tokens":640,"prompt_cache_miss_tokens":260}}\n\n'
        "data: [DONE]\n\n"
    )
    p = DeepSeekProvider("sk-test", "https://api.deepseek.test", "deepseek-flash", "deepseek-flash")
    p._client = httpx.AsyncClient(base_url="https://api.deepseek.test",
                                  transport=httpx.MockTransport(lambda r: httpx.Response(200, text=body)))
    resp = asyncio.run(p.generate(LLMRequest(messages=[LLMMessage("user", "hello")])))
    assert resp.text == "Hi"
    assert (resp.usage.input_tokens, resp.usage.cached_input_tokens, resp.usage.output_tokens) == (900, 640, 12)


# Free accounts' interview time: the welcome credits (credits.py).
WELCOME_S = 20 * 60


# ---- helpers -----------------------------------------------------------------------------------------------


@pytest.fixture
def fast_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A client whose live-minute heartbeat runs every 0.1 s."""
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    monkeypatch.setenv("ORBIT_LIVE_HEARTBEAT_S", "0.1")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            _user(c)  # never the dev-mode "first user = admin" in these tests
            yield c
    finally:
        get_settings.cache_clear()


def _user(client: TestClient) -> tuple[dict[str, str], str]:
    email = f"p1-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return h, client.get("/v1/auth/me", headers=h).json()["id"]


def _add_usage(user_id: str, metric: str, quantity: float, key: str | None = None) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    async def go() -> None:
        async with sessionmaker()() as db:
            db.add(UsageEvent(user_id=user_id, metric=metric, quantity=quantity, idempotency_key=key))
            await db.commit()

    asyncio.run(go())


def _live_rows(user_id: str) -> list[tuple[str | None, float]]:
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    async def go() -> list[tuple[str | None, float]]:
        async with sessionmaker()() as db:
            rows = (await db.execute(select(UsageEvent.idempotency_key, UsageEvent.quantity).where(
                UsageEvent.user_id == user_id, UsageEvent.metric == "live_seconds"))).all()
            return [(k, q) for k, q in rows]

    return asyncio.run(go())


def _call(c: TestClient, fn: Any, *args: Any) -> Any:
    """Run a coroutine function on the app's own event loop (the one its DB engine is bound to)."""
    assert c.portal is not None
    return c.portal.call(fn, *args)


def _collect(ws: Any, until: Any, timeout_s: float = 20) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        events.append(json.loads(ws.receive_text()))
        if until(events):
            return events
    raise AssertionError(f"timed out; got {[e['type'] for e in events]}")


def _live(client: TestClient, h: dict[str, str], sid: str) -> Any:
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    return client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}")


def _session(client: TestClient, h: dict[str, str], **body: Any) -> str:
    r = client.post("/v1/sessions", headers=h, json={"title": "p1", **body})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


# ---- live-minute enforcement -------------------------------------------------------------------------------


def test_session_is_warned_then_ended_at_the_live_minute_limit(fast_client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    h, uid = _user(fast_client)
    _add_usage(uid, "live_seconds", WELCOME_S - 2)  # free plan: the 20 welcome minutes; 2 s left
    sid = _session(fast_client, h)
    events: list[dict[str, Any]] = []
    try:
        with _live(fast_client, h, sid) as ws:
            events = _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev), timeout_s=10)
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_text()
            assert closed.value.code == 4003
    except WebSocketDisconnect:
        pass
    statuses = [e["data"] for e in events if e["type"] == "usage.status"]
    assert statuses[0]["limit_reached"] is False and statuses[0]["minutes_remaining"] <= 0.1  # the warning
    assert statuses[-1] == {"minutes_remaining": 0, "limit_reached": True, "reason": "monthly"}
    assert fast_client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["status"] == "ended"
    usage = fast_client.get("/v1/usage", headers=h).json()
    assert 20.0 <= usage["live_minutes_used"] <= 20.1  # stopped at the limit, not minutes past it
    # no way back in: a new session or a ticket is refused
    assert fast_client.post("/v1/sessions", headers=h, json={"title": "again"}).status_code == 402


def test_usage_is_committed_during_the_session_not_only_at_the_end(fast_client: TestClient) -> None:
    h, uid = _user(fast_client)
    sid = _session(fast_client, h)
    with _live(fast_client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        time.sleep(1.3)
        mid = _live_rows(uid)  # the socket is still open: a crash now would keep this
        assert len(mid) == 1 and mid[0][0] and mid[0][0].startswith("live:") and mid[0][1] >= 1
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    rows = _live_rows(uid)
    assert len(rows) == 1 and rows[0][1] >= mid[0][1]  # heartbeats + final write are one row, not a sum


def test_reconnect_meters_each_connection_once(fast_client: TestClient) -> None:
    h, uid = _user(fast_client)
    sid = _session(fast_client, h)
    for _ in range(2):  # drop, then rejoin
        with _live(fast_client, h, sid) as ws:
            _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
            time.sleep(1.1)
    deadline = time.monotonic() + 5
    while len(_live_rows(uid)) < 2 and time.monotonic() < deadline:
        time.sleep(0.05)
    rows = _live_rows(uid)
    assert len(rows) == 2 and len({k for k, _ in rows}) == 2 and all(q >= 1 for _, q in rows)


def test_a_second_session_cannot_double_the_allowance(fast_client: TestClient) -> None:
    """One live session per account: a second one can't open while the first runs, so the monthly allowance
    can't be spent twice in parallel — and the running one is still cut off at the limit."""
    from starlette.websockets import WebSocketDisconnect

    h, uid = _user(fast_client)
    _add_usage(uid, "live_seconds", WELCOME_S - 3)
    a, b = _session(fast_client, h), _session(fast_client, h)
    ended = False
    try:
        with _live(fast_client, h, a) as ws_a:
            _collect(ws_a, lambda ev: any(e["type"] == "session.started" for e in ev))
            r = fast_client.post(f"/v1/sessions/{b}/live-ticket", headers=h)
            assert r.status_code == 409 and r.json()["detail"]["code"] == "live_session_active"
            _collect(ws_a, lambda ev: any(e["type"] == "session.ended" for e in ev), timeout_s=10)
            ended = True
    except WebSocketDisconnect:
        pass
    assert ended
    assert sum(q for _, q in _live_rows(uid)) <= WELCOME_S + 3  # overshoot bounded by about one heartbeat


def test_unlimited_admin_is_metered_but_never_cut_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    admin = f"owner-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setenv("ORBIT_ADMIN_EMAIL", admin)
    monkeypatch.setenv("ORBIT_LIVE_HEARTBEAT_S", "0.1")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            r = c.post("/v1/auth/register", json={"email": admin, "password": "correct horse battery"})
            c.cookies.clear()
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            uid = c.get("/v1/auth/me", headers=h).json()["id"]
            _add_usage(uid, "live_seconds", 10_000 * 60)
            sid = _session(c, h)
            with _live(c, h, sid) as ws:
                _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
                time.sleep(0.6)
                ws.send_text(json.dumps({"type": "session.end", "data": {}}))
                events = _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
            assert not any(e["type"] == "usage.status" for e in events)
    finally:
        get_settings.cache_clear()


def test_usage_upsert_is_idempotent() -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent
    from orbit_api.sessions.recorder import write_durably

    with TestClient(__import__("orbit_api.main", fromlist=["create_app"]).create_app()) as c:
        _, uid = _user(c)
        key = f"live:{uuid.uuid4()}"

        async def go() -> None:
            for q in (10, 25, 25, 20):  # duplicates and an out-of-order (lower) value
                await write_durably(UsageEvent(user_id=uid, metric="live_seconds", quantity=q, idempotency_key=key))
            async with sessionmaker()() as db:
                from sqlalchemy import select

                rows = (await db.scalars(select(UsageEvent).where(UsageEvent.idempotency_key == key))).all()
                assert [r.quantity for r in rows] == [25]

        _call(c, go)


# ---- screenshot credits ------------------------------------------------------------------------------------

PNG = (Path(__file__).parent / "smoke" / "sum.png").read_bytes()


def test_failed_screenshot_analysis_costs_no_credit(fast_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.llm import get_llm_provider

    llm = get_llm_provider()
    real_stream = llm.stream

    def failing(request: Any) -> Any:
        if request.images:
            async def boom() -> Any:
                raise LLMError("http_503", "vision down", retryable=False)
                yield  # pragma: no cover
            return boom()
        return real_stream(request)

    monkeypatch.setattr(llm, "stream", failing)
    h, _ = _user(fast_client)
    sid = _session(fast_client, h, type="coding")
    with _live(fast_client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        r = fast_client.post(f"/v1/sessions/{sid}/screenshots", headers=h, files={"image": ("s.png", PNG, "image/png")})
        assert r.status_code == 202
        _collect(ws, lambda ev: any(e["type"] == "answer.failed" for e in ev))
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    assert fast_client.get("/v1/usage", headers=h).json()["screenshots_used"] == 0


# ---- durable writes ----------------------------------------------------------------------------------------


def test_transient_db_failures_are_retried_and_permanent_ones_dead_lettered(monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.main import create_app
    from orbit_api.models import FailedWrite, UsageEvent
    from orbit_api.sessions import recorder

    monkeypatch.setattr(recorder, "BACKOFF_S", 0.001)
    with TestClient(create_app()) as c:
        _, uid = _user(c)
        real = recorder.write_once
        calls = {"n": 0}

        async def flaky(obj: Any) -> None:
            calls["n"] += 1
            if calls["n"] <= fail_times:
                raise ConnectionError("db blip")
            await real(obj)

        monkeypatch.setattr(recorder, "write_once", flaky)

        async def count(model: Any, *where: Any) -> int:
            async with sessionmaker()() as db:
                return len((await db.scalars(select(model).where(*where))).all())

        fail_times = 2  # a blip: lands on the 3rd attempt
        ok = _call(c, recorder.write_durably, UsageEvent(user_id=uid, metric="stt_seconds", quantity=5))
        assert ok
        assert _call(c, count, UsageEvent, UsageEvent.user_id == uid, UsageEvent.metric == "stt_seconds") == 1

        calls["n"], fail_times = 0, 99  # an outage: dead-lettered, nothing lost
        ok = _call(c, recorder.write_durably, UsageEvent(user_id=uid, metric="screenshots", quantity=1))
        assert not ok
        assert _call(c, count, FailedWrite, FailedWrite.replayed_at.is_(None)) >= 1

        monkeypatch.setattr(recorder, "write_once", real)  # DB is back: replay restores the write
        assert _call(c, recorder.replay_failed_writes) >= 1
        assert _call(c, count, UsageEvent, UsageEvent.user_id == uid, UsageEvent.metric == "screenshots") == 1


async def _usage_rows(user_id: str, metric: str) -> int:
    from sqlalchemy import func, select

    from orbit_api.db import sessionmaker
    from orbit_api.models import UsageEvent

    async with sessionmaker()() as db:
        return int(await db.scalar(select(func.count()).select_from(UsageEvent).where(
            UsageEvent.user_id == user_id, UsageEvent.metric == metric)) or 0)


def test_spooled_writes_land_while_the_api_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Spooled writes (the DB was unreachable even for the dead-letter table) were replayed only at the next start,
    and on a host whose disk goes with the process (Render) the spool file is gone by then."""
    from orbit_api.main import create_app
    from orbit_api.models import UsageEvent
    from orbit_api.sessions import recorder

    with TestClient(create_app()) as c:
        _, uid = _user(c)
        spooled = UsageEvent(id=str(uuid.uuid4()), user_id=uid, metric="test_spooled", quantity=3)
        with recorder.spool_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "UsageEvent", "payload": recorder._to_payload(spooled), "error": "x"}) + "\n")
        assert c.portal is not None
        replayer = c.portal.start_task_soon(recorder.replayer, 0.05)
        try:
            deadline = time.monotonic() + 5
            while _call(c, _usage_rows, uid, "test_spooled") == 0 and time.monotonic() < deadline:
                time.sleep(0.05)
            assert _call(c, _usage_rows, uid, "test_spooled") == 1 and not recorder.spool_path().exists()
        finally:
            replayer.cancel()


def test_with_no_db_and_no_spool_a_write_is_held_in_memory_until_it_lands(monkeypatch: pytest.MonkeyPatch) -> None:
    """It used to be logged as LOST."""
    from orbit_api.main import create_app
    from orbit_api.models import UsageEvent
    from orbit_api.sessions import recorder

    async def down(obj: Any) -> None:
        raise ConnectionError("database unreachable")

    def no_table(**_k: Any) -> Any:
        raise ConnectionError("database unreachable")

    with TestClient(create_app()) as c:
        _, uid = _user(c)
        with monkeypatch.context() as outage:
            outage.setattr(recorder, "BACKOFF_S", 0.001)
            outage.setattr(recorder, "write_once", down)
            outage.setattr(recorder, "FailedWrite", no_table)
            outage.setattr(recorder, "spool_path", lambda: recorder.Path(str(uuid.uuid4())) / "no" / "spool.jsonl")
            assert not _call(c, recorder.write_durably, UsageEvent(user_id=uid, metric="test_held", quantity=1))
            assert [h["payload"]["metric"] for h in recorder._held] == ["test_held"]
        assert _call(c, recorder.replay_failed_writes) >= 1  # the database is back
        assert _call(c, _usage_rows, uid, "test_held") == 1 and recorder._held == []


def test_the_report_includes_writes_that_failed_during_an_outage(client: TestClient) -> None:
    """A question whose write was dead-lettered while the DB was out: the report written right after the session
    ended left it out (the dead letters were replayed only at the next start)."""
    from datetime import timedelta

    from orbit_api.db import sessionmaker
    from orbit_api.models import FailedWrite, Question
    from orbit_api.sessions import recorder
    from tests.test_api import _register, _wait_report

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "outage"}).json()["id"]
    question = Question(id=str(uuid.uuid4()), session_id=sid, text="How do you shard a ledger?", type="technical",
                        confidence=0.9, created_at=datetime.now(UTC) - timedelta(minutes=1))

    async def dead_letter() -> None:
        async with sessionmaker()() as db:
            db.add(FailedWrite(kind="Question", payload=recorder._to_payload(question), error="db down"))
            await db.commit()

    _call(client, dead_letter)
    assert client.post(f"/v1/sessions/{sid}/end", headers=h).status_code == 200
    detail = _wait_report(client, h, sid)
    assert detail["summary"]["questions_asked"] == ["How do you shard a ledger?"]
    assert [q["text"] for q in detail["questions"]] == ["How do you shard a ledger?"]


# ---- durable report jobs -----------------------------------------------------------------------------------


def test_report_jobs_retry_then_succeed_and_give_up_after_max_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import jobs
    from orbit_api.db import sessionmaker
    from orbit_api.main import create_app
    from orbit_api.models import Job

    monkeypatch.setattr(jobs, "RETRY_BACKOFF_S", (0, 0, 0))
    runs: list[str] = []

    @jobs.handler("test_flaky")
    async def flaky(payload: dict[str, Any]) -> None:
        runs.append(payload["id"])
        if payload["id"] == "never" or runs.count(payload["id"]) < 2:
            raise RuntimeError("provider 503")

    async def state(key: str) -> tuple[str, int]:
        async with sessionmaker()() as db:
            from sqlalchemy import select

            job = await db.scalar(select(Job).where(Job.dedupe_key == key))
            assert job is not None
            return job.status, job.attempts

    with TestClient(create_app()) as c:
        a, b = f"t:{uuid.uuid4()}", f"t:{uuid.uuid4()}"
        _call(c, jobs.enqueue_now, "test_flaky", {"id": "once"}, a)
        _call(c, jobs.enqueue_now, "test_flaky", {"id": "never"}, b)
        _call(c, jobs.enqueue_now, "test_flaky", {"id": "never"}, b)  # deduped
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if _call(c, state, a)[0] == "done" and _call(c, state, b)[0] == "failed":
                break
            time.sleep(0.05)
        assert _call(c, state, a) == ("done", 2)
        assert _call(c, state, b) == ("failed", jobs.MAX_ATTEMPTS)
        assert runs.count("never") == jobs.MAX_ATTEMPTS


def test_job_left_running_by_a_crashed_worker_is_recovered(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import timedelta

    from orbit_api import jobs
    from orbit_api.db import sessionmaker
    from orbit_api.main import create_app
    from orbit_api.models import Job

    done: list[bool] = []

    @jobs.handler("test_orphan")
    async def orphan(payload: dict[str, Any]) -> None:
        done.append(True)

    async def plant() -> None:
        async with sessionmaker()() as db:
            old = datetime.now(UTC) - timedelta(hours=1)
            db.add(Job(kind="test_orphan", payload={}, status="running", attempts=1, run_after=old, updated_at=old,
                       dedupe_key=f"o:{uuid.uuid4()}"))
            await db.commit()

    with TestClient(create_app()) as c:
        _call(c, plant)
        deadline = time.monotonic() + 5
        while not done and time.monotonic() < deadline:
            time.sleep(0.05)
    assert done


async def _job_state(key: str) -> tuple[str, int]:
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.models import Job

    async with sessionmaker()() as db:
        job = await db.scalar(select(Job).where(Job.dedupe_key == key))
        assert job is not None
        return job.status, job.attempts


def _until_done(c: TestClient, key: str, timeout_s: float = 5) -> tuple[str, int]:
    deadline = time.monotonic() + timeout_s
    while (state := _call(c, _job_state, key))[0] != "done" and time.monotonic() < deadline:
        time.sleep(0.05)
    return state  # type: ignore[no-any-return]


def test_a_job_cut_off_by_a_deploy_runs_again_at_once_without_spending_an_attempt() -> None:
    """A deploy shut the worker down mid-job: the job stayed "running" for STALE_AFTER (10 min), and the cancelled
    attempt counted toward MAX_ATTEMPTS."""
    from orbit_api import jobs
    from orbit_api.main import create_app

    runs: list[int] = []

    @jobs.handler("test_deploy")
    async def long_job(payload: dict[str, Any]) -> None:
        runs.append(len(runs))
        if len(runs) == 1:
            await asyncio.sleep(60)  # the deploy comes while the first run is still going

    key = f"d:{uuid.uuid4()}"
    with TestClient(create_app()) as c:
        _call(c, jobs.enqueue_now, "test_deploy", {}, key)
        deadline = time.monotonic() + 5
        while not runs and time.monotonic() < deadline:
            time.sleep(0.02)
        assert runs == [0]
    with TestClient(create_app()) as c:  # the next process
        assert _until_done(c, key) == ("done", 1)
    assert runs == [0, 1]


def test_a_job_left_running_by_a_killed_process_runs_when_the_next_one_starts() -> None:
    from orbit_api import db, jobs
    from orbit_api.main import create_app
    from orbit_api.models import Job

    done: list[bool] = []

    @jobs.handler("test_killed")
    async def killed(payload: dict[str, Any]) -> None:
        done.append(True)

    key = f"k:{uuid.uuid4()}"

    async def plant() -> None:  # the process died mid-job a moment ago: not stale yet
        async with db.sessionmaker()() as s:
            s.add(Job(kind="test_killed", payload={}, status="running", attempts=1, dedupe_key=key))
            await s.commit()
        await db.dispose()  # this loop's connections go with it

    asyncio.run(plant())
    with TestClient(create_app()) as c:
        # Picked up straight away. The killed attempt still counts: the job may be what took the process down.
        assert _until_done(c, key) == ("done", 2)
    assert done == [True]
