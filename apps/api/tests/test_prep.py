"""Interview prep from a job description (orbit_api/prep)."""

import json

import pytest
from fastapi.testclient import TestClient

from orbit_api.prep.routes import parse_prep
from tests.test_api import _doc, _register

JD_TEXT = ("Senior Security Engineer. You will lead threat modelling, run the vulnerability management programme, "
           "partner with platform teams on secure defaults and mentor two engineers.")


def test_prep_from_pasted_job_description(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/prep", headers=h, json={"job_text": JD_TEXT, "count": 6})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["questions"]) == 6
    assert body["grounded_in_resume"] is False  # no resume uploaded yet
    q = body["questions"][0]
    assert q["question"] and q["suggested_answer"] and q["why"]
    assert q["category"] in {"behavioral", "technical", "role", "motivation", "curveball"}
    assert 1 <= len(q["talking_points"]) <= 4


def test_prep_from_saved_documents_uses_the_resume(client: TestClient) -> None:
    h = _register(client)
    resume, jd = _doc(client, h, "resume_sample"), _doc(client, h, "jd_sample")
    r = client.post("/v1/prep", headers=h, json={"job_description_id": jd, "resume_id": resume})
    assert r.status_code == 200, r.text
    assert r.json()["grounded_in_resume"] is True and len(r.json()["questions"]) == 8
    # the newest ready resume is used when none is named
    assert client.post("/v1/prep", headers=h, json={"job_description_id": jd}).json()["grounded_in_resume"] is True


def test_prep_validates_input_and_ownership(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    assert client.post("/v1/prep", headers=h, json={}).status_code == 422
    assert client.post("/v1/prep", headers=h, json={"job_text": "too short"}).status_code == 422
    assert client.post("/v1/prep", headers=h, json={"job_text": JD_TEXT, "count": 40}).status_code == 422
    theirs = _doc(client, other, "jd_sample")
    assert client.post("/v1/prep", headers=h, json={"job_description_id": theirs}).status_code == 404


def test_parse_prep_keeps_only_well_formed_questions() -> None:
    raw = "Sure! " + json.dumps({"role": "  Staff   Engineer ", "company": "", "questions": [
        {"question": "Why us?", "category": "MOTIVATION", "why": "x", "talking_points": ["a", "", "b"],
         "suggested_answer": "Because..."},
        {"question": "", "suggested_answer": "orphan answer"},  # no question → dropped
        {"question": "Tell me about a conflict", "category": "gossip", "suggested_answer": "Once..."},
        "not a dict",
    ]}) + " Hope that helps."
    out = parse_prep(raw, count=8)
    assert out["role"] == "Staff Engineer" and out["company"] is None
    assert [q["question"] for q in out["questions"]] == ["Why us?", "Tell me about a conflict"]
    assert out["questions"][0]["category"] == "motivation" and out["questions"][0]["talking_points"] == ["a", "b"]
    assert out["questions"][1]["category"] == "role"  # unknown category falls back
    with pytest.raises(ValueError):
        parse_prep(json.dumps({"questions": []}), count=8)
    assert out["ask_them"] == []  # an older answer without questions to ask them


def test_prep_also_gives_questions_to_ask_them_at_the_end() -> None:
    q = {"question": "Why us?", "category": "motivation", "why": "w", "talking_points": [], "suggested_answer": "x"}
    raw = json.dumps({"questions": [q], "ask_them": [
        {"question": "What does success look like in the first 90 days?", "why": "Shows you plan to deliver."},
        {"question": "   ", "why": "dropped: empty"}, "not an object",
        *({"question": f"Q{i}?", "why": ""} for i in range(6))]})
    ask = parse_prep(raw, count=8)["ask_them"]
    assert ask[0] == {"question": "What does success look like in the first 90 days?",
                      "why": "Shows you plan to deliver."}
    assert len(ask) == 4  # four at most


def test_prep_questions_can_be_practised_in_a_mock_session(client: TestClient) -> None:
    h = _register(client)
    qs = client.post("/v1/prep", headers=h, json={"job_text": JD_TEXT, "count": 4}).json()["questions"]
    s = client.post("/v1/sessions", headers=h, json={
        "title": "Prep practice", "type": "mock",
        "mock": {"duration_minutes": 15, "drill": [{"question": q["question"], "kind": "prep"} for q in qs]},
    })
    assert s.status_code == 201, s.text
