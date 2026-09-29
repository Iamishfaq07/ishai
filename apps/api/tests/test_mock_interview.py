"""AI mock interviewer: asks, listens, moves on after the candidate finishes, ends the session, and gets recorded."""

import asyncio
import json
import time
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.mock_interviewer import ANSWER_SILENCE_MS, MockConfig
from orbit_api.providers.llm.base import LLMError, LLMRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink


class Spy:
    def __init__(self) -> None:
        self.turns: list[tuple[str, str]] = []
        self.questions: list[tuple[str, str]] = []

    async def turn(self, turn_id: str, speaker: str, text: str, *_: Any) -> None:
        self.turns.append((speaker, text))

    async def question(self, qid: str, turn_id: str | None, text: str, qtype: str, *_: Any) -> None:
        self.questions.append((text, _[-1] if _ else ""))

    async def question_text(self, *a: Any, **k: Any) -> None: ...
    async def answer(self, *a: Any, **k: Any) -> None: ...
    async def provider_request(self, *a: Any, **k: Any) -> None: ...
    async def usage(self, *a: Any, **k: Any) -> None: ...
    async def ended(self, *a: Any, **k: Any) -> None: ...
    async def detached(self, *a: Any, **k: Any) -> None: ...


async def _engine(llm: Any = None, minutes: int = 5) -> tuple[LiveEngine, Sink, Spy, dict[str, float]]:
    now = {"t": 0.0}
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(duration_minutes=minutes)),
                     LiveSettings(auto_answer=False), send=sink, llm=llm or MockLLMProvider(), stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    return eng, sink, spy, now


async def _answer(eng: LiveEngine, now: dict[str, float], text: str) -> None:
    await eng.on_transcript("mic", TranscriptEvent("final", text, 0, 1000, endpoint=True))
    now["t"] += ANSWER_SILENCE_MS / 1000 + 0.2  # the candidate goes quiet


async def test_interviewer_asks_listens_and_moves_on_after_the_answer() -> None:
    eng, sink, spy, now = await _engine()
    await sink.wait_for("mock.question")
    first = sink.of("mock.question")[0]
    assert first["index"] == 1 and first["total"] == 3 and first["text"]
    assert ("interviewer", first["text"]) in spy.turns  # recorded like a real interviewer turn
    assert [e["speaker"] for e in sink.of("transcript.final")][:1] == ["interviewer"]

    await eng.on_transcript("mic", TranscriptEvent("final", "Sure", 0, 100, endpoint=True))
    now["t"] += 5
    await asyncio.sleep(0.2)
    assert len(sink.of("mock.question")) == 1  # a one-word answer isn't the end of the answer

    await _answer(eng, now, "I built the payments ledger and led the migration to event sourcing")
    await sink.wait_for("mock.question", 2)
    assert not sink.of("answer.started")  # practice mode: Orbit never answers for the candidate
    await eng.end()


async def test_done_button_skips_the_wait_and_the_plan_ends_the_session() -> None:
    eng, sink, spy, _ = await _engine()
    await sink.wait_for("mock.question")
    for _ in range(12):
        if sink.of("mock.completed"):
            break
        asked = len(sink.of("mock.question"))
        await eng.handle_client({"type": "mock.next", "data": {}})
        async with asyncio.timeout(5):  # either another question or the end of the interview
            while len(sink.of("mock.question")) == asked and not sink.of("mock.completed"):
                await asyncio.sleep(0.01)
    await sink.wait_for("session.ended", timeout=5)
    assert sink.of("mock.completed")
    topics = [q for q in sink.of("mock.question") if not q["is_follow_up"]]
    assert len(topics) == 3  # duration 5 min → the minimum plan of three topics
    assert all(src == "mock" for _, src in spy.questions)


async def test_time_limit_ends_the_interview() -> None:
    eng, sink, _, now = await _engine(minutes=5)
    await sink.wait_for("mock.question")
    now["t"] += 5 * 60 + 1
    await _answer(eng, now, "That's my answer about the architecture decisions I made")
    await sink.wait_for("session.ended", timeout=5)
    assert sink.of("mock.completed")


async def test_provider_failure_falls_back_to_a_sensible_question() -> None:
    class Broken(MockLLMProvider):
        async def generate(self, request: LLMRequest) -> Any:
            raise LLMError("http_503", "down")

    eng, sink, _, _ = await _engine(llm=Broken())
    await sink.wait_for("mock.question")
    assert "background" in sink.of("mock.question")[0]["text"]
    await eng.end()


def test_mock_session_over_the_api_is_recorded_and_reported(client: TestClient) -> None:
    from tests.test_api import _register, _wait_report

    h = _register(client)
    s = client.post("/v1/sessions", headers=h, json={
        "title": "Mock", "type": "mock", "role": "Backend Engineer", "auto_answer": False,
        "mock": {"interview_type": "behavioral", "difficulty": "hard", "duration_minutes": 10, "persona": "engineer"}})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        events: list[dict[str, Any]] = []
        deadline = time.monotonic() + 10
        while not any(e["type"] == "mock.question" for e in events) and time.monotonic() < deadline:
            events.append(json.loads(ws.receive_text()))
        assert any(e["type"] == "mock.question" for e in events)
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        while not any(e["type"] == "session.ended" for e in events):
            events.append(json.loads(ws.receive_text()))
    detail = _wait_report(client, h, sid)
    assert detail["session"]["type"] == "mock" and detail["questions"][0]["source"] == "mock"
    assert detail["turns"][0]["speaker"] == "interviewer"
    # a mock config on a normal session is ignored
    plain = client.post("/v1/sessions", headers=h, json={"title": "x", "mock": {"duration_minutes": 10}})
    assert plain.status_code == 201


async def test_answer_requests_never_produce_an_ai_answer_in_practice_mode() -> None:
    eng, sink, _, _ = await _engine()
    await sink.wait_for("mock.question")
    await eng.handle_client({"type": "answer.request", "data": {"question_text": "Tell me about yourself"}})
    await sink.wait_for("mock.question", 2)  # treated as "I'm done"
    assert not sink.of("answer.started")
    await eng.end()


async def test_the_interviewer_sees_every_topic_covered_and_what_the_difficulty_means() -> None:
    class Recording(MockLLMProvider):
        def __init__(self) -> None:
            super().__init__()
            self.requests: list[LLMRequest] = []

        async def generate(self, request: LLMRequest) -> Any:
            self.requests.append(request)
            return await super().generate(request)

    llm = Recording()
    eng, sink, _, _ = await _engine(llm=llm, minutes=30)
    await sink.wait_for("mock.question")
    for n in range(2, 5):  # the mock model makes every second question a follow-up: two topics by the fourth
        await eng.handle_client({"type": "mock.next", "data": {}})
        await sink.wait_for("mock.question", n)
    asked = [q["text"] for q in sink.of("mock.question") if not q["is_follow_up"]]
    assert len(asked) == 2
    last = llm.requests[-1]
    system, user = str(last.messages[0].content), str(last.messages[1].content)
    assert "Difficulty: medium: the realistic bar for the level" in system
    assert '<reference_data source="topics_already_covered">' in user
    assert all(q[:160] in user for q in asked)
    await eng.end()
