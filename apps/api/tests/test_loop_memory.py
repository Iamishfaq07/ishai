"""Company loop memory: earlier rounds with the same company (company named on the session, its saved setup, or the
mock setup), the questions asked there and the stories already told, only from the user's own sessions; and the
rule that tells the next round's answers to pick a different story."""

import uuid
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.models import Answer, LiveSessionRow, Question
from orbit_api.retrieval.index import SessionIndex
from orbit_api.sessions.loop_memory import same_company
from tests.test_admin_console import _db, _user, console  # noqa: F401  (fixture)


def _round(client: TestClient, user_id: str, company: str | None, questions: list[str], stories: list[str],
           **row: Any) -> str:
    sid = str(uuid.uuid4())

    async def go(db: Any) -> None:
        db.add(LiveSessionRow(id=sid, user_id=user_id, title="Round", type="interview", status="ended",
                              company=company, **row))
        await db.flush()
        for q in questions:
            db.add(Question(id=str(uuid.uuid4()), session_id=sid, text=q, type="behavioral", confidence=1.0))
        db.add(Answer(id=str(uuid.uuid4()), session_id=sid, status="completed", provider="mock", model="mock",
                      content={"sources": [{"ref": f"F{i}", "chunk_id": "c", "doc_kind": "story", "document": s,
                                            "label": "", "excerpt": "", "verified": True}
                                           for i, s in enumerate(stories)]
                               + [{"ref": "F9", "chunk_id": "r", "doc_kind": "resume", "document": "Resume",
                                   "label": "", "excerpt": "", "verified": True}]}))
        await db.commit()

    _db(client, go)
    return sid


def test_company_names_match_loosely_but_not_partially() -> None:
    assert same_company("Acme Corp.", "acme  corp")
    assert not same_company("Acme", "Acme Labs") and not same_company("", "")


def test_earlier_rounds_with_the_same_company(console: Any) -> None:  # noqa: F811
    client, _, _ = console
    h, user = _user(client, "loop")
    _round(client, user["id"], "Acme", ["Tell me about a conflict.", "Why Acme?"], ["Payments outage"])
    _round(client, user["id"], "acme", ["Tell me about a conflict.", "Biggest failure?"], ["Payments outage", "Hiring"])
    _round(client, user["id"], "Globex", ["Why Globex?"], ["Other story"])
    other_h, other = _user(client, "loop-other")
    _round(client, other["id"], "Acme", ["Someone else's question"], ["Someone else's story"])

    r = client.get("/v1/sessions/loop-memory", headers=h, params={"company": "ACME"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["rounds"] == 2
    assert sorted(m["questions"]) == ["Biggest failure?", "Tell me about a conflict.", "Why Acme?"]  # no repeats
    assert sorted(m["stories"]) == ["Hiring", "Payments outage"]  # stories only, not the resume
    assert "Someone else's story" not in m["stories"] and "Why Globex?" not in m["questions"]
    # A company with no earlier rounds, and a missing company, are refused or empty.
    assert client.get("/v1/sessions/loop-memory", headers=h, params={"company": "Initech"}).json()["rounds"] == 0
    assert client.get("/v1/sessions/loop-memory", headers=h).status_code == 422
    assert client.get("/v1/sessions/loop-memory", headers=other_h, params={"company": "Globex"}).json()["rounds"] == 0


def test_the_next_rounds_answers_are_told_to_pick_another_story() -> None:
    def prompt(prep: dict[str, Any]) -> str:
        inputs = PromptInputs(question="Tell me about a time you failed.", qtype=QuestionType.behavioral,
                              is_follow_up=False, session_type="interview", role=None, length="standard",
                              style="natural", answer_language="en", prep_context=prep)
        return "\n".join(m.content for m in build_prompt(SessionIndex([]), inputs, SessionMemory()).messages)

    later = prompt({"company": "Acme", "earlier_rounds": {"rounds": 1, "questions_already_asked": ["Why Acme?"],
                                                          "stories_already_told": ["Payments outage"]}})
    assert "prefer a different story" in later and "Payments outage" in later
    assert "prefer a different story" not in prompt({"company": "Acme"})
