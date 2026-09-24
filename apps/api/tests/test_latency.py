"""Latency is measured from the interviewer's actual speech, on a timeline that survives pauses and reconnects."""

from typing import Any

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.metrics import AudioClock, LatencySamples, merge, percentile, summarize
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import STTConfig, TranscriptEvent
from orbit_api.providers.stt.deepgram import DeepgramSession
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink

FRAME = b"\x00\x00" * 1600  # 100 ms of PCM16 mono 16 kHz


def test_audio_clock_maps_audio_time_to_arrival_time_across_a_pause() -> None:
    clock = AudioClock()
    for i in range(10):  # 0–1 s of audio, arriving in real time
        clock.sent(len(FRAME), 100 * (i + 1))
    for i in range(10):  # paused for 5 s (nothing forwarded), then 1–2 s of audio
        clock.sent(len(FRAME), 6_100 + 100 * i)
    assert clock.server_time(500) == 500
    assert clock.server_time(1_500) == 6_500  # the provider's 1.5 s arrived at server t=6.5 s, not 1.5 s
    assert clock.server_time(50_000) is None and AudioClock().server_time(10) is None


def test_percentiles_merge_and_summary() -> None:
    assert percentile([5, 1, 3, 2, 4], 50) == 3 and percentile([], 95) == 0
    s = LatencySamples()
    s.add("first_token_after_speech", 800)
    s.add("first_token_after_speech", -5)  # clock misalignment: dropped
    s.add("first_token_after_speech", 999_999)  # implausible: dropped
    s.add("not_a_metric", 1)
    assert s.as_dict() == {"first_token_after_speech": [800]}
    merged = merge({"first_token_after_speech": [600], "junk": [1]}, s.as_dict())
    assert merged == {"first_token_after_speech": [600, 800]}
    out = summarize([merged, {"stt_final": [300, 500]}])
    assert out["first_token_after_speech"] == {"n": 2, "p50": 600, "p95": 800, "p99": 800}  # nearest rank
    assert out["stt_final"]["n"] == 2


def test_deepgram_timestamps_continue_across_a_reconnect() -> None:
    import asyncio

    s = DeepgramSession("dg-test", "nova-3", STTConfig())
    asyncio.run(s.send_audio(FRAME * 30))  # 3 s go to a socket that then dies…
    s._start_socket_timeline()
    s._backlog.clear()  # replayed onto the first socket (as _run does)
    assert s.shift(TranscriptEvent("final", "hi", 100, 200)).end_ms == 200  # first socket: no shift
    s._ws = None
    asyncio.run(s.send_audio(FRAME * 5))  # …0.5 s buffered while reconnecting
    s._start_socket_timeline()  # new socket: its t=0 is where the backlog starts (3.0 s)
    ev = s.shift(TranscriptEvent("final", "again", 100, 400))
    assert (ev.start_ms, ev.end_ms) == (3_100, 3_400)


async def test_engine_measures_legs_from_the_end_of_speech() -> None:
    now = {"t": 0.0}
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", None, "en", "en", dev_mode=True),
                     LiveSettings(response_timing="quick"), send=sink,
                     llm=MockLLMProvider(), stt=MockSTTProvider(), index=SessionIndex([]),
                     clock=lambda: now["t"])
    await eng.start()

    async def audio(seconds: float) -> None:
        for _ in range(int(seconds * 10)):
            now["t"] += 0.1
            await eng.handle_audio(b"\x01" + FRAME)  # system channel = interviewer

    await audio(1.0)  # speech runs 0.2–1.9 s on the audio timeline
    now["t"] += 0.15
    await eng.on_transcript("system", TranscriptEvent("partial", "What is a", 200, 900))
    await audio(1.0)
    now["t"] += 0.3  # the final arrives 0.3 s after the audio carrying the end of speech
    await eng.on_transcript("system", TranscriptEvent("final", "What is a race condition?", 200, 1_900,
                                                      endpoint=True))
    await sink.wait_for("answer.completed")
    await eng.end()
    lat: dict[str, Any] = eng.latency.as_dict()
    assert lat["stt_first_partial"] == [950]  # speech start (audio 0.2 s, arrived t=0.2) → partial at t=1.15
    assert lat["stt_final"] == [400]  # end of speech (audio 1.9 s arrived t=2.05) → final at t=2.45
    assert lat["question_after_speech"][0] >= 400
    assert "first_token_after_speech" in lat and "first_token_after_question" in lat


def test_admin_latency_endpoint_is_admin_only_and_aggregates(monkeypatch: Any) -> None:
    import uuid

    from fastapi.testclient import TestClient

    from orbit_api.config import get_settings
    from orbit_api.db import sessionmaker
    from orbit_api.main import create_app
    from orbit_api.models import LiveSessionRow

    admin = f"owner-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setenv("ORBIT_ADMIN_EMAIL", admin)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            def login(email: str) -> dict[str, str]:
                r = c.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
                c.cookies.clear()
                return {"Authorization": f"Bearer {r.json()['access_token']}"}

            h_admin, h_guest = login(admin), login(f"guest-{uuid.uuid4().hex[:6]}@example.com")
            sid = c.post("/v1/sessions", headers=h_admin, json={"title": "timed"}).json()["id"]

            async def plant() -> None:
                async with sessionmaker()() as db:
                    row = await db.get(LiveSessionRow, sid)
                    assert row is not None
                    row.metrics = {"first_token_after_speech": [700, 900, 1100]}
                    await db.commit()

            assert c.portal is not None
            c.portal.call(plant)
            assert c.get("/v1/admin/latency", headers=h_guest).status_code == 403
            out = c.get("/v1/admin/latency?days=7", headers=h_admin).json()
            assert out["sessions"] >= 1
            assert out["metrics"]["first_token_after_speech"]["p50"] == 900
    finally:
        get_settings.cache_clear()
