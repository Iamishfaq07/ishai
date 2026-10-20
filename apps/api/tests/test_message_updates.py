"""Employer-message proposals need human confirmation, exact evidence and a current owned job."""
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from orbit_api.db import sessionmaker
from orbit_api.job_portal import message_updates
from orbit_api.job_portal.message_updates import classify, explicit_date
from orbit_api.models import JobApplication, ProviderRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def setup(client: TestClient) -> tuple[dict[str, str], str]:
    user = register(client, f"reply-{tag()}@example.com")
    result = client.post("/v1/jobs/tracker/manual", headers=auth(user),
        json={"title": "Engineer", "company": "Example", "status": "applied", "notes": "Keep these private notes"})
    assert result.status_code == 201, result.text
    return user, str(result.json()["id"])


def current(client: TestClient, user: dict[str, str], entry: str) -> dict[str, Any]:
    response = client.get(f"/v1/jobs/tracker/{entry}/message-update", headers=auth(user))
    assert response.status_code == 200, response.text
    return dict(response.json())


def propose(client: TestClient, user: dict[str, str], entry: str, **extra: Any) -> Any:
    return client.post(f"/v1/jobs/tracker/{entry}/message-update/preview", headers=auth(user), json={
        "version": current(client, user, entry)["version"],
        "message": "We would like to invite you to an interview.", **extra})


@pytest.mark.parametrize(("message", "event"), [
    ("We have received your application.", "application_received"),
    ("We would like to invite you to an interview. Please confirm your availability.", "interview"),
    ("Thank you for applying. We are pleased to offer you the role.", "offer"),
    ("We will not be moving forward with your application.", "rejected"),
    ("Please reply with your availability for a call.", "needs_reply"),
    ("If we invite you to an interview, we will send a message.", "other"),
    ("We would like to invite you to apply for an open role.", "other"),
    ("We would like to invite you to an interview. We will not be moving forward.", "other"),
    ("We regret to inform you that the interview room has moved.", "other"),
])
def test_patterns_are_explicit_and_conflicting_threads_are_not_resolved(message: str, event: str) -> None:
    result = classify(message)
    assert result.event == event
    assert result.source_quote in message


def test_dates_require_one_explicit_offset_and_do_not_guess_relative_dates() -> None:
    assert explicit_date("Interview tomorrow at 10am") is None
    assert explicit_date("Interview 2030-01-02T10:00") is None
    assert explicit_date("2030-01-02T10:00Z or 2030-01-03T10:00Z") is None
    date = explicit_date("Your interview is confirmed for 2030-01-02T10:00+05:30")
    assert date and date["value"] == "2030-01-02T04:30:00+00:00"
    assert explicit_date("2030-99-02T10:00Z") is None


def test_free_preview_does_not_write_or_call_model_and_owned_ids_are_required(client: TestClient) -> None:
    user, entry = setup(client)
    other, _ = setup(client)
    before = current(client, user, entry)
    response = propose(client, user, entry)
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "rules" and response.json()["suggested_status"] == "interviewing"
    assert current(client, user, entry) == before
    assert client.get(f"/v1/jobs/tracker/{entry}/message-update", headers=auth(other)).status_code == 404
    assert client.get(f"/v1/jobs/tracker/{entry}/message-update").status_code == 401
    assert client.post(f"/v1/jobs/tracker/{entry}/message-update/preview", headers=auth(other), json={
        "version": before["version"], "message": "We would like to invite you to an interview."}).status_code == 404
    async def requests(db: Any) -> list[Any]:
        return list(await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == uid(user))))
    assert db_call(client, requests) == []


def test_confirm_records_stage_date_and_feeds_existing_actions_without_storing_message(client: TestClient) -> None:
    user, entry = setup(client)
    source = current(client, user, entry)
    at = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0).isoformat()
    response = client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json={
        "version": source["version"], "confirmed": True, "status": "interviewing", "next_at": at})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["status"] == "interviewing" and saved["version"] != source["version"]
    actions = client.get("/v1/jobs/actions", headers=auth(user)).json()["items"]
    assert any(item["path"].startswith(f"/jobs/mission/{entry}") for item in actions)
    tracked = next(row for row in client.get("/v1/jobs/tracker", headers=auth(user)).json() if row["id"] == entry)
    assert tracked["notes"] == "Keep these private notes"
    assert client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json={
        "version": source["version"], "confirmed": True, "status": "offer"}).status_code == 409


@pytest.mark.parametrize("extra", [
    {"confirmed": False}, {"confirmed": 1}, {"status": "hired"}, {"next_at": "2030-01-02T10:00:00"},
    {"clear_next": True, "next_at": "2030-01-02T10:00:00Z"}, {"message": "do not store this"},
])
def test_confirm_rejects_unsafe_or_unsupported_changes(client: TestClient, extra: dict[str, Any]) -> None:
    user, entry = setup(client)
    source = current(client, user, entry)
    response = client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json={
        "version": source["version"], "confirmed": True, "status": "interviewing", **extra})
    assert response.status_code == 422, response.text
    assert current(client, user, entry) == source


@pytest.mark.parametrize("status", ["hired", "withdrawn", "rejected"])
def test_closed_jobs_are_preview_only(client: TestClient, status: str) -> None:
    user, entry = setup(client)
    assert client.patch(f"/v1/jobs/tracker/{entry}", headers=auth(user), json={"status": status}).status_code == 200
    response = propose(client, user, entry)
    assert response.status_code == 200 and response.json()["suggested_status"] is None
    assert client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json={
        "version": current(client, user, entry)["version"], "confirmed": True,
        "status": "interviewing"}).status_code == 409


def test_ai_output_requires_exact_quote_and_failure_quota_is_durable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, entry = setup(client)
    original = MockLLMProvider.generate
    async def generate(self: MockLLMProvider, request: Any) -> Any:
        response = await original(self, request)
        response.text = json.dumps({"event": "offer", "source_quote": "Invented employer offer",
                                    "summary": "Review this offer."})
        return response
    monkeypatch.setattr(MockLLMProvider, "generate", generate)
    for _ in range(5):
        response = propose(client, user, entry, mode="ai")
        assert response.status_code == 502, response.text
    assert propose(client, user, entry, mode="ai").status_code == 429
    assert propose(client, user, entry, mode="rules").status_code == 200


def test_ai_preview_and_confirm_refuse_concurrent_changes(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user, entry = setup(client)
    original = MockLLMProvider.generate
    async def generate(self: MockLLMProvider, request: Any) -> Any:
        async with sessionmaker()() as db:
            await db.execute(update(JobApplication).where(JobApplication.id == entry).values(status="offer"))
            await db.commit()
        return await original(self, request)
    monkeypatch.setattr(MockLLMProvider, "generate", generate)
    assert propose(client, user, entry, mode="ai").status_code == 409
    # Simulate a normal tracker writer between the confirm read and its conditional UPDATE.
    source = current(client, user, entry)
    original_owned = message_updates.owned
    first = True
    async def owned(db: Any, account: Any, eid: str) -> Any:
        nonlocal first
        row = await original_owned(db, account, eid)
        if first:
            first = False
            async with sessionmaker()() as other_db:
                await other_db.execute(update(JobApplication).where(JobApplication.id == entry)
                                       .values(status="interviewing"))
                await other_db.commit()
        return row
    monkeypatch.setattr(message_updates, "owned", owned)
    response = client.post(f"/v1/jobs/tracker/{entry}/message-update/confirm", headers=auth(user), json={
        "version": source["version"], "confirmed": True, "status": "rejected"})
    assert response.status_code == 409, response.text
    assert current(client, user, entry)["status"] == "interviewing"
