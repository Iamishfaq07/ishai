"""Salary-negotiation practice: the AI recruiter's turns, closing, the hidden target, and the negotiation review."""

import asyncio
import json
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.mock_interviewer import MockConfig, NegotiationSetup
from orbit_api.providers.llm.base import LLMRequest, LLMResponse, Usage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink
from tests.test_mock_interview import Spy, _answer

SETUP = NegotiationSetup(offer="$150,000 base, 10% bonus", company="Acme", target="$170,000 base")


class Recorder(MockLLMProvider):
    """Records every request; answers from a script of recruiter turns (JSON)."""

    def __init__(self, turns: list[dict[str, Any]]) -> None:
        super().__init__()
        self.turns = turns
        self.seen: list[LLMRequest] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.seen.append(request)
        turn = self.turns.pop(0) if self.turns else {"question": "Anything else?", "is_follow_up": True}
        return LLMResponse(text=json.dumps(turn), model="mock", usage=Usage())


async def _engine(llm: Any, minutes: int = 10, difficulty: str = "hard") -> tuple[LiveEngine, Sink, dict[str, float]]:
    now = {"t": 0.0}
    sink = Sink()
    cfg = MockConfig(interview_type="negotiation", difficulty=difficulty, duration_minutes=minutes,
                     negotiation=SETUP)
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True, mock=cfg),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=Spy(), clock=lambda: now["t"])
    await eng.start()
    return eng, sink, now


def test_a_negotiation_needs_an_offer() -> None:
    with pytest.raises(ValidationError, match="offer"):
        MockConfig(interview_type="negotiation")
    assert MockConfig(interview_type="negotiation", negotiation=SETUP, duration_minutes=10).planned_questions == 5
    assert MockConfig(interview_type="negotiation", negotiation=SETUP, duration_minutes=60).planned_questions == 12


async def test_recruiter_opens_with_the_offer_reacts_and_closes() -> None:
    llm = Recorder([
        {"question": "Congratulations! We're offering $150,000 base plus a 10% bonus. How does that sound?",
         "is_follow_up": False, "done": False},
        {"question": "That's above our band. What's that number based on?", "is_follow_up": True, "done": False},
        {"question": "I can do $160,000 and a $10,000 signing bonus. I'll send the updated offer today.",
         "is_follow_up": True, "done": True},
    ])
    eng, sink, now = await _engine(llm)
    await sink.wait_for("mock.question")
    first = sink.of("mock.question")[0]
    assert first["negotiation"] is True and first["index"] == 1 and first["total"] == 5
    assert "$150,000" in first["text"]

    system = llm.seen[0].messages[0].content
    assert "recruiter at Acme" in system and "$150,000 base, 10% bonus" in system
    assert "negotiate hard" in system  # difficulty "hard" → a tough recruiter
    assert "$170,000" not in "".join(m.content for m in llm.seen[0].messages)  # the target stays hidden

    await _answer(eng, now, "Thank you! Based on market data for this level I was expecting $170,000 base.")
    async with asyncio.timeout(5):
        while len(sink.of("mock.question")) < 2:
            await asyncio.sleep(0.01)
    second = sink.of("mock.question")[1]
    assert second["index"] == 2 and second["is_follow_up"] is False  # turns, not follow-ups, in a negotiation
    assert "Recruiter:" in llm.seen[1].messages[-1].content  # the call so far goes back to the recruiter

    await _answer(eng, now, "I appreciate that. Could we meet at $165,000 with the signing bonus?")
    async with asyncio.timeout(5):
        while len(sink.of("mock.question")) < 3:
            await asyncio.sleep(0.01)
    # the recruiter closed the call: the candidate's reply ends the round
    await _answer(eng, now, "That works for me, thank you. I look forward to the written offer.")
    async with asyncio.timeout(5):
        while not sink.of("mock.completed"):
            await asyncio.sleep(0.01)
    summary = sink.of("mock.completed")[0]
    assert summary["negotiation"] is True and summary["questions"] == 3 and summary["answered"] == 3


async def test_turn_budget_ends_the_call_and_failures_fall_back() -> None:
    class Broken(MockLLMProvider):
        async def generate(self, request: LLMRequest) -> Any:
            raise TimeoutError

    eng, sink, _ = await _engine(Broken(), minutes=5)  # 5 min → 4 turns
    await sink.wait_for("mock.question")
    assert "Congratulations" in sink.of("mock.question")[0]["text"]
    for _ in range(8):
        if sink.of("mock.completed"):
            break
        asked = len(sink.of("mock.question"))
        await eng.handle_client({"type": "mock.next", "data": {}})
        async with asyncio.timeout(5):
            while len(sink.of("mock.question")) == asked and not sink.of("mock.completed"):
                await asyncio.sleep(0.01)
    assert sink.of("mock.completed") and len(sink.of("mock.question")) == 4
    texts = [q["text"] for q in sink.of("mock.question")]
    assert len(set(texts)) == 4  # fallback lines don't repeat


def test_negotiation_session_is_created_reviewed_with_the_rubric(client: TestClient,
                                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.sessions import report
    from tests.test_api import _register, _wait_report

    h = _register(client)
    bad = client.post("/v1/sessions", headers=h, json={
        "title": "N", "type": "mock", "mock": {"interview_type": "negotiation", "duration_minutes": 10}})
    assert bad.status_code == 422  # no offer to negotiate

    seen: list[LLMRequest] = []
    llm = MockLLMProvider()
    original = llm.generate

    async def spy(request: LLMRequest) -> LLMResponse:
        seen.append(request)
        return await original(request)

    llm.generate = spy  # type: ignore[method-assign]
    monkeypatch.setattr(report, "get_llm_provider", lambda: llm)

    s = client.post("/v1/sessions", headers=h, json={
        "title": "Negotiation", "type": "mock", "role": "Backend Engineer", "auto_answer": False,
        "mock": {"interview_type": "negotiation", "difficulty": "medium", "duration_minutes": 10,
                 "negotiation": {"offer": "$150k base", "company": "Acme", "target": "$170k base"}}})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        events: list[dict[str, Any]] = []
        deadline = time.monotonic() + 10
        while not any(e["type"] == "mock.question" for e in events) and time.monotonic() < deadline:
            events.append(json.loads(ws.receive_text()))
        q = next(e for e in events if e["type"] == "mock.question")
        assert q["data"]["negotiation"] is True and "Recruiter turn 1" in q["data"]["text"]
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        while not any(e["type"] == "session.ended" for e in events):
            events.append(json.loads(ws.receive_text()))
    _wait_report(client, h, sid)
    summaries = [r for r in seen if r.request_type == "summary"]
    assert summaries, "the report ran"
    assert "SALARY NEGOTIATION" in summaries[-1].messages[0].content
    assert "Candidate's target: $170k base" in summaries[-1].messages[-1].content
