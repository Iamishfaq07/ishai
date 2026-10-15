"""The public engineering telemetry: aggregate live latency only once enough sessions were measured, an honest
"up for", cached, and open to anyone."""

from typing import Any

from fastapi.testclient import TestClient

from orbit_api import telemetry
from orbit_api.models import LiveSessionRow
from tests.test_admin_console import _db, _user, console  # noqa: F401  (fixture)


def _measured(client: TestClient, user_id: str, n: int) -> None:
    async def go(db: Any) -> None:
        for i in range(n):
            db.add(LiveSessionRow(user_id=user_id, title=f"t{i}", type="interview", status="ended",
                                  metrics={"first_token_after_question": [400 + i * 10, 500],
                                           "question_after_speech": [700]}))
        await db.commit()

    _db(client, go)


def test_nothing_until_enough_sessions_then_percentiles(console: Any) -> None:  # noqa: F811
    client, _, _ = console
    telemetry.reset_cache()
    client.cookies.clear()
    r = client.get("/v1/public/engineering-telemetry")
    assert r.status_code == 200 and "max-age=300" in r.headers["cache-control"]
    body = r.json()
    assert body["window_days"] == 7 and body["up_for_s"] >= 0
    if body["sessions"] == 0:  # a fresh database: too few sessions to say anything
        assert body["first_word"] is None and body["question_detected"] is None
    _, user = _user(client, "tele")
    _measured(client, user["id"], telemetry.MIN_SESSIONS)
    assert client.get("/v1/public/engineering-telemetry").json()["sessions"] == body["sessions"]  # still cached
    telemetry.reset_cache()  # cached five minutes; a fresh read sees the new sessions
    fresh = client.get("/v1/public/engineering-telemetry").json()
    assert fresh["sessions"] >= telemetry.MIN_SESSIONS
    fw = fresh["first_word"]
    assert fw["samples"] >= 2 * telemetry.MIN_SESSIONS and fw["p95_ms"] >= fw["p50_ms"] >= 0
    assert set(fresh) == {"window_days", "sessions", "question_detected", "first_word", "up_for_s", "measured_at"}
