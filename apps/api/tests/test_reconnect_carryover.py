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


# ---- across a server restart (the copy on the session row) -------------------------------------------------------


def test_the_state_round_trips_through_json_and_can_leave_the_words_out() -> None:
    from orbit_api.live.context_builder import RECENT_TURNS, AnswerNote
    from orbit_api.live.mock_interviewer import DrillItem, _Asked

    memory = SessionMemory(rolling_summary="Discussed the ledger.", questions=["Tell me about the ledger."],
                           last_answer_brief="We moved it to event sourcing.")
    for i in range(20):
        memory.add_turn("interviewer" if i % 2 else "candidate", f"turn {i}")
    memory.answers.append(AnswerNote("Tell me about the ledger.", ("event sourcing", "replays"), ("Resume: Ledger",),
                                     False))
    drill = DrillItem(question="Why event sourcing?", kind="retry", follow_up=True, feedback="no trade-offs")
    mock = carryover.MockProgress(asked=[_Asked("q1", "Why event sourcing?", False, answer=["Replays."], drill=drill)],
                                  drill_next=1, closing=False, elapsed_ms=120_000, awaiting=True)
    state = carryover.Carryover(memory=memory, mock=mock)

    back = carryover.from_json(json.loads(json.dumps(carryover.to_json(state))))  # as the JSON column keeps it
    assert back is not None and back.mock == mock
    assert list(back.memory.recent) == list(memory.recent) and back.memory.recent.maxlen == RECENT_TURNS * 2
    assert list(back.memory.answers) == list(memory.answers)
    assert (back.memory.rolling_summary, back.memory.questions, back.memory.last_answer_brief) == (
        memory.rolling_summary, memory.questions, memory.last_answer_brief)

    private = carryover.to_json(state, transcripts=False)  # the account doesn't store transcripts
    assert private["memory"]["recent"] == [] and private["mock"]["asked"][0]["answer"] == []
    assert private["memory"]["questions"] == memory.questions and private["mock"]["asked"][0]["text"]

    assert carryover.from_json(None) is None and carryover.from_json({"v": carryover.FORMAT + 1}) is None
    assert carryover.from_json({"v": carryover.FORMAT, "memory": {"recent": [{"who": "?"}]}}) is None


def _saved(client: TestClient, sid: str) -> Any:
    """The state on the session row (sessions.carryover)."""
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow

    async def go() -> Any:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            return row.carryover if row is not None else None

    assert client.portal is not None
    return client.portal.call(go)


def _wait_saved(client: TestClient, sid: str, ok: Any, timeout_s: float = 5) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        state = _saved(client, sid)
        if state and ok(state):
            return state  # type: ignore[no-any-return]
        time.sleep(0.05)
    raise AssertionError(f"not saved as expected: {_saved(client, sid)}")


def _asked(state: dict[str, Any]) -> list[str]:
    return [a["question_id"] for a in state["mock"]["asked"]]


def test_a_mock_round_continues_after_a_server_restart(client: TestClient) -> None:
    """A deploy restarts the server between two connections of a mock round. The state kept in memory went with the
    old process: the round started over at question 1, its timer reset, and question 1 was recorded twice."""
    from tests.test_api import _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={
        "title": "Mock", "type": "mock", "role": "Backend Engineer", "auto_answer": False,
        "mock": {"interview_type": "behavioral", "duration_minutes": 10}}).json()["id"]

    def connect() -> Any:
        ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
        return client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}")

    with connect() as ws:
        q1 = _first(ws, "mock.question")
        ws.send_text(json.dumps({"type": "mock.next", "data": {}}))
        q2 = _first(ws, "mock.question")
    _wait_saved(client, sid, lambda s: _asked(s) == [q1["question_id"], q2["question_id"]])  # written as it dropped
    carryover._store.clear()  # the restart: nothing in memory
    with connect() as ws:
        assert _first(ws, "mock.question") == q2  # the same question, in the same place in the round
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _first(ws, "session.ended")
    detail = client.get(f"/v1/sessions/{sid}", headers=h).json()
    assert [q["text"] for q in detail["questions"]] == [q1["text"], q2["text"]]  # each recorded once
    assert _saved(client, sid) is None  # ended: nothing kept


def test_a_live_interview_keeps_its_thread_after_a_server_restart(client: TestClient) -> None:
    """Only the rolling summary used to survive a restart: the recent turns, the questions asked and the last
    answer (what follow-ups are answered from) were gone."""
    from orbit_api.sessions import routes
    from tests.test_api import _collect, _live, _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Restart mid-interview"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        _collect(ws, lambda ev: sum(e["type"] == "answer.completed" for e in ev) >= 2)
    saved = _wait_saved(client, sid, lambda s: len(s["memory"]["questions"]) >= 2)
    carryover._store.clear()
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        memory = routes._live_engines[sid].memory
        assert memory.questions == saved["memory"]["questions"]
        assert memory.recent and [t.text for t in memory.recent] == [t["text"] for t in saved["memory"]["recent"]]
        assert memory.last_answer_brief and memory.last_answer_brief == saved["memory"]["last_answer_brief"]
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))


def test_the_state_is_saved_every_heartbeat_while_connected(monkeypatch: Any) -> None:
    """Not only when the connection drops: a crash (no teardown at all) loses at most a heartbeat of it."""
    from tests.test_api import _register
    from tests.test_signup_approval import _client

    gen = _client(monkeypatch, ORBIT_LIVE_HEARTBEAT_S="0.1")
    client = next(gen)
    try:
        h = _register(client)
        sid = client.post("/v1/sessions", headers=h, json={
            "title": "Mock", "type": "mock", "auto_answer": False,
            "mock": {"interview_type": "behavioral", "duration_minutes": 10}}).json()["id"]
        ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
            q1 = _first(ws, "mock.question")
            assert _wait_saved(client, sid, lambda s: _asked(s) == [q1["question_id"]])["mock"]["awaiting"]
            ws.send_text(json.dumps({"type": "session.end", "data": {}}))
            _first(ws, "session.ended")
        assert _saved(client, sid) is None
    finally:
        gen.close()


def test_without_transcripts_the_saved_state_leaves_out_what_was_said(client: TestClient) -> None:
    from tests.test_api import _collect, _live, _register

    h = _register(client)
    assert client.patch("/v1/auth/me/privacy", headers=h, json={"store_transcripts": False}).status_code == 200
    sid = client.post("/v1/sessions", headers=h, json={"title": "private"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        _collect(ws, lambda ev: sum(e["type"] == "answer.completed" for e in ev) >= 2)
    saved = _wait_saved(client, sid, lambda s: len(s["memory"]["questions"]) >= 2)
    assert saved["memory"]["recent"] == []  # the questions and answer notes stay: they're stored anyway
    assert client.post(f"/v1/sessions/{sid}/end", headers=h).status_code == 200
    assert _saved(client, sid) is None
