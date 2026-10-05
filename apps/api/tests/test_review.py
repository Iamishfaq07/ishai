"""Post-session review scorecard: server-side Q/A pairing, validation of the model's scores, endpoint."""

import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest
from orbit_api.sessions.report import QAPair, build_review, pair_questions_with_answers

T0 = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


def _at(s: float) -> datetime:
    return T0 + timedelta(seconds=s)


def test_each_question_gets_only_the_candidate_turns_that_followed_it() -> None:
    qs = [SimpleNamespace(text="Tell me about yourself.", created_at=_at(10)),
          SimpleNamespace(text="Why this role?", created_at=_at(60)),
          SimpleNamespace(text="Any questions for us?", created_at=_at(120))]
    turns = [SimpleNamespace(speaker="candidate", text="Hi there.", created_at=_at(5), start_ms=0),  # before Q1
             SimpleNamespace(speaker="interviewer", text="Tell me about yourself.", created_at=_at(9), start_ms=1),
             SimpleNamespace(speaker="candidate", text="I build secure systems.", created_at=_at(20), start_ms=2),
             SimpleNamespace(speaker="candidate", text="Six years in AppSec.", created_at=_at(30), start_ms=3),
             SimpleNamespace(speaker="candidate", text="The mission.", created_at=_at(70), start_ms=4)]
    pairs = pair_questions_with_answers(qs, turns)  # type: ignore[arg-type]
    assert [p.answer for p in pairs] == ["I build secure systems. Six years in AppSec.", "The mission.", ""]


def test_review_uses_transcript_text_and_never_scores_unanswered_questions() -> None:
    pairs = [QAPair("Q one?", "my answer"), QAPair("Q two?", "")]
    model = {"overall_score": 9, "strengths": ["a", "", "b"], "improvements": "not a list",
             "items": [{"q": 1, "score": 7, "feedback": "good", "better": "say more", "question": "INJECTED"},
                       {"q": 2, "score": 5, "feedback": "", "better": ""}]}
    r = build_review(model, pairs)
    assert r is not None
    assert r["overall_score"] == 5 and r["strengths"] == ["a", "b"] and r["improvements"] == []
    first, second = r["items"]
    assert first == {"question": "Q one?", "you_said": "my answer", "score": 5, "feedback": "good",
                     "better": "say more"}
    assert second["score"] is None and second["feedback"] == "Not answered in the recording."
    # nothing answered at all → no overall score
    assert build_review({"overall_score": 4}, [QAPair("Q?", "")])["overall_score"] is None  # type: ignore[index]
    assert build_review("garbage", pairs) is None


def _collect(ws: Any, until: Any, timeout_s: float = 20) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        events.append(json.loads(ws.receive_text()))
        if until(events):
            return events
    raise AssertionError(f"timed out; got {[e['type'] for e in events]}")


def test_review_endpoint_and_report_after_a_live_session(client: TestClient) -> None:
    from tests.test_api import _register, _wait_report

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Review me"}).json()["id"]
    assert client.post(f"/v1/sessions/{sid}/review", headers=h).status_code == 409  # not ended yet
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        _collect(ws, lambda ev: sum(e["type"] == "answer.completed" for e in ev) >= 2)
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))

    review = _wait_report(client, h, sid)["summary"]["review"]
    assert review["overall_score"] == 4 and review["strengths"] == ["[mock] clear structure"]
    first = review["items"][0]
    assert first["question"] == "Tell me about yourself." and first["you_said"] and first["score"] == 4

    other = _register(client)
    assert client.post(f"/v1/sessions/{sid}/review", headers=other).status_code == 404
    r = client.post(f"/v1/sessions/{sid}/review", headers=h)
    assert r.status_code == 200 and r.json()["review"]["items"][0]["question"] == "Tell me about yourself."


def test_review_accepts_the_ways_models_number_items() -> None:
    pairs = [QAPair("A?", "a"), QAPair("B?", "b"), QAPair("C?", "c")]
    r = build_review({"items": [{"q": "Q2", "score": 2}, {"q": "3", "score": 3}, {"score": 5}]}, pairs)
    assert r is not None
    # "Q2" → 2, "3" → 3, the unnumbered third item falls back to its position (3, already taken) → Q1 unscored
    assert [i["score"] for i in r["items"]] == [None, 2, 3]
    r2 = build_review({"items": [{"score": 4}, {"score": 1}, {"score": 3}]}, pairs)
    assert r2 is not None and [i["score"] for i in r2["items"]] == [4, 1, 3]


def test_review_of_a_session_where_nothing_was_captured_says_so(client: TestClient) -> None:
    from tests.test_api import _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Silent"}).json()["id"]
    assert client.post(f"/v1/sessions/{sid}/end", headers=h).status_code == 200
    r = client.post(f"/v1/sessions/{sid}/review", headers=h)
    assert r.status_code == 409 and "Nothing was captured" in r.json()["detail"]


class _Down(LLMProvider):
    name = "down"

    def model_for(self, reasoning: Any) -> str:
        return "down-1"

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        raise LLMError("http_503", "provider down", retryable=True)
        yield LLMChunk()  # pragma: no cover


def test_regenerating_keeps_the_follow_up_and_a_failed_one_keeps_the_review(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regenerate used to drop the saved follow-up email, and on a provider error replace the report with a
    facts-only one: the review was gone (and the drill refused with no_review). So could the report job's retry."""
    from orbit_api.sessions import report
    from tests.test_api import _register, _wait_report

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Regenerate me"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "dev.simulate", "data": {"fixture": "behavioral_interview", "speed": 25}}))
        _collect(ws, lambda ev: sum(e["type"] == "answer.completed" for e in ev) >= 2)
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    assert _wait_report(client, h, sid)["summary"]["review"]
    assert client.post(f"/v1/sessions/{sid}/follow-up", headers=h).status_code == 200

    assert client.post(f"/v1/sessions/{sid}/review", headers=h).status_code == 200
    kept = client.get(f"/v1/sessions/{sid}", headers=h).json()["summary"]
    assert kept["review"] and kept["follow_up"]["thank_you"]["body"]  # the email survives a regenerate

    monkeypatch.setattr(report, "get_llm_provider", lambda: _Down())
    r = client.post(f"/v1/sessions/{sid}/review", headers=h)
    assert r.status_code == 502 and "earlier review is unchanged" in r.json()["detail"]
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["summary"] == kept
    drill = client.post(f"/v1/sessions/{sid}/drill", headers=h)
    assert drill.status_code == 201 or drill.json()["detail"]["code"] == "nothing_to_drill"  # not no_review

    with pytest.raises(RuntimeError, match="narrative unavailable"):  # the job retries later...
        client.portal.call(report.run_report_job, {"session_id": sid})  # type: ignore[union-attr]
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["summary"] == kept  # ...without wiping it now


def test_the_report_on_a_long_session_covers_all_of_it(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """25 questions and a transcript over the 12,000 characters the model gets: the narrative used to see only the
    end (the running summary was never sent), and the scorecard said nothing about the questions it left out."""
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, Question, SessionTurn
    from orbit_api.providers.llm.mock import MockLLMProvider
    from orbit_api.sessions import report
    from tests.test_api import _register

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Marathon"}).json()["id"]

    async def plant() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status, row.rolling_summary = "ended", "EARLY: walked through the payments ledger migration."
            for i in range(25):
                at = T0 + timedelta(minutes=2 * i)
                db.add(Question(id=f"{sid[:8]}-q{i}", session_id=sid, text=f"Question number {i}?", type="technical",
                                confidence=0.9, created_at=at))
                db.add(SessionTurn(id=f"{sid[:8]}-t{i}", session_id=sid, speaker="candidate",
                                   text=f"Answer {i}. " + "We shipped it. " * 40, start_ms=i, end_ms=i + 1,
                                   created_at=at + timedelta(seconds=30)))
            await db.commit()

    llm = MockLLMProvider()
    monkeypatch.setattr(report, "get_llm_provider", lambda: llm)
    assert client.portal is not None
    client.portal.call(plant)
    review = client.portal.call(report.generate_report, sid)["review"]
    prompt = llm.requests[-1].messages[-1].content
    assert "EARLY: walked through the payments ledger migration." in prompt  # the part the excerpt cut
    assert "- Question number 0?" in prompt and "- Question number 4?" in prompt  # earlier questions, listed
    assert "Q1: Question number 5?" in prompt and "Q20: Question number 24?" in prompt  # the scored ones
    assert len(review["items"]) == 20 and review["questions_total"] == 25
    assert review["note"] == "Only the last 20 of this session's 25 questions were scored."
