"""Attribution can be reviewed and undone without rewriting source sessions or leaking another owner."""
import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal import session_associations
from orbit_api.models import ApplicationPacket, AuditLog, LiveSessionRow
from tests.business_helpers import db_call
from tests.test_api import _register


def job(client: TestClient, headers: dict[str, str], company: str = "Acme") -> str:
    response = client.post("/v1/jobs/tracker/manual", headers=headers,
        json={"company": company, "title": "Developer"})
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def session(client: TestClient, user_id: str, **values: Any) -> str:
    identifier = str(uuid.uuid4())

    async def add(db: AsyncSession) -> None:
        db.add(LiveSessionRow(id=identifier, user_id=user_id, title="Original general practice",
            type="mock", status="ended", company="Different company", **values))

    db_call(client, add)
    return identifier


def test_review_unlink_relink_is_owned_idempotent_and_preserves_original_context(client: TestClient) -> None:
    headers, other = _register(client), _register(client)
    owner = client.get("/v1/auth/me", headers=headers).json()["id"]
    foreign_owner = client.get("/v1/auth/me", headers=other).json()["id"]
    first, second, foreign = job(client, headers), job(client, headers, "Second company"), job(client, other)
    sid = session(client, owner, role="Original role", instructions="Keep my original instructions")
    stranger = session(client, foreign_owner)
    base = f"/v1/jobs/tracker/{first}/sessions"
    body = {"session_id": sid, "confirmed": True}
    assert client.post(f"{base}/unlink", headers=headers, json={**body, "confirmed": False}).status_code == 422
    assert client.post(f"{base}/link", headers=headers, json=body).status_code == 200
    assert client.post(f"{base}/link", headers=headers, json=body).status_code == 200
    assert client.post(f"{base}/unlink", headers=other, json=body).status_code == 404
    assert client.post(f"{base}/unlink", headers=headers, json={**body, "session_id": stranger}).status_code == 404
    assert client.post(f"/v1/jobs/tracker/{foreign}/sessions/unlink", headers=headers, json=body).status_code == 404
    assert client.post(f"/v1/jobs/tracker/{second}/sessions/unlink", headers=headers, json=body).status_code == 409
    assert client.get(f"/v1/jobs/tracker/{first}/mission", headers=headers).json()["practice_rounds"] == 1
    assert client.post(f"{base}/unlink", headers=headers, json=body).status_code == 200
    assert client.post(f"{base}/unlink", headers=headers, json=body).status_code == 200
    assert client.get(f"/v1/jobs/tracker/{first}/mission", headers=headers).json()["practice_rounds"] == 0
    # Review can intentionally associate with another job only after unlinking the old attribution.
    assert client.post(f"/v1/jobs/tracker/{second}/sessions/link", headers=headers, json=body).status_code == 200
    assert client.post(f"{base}/unlink", headers=headers, json=body).status_code == 409  # stale first-room action
    detail = client.get(f"/v1/sessions/{sid}", headers=headers).json()["session"]
    assert detail["role"] == "Original role" and detail["company"] == "Different company"
    assert detail["instructions"] == "Keep my original instructions" and detail["application_id"] == second
    exported = client.get("/v1/auth/me/export", headers=headers).json()["opportunity_session_associations"]
    assert [event["action"] for event in reversed(exported)] == [
        session_associations.LINK, session_associations.UNLINK, session_associations.LINK]
    assert all(event["session_id"] == sid for event in exported)
    assert not client.get("/v1/auth/me/export", headers=other).json()["opportunity_session_associations"]
    history = client.get(f"/v1/jobs/tracker/{first}/timeline", headers=headers).json()
    assert len([event for event in history if event["kind"] == "association"]) == 2
    assert not any(event["kind"] == "round" for event in history)
    assert client.request("DELETE", "/v1/auth/me", headers=headers,
        json={"password": "correct horse battery"}).status_code == 204

    async def remaining(db: AsyncSession) -> int:
        return int(await db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.user_id == owner, AuditLog.action.in_(session_associations.ACTIONS))) or 0)

    assert db_call(client, remaining) == 0


def test_active_session_cannot_be_unlinked(client: TestClient) -> None:
    headers = _register(client)
    entry = job(client, headers)
    response = client.post("/v1/sessions", headers=headers,
        json={"type": "mock", "title": "Unfinished", "application_id": entry})
    assert response.status_code == 201, response.text
    sid = response.json()["id"]
    assert client.post(f"/v1/jobs/tracker/{entry}/sessions/unlink", headers=headers,
        json={"session_id": sid, "confirmed": True}).status_code == 409


def test_linked_history_is_not_evicted_and_counts_are_not_preview_counts(client: TestClient) -> None:
    headers = _register(client)
    owner = client.get("/v1/auth/me", headers=headers).json()["id"]
    entry = job(client, headers)
    old = datetime.now(UTC) - timedelta(days=10)

    async def add(db: AsyncSession) -> None:
        for number in range(13):
            db.add(LiveSessionRow(user_id=owner, title=f"Owned older round {number}", company="Acme",
                type="mock", status="ended", application_id=entry, created_at=old + timedelta(seconds=number)))
        for number in range(90):
            db.add(LiveSessionRow(user_id=owner, title=f"Unrelated {number}", company="Elsewhere",
                type="mock", status="ended"))

    db_call(client, add)
    timeline = client.get(f"/v1/jobs/tracker/{entry}/timeline", headers=headers).json()
    assert len([event for event in timeline if event["kind"] == "round"]) == 10
    assert all(event["completed"] for event in timeline if event["kind"] == "round")
    assert client.get(f"/v1/jobs/tracker/{entry}/mission", headers=headers).json()["practice_rounds"] == 13


@pytest.mark.parametrize(("status", "started", "provenance", "title"), [
    ("review", False, "saved_record", "Application packet updated"),
    ("applied", False, "candidate_recorded", "Application recorded by you"),
    ("submitted", True, "executor_reported", "Executor reported submission"),
    ("needs_you", True, "outcome_uncertain", "Application outcome needs review"),
])
def test_application_timeline_uses_explicit_owned_packet_not_guessed_delivery(
    client: TestClient, status: str, started: bool, provenance: str, title: str,
) -> None:
    headers, other = _register(client), _register(client)
    owner = client.get("/v1/auth/me", headers=headers).json()["id"]
    stranger = client.get("/v1/auth/me", headers=other).json()["id"]
    entry = job(client, headers)
    packet_id = str(uuid.uuid4())

    async def add(db: AsyncSession) -> None:
        for user_id, application_id, identifier in [(owner, entry, packet_id), (stranger, entry, str(uuid.uuid4()))]:
            db.add(ApplicationPacket(id=identifier, user_id=user_id, listing_id=str(uuid.uuid4()),
                application_id=application_id, ats="other", company="Acme", company_key="acme", title="Developer",
                url="https://example.com/jobs", apply_url="https://example.com/apply", status=status,
                expires_at=datetime.now(UTC) + timedelta(days=1),
                submission_started_at=datetime.now(UTC) if started else None,
                confirmation_text="private confirmation should not leak", final_url="https://example.com/private"))

    db_call(client, add)
    response = client.get(f"/v1/jobs/tracker/{entry}/timeline", headers=headers)
    assert response.status_code == 200, response.text
    events = [event for event in response.json() if event["kind"] == "application"]
    assert len(events) == 1 and events[0]["title"] == title and events[0]["provenance"] == provenance
    assert events[0]["link"] == f"/jobs/applications?packet={packet_id}"
    assert "private confirmation" not in response.text and "/private" not in response.text
    assert client.get(f"/v1/jobs/tracker/{entry}/timeline", headers=other).status_code == 404


def test_concurrent_session_attribution_cannot_land_in_two_jobs(client: TestClient) -> None:
    headers = _register(client)
    owner = client.get("/v1/auth/me", headers=headers).json()["id"]
    first, second = job(client, headers), job(client, headers, "Second company")
    sid = session(client, owner)

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            responses = await asyncio.gather(*[http.post(f"/v1/jobs/tracker/{entry}/sessions/link",
                headers=headers, json={"session_id": sid, "confirmed": True}) for entry in (first, second)])
        return [response.status_code for response in responses]

    assert sorted(client.portal.call(burst)) == [200, 409]
    exported = client.get("/v1/auth/me/export", headers=headers).json()["opportunity_session_associations"]
    assert len(exported) == 1
    assert exported[0]["application_id"] in (first, second)


def test_concurrent_master_selection_from_one_version_has_one_winner(client: TestClient) -> None:
    headers = _register(client)
    resumes = [client.post("/v1/resumes", headers=headers, json={"title": f"Resume {number}"}).json()
               for number in range(2)]
    path = "/v1/jobs/launchpad/identity"
    initial = client.get(path, headers=headers).json()

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            responses = await asyncio.gather(*[http.put(path, headers=headers, json={
                "action": "select", "version": initial["version"], "resume_id": resume["id"],
                "resume_revision": resume["revision"]}) for resume in resumes])
        return [response.status_code for response in responses]

    assert sorted(client.portal.call(burst)) == [200, 409]
    current = client.get(path, headers=headers).json()
    assert current["master"]["id"] in [resume["id"] for resume in resumes]
    assert current["review"] == "needs_review"
