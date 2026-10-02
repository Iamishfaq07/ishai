"""Answer feedback: rating, the session review showing it, learned preferences, and the admin report."""

import contextlib
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.retrieval.index import SessionIndex
from orbit_api.sessions.feedback import LEARNED_HINTS
from orbit_api.sessions.routes import _live_engines
from tests.test_admin_config import _client as _admin_client
from tests.test_admin_config import _register as _register_as
from tests.test_api import _collect, _register


def _answered_session(client: TestClient, h: dict[str, str]) -> tuple[str, str]:
    """A session with one completed chat answer; returns (session id, answer id)."""
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "chat.message", "data": {"text": "Why do you want this job?"}}))
        done = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        # End cleanly: the session's final writes land before `session.ended`, so the ratings below never race
        # them (SQLite deadlocks two read-then-write transactions; Postgres doesn't).
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
    aid = next(e for e in done if e["type"] == "answer.completed")["data"]["answer_id"]
    return sid, str(aid)


def _answers(client: TestClient, sid: str, *ids: str) -> None:
    """Stored answers of this session to rate (after a session ends, only its real answers can be rated)."""
    from orbit_api.db import sessionmaker
    from orbit_api.models import Answer

    async def add() -> None:
        async with sessionmaker()() as db:
            for aid in ids:
                db.add(Answer(id=aid, session_id=sid, status="completed", content={}, provider="mock", model="mock"))
            await db.commit()

    client.portal.call(add)  # type: ignore[union-attr]


def _rate(client: TestClient, h: dict[str, str], sid: str, aid: str, **body: object) -> dict[str, object]:
    r = client.put(f"/v1/sessions/{sid}/answers/{aid}/feedback", headers=h, json=body)
    assert r.status_code == 200, r.text
    out: dict[str, object] = r.json()
    return out


def test_rate_change_and_clear_an_answer(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    sid, aid = _answered_session(client, h)

    assert _rate(client, h, sid, aid, rating="down", reason="too_long") == {
        "answer_id": aid, "rating": "down", "reason": "too_long"}
    answers = client.get(f"/v1/sessions/{sid}", headers=h).json()["answers"]
    assert answers[0]["feedback"] == {"rating": "down", "reason": "too_long"}

    # 👍 drops the reason; null clears the rating
    assert _rate(client, h, sid, aid, rating="up", reason="too_long")["reason"] is None
    assert _rate(client, h, sid, aid, rating=None)["rating"] is None
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["answers"][0]["feedback"] is None

    url = f"/v1/sessions/{sid}/answers/{aid}/feedback"
    assert client.put(url, headers=other, json={"rating": "up"}).status_code == 404  # not their session
    assert client.put(url, headers=h, json={"rating": "meh"}).status_code == 422
    assert client.put(url, headers=h, json={"rating": "down", "reason": "rude"}).status_code == 422
    # an answer rated in one session can't be claimed from another
    _rate(client, h, sid, aid, rating="up")
    sid2 = client.post("/v1/sessions", headers=h, json={"title": "B"}).json()["id"]
    assert client.put(f"/v1/sessions/{sid2}/answers/{aid}/feedback", headers=h,
                      json={"rating": "down"}).status_code == 404


def test_rating_works_before_the_answer_row_is_written(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "x"}).json()["id"]
    assert _rate(client, h, sid, "a-not-yet-written", rating="up")["rating"] == "up"


def test_repeated_reasons_become_learned_preferences(client: TestClient) -> None:
    h = _register(client)
    sid, _ = _answered_session(client, h)
    _answers(client, sid, "long-0", "long-1", "long-2", "formal-0")
    for i in range(3):
        _rate(client, h, sid, f"long-{i}", rating="down", reason="too_long")
    _rate(client, h, sid, "formal-0", rating="down", reason="too_formal")  # once isn't a pattern

    # the next session's prompts carry the learned hint
    nxt = client.post("/v1/sessions", headers=h, json={"title": "next"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{nxt}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{nxt}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        assert _live_engines[nxt].profile.learned == [LEARNED_HINTS["too_long"]]
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))


def test_learned_hints_are_in_the_prompt() -> None:
    inputs = PromptInputs(question="Why us?", qtype=QuestionType.culture, is_follow_up=False,
                          session_type="interview", role=None, length="standard", style="natural",
                          answer_language="en", learned_preferences=[LEARNED_HINTS["too_generic"]])
    prompt = "\n".join(m.content for m in build_prompt(SessionIndex([]), inputs, SessionMemory()).messages)
    assert "Learned from the candidate's ratings" in prompt and LEARNED_HINTS["too_generic"] in prompt


def test_admin_feedback_report(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _admin_client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin = _register_as(client, admin_email)
        h = _register(client)
        sid, aid = _answered_session(client, h)
        _rate(client, h, sid, aid, rating="down", reason="too_generic")
        _answers(client, sid, "second-answer")
        _rate(client, h, sid, "second-answer", rating="up")
        # A made-up answer id, after the session: refused (it would skew this report).
        made_up = client.put(f"/v1/sessions/{sid}/answers/not-an-answer/feedback", headers=h, json={"rating": "up"})
        assert made_up.status_code == 404
        assert client.get("/v1/admin/feedback", headers=h).status_code == 403  # admins only

        report = client.get("/v1/admin/feedback", headers=admin).json()
        assert report["up"] >= 1 and report["down"] >= 1 and 0 < report["satisfaction"] < 1
        assert report["reasons"].get("too_generic", 0) >= 1
        assert {g["key"] for g in report["by_type"]} >= {"chat"}  # ratings without a question row
        assert all("text" not in g and "content" not in g for g in report["by_model"])  # counts only
    finally:
        with contextlib.suppress(StopIteration):
            next(gen)
