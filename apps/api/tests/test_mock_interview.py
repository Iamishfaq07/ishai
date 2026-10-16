"""AI mock interviewer: asks, listens, moves on after the candidate finishes, ends the session, and gets recorded."""

import asyncio
import json
import time
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live.engine import REQUEST_EVERY_S, LiveEngine, SessionProfile
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

    async def turn(self, turn_id: str, speaker: str, text: str, *_: Any, **__: Any) -> None:
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
    eng, sink, spy, now = await _engine()
    await sink.wait_for("mock.question")
    for _ in range(12):
        if sink.of("mock.completed"):
            break
        asked = len(sink.of("mock.question"))
        now["t"] += REQUEST_EVERY_S  # a person answering between presses (a flood of presses is throttled)
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


class SlowQuestions(MockLLMProvider):
    """Each interviewer question takes a noticeable moment to write, like a real model call."""

    async def generate(self, request: LLMRequest) -> Any:
        if request.request_type == "mock_question":
            await asyncio.sleep(0.3)
        return await super().generate(request)


def _questions_written(llm: MockLLMProvider) -> int:
    return sum(r.request_type == "mock_question" for r in llm.requests)


async def test_the_next_question_is_written_during_the_pause_and_asked_without_waiting() -> None:
    llm = SlowQuestions()
    eng, sink, _spy, now = await _engine(llm)
    await sink.wait_for("mock.question")
    await eng.on_transcript("mic", TranscriptEvent("final", "I built the payments service and led its migration",
                                                   0, 1000, endpoint=True))
    now["t"] += 1.0  # a pause: long enough to start on the next question, too short to end the answer
    await asyncio.sleep(0.45)  # …which gets written in the background meanwhile
    assert sink.of("mock.question")[1:] == [] and _questions_written(llm) == 2
    now["t"] += ANSWER_SILENCE_MS / 1000  # the answer is over
    started = time.monotonic()
    await sink.wait_for("mock.question", 2)
    assert time.monotonic() - started < 0.25  # no model call left to wait for
    assert _questions_written(llm) == 2  # the early question was used, not written twice
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_an_early_question_is_dropped_when_the_candidate_keeps_talking() -> None:
    llm = SlowQuestions()
    eng, sink, _spy, now = await _engine(llm)
    await sink.wait_for("mock.question")
    await eng.on_transcript("mic", TranscriptEvent("final", "I built the payments service", 0, 1000, endpoint=True))
    now["t"] += 1.0
    await asyncio.sleep(0.1)  # the early question has started
    await eng.on_transcript("mic", TranscriptEvent("final", "and then I scaled it to ten regions", 0, 1000,
                                                   endpoint=True))
    assert eng._mock is not None and eng._mock._prefetch is None  # thrown away: the answer changed
    now["t"] += ANSWER_SILENCE_MS / 1000 + 0.2
    await sink.wait_for("mock.question", 2, timeout=5)
    await eng.handle_client({"type": "session.end", "data": {}})


async def test_a_panel_takes_turns_and_a_follow_up_stays_with_who_asked() -> None:
    import json as _json

    script = [_json.dumps({"question": q, "is_follow_up": f}) for q, f in [
        ("Hi, I'm Rahul; with me are Meera and Anita. Tell me about yourself.", False),
        ("What was the hardest part of that?", True),
        ("I'm Meera. How would you design a rate limiter?", False),
        ("I'm Anita. Why are you looking to move?", False),
        ("Tell me about a conflict on your team.", False),
    ]]
    llm = MockLLMProvider(script=script)
    now = {"t": 0.0}
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True, country="IN",
                                    mock=MockConfig(duration_minutes=15,
                                                    panel=["hiring_manager", "engineer", "recruiter"])),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    for n, said in enumerate(["I build payment systems at a fintech in Bengaluru and lead the ledger team",
                              "The backfill of five years of transactions without downtime was the hardest part",
                              "A token bucket per user in Redis with a sliding window for bursts and a fallback",
                              "I want to work on a bigger platform with more ownership of the architecture"], start=1):
        await sink.wait_for("mock.question", n)
        await _answer(eng, now, said)
    await sink.wait_for("mock.question", 5)
    speakers = [q["speaker"]["name"] for q in sink.of("mock.question")]
    assert speakers == ["Rahul", "Rahul", "Meera", "Anita", "Rahul"]  # the follow-up stays with Rahul
    assert sink.of("mock.question")[2]["speaker"] == {"persona": "engineer", "name": "Meera",
                                                       "title": "Senior engineer"}
    first_prompt = llm.requests[0].messages[-1].content
    assert "PANEL interview" in first_prompt and "introduces the panel" in first_prompt
    assert "Meera (speaking for the first time" in llm.requests[1].messages[-1].content
    await eng.end()


async def test_a_panel_outside_india_has_names_heard_everywhere() -> None:
    from orbit_api.live.mock_interviewer import PANELISTS, WORLD_PANELISTS, panelists_for

    assert panelists_for("IN") is PANELISTS and panelists_for("US") is panelists_for(None) is WORLD_PANELISTS
    assert {k: t for k, (_, t) in WORLD_PANELISTS.items()} == {k: t for k, (_, t) in PANELISTS.items()}
    llm = MockLLMProvider(script=[json.dumps({"question": "Hi, I'm Daniel. Tell me about yourself.",
                                              "is_follow_up": False})])
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True, country="GB",
                                    mock=MockConfig(duration_minutes=15,
                                                    panel=["hiring_manager", "engineer", "recruiter"])),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: 0.0)  # type: ignore[arg-type]
    await eng.start()
    await sink.wait_for("mock.question")
    assert sink.of("mock.question")[0]["speaker"] == {"persona": "hiring_manager", "name": "Daniel",
                                                       "title": "Hiring manager"}
    system, steer = llm.requests[0].messages[0].content, llm.requests[0].messages[-1].content
    assert "(Daniel, Maya, Emma)" in system and "Maya, a senior engineer" in steer
    assert not any(name in system + steer for name, _ in PANELISTS.values())
    await eng.end()


def test_a_live_session_carries_the_accounts_country(client: TestClient) -> None:
    from tests.test_api import _register

    def first_speaker(h: dict[str, str]) -> str:
        s = client.post("/v1/sessions", headers=h, json={
            "title": "Panel", "type": "mock", "role": "Backend Engineer", "auto_answer": False,
            "mock": {"duration_minutes": 10, "panel": ["hiring_manager", "engineer"]}})
        assert s.status_code == 201, s.text
        sid = s.json()["id"]
        ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
            events: list[dict[str, Any]] = []
            deadline = time.monotonic() + 10
            while not any(e["type"] == "mock.question" for e in events) and time.monotonic() < deadline:
                events.append(json.loads(ws.receive_text()))
            ws.send_text(json.dumps({"type": "session.end", "data": {}}))
            while not any(e["type"] == "session.ended" for e in events):
                events.append(json.loads(ws.receive_text()))
        name: str = next(e for e in events if e["type"] == "mock.question")["data"]["speaker"]["name"]
        return name

    uk = _register(client)
    assert client.patch("/v1/auth/me/region", headers=uk, json={"country": "GB"}).status_code == 200
    assert first_speaker(uk) == "Daniel"
    india = _register(client)
    assert client.patch("/v1/auth/me/region", headers=india, json={"country": "IN"}).status_code == 200
    assert first_speaker(india) == "Rahul"


async def test_an_adaptive_panel_lets_the_best_placed_panelist_ask_but_everyone_gets_a_turn() -> None:
    script = [json.dumps(d) for d in [
        {"question": "Hi, I'm Rahul; with me are Meera and Anita. Tell me about yourself.", "is_follow_up": False},
        # The answer skipped why they're moving: the recruiter, not the next in turn, takes it.
        {"question": "I'm Anita. Why are you looking to move?", "is_follow_up": False, "asked_by": "recruiter"},
        # Anita just asked, so she can't take the next topic too: the server holds the model to who may.
        {"question": "Tell me more about your motivation.", "is_follow_up": False, "asked_by": "recruiter"},
        {"question": "Walk me through a hard trade-off.", "is_follow_up": False, "asked_by": "nobody"},
    ]]
    llm = MockLLMProvider(script=script)
    now = {"t": 0.0}
    sink, spy = Sink(), Spy()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(duration_minutes=12,
                                                    panel=["hiring_manager", "engineer", "recruiter"])),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    for n, said in enumerate(["I build payment systems at a fintech in Bengaluru and lead the ledger team",
                              "I want to work on a bigger platform with more ownership of the architecture",
                              "Mostly the chance to design systems at a much larger scale than today"], start=1):
        await sink.wait_for("mock.question", n)
        await _answer(eng, now, said)
    await sink.wait_for("mock.question", 4)
    speakers = [q["speaker"]["persona"] for q in sink.of("mock.question")]
    # Rahul opens; Anita is chosen; she can't go twice running, so the next in turn (Rahul) asks; with one topic
    # left, Meera, who hasn't opened one yet, must take it, whatever the model said.
    assert speakers == ["hiring_manager", "recruiter", "hiring_manager", "engineer"]
    prompt = llm.requests[1].messages[-1].content
    assert "best placed to probe" in prompt and "[engineer]" in prompt and "[recruiter]" in prompt
    assert "[hiring_manager]" not in prompt  # Rahul asked the last topic: the floor moves on
    await eng.end()


async def test_a_typed_answer_is_recorded_and_moves_the_interview_on() -> None:
    eng, sink, spy, _ = await _engine()
    await sink.wait_for("mock.question")
    await eng.handle_client({"type": "mock.answer", "data": {"text": "  I led the ledger migration end to end.  "}})
    await sink.wait_for("mock.question", 2)
    assert ("candidate", "I led the ledger migration end to end.") in spy.turns
    assert any(e["speaker"] == "candidate" for e in sink.of("transcript.final"))
    assert eng._mock is not None and eng._mock.asked[0].answer == ["I led the ledger migration end to end."]
    # Too long, or empty: refused, nothing recorded.
    await eng.handle_client({"type": "mock.answer", "data": {"text": "x" * 4001}})
    await eng.handle_client({"type": "mock.answer", "data": {"text": ""}})
    assert [e["code"] for e in sink.of("error")] == ["invalid_event", "invalid_event"]
    assert sum(1 for who, _ in spy.turns if who == "candidate") == 1
    await eng.end()


async def test_a_typed_answer_is_ignored_while_paused() -> None:
    eng, sink, spy, _ = await _engine()
    await sink.wait_for("mock.question")
    await eng.handle_client({"type": "session.pause", "data": {}})
    await eng.handle_client({"type": "mock.answer", "data": {"text": "An answer while paused."}})
    assert not [t for t in spy.turns if t[0] == "candidate"]
    await eng.end()


def test_a_panel_needs_different_interviewers_and_skips_drills() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        MockConfig(panel=["engineer", "engineer"])
    assert MockConfig(panel=["engineer", "recruiter"]).is_panel
    assert not MockConfig(panel=["engineer", "recruiter"], drill=[{"question": "Q?"}]).is_panel  # type: ignore[list-item]


async def test_a_one_way_interview_waits_out_the_answer_time_not_a_pause() -> None:
    import json as _json

    from orbit_api.live.mock_interviewer import OneWaySetup

    script = [_json.dumps({"question": q, "is_follow_up": True}) for q in
              ["Welcome. Tell us about a project you're proud of.", "Describe a time you missed a deadline."]]
    llm = MockLLMProvider(script=script)
    now = {"t": 0.0}
    sink, spy = Sink(), Spy()
    config = MockConfig(duration_minutes=15, one_way=OneWaySetup(think_seconds=10, answer_seconds=30),
                        panel=["engineer", "recruiter"])  # one-way has one voice: the panel is ignored
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True, mock=config),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=spy, clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    await sink.wait_for("mock.question")
    first = sink.of("mock.question")[0]
    assert first["one_way"] == {"think_seconds": 10, "answer_seconds": 30} and "speaker" not in first
    assert first["is_follow_up"] is False and first["total"] == 10  # 15 min of 40 s prompts, capped at 10
    assert "ONE-WAY recorded video interview" in llm.requests[0].messages[-1].content

    await asyncio.sleep(0.3)  # a tick sees the prompt out
    await _answer(eng, now, "I led the payments ledger migration to event sourcing with zero downtime")
    now["t"] += 5  # a long pause: in a one-way interview that's not the end of the answer
    await asyncio.sleep(0.5)
    assert len(sink.of("mock.question")) == 1

    now["t"] += 45  # past thinking + answer time and the grace
    await sink.wait_for("mock.question", 2)
    second = sink.of("mock.question")[1]
    assert second["is_follow_up"] is False and second["index"] == 2  # never a follow-up, even if the model says so
    await eng.end()
