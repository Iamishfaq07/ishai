"""Grounded career planning reads actual owned records, and never edits them."""
import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.db import sessionmaker
from orbit_api.models import Resume
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, make_client, register, tag


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def account(client: TestClient, resume: bool = True) -> tuple[dict[str, str], str | None]:
    user = register(client, f"progress-{tag()}@example.com")
    rid = None
    if resume:
        response = client.post("/v1/resumes", headers=auth(user), json={"title": "My real projects", "data": {
            "basics": {"name": "Private name", "email": "private@example.com"},
            "skills": [{"items": ["Python"]}], "education": [{"degree": "BSc", "field": "Computer science"}],
            "projects": [{"name": "Library", "description": "Organised college books"}],
        }})
        assert response.status_code == 201, response.text
        rid = response.json()["id"]
    return user, rid


def source(client: TestClient, user: dict[str, str], rid: str | None = None) -> dict[str, Any]:
    response = client.get("/v1/jobs/launchpad/progress", headers=auth(user),
                          params={"resume_id": rid} if rid else {})
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_progress_is_owned_and_does_not_expose_contact_values(client: TestClient) -> None:
    user, rid = account(client)
    other, _ = account(client)
    current = source(client, user)
    checks = {c["id"]: c for c in current["checks"]}
    assert checks["basics"]["present"] and checks["projects"]["present"] and checks["education"]["present"]
    assert not checks["experience"]["present"]
    assert "private@example.com" not in json.dumps(current) and "Private name" not in json.dumps(current)
    assert current["next_step"]["id"] == "search"
    assert client.get("/v1/jobs/launchpad/progress", headers=auth(other), params={"resume_id": rid}).status_code == 404
    assert client.post("/v1/jobs/launchpad/plan", headers=auth(other),
                      json={"resume_id": rid, "version": current["version"]}).status_code == 404
    assert client.get("/v1/jobs/launchpad/progress").status_code == 401


def test_no_resume_plan_is_available_and_does_not_claim_completed_actions(client: TestClient) -> None:
    user, _ = account(client, False)
    current = source(client, user)
    assert not current["checks"] and current["next_step"]["path"] == "/jobs?work=resume"
    response = client.post("/v1/jobs/launchpad/plan", headers=auth(user), json={"version": current["version"]})
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "mock" and response.json()["tips"][0]["path"] == "/jobs?work=resume"
    assert source(client, user) == current
    assert client.get("/v1/resumes", headers=auth(user)).json() == []


def test_interview_and_outcome_recommendations_use_only_own_tracker(client: TestClient) -> None:
    user, _ = account(client, False)
    other, _ = account(client, False)
    assert client.post("/v1/jobs/tracker/manual", headers=auth(other),
        json={"title": "Private role", "company": "Acme", "status": "interviewing"}).status_code == 201
    assert source(client, user)["next_step"]["id"] == "resume"
    response = client.post("/v1/jobs/tracker/manual", headers=auth(user),
        json={"title": "Engineer", "company": "Acme", "status": "interviewing"})
    assert response.status_code == 201
    assert source(client, user)["next_step"]["id"] == "interviews"
    assert client.patch(f"/v1/jobs/tracker/{response.json()['id']}", headers=auth(user),
                        json={"status": "hired"}).status_code == 200
    current = source(client, user)
    assert current["next_step"]["id"] == "outcomes"
    assert "not independently verified" in current["next_step"]["text"]


@pytest.mark.parametrize("bad", ["quote", "id", "duplicate", "malformed"])
def test_ai_rejects_untrusted_output_and_failures_consume_allowance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, bad: str,
) -> None:
    user, _ = account(client)
    current = source(client, user)
    tip = {"fact_id": "resume", "source_quote": "An owned resume is selected.",
           "suggestion": "Review your selected resume before sharing it.", "success_check": "Check the saved details."}
    if bad == "quote":
        tip["source_quote"] = "Ten years of experience at Acme"
    if bad == "id":
        tip["fact_id"] = "someone-else"
    output = "not JSON" if bad == "malformed" else json.dumps({"tips": [tip, tip] if bad == "duplicate" else [tip]})
    mock = MockLLMProvider(script=[output] * 6)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    for _ in range(5):
        assert client.post("/v1/jobs/launchpad/plan", headers=auth(user),
                           json={"version": current["version"]}).status_code == 502
    assert client.post("/v1/jobs/launchpad/plan", headers=auth(user),
                       json={"version": current["version"]}).status_code == 429
    assert len(mock.requests) == 5 and source(client, user) == current


def test_resume_change_during_plan_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user, rid = account(client)
    current = source(client, user)

    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            async with sessionmaker()() as db:
                row = await db.get(Resume, rid)
                assert row
                row.data = {**row.data, "skills": []}
                await db.commit()
            return await super().generate(request)

    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    assert client.post("/v1/jobs/launchpad/plan", headers=auth(user),
                       json={"version": current["version"]}).status_code == 409


def test_hidden_sections_and_blank_rows_do_not_count_as_added_details() -> None:
    from orbit_api.job_portal.career_progress import resume_checks
    checks = resume_checks({"education": [{}], "projects": [{"name": "Name only"}],
        "skills": [{"items": ["Secret"]}], "hidden": ["skills"]}, "owned")
    assert all(not c["present"] for c in checks)
    assert all(c["path"].startswith("/resume-ai/owned?guide=1&section=") for c in checks)


def test_selected_resume_search_links_do_not_fall_back_to_another_profile_resume(client: TestClient) -> None:
    user, first = account(client)
    created = client.post("/v1/resumes", headers=auth(user), json={"title": "Different resume", "data": {
        "basics": {"name": "Robin", "email": "robin@example.com"}}})
    assert created.status_code == 201
    selected = created.json()["id"]
    prefs = client.get("/v1/jobs/profile", headers=auth(user)).json()["prefs"]
    prefs["titles"] = ["Engineer"]
    assert client.put("/v1/jobs/profile", headers=auth(user),
                      json={"prefs": prefs, "resume_id": first}).status_code == 200
    current = source(client, user, selected)
    assert current["next_step"]["action"] == "Choose your search direction"
    assert current["next_step"]["path"] == f"/jobs?start=1&resume_id={selected}"
    assert client.get("/v1/jobs/profile", headers=auth(user)).json()["resume"]["id"] == first
