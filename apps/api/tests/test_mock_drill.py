"""Mock quality (§32: answer completion, end-of-round summary) and re-drill (§33)."""

import asyncio
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.live.mock_interviewer import (
    ANSWER_SILENCE_MS,
    LONG_ANSWER_MS,
    TRAILING_OFF_MS,
    WRAPPED_UP_MS,
    DrillItem,
    MockConfig,
    answer_silence_ms,
    drill_plan,
)
from orbit_api.providers.llm.base import LLMRequest, LLMResponse, Usage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink
from tests.test_mock_interview import Spy


def test_answer_completion_adapts_to_how_the_answer_ends() -> None:
    assert answer_silence_ms("I led the migration to event sourcing.") == ANSWER_SILENCE_MS
    assert answer_silence_ms("We moved the ledger first and") == TRAILING_OFF_MS  # mid-thought
    assert answer_silence_ms("the hardest part was the backfill, because") == TRAILING_OFF_MS
    assert answer_silence_ms("so we cut it by half, um") == TRAILING_OFF_MS
    assert answer_silence_ms("It cut incidents by 60 percent. So yeah.") == WRAPPED_UP_MS
    assert answer_silence_ms("and that's how we shipped it on time") == WRAPPED_UP_MS
    assert answer_silence_ms("That's it.") == WRAPPED_UP_MS
    assert answer_silence_ms(" ".join(["word"] * 130)) == LONG_ANSWER_MS


REVIEW_ITEMS: list[dict[str, Any]] = [
    {"question": "Tell me about yourself.", "you_said": "I'm a backend engineer...", "score": 5, "feedback": "Clear."},
    {"question": "Describe a conflict with a teammate.", "you_said": "We disagreed.", "score": 2,
     "feedback": "No resolution or outcome."},
    {"question": "How would you design a rate limiter?", "you_said": "", "score": None, "feedback": ""},
    {"question": "What's your biggest failure?", "you_said": "A release went wrong.", "score": 3,
     "feedback": "Missing what you learned."},
    {"question": "Why this company?", "you_said": "The mission.", "score": 4, "feedback": "Thin."},
    {"question": "A time you led without authority?", "you_said": "I organised the guild.", "score": 3,
     "feedback": "Vague impact."},
]


def test_drill_plan_takes_the_weakest_three_then_a_short_version() -> None:
    plan = drill_plan(REVIEW_ITEMS)
    assert [d.kind for d in plan] == ["retry", "retry", "retry", "concise"]
    # unanswered first, then lowest scores (stable for ties)
    assert [d.question for d in plan[:3]] == ["How would you design a rate limiter?",
                                             "Describe a conflict with a teammate.", "What's your biggest failure?"]
    assert [d.follow_up for d in plan] == [True, True, False, False]
    assert plan[1].feedback == "No resolution or outcome."
    # the short version is a different, answered question (the next weakest)
    assert plan[3].question == "A time you led without authority?"


def test_nothing_weak_means_no_drill() -> None:
    assert drill_plan([{"question": "Q", "you_said": "A", "score": 4}]) == []
    assert drill_plan([]) == []


class FollowUpLLM(MockLLMProvider):
    """Returns a recognisable follow-up and records what it was asked."""

    def __init__(self) -> None:
        super().__init__()
        self.prompts: list[str] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.prompts.append(request.messages[-1].content)
        return LLMResponse(text='{"question": "What was the outcome, exactly?", "is_follow_up": true}',
                           model="mock", usage=Usage(1, 1))


async def _drill_engine(plan: list[DrillItem]) -> tuple[LiveEngine, Sink, dict[str, float], FollowUpLLM]:
    now = {"t": 0.0}
    sink, llm = Sink(), FollowUpLLM()
    eng = LiveEngine(SessionProfile("s1", "mock", "Backend Engineer", "en", "en", dev_mode=True,
                                    mock=MockConfig(drill=plan, duration_minutes=20)),
                     LiveSettings(auto_answer=False), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=Spy(), clock=lambda: now["t"])  # type: ignore[arg-type]
    await eng.start()
    return eng, sink, now, llm


async def _say(eng: LiveEngine, now: dict[str, float], text: str) -> None:
    await eng.on_transcript("mic", TranscriptEvent("final", text, 0, 1000, endpoint=True))
    now["t"] += TRAILING_OFF_MS / 1000 + 0.2


async def test_drill_asks_the_plan_in_order_with_live_follow_ups_then_summarises() -> None:
    plan = [DrillItem(question="Describe a conflict with a teammate.", follow_up=True, feedback="No outcome."),
            DrillItem(question="What's your biggest failure?"),
            DrillItem(question="Why this company?", kind="concise")]
    eng, sink, now, llm = await _drill_engine(plan)
    await sink.wait_for("mock.question")
    q = sink.of("mock.question")
    assert q[0]["text"] == "Let's work on a few questions from your last session. Describe a conflict with a teammate."
    assert q[0]["drill_kind"] == "retry" and q[0]["total"] == 3 and not llm.prompts  # verbatim, no model call

    await _say(eng, now, "We disagreed about the schema and I proposed a trial on one service")
    await sink.wait_for("mock.question", 2)
    q = sink.of("mock.question")
    assert q[1]["is_follow_up"] and q[1]["drill_kind"] == "follow_up"
    assert q[1]["text"] == "What was the outcome, exactly?"
    assert "No outcome." in llm.prompts[0] and "previous_feedback" in llm.prompts[0]  # fenced reference data

    await _say(eng, now, "It cut review time in half and we adopted it everywhere")
    await sink.wait_for("mock.question", 3)
    assert sink.of("mock.question")[2]["text"] == "Let's try this one again. What's your biggest failure?"

    await _say(eng, now, "A release broke billing and I learned to stage rollouts behind flags")
    await sink.wait_for("mock.question", 4)
    concise = sink.of("mock.question")[3]
    assert concise["drill_kind"] == "concise" and concise["text"].startswith("Now the short version")

    await _say(eng, now, "The mission and the team's engineering culture")
    await sink.wait_for("mock.completed")
    done = sink.of("mock.completed")[0]
    assert done == {"questions": 4, "topics": 3, "follow_ups": 1, "answered": 4, "unanswered": 0,
                    "average_answer_words": done["average_answer_words"], "drill": True,
                    "negotiation": False}
    assert done["average_answer_words"] > 5
    await eng.end()


async def test_a_skipped_drill_question_gets_no_follow_up() -> None:
    plan = [DrillItem(question="Q one?", follow_up=True), DrillItem(question="Q two?")]
    eng, sink, _, llm = await _drill_engine(plan)
    await sink.wait_for("mock.question")
    await eng.handle_client({"type": "answer.request", "data": {}})  # "I'm done" without saying anything
    await sink.wait_for("mock.question", 2)
    assert sink.of("mock.question")[1]["text"].endswith("Q two?") and not llm.prompts
    await asyncio.sleep(0)
    await eng.end()


def _seed_review(client: TestClient, sid: str, items: list[dict[str, Any]]) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, SessionSummary

    async def go() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status = "ended"
            db.add(SessionSummary(session_id=sid, content={"summary": "x", "review": {"items": items}}))
            await db.commit()

    assert client.portal is not None
    client.portal.call(go)


def test_drill_endpoint_builds_a_mock_session_from_the_review(client: TestClient) -> None:
    from tests.test_api import _doc, _register

    h = _register(client)
    doc_id = _doc(client, h, "resume_sample")
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite", "role": "Backend Engineer",
                                                        "document_ids": [doc_id]}).json()["id"]
    r = client.post(f"/v1/sessions/{sid}/drill", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_review"

    _seed_review(client, sid, REVIEW_ITEMS)
    r = client.post(f"/v1/sessions/{sid}/drill", headers=h)
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["type"] == "mock" and new["title"] == "Drill: Acme onsite" and new["role"] == "Backend Engineer"
    assert new["document_ids"] == [doc_id]  # same documents, so answers can be grounded again

    other = _register(client)
    assert client.post(f"/v1/sessions/{sid}/drill", headers=other).status_code == 404  # not yours

    strong = client.post("/v1/sessions", headers=h, json={"title": "Good one"}).json()["id"]
    _seed_review(client, strong, [{"question": "Q", "you_said": "A", "score": 5}])
    r = client.post(f"/v1/sessions/{strong}/drill", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "nothing_to_drill"
