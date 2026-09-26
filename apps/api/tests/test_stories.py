"""Story bank: CRUD, drafting, and stories reaching live answers as verified facts."""

import json

from fastapi.testclient import TestClient

from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.events import QuestionType
from orbit_api.models import Story
from orbit_api.retrieval.index import IndexedChunk, SessionIndex
from orbit_api.stories.routes import index_chunk, parse_draft, story_text
from tests.test_api import _collect, _doc, _register

STORY = {
    "title": "Resolved a launch-date conflict with design",
    "situation": "Design and engineering disagreed on the checkout redesign scope two weeks before launch.",
    "task": "As the tech lead I had to get us to one plan without slipping the date.",
    "action": "I set up a joint session, split the scope into must-have and fast-follow, and wrote the trade-offs.",
    "result": "We launched on time and shipped the fast-follow items a sprint later; conversion rose 6%.",
    "competencies": ["conflict", "leadership"],
}


def test_story_crud_and_ownership(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    r = client.post("/v1/stories", headers=h, json=STORY)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["competencies"] == ["conflict", "leadership"]
    assert [s["id"] for s in client.get("/v1/stories", headers=h).json()] == [sid]
    assert client.get("/v1/stories", headers=other).json() == []

    edited = client.put(f"/v1/stories/{sid}", headers=h, json={**STORY, "title": "Launch-date conflict"}).json()
    assert edited["title"] == "Launch-date conflict"
    assert client.put(f"/v1/stories/{sid}", headers=other, json=STORY).status_code == 404
    assert client.delete(f"/v1/stories/{sid}", headers=other).status_code == 404

    bad = client.post("/v1/stories", headers=h, json={**STORY, "competencies": ["juggling"]})
    assert bad.status_code == 422
    assert client.post("/v1/stories", headers=h, json={**STORY, "title": ""}).status_code == 422

    assert client.delete(f"/v1/stories/{sid}", headers=h).status_code == 204
    assert client.get("/v1/stories", headers=h).json() == []


def test_stories_are_in_the_account_export(client: TestClient) -> None:
    h = _register(client)
    client.post("/v1/stories", headers=h, json=STORY)
    export = client.get("/v1/auth/me/export", headers=h).json()
    assert [s["title"] for s in export["stories"]] == [STORY["title"]]
    assert "embedding" not in export["stories"][0]


def test_draft_from_resume_and_from_notes(client: TestClient) -> None:
    h = _register(client)
    none_yet = client.post("/v1/stories/draft", headers=h, json={"source": "resume"}).json()
    assert none_yet == {"stories": [], "grounded": False}  # no resume uploaded: nothing to draft from

    _doc(client, h, "resume_sample")
    r = client.post("/v1/stories/draft", headers=h, json={"source": "resume", "count": 3})
    assert r.status_code == 200, r.text
    assert r.json()["grounded"] is True and len(r.json()["stories"]) == 3
    assert all(s["title"] and s["action"] for s in r.json()["stories"])
    assert client.get("/v1/stories", headers=h).json() == []  # drafts aren't saved until the user saves them

    one = client.post("/v1/stories/draft", headers=h, json={
        "source": "notes", "notes": "Led the incident response when our payments API went down for an hour."})
    assert len(one.json()["stories"]) == 1
    short = client.post("/v1/stories/draft", headers=h, json={"source": "notes", "notes": "a thing"})
    assert short.status_code == 422


def test_parse_draft_keeps_well_formed_stories_only() -> None:
    raw = "Here you go: " + json.dumps({"stories": [
        {"title": "Good", "action": "I did it.", "competencies": ["Impact", "made-up"]},
        {"title": "", "action": "no title"},
        "not a story",
        {"title": "No action"},
    ]})
    out = parse_draft(raw, 5)
    assert [s.title for s in out] == ["Good"] and out[0].competencies == ["impact"]


def _index_with_story() -> SessionIndex:
    story = Story(id="s1", user_id="u", **STORY)
    resume = IndexedChunk("c1", "resume", "experience", "Acme — Engineer", "Acme — Engineer (2020-2024): Built the "
                          "checkout service in Go.", True, [])
    return SessionIndex([resume, index_chunk(story, [])])


def test_behavioral_questions_get_the_matching_story() -> None:
    inputs = PromptInputs(question="Tell me about a time you had a conflict with another team.",
                          qtype=QuestionType.behavioral, is_follow_up=False, session_type="interview", role=None,
                          length="standard", style="natural", answer_language="en")
    built = build_prompt(_index_with_story(), inputs, SessionMemory())
    prompt = "\n".join(m.content for m in built.messages)
    assert "[VERIFIED CANDIDATE FACT] (Story: Resolved a launch-date conflict with design)" in prompt
    assert "Result: We launched on time" in prompt
    assert story_text(Story(title="T", situation="", task="", action="Did X.", result="")) == "T. Action: Did X."


def test_a_saved_story_reaches_live_answers(client: TestClient) -> None:
    h = _register(client)
    client.post("/v1/stories", headers=h, json=STORY)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Acme onsite"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "chat.message",
                                 "data": {"text": "Tell me about a time you resolved a conflict with design."}}))
        done = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
        answer = next(e for e in done if e["type"] == "answer.completed")["data"]["answer"]
        assert "Story: Resolved a launch-date conflict with design" in answer["context_used"]
