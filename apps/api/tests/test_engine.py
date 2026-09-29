"""Engine behaviour that the WebSocket E2E can't pin down precisely: cancellation, pinning, failures."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex


class Sink:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def __call__(self, msg: dict[str, Any]) -> None:
        self.events.append(msg)

    def of(self, type_: str) -> list[dict[str, Any]]:
        return [e["data"] for e in self.events if e["type"] == type_]

    async def wait_for(self, type_: str, n: int = 1, timeout: float = 5.0) -> None:
        async with asyncio.timeout(timeout):
            while len(self.of(type_)) < n:
                await asyncio.sleep(0.01)


async def _engine(llm: LLMProvider, **settings: Any) -> tuple[LiveEngine, Sink]:
    settings.setdefault("response_timing", "quick")  # these tests are about cancel/pin/retry, not patience
    sink = Sink()
    eng = LiveEngine(
        SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True),
        LiveSettings(**settings), send=sink, llm=llm, stt=MockSTTProvider(), index=SessionIndex([]),
    )
    await eng.start()
    return eng, sink


async def _ask(eng: LiveEngine, text: str) -> None:
    await eng.on_transcript("system", TranscriptEvent("final", text, 0, 100, endpoint=True))


async def test_new_question_cancels_stale_generation() -> None:
    eng, sink = await _engine(MockLLMProvider(chunk_delay_s=0.02))
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.chunk")
    # the candidate answers, so the interviewer's next words are a new question (not a continuation)
    await eng.on_transcript("mic", TranscriptEvent("final", "So dependency injection means passing", 0, 100,
                                                   endpoint=True))
    await _ask(eng, "How would you design a rate limiter?")
    await sink.wait_for("answer.completed")
    cancelled = sink.of("answer.cancelled")
    assert len(cancelled) == 1 and cancelled[0]["reason"] == "superseded"
    assert sink.of("answer.completed")[0]["answer"]["question"] == "How would you design a rate limiter?"
    await eng.end()


async def test_pinned_answer_survives_new_question_but_not_clear() -> None:
    eng, sink = await _engine(MockLLMProvider(chunk_delay_s=0.02))
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.started")
    first = sink.of("answer.started")[0]["answer_id"]
    await eng.handle_client({"type": "answer.pin", "data": {"answer_id": first, "pinned": True}})
    await _ask(eng, "How would you design a rate limiter?")
    await sink.wait_for("answer.completed", 2)
    assert sink.of("answer.cancelled") == []

    await _ask(eng, "Why do you want this role?")
    await sink.wait_for("answer.chunk", len(sink.of("answer.chunk")) + 1)
    await eng.handle_client({"type": "answer.clear", "data": {}})
    await sink.wait_for("answer.cancelled")
    assert sink.of("answer.cancelled")[0]["reason"] == "cleared"
    await eng.end()


async def test_manual_answer_uses_latest_interviewer_utterance_even_with_auto_off() -> None:
    eng, sink = await _engine(MockLLMProvider(), auto_answer=False)
    await _ask(eng, "We rely on Kafka for event streaming across teams")
    await asyncio.sleep(0.1)
    assert sink.of("answer.started") == []  # auto answer off, and it's not a question anyway
    await eng.handle_client({"type": "answer.request", "data": {}})
    await sink.wait_for("answer.completed")
    assert sink.of("answer.started")[0]["source"] == "manual"
    assert "Kafka" in sink.of("question.detected")[0]["text"]
    await eng.end()


async def test_manual_answer_without_any_question_reports_error() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await eng.handle_client({"type": "answer.request", "data": {}})
    assert sink.of("error")[0]["code"] == "no_question"
    await eng.end()


class FlakyLLM(LLMProvider):
    name = "flaky"

    def __init__(self, failures: int, retryable: bool = True) -> None:
        self.failures = failures
        self.retryable = retryable
        self.calls = 0

    def model_for(self, reasoning: str) -> str:  # type: ignore[override]
        return "flaky-1"

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        self.calls += 1
        if self.calls <= self.failures:
            raise LLMError("timeout", "slow", retryable=self.retryable)
        yield LLMChunk("ANSWER: ok\n- point")


async def test_retryable_error_is_retried_once() -> None:
    llm = FlakyLLM(failures=1)
    eng, sink = await _engine(llm)
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    assert llm.calls == 2
    states = [e["data"]["state"] for e in sink.events if e["type"] == "state.changed"]
    assert "ai_reconnecting" in states
    await eng.end()


async def test_persistent_failure_surfaces_answer_failed_and_recovers() -> None:
    eng, sink = await _engine(FlakyLLM(failures=5, retryable=False))
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.failed")
    assert sink.of("answer.failed")[0]["error"]["code"] == "timeout"
    assert eng.state.value == "listening"
    await eng.end()


async def test_duplicate_stt_fragments_generate_once() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await _ask(eng, "Tell me about yourself.")
    await _ask(eng, "Tell me about yourself.")  # STT re-sends as a new segment
    await sink.wait_for("answer.completed")
    await asyncio.sleep(0.1)
    assert len(sink.of("question.detected")) == 1
    await eng.end()


async def test_paused_session_ignores_speech_and_ended_state() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await eng.handle_client({"type": "session.pause", "data": {}})
    await _ask(eng, "What is dependency injection?")
    await asyncio.sleep(0.05)
    assert sink.of("question.detected") == []
    await eng.handle_client({"type": "session.end", "data": {}})
    assert sink.of("session.ended") and eng.state.value == "ended"


async def test_simulation_forbidden_without_dev_mode() -> None:
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", None, "en", "en", dev_mode=False), LiveSettings(),
                     send=sink, llm=MockLLMProvider(), stt=MockSTTProvider(), index=SessionIndex([]))
    await eng.start()
    await eng.handle_client({"type": "dev.simulate", "data": {"fixture": "meeting"}})
    assert sink.of("error")[0]["code"] == "forbidden"
    await eng.handle_client({"type": "dev.simulate", "data": {"fixture": "../../etc/passwd"}})
    assert sink.of("error")[1]["code"] == "invalid_event"
    await eng.end()


async def test_audio_frames_are_routed_per_channel_and_acknowledged() -> None:
    eng, sink = await _engine(MockLLMProvider())
    pcm = b"\x01\x00" * 800  # 50 ms of PCM16 @ 16 kHz
    await eng.handle_audio(b"\x00" + pcm)
    await eng.handle_audio(b"\x00" + pcm)
    await eng.handle_audio(b"\x01" + pcm)
    await eng.handle_audio(b"\x07" + pcm)  # unknown channel → dropped
    await eng.handle_audio(b"\x00" + pcm + b"\x00")  # odd byte count → dropped
    assert eng.channel_bytes == {"mic": 3200, "system": 1600}
    acks = [e for e in sink.events if e["type"] in ("audio.mic_status", "audio.system_status")
            and e["data"].get("detail") == "receiving"]
    assert [e["type"] for e in acks] == ["audio.mic_status", "audio.system_status"]  # once per channel
    await eng.end()


async def test_stt_status_reconnect_clears_and_down_is_reported() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await eng.on_transcript("system", TranscriptEvent("status", status="reconnecting"))
    await eng.on_transcript("system", TranscriptEvent("status", status="connected"))
    stt = [p for p in sink.of("provider.status") if p["provider"] == "stt"]
    assert [p["state"] for p in stt][-2:] == ["reconnecting", "ok"]  # banner clears after reconnect
    assert eng.state.value == "listening"

    await eng.on_transcript("mic", TranscriptEvent("status", "the Deepgram API key was rejected", status="down"))
    down = [p for p in sink.of("provider.status") if p["provider"] == "stt"][-1]
    assert down["state"] == "down" and "key was rejected" in down["detail"]
    assert sink.of("audio.mic_status")[-1]["state"] == "error"
    await eng.handle_client({"type": "session.end", "data": {}})


class RecordingLLM(MockLLMProvider):
    def __init__(self) -> None:
        super().__init__()
        self.requests: list[LLMRequest] = []

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        self.requests.append(request)
        async for chunk in super().stream(request):
            yield chunk


async def test_deep_questions_still_use_the_fast_model_live() -> None:
    llm = RecordingLLM()
    eng, sink = await _engine(llm)
    await _ask(eng, "How would you design a distributed rate limiter that scales to a million requests per second?")
    await sink.wait_for("answer.completed")
    assert sink.of("answer.started")[0]["reasoning"] == "deep"  # still flagged for the UI
    assert llm.requests and all(r.reasoning == "light" for r in llm.requests)  # never the slow reasoner
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_response_timing_waits_before_answering_and_is_live_adjustable() -> None:
    eng, sink = await _engine(MockLLMProvider(), response_timing="balanced")
    await _ask(eng, "What is dependency injection?")
    await asyncio.sleep(0.4)
    assert sink.of("question.detected") == []  # still listening in case the interviewer continues
    await sink.wait_for("question.detected")
    await eng.handle_client({"type": "settings.update", "data": {"response_timing": "patient"}})
    assert eng._finalizer.grace_ms == 3000 and eng.settings.response_timing == "patient"
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_live_thinking_setting_reaches_the_model() -> None:
    llm = RecordingLLM()
    eng, sink = await _engine(llm, thinking="max")
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    answers = [r for r in llm.requests if r.request_type == "answer"]
    assert answers and all(r.thinking == "max" for r in answers)
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_question_continued_after_it_fired_is_answered_whole() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await _ask(eng, "Walk me through how you'd build an image classification pipeline.")
    await sink.wait_for("answer.completed")
    # interviewer keeps going after a pause; the candidate hasn't answered yet
    await _ask(eng, "Start with data, then preprocessing, and what failure modes you'd look for.")
    await sink.wait_for("question.updated")
    updated = sink.of("question.updated")[-1]["text"]
    assert updated.startswith("Walk me through") and updated.endswith("look for.")
    await sink.wait_for("answer.completed", n=2)
    assert sink.of("answer.completed")[-1]["answer"]["question"] == updated
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_manual_answer_with_auto_off_gets_the_whole_question() -> None:
    eng, sink = await _engine(MockLLMProvider(), auto_answer=False)
    await _ask(eng, "Walk me through how you'd build an image classification pipeline.")
    await _ask(eng, "Start with data, then preprocessing, and what failure modes you'd look for.")
    await asyncio.sleep(0.1)
    assert sink.of("question.detected") == []  # auto answer off: nothing fires on its own
    await eng.handle_client({"type": "answer.request", "data": {}})
    await sink.wait_for("answer.completed")
    q = sink.of("question.detected")[0]["text"]
    assert q.startswith("Walk me through") and "failure modes" in q
    await eng.handle_client({"type": "session.end", "data": {}})



async def test_a_question_that_grows_is_stored_whole() -> None:
    """The interviewer carries on after a question fired: the stored question (review, exports, history) becomes
    the whole question, not just the part that fired first."""
    from tests.test_mock_interview import Spy

    class Recording(Spy):
        def __init__(self) -> None:
            super().__init__()
            self.updates: list[tuple[str, str]] = []

        async def question_text(self, qid: str, text: str) -> None:
            self.updates.append((qid, text))

    rec = Recording()
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True),
                     LiveSettings(response_timing="quick"), send=sink, llm=MockLLMProvider(),
                     stt=MockSTTProvider(), index=SessionIndex([]), recorder=rec)  # type: ignore[arg-type]
    await eng.start()
    await _ask(eng, "Walk me through how you'd build an image classification pipeline.")
    await sink.wait_for("answer.completed")
    await _ask(eng, "Start with data, then preprocessing, and what failure modes you'd look for.")
    await sink.wait_for("question.updated")
    updated = sink.of("question.updated")[-1]
    assert rec.updates == [(updated["question_id"], updated["text"])]
    assert rec.questions[0][0].startswith("Walk me through")  # recorded once, then updated in place
    await eng.handle_client({"type": "session.end", "data": {}})


def test_recorder_updates_the_stored_question_text(client: Any) -> None:
    from orbit_api.sessions.recorder import DbRecorder
    from tests.test_api import _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "t"}).json()["id"]
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]

    async def record() -> None:
        rec = DbRecorder(sid, user_id, store_transcripts=True, usage_key=None, usage_metric="live_seconds")
        await rec.question("q-grow", None, "How do you prevent security gates from slowing engineering?",
                           "technical", 0.9, False, "auto")
        await rec.question_text("q-grow", "How do you prevent security gates from slowing engineering? "
                                          "What is dependency injection?")
        await rec.close()

    client.portal.call(record)
    stored = next(q for q in client.get(f"/v1/sessions/{sid}", headers=h).json()["questions"] if q["id"] == "q-grow")
    assert stored["text"].endswith("What is dependency injection?")


async def test_each_answer_is_noted_and_a_rewrite_replaces_its_note() -> None:
    eng, sink = await _engine(MockLLMProvider())
    await _ask(eng, "Tell me about a time you handled a conflict.")
    await sink.wait_for("answer.completed")
    assert [n.question for n in eng.memory.answers] == ["Tell me about a time you handled a conflict."]
    await eng.handle_client({"type": "chat.message", "data": {"text": "Make it shorter"}})
    await sink.wait_for("answer.completed", n=2)
    notes = list(eng.memory.answers)
    assert len(notes) == 1 and notes[0].question == "Tell me about a time you handled a conflict."
    await eng.end()
