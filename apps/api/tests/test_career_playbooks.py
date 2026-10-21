"""Opt-in follow-up rules from owned records, with versioned settings and no outbound actions."""
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import JobApplication, JobContact
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def person(client: TestClient) -> dict[str, str]:
    return register(client, f"playbook-{tag()}@example.com")


def settings(client: TestClient, user: dict[str, str], **extra: Any) -> Any:
    current = client.get("/v1/jobs/playbook", headers=auth(user)).json()
    revision = current.pop("revision")
    return client.put("/v1/jobs/playbook", headers=auth(user), json={
        **current, "base_revision": revision, **extra})


def job(client: TestClient, user: dict[str, str], days: int = 14, status: str = "applied") -> str:
    response = client.post("/v1/jobs/tracker/manual", headers=auth(user), json={
        "title": f"Platform engineer {tag()}", "company": "Northstar", "status": status})
    assert response.status_code == 201, response.text
    jid = str(response.json()["id"])
    async def age(db: Any) -> None:
        row = await db.get(JobApplication, jid)
        row.applied_at = row.status_at = datetime.now(UTC) - timedelta(days=days)
    db_call(client, age)
    return jid


def actions(client: TestClient, user: dict[str, str]) -> Any:
    response = client.get("/v1/jobs/actions", headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()


def test_opt_in_owned_revisioned_settings_and_export(client: TestClient) -> None:
    user, other = person(client), person(client)
    jid = job(client, user)
    job(client, other)
    assert actions(client, user)["items"] == []
    saved = settings(client, user, follow_up_days=7)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    queue = actions(client, user)
    assert [a["id"] for a in queue["items"]] == [f"playbook:{jid}"]
    assert queue["items"][0]["rule"] == "application_follow_up"
    assert actions(client, other)["items"] == []
    stale = client.put("/v1/jobs/playbook", headers=auth(user), json={"base_revision": 0, "follow_up_days": 14})
    assert stale.status_code == 409
    exported = client.get("/v1/auth/me/export", headers=auth(user)).json()
    assert exported["job_search"]["playbook"]["follow_up_days"] == 7
    assert settings(client, user, follow_up_days=None).status_code == 200
    assert actions(client, user)["items"] == []


@pytest.mark.parametrize("bad", [{"follow_up_days": 2}, {"follow_up_days": 61}, {"follow_up_days": True},
    {"prep_hours": 0}, {"prep_hours": 169}, {"send_emails": True}])
def test_invalid_settings_cannot_enable_actions(client: TestClient, bad: dict[str, Any]) -> None:
    user = person(client)
    response = client.put("/v1/jobs/playbook", headers=auth(user), json={"base_revision": 0, **bad})
    assert response.status_code == 422


def test_source_progress_and_contact_activity_resolve_followup(client: TestClient) -> None:
    user = person(client)
    jid = job(client, user)
    assert settings(client, user, follow_up_days=7).status_code == 200
    assert len(actions(client, user)["items"]) == 1
    contact = client.post("/v1/jobs/contacts", headers=auth(user), json={"name": "Alex", "company": "Northstar",
        "application_id": jid})
    assert contact.status_code == 201, contact.text
    response = client.patch(f"/v1/jobs/contacts/{contact.json()['id']}", headers=auth(user), json={
        "last_contacted_at": datetime.now(UTC).isoformat()})
    assert response.status_code == 200, response.text
    assert actions(client, user)["items"] == []
    client.delete(f"/v1/jobs/contacts/{contact.json()['id']}", headers=auth(user))
    assert len(actions(client, user)["items"]) == 1
    assert client.patch(f"/v1/jobs/tracker/{jid}", headers=auth(user), json={
        "next_at": (datetime.now(UTC) + timedelta(days=20)).isoformat()}).status_code == 200
    assert actions(client, user)["items"] == []
    assert client.patch(f"/v1/jobs/tracker/{jid}", headers=auth(user), json={"clear_next": True,
        "status": "rejected"}).status_code == 200
    assert actions(client, user)["items"] == []


def test_recent_future_and_terminal_jobs_never_get_automatic_followups(client: TestClient) -> None:
    user = person(client)
    for days, status in [(2, "applied"), (-8, "applied"), (30, "rejected"), (30, "hired"), (30, "saved")]:
        job(client, user, days, status)
    assert settings(client, user, follow_up_days=7).status_code == 200
    assert actions(client, user)["items"] == []


def test_preparation_enriches_the_real_interview_and_keeps_its_date(client: TestClient) -> None:
    user = person(client)
    jid = job(client, user, status="interviewing")
    date = (datetime.now(UTC) + timedelta(hours=12)).isoformat()
    client.patch(f"/v1/jobs/tracker/{jid}", headers=auth(user), json={"next_at": date})
    assert settings(client, user, prep_hours=24).status_code == 200
    queue = actions(client, user)
    assert len(queue["items"]) == 1
    item = queue["items"][0]
    assert item["id"] == f"job:{jid}" and item["kind"] == "interview"
    assert item["rule"] == "interview_preparation" and item["due_at"] == date and not item["overdue"]
    assert settings(client, user, prep_hours=1).status_code == 200
    assert "rule" not in actions(client, user)["items"][0]


def test_concurrent_rule_edits_have_one_winner_and_invalidate_old_ai(client: TestClient) -> None:
    user = person(client)
    job(client, user)
    assert settings(client, user, follow_up_days=7).status_code == 200
    before = actions(client, user)
    def edit(days: int) -> int:
        return client.put("/v1/jobs/playbook", headers=auth(user), json={
            "base_revision": 1, "follow_up_days": days}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, [8, 9])) == [200, 409]
    response = client.post("/v1/jobs/actions/brief", headers=auth(user), json={"version": before["version"]})
    assert response.status_code == 409


def test_recent_contact_records_cannot_hide_a_due_job_behind_the_scan_limit(client: TestClient) -> None:
    user = person(client)
    async def seed(db: Any) -> str:
        now = datetime.now(UTC)
        old = now - timedelta(days=30)
        records = [JobApplication(id=str(uuid4()), user_id=uid(user), listing_id=str(uuid4()), source="manual",
            company="Older", title="Engineer", status="applied", url="", apply_url="", applied_at=old,
            status_at=old) for _ in range(201)]
        db.add_all(records)
        await db.flush()
        db.add_all([JobContact(user_id=uid(user), application_id=row.id, name="Recruiter",
            last_contacted_at=now - timedelta(days=1)) for row in records])
        due = JobApplication(id=str(uuid4()), user_id=uid(user), listing_id=str(uuid4()), source="manual",
            company="Due", title="Engineer", status="applied", url="", apply_url="",
            applied_at=now - timedelta(days=10), status_at=now - timedelta(days=10))
        db.add(due)
        return due.id
    jid = db_call(client, seed)
    assert settings(client, user, follow_up_days=7).status_code == 200
    assert [a["id"] for a in actions(client, user)["items"]] == [f"playbook:{jid}"]


def test_new_workflow_rules_are_off_until_enabled_and_only_suggest(client: TestClient) -> None:
    from orbit_api.models import JobInterviewRound

    user = person(client)
    quiet_job = job(client, user, days=40)
    saved_job = job(client, user, days=10, status="saved")
    interviewing = job(client, user, days=3, status="interviewing")

    async def round_held(db: Any) -> None:
        db.add(JobInterviewRound(user_id=uid(user), application_id=interviewing, label="Hiring manager round",
            scheduled_at=datetime.now(UTC) - timedelta(hours=3), status="planned", source_key=uuid4().hex))
    db_call(client, round_held)
    assert actions(client, user)["items"] == []  # every rule starts off

    saved = settings(client, user, follow_up_days=7, stale_days=30, saved_days=7, thank_you_hours=24)
    assert saved.status_code == 200, saved.text
    assert {k: saved.json()[k] for k in ("stale_days", "saved_days", "thank_you_hours")} == {
        "stale_days": 30, "saved_days": 7, "thank_you_hours": 24}
    rules = {item["id"]: item["rule"] for item in actions(client, user)["items"] if item.get("rule")}
    # The quiet application's decision replaces its routine follow-up for the same job.
    assert rules[f"quiet:{quiet_job}"] == "application_quiet" and f"playbook:{quiet_job}" not in rules
    assert rules[f"saved:{saved_job}"] == "saved_job_decision"
    thanks = [item for item in actions(client, user)["items"] if item.get("rule") == "interview_thank_you"]
    assert len(thanks) == 1 and thanks[0]["path"].startswith("/jobs/outreach?view=messages&job=")

    # Nothing was changed by the rules themselves.
    statuses = {e["id"]: e["status"] for e in client.get("/v1/jobs/tracker", headers=auth(user)).json()}
    assert statuses[quiet_job] == "applied" and statuses[saved_job] == "saved"

    # A contact logged after the interview clears the thank-you suggestion.
    async def contacted(db: Any) -> None:
        db.add(JobContact(user_id=uid(user), application_id=interviewing, name="Priya",
            last_contacted_at=datetime.now(UTC) - timedelta(hours=1)))
    db_call(client, contacted)
    assert not [i for i in actions(client, user)["items"] if i.get("rule") == "interview_thank_you"]
    assert settings(client, user, stale_days=7).status_code == 422  # below the 14-day floor
