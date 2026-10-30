"""Role-scoped operational facts and real, idempotent preparation automations."""
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import BizApplication, BizInterview, BizJob, BizMember
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, new_job, register, tag, uid, wait_ranked
from tests.test_business_automations import age, config, queue, run
from tests.test_business_hiring_studio import save_plan
from tests.test_business_hiring_studio import setup as _setup


def setup(client: TestClient) -> tuple[dict[str, str], str, dict[str, Any], str, str]:
    # The application's AI ranking runs in the background after it's submitted; let it finish before these tests
    # write rows directly, or on Postgres the two transactions can deadlock (CI, 1 run in many).
    owner, cid, job, aid, token = _setup(client)
    wait_ranked(client, owner, cid, aid)
    return owner, cid, job, aid, token


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def path(cid: str) -> str:
    return f"/v1/business/companies/{cid}/control-room"


def booking(client: TestClient, cid: str, aid: str, owner: dict[str, str], **extra: Any) -> str:
    async def seed(db: Any) -> str:
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(owner)]
        interview = BizInterview(company_id=cid, application_id=aid, duration_min=45,
            chosen=datetime.now(UTC) + timedelta(hours=1), panel_user_ids=None, **extra)
        db.add(interview)
        await db.flush()
        return str(interview.id)
    return str(db_call(client, seed))


def test_operational_snapshot_readiness_aging_and_privacy(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    age(client, aid, days=5)
    booking(client, cid, aid, owner)
    result = client.get(path(cid), headers=auth(owner))
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["jobs"][0]["active"] == data["jobs"][0]["stalled"] == 1
    assert data["jobs"][0]["stages"][0]["oldest_days"] == 5
    assert data["booked_interviews"] == 1 and data["unassigned_interviews"] == 0
    assert data["capacity"][0]["minutes"] == 45
    assert aid not in result.text and token not in result.text and "resume_text" not in result.text
    assert next(c for c in data["jobs"][0]["checks"] if c["id"] == "plan")["ready"] is False
    save_plan(client, owner, cid, job["id"])
    after = client.get(path(cid), headers=auth(owner)).json()
    assert after["version"] != data["version"]
    assert next(c for c in after["jobs"][0]["checks"] if c["id"] == "plan")["ready"] is True


def test_manager_scoping_interviewer_wall_and_tenant_isolation(client: TestClient) -> None:
    owner, cid, job, _aid, _token = setup(client)
    other = new_job(client, owner, cid, title="Private role", publish=False)
    manager = register(client, f"manager-{tag()}@example.com")
    interviewer = register(client, f"panel-{tag()}@example.com")
    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(manager), role="hiring_manager"))
        db.add(BizMember(company_id=cid, user_id=uid(interviewer), role="interviewer"))
        row = await db.get(BizJob, job["id"])
        row.hiring_team = [uid(manager)]
    db_call(client, assign)
    result = client.get(path(cid), headers=auth(manager))
    assert result.status_code == 200 and [j["id"] for j in result.json()["jobs"]] == [job["id"]]
    assert other["id"] not in result.text and "Private role" not in result.text
    assert client.get(path(cid), headers=auth(interviewer)).status_code == 403
    outsider, _, _ = new_company(client)
    assert client.get(path(cid), headers=auth(outsider)).status_code == 404


def test_latest_unbooked_interview_hides_old_booking_and_explicit_empty_panel_is_empty(client: TestClient) -> None:
    owner, cid, _job, aid, _token = setup(client)
    first = booking(client, cid, aid, owner)
    async def clear_panel(db: Any) -> None:
        row = await db.get(BizInterview, first)
        row.panel_user_ids = []
    db_call(client, clear_panel)
    result = client.get(path(cid), headers=auth(owner)).json()
    assert result["booked_interviews"] == result["unassigned_interviews"] == 1 and result["capacity"] == []
    async def cancel(db: Any) -> None:
        db.add(BizInterview(company_id=cid, application_id=aid, chosen=None,
            created_at=datetime.now(UTC) + timedelta(seconds=1)))
    db_call(client, cancel)
    assert client.get(path(cid), headers=auth(owner)).json()["booked_interviews"] == 0


def test_preparation_recipe_off_by_default_then_deduplicates_and_resolves(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    booking(client, cid, aid, owner)  # Legacy panel fallback is loaded, not an async lazy-load failure.
    config(client, owner, cid, job["id"], stalled_days=None, question_hours=None, feedback_hours=None,
        assessment_hours=None, scheduling_hours=None)
    assert queue(client, owner, cid)["items"] == []
    record = config(client, owner, cid, job["id"], prep_hours=24, stalled_days=None, question_hours=None,
        feedback_hours=None, assessment_hours=None, scheduling_hours=None)
    assert record["changes"]["created"] == 1
    assert queue(client, owner, cid)["items"][0]["kind"] == "prep"
    assert run(client, owner, cid, job["id"])["changes"]["created"] == 0
    save_plan(client, owner, cid, job["id"])
    assert run(client, owner, cid, job["id"])["changes"]["resolved"] == 1


def test_recipe_preview_includes_new_rule_and_does_not_create_tasks(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    booking(client, cid, aid, owner)
    preview = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}/automation/preview",
        headers=auth(owner), params={"prep_hours": 24, "stalled_days": 0, "question_hours": 0,
            "feedback_hours": 0, "assessment_hours": 0})
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["prep"] == 1
    assert queue(client, owner, cid)["items"] == []


def test_ai_operations_advice_rejects_stale_sources_and_does_not_write_tasks(client: TestClient) -> None:
    owner, cid, job, _aid, _token = setup(client)
    source = client.get(path(cid), headers=auth(owner)).json()
    result = client.post(path(cid) + "/brief", headers=auth(owner), json={"version": source["version"]})
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "mock" and result.json()["tips"][0]["fact_id"] == "operations"
    assert queue(client, owner, cid)["items"] == []
    save_plan(client, owner, cid, job["id"])
    stale = client.post(path(cid) + "/brief", headers=auth(owner), json={"version": source["version"]})
    assert stale.status_code == 409


def test_operations_permissions_rechecked_after_model_wait(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy import delete
    owner, cid, _job, _aid, _token = setup(client)
    source = client.get(path(cid), headers=auth(owner)).json()
    class Revoking(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                await db.execute(delete(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(owner)))
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Revoking)
    revoked = client.post(path(cid) + "/brief", headers=auth(owner), json={"version": source["version"]})
    assert revoked.status_code == 404


@pytest.mark.parametrize("change", ["unconfirmed", "deleted", "rejected"])
def test_pipeline_and_capacity_exclude_inactive_or_unconfirmed_applications(client: TestClient, change: str) -> None:
    owner, cid, _job, aid, _token = setup(client)
    booking(client, cid, aid, owner)
    async def edit(db: Any) -> None:
        row = await db.get(BizApplication, aid)
        if change == "unconfirmed":
            row.email_confirmed_at = None
        elif change == "deleted":
            row.deletion_requested_at = datetime.now(UTC)
        else:
            row.status = "rejected"
    db_call(client, edit)
    data = client.get(path(cid), headers=auth(owner)).json()
    assert data["jobs"][0]["active"] == data["booked_interviews"] == 0


def test_preparation_task_starts_in_window_and_resolves_when_booking_clears(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    iv = booking(client, cid, aid, owner)
    async def far_away(db: Any) -> None:
        row = await db.get(BizInterview, iv)
        row.chosen = datetime.now(UTC) + timedelta(days=5)
    db_call(client, far_away)
    config(client, owner, cid, job["id"], prep_hours=24, stalled_days=None, question_hours=None,
        feedback_hours=None, assessment_hours=None, scheduling_hours=None)
    assert queue(client, owner, cid)["items"] == []
    async def near(db: Any) -> None:
        row = await db.get(BizInterview, iv)
        row.chosen = datetime.now(UTC) + timedelta(hours=1)
    db_call(client, near)
    assert run(client, owner, cid, job["id"])["changes"]["created"] == 1
    async def cancel(db: Any) -> None:
        row = await db.get(BizInterview, iv)
        row.chosen = None
    db_call(client, cancel)
    assert run(client, owner, cid, job["id"])["changes"]["resolved"] == 1
