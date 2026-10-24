import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.career_workspace.schemas import Transition
from orbit_api.career_workspace.transition_review import grounded
from tests.business_helpers import auth, register

PLAN = {"currentRole": "Support", "targetRole": "Analyst", "motivation": "Data work", "requirements": [
    {"id": "sql", "requirement": "Write reproducible SQL", "evidence": "Synthetic cohort query",
     "state": "practising", "nextAction": "Review denominators", "due": ""}]}


def test_review_quotes_must_belong_to_the_named_requirement() -> None:
    raw = {"summary": "Review the evidence before proceeding.", "suggestions": [{"requirement_id": "sql",
        "source_quote": "Write reproducible SQL", "gap": "Show actual test output.",
        "next_action": "Record the actual query results."}]}
    assert grounded(raw, Transition.model_validate(PLAN)).suggestions
    raw["suggestions"][0]["source_quote"] = "Invented experience"
    with pytest.raises(ValueError):
        grounded(raw, Transition.model_validate(PLAN))


def test_saved_owned_revision_review_is_read_only_and_limited(client: TestClient) -> None:
    h = auth(register(client, f"review-{uuid.uuid4().hex}@example.com"))
    other = auth(register(client, f"review-other-{uuid.uuid4().hex}@example.com"))
    path = "/v1/career/workspace/transition"
    assert client.put(path, headers=h, json={"revision": 0, "data": PLAN}).status_code == 200
    assert client.post("/v1/career/transition/review", headers=other, json={"revision": 1}).status_code == 404
    assert client.post("/v1/career/transition/review", headers=h, json={"revision": 2}).status_code == 409
    for _ in range(5):
        response = client.post("/v1/career/transition/review", headers=h, json={"revision": 1})
        assert response.status_code == 200, response.text
        assert response.json()["suggestions"][0]["source_quote"] == "Write reproducible SQL"
    assert client.post("/v1/career/transition/review", headers=h, json={"revision": 1}).status_code == 429
    saved = client.get(path, headers=h).json()
    assert saved["revision"] == 1 and saved["data"] == PLAN
