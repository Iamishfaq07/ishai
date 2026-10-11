"""Answer bank: saving answers (orbit_api/answers/routes.py) and the copilot starting from them in live sessions."""

import json
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.answers.match import same_question
from orbit_api.answers.routes import index_chunk
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.models import SavedAnswer
from orbit_api.retrieval.index import IndexedChunk, SessionIndex
from tests.test_api import _collect, _register

INTRO = ("I'm a backend engineer with four years at Acme, where I built the checkout service in Go and cut its p99 "
         "latency by 40%. I'm looking for a team where I can own a payments system end to end.")


def _save(client: TestClient, h: dict[str, str], **body: Any) -> Any:
    return client.post("/v1/answers", headers=h, json={"question": "Tell me about yourself.", "answer": INTRO, **body})


def test_save_edit_and_remove_an_answer(client: TestClient) -> None:
    h = _register(client)
    r = _save(client, h, question="Let's try this one again. Tell me   about yourself.")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["question"] == "Tell me about yourself." and a["answer"] == INTRO  # the drill's lead line is dropped
    assert [x["id"] for x in client.get("/v1/answers", headers=h).json()] == [a["id"]]

    # The same question again, in near enough the same words, replaces the answer instead of adding a second.
    again = _save(client, h, question="So tell me about yourself?", answer="A shorter intro.")
    assert again.status_code == 200 and again.json()["id"] == a["id"]
    assert again.json()["answer"] == "A shorter intro." and again.json()["question"] == "So tell me about yourself?"
    other_q = _save(client, h, question="Why do you want to work here?", answer="Because of the payments work.")
    assert other_q.status_code == 201 and other_q.json()["id"] != a["id"]
    assert len(client.get("/v1/answers", headers=h).json()) == 2

    r = client.put(f"/v1/answers/{a['id']}", headers=h, json={"question": "Walk me through your background.",
                                                               "answer": INTRO})
    assert r.status_code == 200 and r.json()["question"] == "Walk me through your background."
    assert client.delete(f"/v1/answers/{a['id']}", headers=h).status_code == 204
    assert [x["id"] for x in client.get("/v1/answers", headers=h).json()] == [other_q.json()["id"]]


def test_answers_are_checked_and_private(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    for bad in ({"question": " "}, {"answer": "   "}, {"answer": "x" * 3001}, {"question": "q" * 501}):
        assert _save(client, h, **bad).status_code == 422, bad
    theirs = client.post("/v1/sessions", headers=other, json={"title": "Theirs"}).json()["id"]
    a = _save(client, h, session_id=theirs).json()
    assert a["session_id"] is None  # someone else's session isn't linked
    assert client.get("/v1/answers", headers=other).json() == []
    assert client.put(f"/v1/answers/{a['id']}", headers=other, json={"question": "q", "answer": "a"}).status_code == 404
    assert client.delete(f"/v1/answers/{a['id']}", headers=other).status_code == 404
    mine = client.post("/v1/sessions", headers=h, json={"title": "Mine"}).json()["id"]
    assert _save(client, h, session_id=mine).json()["session_id"] == mine
    export = client.get("/v1/auth/me/export", headers=h).json()
    assert [x["answer"] for x in export["saved_answers"]] == [INTRO] and "contacts" in export["job_search"]


def test_same_question_matches_rewordings_not_different_questions() -> None:
    assert same_question("Tell me about yourself.", "Could you tell me a little about yourself?")
    assert same_question("Why do you want to join Razorpay?", "So why do you want to join Razorpay")
    assert not same_question("Tell me about yourself.", "Tell me about a time you failed.")
    assert not same_question("Why do you want to join Razorpay?", "Why are you leaving your current job?")


def _inputs(question: str) -> PromptInputs:
    return PromptInputs(question=question, qtype=QuestionType.behavioral, is_follow_up=False,
                        session_type="interview", role=None, length="standard", style="natural", answer_language="en")


def _index() -> SessionIndex:
    saved = SavedAnswer(id="a1", user_id="u", question="Tell me about yourself.", answer=INTRO)
    resume = IndexedChunk("c1", "resume", "experience", "Acme — Engineer", "Acme — Engineer (2020-2024): Built the "
                          "checkout service in Go.", True, [])
    return SessionIndex([resume, index_chunk(saved, [])])


def test_the_prepared_answer_leads_when_the_question_comes_up() -> None:
    built = build_prompt(_index(), _inputs("So, tell me a bit about yourself?"), SessionMemory())
    prompt = "\n".join(m.content for m in built.messages)
    assert "F1 [THE USER'S PREPARED ANSWER] (Your answer: Tell me about yourself.)" in prompt
    assert "F1 is the user's own prepared answer to this question" in prompt
    assert "cut its p99 latency by 40%" in prompt
    # A different question doesn't get told to build on it, even if the search finds it.
    other = "\n".join(m.content for m in build_prompt(_index(), _inputs("Tell me about the checkout service you "
                                                                         "built."), SessionMemory()).messages)
    assert "own prepared answer to this question" not in other


def test_a_saved_answer_reaches_live_answers(client: TestClient) -> None:
    h = _register(client)
    _save(client, h)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "chat.message", "data": {"text": "Tell me about yourself."}}))
        done = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        answer = next(e for e in done if e["type"] == "answer.completed")["data"]["answer"]
        assert "Your answer: Tell me about yourself." in answer["context_used"]


def test_the_migration_adds_and_removes_the_table(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "answers.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def tables() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    alembic("upgrade", "head")
    assert "saved_answers" in tables()
    alembic("downgrade", "d2c4e6a8f0b1")
    assert "saved_answers" not in tables()
    alembic("upgrade", "head")
