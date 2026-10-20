"""Owned per-job guidance, factual boundaries, durable quotas and source invalidation."""
import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from orbit_api.db import sessionmaker
from orbit_api.models import JobApplication, JobFitCheck, ProviderRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def setup(client: TestClient) -> tuple[dict[str, str], str]:
    user = register(client, f"job-coach-{tag()}@example.com")
    response = client.post("/v1/jobs/tracker/manual", headers=auth(user), json={
        "title": "Private job title", "company": "Private company", "notes": "Private contact and notes"})
    assert response.status_code == 201, response.text
    return user, str(response.json()["id"])


def read(client: TestClient, user: dict[str, str], entry: str) -> dict[str, Any]:
    response = client.get(f"/v1/jobs/tracker/{entry}/coach", headers=auth(user))
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_read_is_owned_private_and_does_not_create_application_or_provider_activity(client: TestClient) -> None:
    user, entry = setup(client)
    other, _ = setup(client)
    current = read(client, user, entry)
    assert "Private" not in json.dumps(current)
    assert {fact["id"] for fact in current["facts"]} == {"resume", "fit", "timeline", "interview", "offer"}
    assert all(fact["path"].startswith(f"/jobs/mission/{entry}?guide=1&tab=") for fact in current["facts"])
    assert client.get(f"/v1/jobs/tracker/{entry}/coach", headers=auth(other)).status_code == 404
    assert client.get(f"/v1/jobs/tracker/{entry}/coach").status_code == 401
    assert client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(other),
        json={"version": current["version"], "focus": "resume"}).status_code == 404
    assert client.get("/v1/resumes", headers=auth(user)).json() == []
    async def requests(db: Any) -> list[Any]:
        return list(await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == uid(user))))
    assert db_call(client, requests) == []


def test_plan_is_focused_and_never_updates_tracker_or_resume(client: TestClient) -> None:
    user, entry = setup(client)
    current = read(client, user, entry)
    before = client.get(f"/v1/jobs/tracker/{entry}/mission", headers=auth(user)).json()
    result = client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(user),
        json={"version": current["version"], "focus": "interview"})
    assert result.status_code == 200, result.text
    advice = result.json()
    assert advice["source"] == "mock"
    assert advice["tips"][0]["fact_id"] == "interview"
    assert advice["tips"][0]["path"] == f"/jobs/mission/{entry}?guide=1&tab=interview"
    assert client.get(f"/v1/jobs/tracker/{entry}/mission", headers=auth(user)).json() == before
    assert read(client, user, entry) == current
    assert client.get("/v1/resumes", headers=auth(user)).json() == []


@pytest.mark.parametrize("bad", ["quote", "unknown", "duplicate", "focus", "malformed"])
def test_untrusted_plan_is_rejected_and_failures_count_against_quota(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, bad: str,
) -> None:
    user, entry = setup(client)
    current = read(client, user, entry)
    fact = next(f for f in current["facts"] if f["id"] == ("fit" if bad == "focus" else "resume"))
    tip = {"fact_id": "invented" if bad == "unknown" else fact["id"],
        "source_quote": "fabricated qualification" if bad == "quote" else fact["text"],
        "suggestion": "Review this saved information carefully.",
        "success_check": "Check the linked source before continuing."}
    original = MockLLMProvider.generate
    async def generate(self: MockLLMProvider, request: Any) -> Any:
        response = await original(self, request)
        response.text = "not json" if bad == "malformed" else json.dumps(
            {"tips": [tip, tip] if bad == "duplicate" else [tip]})
        return response
    monkeypatch.setattr(MockLLMProvider, "generate", generate)
    for _ in range(5):
        response = client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(user),
            json={"version": current["version"], "focus": "resume"})
        assert response.status_code == 502, response.text
    assert client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(user),
        json={"version": current["version"], "focus": "resume"}).status_code == 429


def test_source_updates_after_linking_freezing_and_deleting_resume(client: TestClient) -> None:
    user, entry = setup(client)
    initial = read(client, user, entry)
    response = client.post("/v1/resumes", headers=auth(user), json={"title": "Private resume", "data": {
        "basics": {"name": "Private Name", "email": "private@example.com"}}})
    assert response.status_code == 201, response.text
    resume = response.json()
    assert client.put(f"/v1/jobs/tracker/{entry}/mission/resume", headers=auth(user),
        json={"resume_id": resume["id"]}).status_code == 200
    linked = read(client, user, entry)
    assert linked["version"] != initial["version"] and "Private" not in json.dumps(linked)
    assert client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(user),
        json={"version": initial["version"], "focus": "resume"}).status_code == 409
    assert client.post(f"/v1/jobs/tracker/{entry}/mission/snapshots", headers=auth(user), json={}).status_code == 201
    frozen = read(client, user, entry)
    assert frozen["version"] != linked["version"]
    assert "1 frozen" in next(f["text"] for f in frozen["facts"] if f["id"] == "timeline")
    assert client.delete(f"/v1/resumes/{resume['id']}", headers=auth(user)).status_code == 204
    assert read(client, user, entry)["version"] != frozen["version"]


def test_concurrent_change_during_generation_is_detected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user, entry = setup(client)
    current = read(client, user, entry)
    original = MockLLMProvider.generate
    async def generate(self: MockLLMProvider, request: Any) -> Any:
        # An independent write while the provider is running; the post-check must bypass session identity caching.
        async with sessionmaker()() as db:
            await db.execute(update(JobApplication).where(JobApplication.id == entry).values(status="interviewing"))
            await db.commit()
        return await original(self, request)
    monkeypatch.setattr(MockLLMProvider, "generate", generate)
    response = client.post(f"/v1/jobs/tracker/{entry}/coach/plan", headers=auth(user),
        json={"version": current["version"], "focus": "resume"})
    assert response.status_code == 409, response.text
    assert read(client, user, entry)["version"] != current["version"]


def test_review_link_is_for_this_owned_job_and_removed_when_closed(client: TestClient) -> None:
    from tests.test_career_next_actions import packet

    user, entry = setup(client)
    other, _ = setup(client)
    packet(client, other, application_id=entry)
    before = read(client, user, entry)
    assert not any("packet=" in fact["path"] for fact in before["facts"])
    pid = packet(client, user, application_id=entry)
    current = read(client, user, entry)
    fact = next(f for f in current["facts"] if f["id"] == "timeline")
    assert fact["path"] == f"/jobs/applications?packet={pid}"
    assert "needs_answer" in fact["text"]
    assert current["version"] != before["version"]
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"status": "hired"}).status_code == 200
    after = read(client, user, entry)
    assert not any("packet=" in fact["path"] for fact in after["facts"])
    assert after["version"] != current["version"]


def test_prior_requirements_can_ground_practice_without_sending_resume_quotes(client: TestClient) -> None:
    user, entry = setup(client)
    before = read(client, user, entry)
    async def seed(db: Any) -> None:
        job = await db.get(JobApplication, entry)
        db.add(JobFitCheck(user_id=uid(user), listing_id=job.listing_id, resume_hash="a" * 64, result={
            "requirements": [{"requirement": "Explain SQL query plans", "status": "missing",
                              "resume_quote": "Private resume detail"}]}))
    db_call(client, seed)
    current = read(client, user, entry)
    fact = next(f for f in current["facts"] if f["id"] == "requirement_0")
    assert "Explain SQL query plans" in fact["text"] and "prior fit check" in fact["text"]
    assert "does not verify" in fact["text"]
    assert "Private resume detail" not in json.dumps(current)
    assert current["version"] != before["version"]
