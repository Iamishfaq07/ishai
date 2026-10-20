"""Record-derived priorities, source lifecycle changes and owned job context over real HTTP."""
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import ApplicationPacket, JobApplication
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def person(client: TestClient) -> dict[str, str]:
    return register(client, f"next-action-{tag()}@example.com")


def job(client: TestClient, user: dict[str, str], hours: int = 72,
        status: str = "interviewing") -> dict[str, Any]:
    response = client.post("/v1/jobs/tracker/manual", headers=auth(user), json={
        "title": f"Engineer {tag()}", "company": "Northstar", "status": status,
        "next_at": (datetime.now(UTC) + timedelta(hours=hours)).isoformat()})
    assert response.status_code == 201, response.text
    return dict(response.json())


def packet(client: TestClient, user: dict[str, str], state: str = "needs_answer", **extra: Any) -> str:
    async def seed(db: Any) -> str:
        row = ApplicationPacket(user_id=uid(user), listing_id=str(uuid4()), company="Acme", company_key="acme",
            title="Platform Engineer", status=state, ats="workday", url="https://example.com/job",
            apply_url="https://example.com/apply", expires_at=datetime.now(UTC) + timedelta(days=3))
        for key, value in extra.items():
            setattr(row, key, value)
        db.add(row)
        await db.flush()
        return str(row.id)
    return str(db_call(client, seed))


def queue(client: TestClient, user: dict[str, str]) -> Any:
    response = client.get("/v1/jobs/actions", headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()


def test_blocked_application_comes_before_later_interview_and_updates_from_records(client: TestClient) -> None:
    user = person(client)
    upcoming = job(client, user)
    pid = packet(client, user)
    first = queue(client, user)
    assert first["focus_id"] == f"packet:{pid}"
    assert first["items"][0]["action_label"] == "Answer questions"
    assert "only you" in first["items"][0]["priority_reason"]
    assert first["items"][1]["path"] == f"/jobs/mission/{upcoming['id']}?tab=plan"
    assert queue(client, user)["version"] == first["version"]
    soon = job(client, user, hours=4)
    assert queue(client, user)["focus_id"] == f"job:{soon['id']}"
    past = job(client, user, hours=-4)
    latest = queue(client, user)
    assert latest["focus_id"] == f"job:{past['id']}"
    assert latest["items"][0]["path"].endswith("?tab=timeline")
    assert "Record what happened" in latest["items"][0]["priority_reason"]
    stale = client.post("/v1/jobs/actions/brief", headers=auth(user), json={"version": first["version"]})
    assert stale.status_code == 409


@pytest.mark.parametrize("state", ["needs_answer", "review", "needs_you", "handoff", "failed", "expired"])
def test_every_attention_state_has_specific_action_and_consistent_journey_count(client: TestClient, state: str) -> None:
    user, other = person(client), person(client)
    pid = packet(client, user, state)
    packet(client, other, "needs_answer")
    result = queue(client, user)
    assert result["focus_id"] == f"packet:{pid}"
    action = result["items"][0]
    assert action["source_status"] == state and action["action_label"] != "Open workspace"
    assert action["path"] == f"/jobs/applications?packet={pid}"
    assert action["due_at"] is None and not action["overdue"]
    assert client.get("/v1/apply/journey", headers=auth(user)).json()["needs_attention"] == 1
    detail = client.get(f"/v1/apply/packets/{pid}", headers=auth(user))
    assert detail.status_code == 200, detail.text
    assert detail.json()["status"] == state and detail.json()["tracker_id"] is None
    assert client.get(f"/v1/apply/packets/{pid}", headers=auth(other)).status_code == 404


@pytest.mark.parametrize("state", ["ready", "leased", "submitted", "cancelled", "skipped"])
def test_waiting_and_finished_packets_do_not_create_candidate_tasks(client: TestClient, state: str) -> None:
    user = person(client)
    packet(client, user, state)
    result = queue(client, user)
    assert result["items"] == [] and result["focus_id"] is None
    assert client.get("/v1/apply/journey", headers=auth(user)).json()["needs_attention"] == 0


@pytest.mark.parametrize("state", ["withdrawn", "rejected", "hired"])
def test_closed_job_removes_date_and_prepared_packet_reminders(client: TestClient, state: str) -> None:
    user = person(client)
    saved = job(client, user, hours=-2, status=state)
    # Prepared packets have no submission application_id yet: listing context still matters.
    pid = packet(client, user, "review", listing_id=saved["listing_id"])
    assert queue(client, user)["items"] == []
    assert client.get("/v1/apply/journey", headers=auth(user)).json()["needs_attention"] == 0
    detail = client.get(f"/v1/apply/packets/{pid}", headers=auth(user)).json()
    assert detail["tracker_id"] == saved["id"] and detail["status"] == "review"


def test_prepared_packet_resolves_owned_context_without_creating_or_submitting(client: TestClient) -> None:
    user, other = person(client), person(client)
    saved = job(client, user, status="saved")
    pid = packet(client, user, "review", listing_id=saved["listing_id"])
    async def foreign(db: Any) -> None:
        db.add(JobApplication(user_id=uid(other), listing_id=saved["listing_id"], source="manual",
            company="Private company", title="Private title", status="hired", url="", apply_url=""))
    db_call(client, foreign)
    detail = client.get(f"/v1/apply/packets/{pid}", headers=auth(user)).json()
    assert detail["tracker_id"] == saved["id"]
    result = queue(client, user)
    assert result["focus_id"] == f"packet:{pid}"
    assert "Private" not in str(result)
    assert len(client.get("/v1/jobs/tracker", headers=auth(user)).json()) == 1
    async def unchanged(db: Any) -> None:
        prepared = await db.get(ApplicationPacket, pid)
        assert prepared.status == "review" and prepared.application_id is None
        assert (await db.get(JobApplication, saved["id"])).status == "saved"
    db_call(client, unchanged)


def test_candidate_answers_are_not_starved_by_a_large_review_queue(client: TestClient) -> None:
    user = person(client)
    async def many(db: Any) -> None:
        db.add_all([ApplicationPacket(user_id=uid(user), listing_id=str(uuid4()), company="Acme", company_key="acme",
            title="Review later", status="review", ats="lever", url="https://example.com", apply_url="https://example.com",
            expires_at=datetime.now(UTC) + timedelta(days=3)) for _ in range(110)])
    db_call(client, many)
    pid = packet(client, user)
    result = queue(client, user)
    assert result["truncated"] and len(result["items"]) == 100
    assert result["focus_id"] == f"packet:{pid}"
    assert client.get("/v1/apply/journey", headers=auth(user)).json()["needs_attention"] == 111


@pytest.mark.parametrize("state,started,uncertain", [
    ("failed", True, True), ("failed", False, False), ("submitted", True, False), ("applied", True, False)])
def test_packet_list_and_detail_agree_on_unconfirmed_attempts(client: TestClient, state: str,
                                                            started: bool, uncertain: bool) -> None:
    user, other = person(client), person(client)
    pid = packet(client, user, state, submission_started_at=datetime.now(UTC) if started else None)
    listed = client.get("/v1/apply/packets", headers=auth(user))
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["id"] == pid and listed.json()[0]["submission_uncertain"] is uncertain
    assert client.get(f"/v1/apply/packets/{pid}", headers=auth(user)).json()["submission_uncertain"] is uncertain
    assert client.get("/v1/apply/packets", headers=auth(other)).json() == []
