"""A dropped connection doesn't wipe the session: the next engine keeps the conversation and the mock round."""

import json
import time
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live import carryover
from orbit_api.live.context_builder import SessionMemory
from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.mock_interviewer import MockConfig
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink
from tests.test_mock_interview import Spy, _answer


def _mock_engine(now: dict[str, float], resume: carryover.Carryover | None = None,
                 minutes: int = 5) -> tuple[LiveEngine, Sink, Spy]:
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(duration_minutes=minutes)),
                     LiveSettings(auto_answer=False), send=sink, llm=MockLLMProvider(), stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"],  # type: ignore[arg-type]
                     resume=resume)
    return eng, sink, spy


async def test_conversation_memory_moves_to_the_next_engine() -> None:
    sink = Sink()
    first = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True), LiveSettings(),
                       send=sink, llm=MockLLMProvider(), stt=MockSTTProvider(), index=SessionIndex([]))
    first.memory.add_turn("interviewer", "Tell me about the payments migration.")
    first.memory.add_turn("candidate", "We moved the ledger to event sourcing.")
    first.memory.questions.append("Tell me about the payments migration.")
    first.memory.rolling_summary = "Discussed the payments ledger migration."
    saved = first.carryover()

    second = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True), LiveSettings(),
                        send=Sink(), llm=MockLLMProvider(), stt=MockSTTProvider(), index=SessionIndex([]),
                        resume=saved)
    assert [t.text for t in second.memory.recent_turns()] == [
        "Tell me about the payments migration.", "We moved the ledger to event sourcing."]
    assert second.memory.questions == ["Tell me about the payments migration."]
    assert second.memory.rolling_summary == "Discussed the payments ledger migration."
    assert first.carryover().mock is None  # not a mock session


async def test_mock_round_resumes_at_the_same_question_with_its_clock() -> None:
    now = {"t": 0.0}
    eng, sink, _ = _mock_engine(now)
    await eng.start()
    await sink.wait_for("mock.question")
    await _answer(eng, now, "I built the payments ledger and led the migration to event sourcing")
    await sink.wait_for("mock.question", 2)
    second_q = sink.of("mock.question")[1]
    now["t"] = 120.0  # two minutes into the round, mid-answer, the connection drops
    saved = eng.carryover()
    await eng.end(final=False)
    assert saved.mock is not None and saved.mock.elapsed_ms == 120_000 and saved.mock.awaiting

    later = {"t": 1000.0}  # the new engine's own clock
    eng2, sink2, spy2 = _mock_engine(later, resume=saved)
    await eng2.start()
    await sink2.wait_for("mock.question")
    again = sink2.of("mock.question")[0]
    assert again == second_q  # the same question, same place in the round ("2 of 3"), not question 1
    assert spy2.questions == []  # already recorded by the first connection: not recorded twice

    # the round's clock kept running: 3 more minutes finishes a 5-minute round
    later["t"] += 181
    await _answer(eng2, later, "And then we cut the settlement latency in half with batching")
    await sink2.wait_for("mock.completed")
    assert sink2.of("mock.completed")[0]["questions"] == 2  # both questions count in the round summary
    await eng2.end()


async def test_a_question_being_written_when_the_connection_dropped_is_asked_by_the_next_engine() -> None:
    now = {"t": 0.0}
    eng, sink, _ = _mock_engine(now)
    await eng.start()
    await sink.wait_for("mock.question")
    saved = eng.carryover()
    saved.mock.awaiting = False  # type: ignore[union-attr]  # dropped while the next question was being written
    await eng.end(final=False)

    eng2, sink2, spy2 = _mock_engine({"t": 0.0}, resume=saved)
    await eng2.start()
    await sink2.wait_for("mock.question")
    assert sink2.of("mock.question")[0]["question_id"] != sink.of("mock.question")[0]["question_id"]
    assert len(spy2.questions) == 1  # a new question: recorded
    await eng2.end()


def test_store_hands_state_over_once_and_expires(monkeypatch: Any) -> None:
    carryover.save("s-a", carryover.Carryover(memory=SessionMemory(rolling_summary="x")))
    got = carryover.take("s-a")
    assert got is not None and got.memory.rolling_summary == "x"
    assert carryover.take("s-a") is None  # handed over once
    carryover.save("s-b", carryover.Carryover())
    real = time.monotonic
    monkeypatch.setattr(carryover.time, "monotonic", lambda: real() + 24 * 3600)
    assert carryover.take("s-b") is None  # no longer than an idle session lives


# ---- end to end, over the WebSocket ------------------------------------------------------------------------------


def _first(ws: Any, type_: str, limit: float = 10) -> dict[str, Any]:
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        event = json.loads(ws.receive_text())
        if event["type"] == type_:
            return event["data"]  # type: ignore[no-any-return]
    raise AssertionError(f"no {type_}")


def test_reconnecting_mid_mock_continues_the_round(client: TestClient) -> None:
    from tests.test_api import _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={
        "title": "Mock", "type": "mock", "role": "Backend Engineer", "auto_answer": False,
        "mock": {"interview_type": "behavioral", "duration_minutes": 10}}).json()["id"]

    def connect() -> Any:
        ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
        return client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}")

    with connect() as ws:
        asked = _first(ws, "mock.question")
    # the socket dropped (no session.end): the session stays open and its state waits for the next connection
    with connect() as ws:
        again = _first(ws, "mock.question")
        assert again["question_id"] == asked["question_id"] and again["text"] == asked["text"]
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _first(ws, "session.ended")
    assert carryover.take(sid) is None  # ended: nothing kept
