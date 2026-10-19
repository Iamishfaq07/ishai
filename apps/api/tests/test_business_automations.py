"""Enterprise follow-ups through real HTTP, durable sweeps, tenant boundaries and concurrent writers."""
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.business import automation
from orbit_api.models import (
    BizApplication,
    BizAutomation,
    BizCompany,
    BizEvent,
    BizHiringTask,
    BizInterview,
    BizJob,
    BizMember,
    BizNotification,
)
from tests.business_helpers import auth, db_call, make_client, new_company, register, tag, uid
from tests.test_business_hiring_operations import answer, question
from tests.test_business_hiring_studio import feedback, save_plan, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def paths(cid: str, jid: str) -> tuple[str, str]:
    base = f"/v1/business/companies/{cid}"
    return base, f"{base}/jobs/{jid}/automation"


def config(client: TestClient, owner: Any, cid: str, jid: str, **overrides: Any) -> Any:
    recipe = {**automation.Recipe(enabled=True).model_dump(), **overrides}
    records = client.get(f"/v1/business/companies/{cid}/automations", headers=auth(owner)).json()["jobs"]
    revision = next(j["revision"] for j in records if j["job_id"] == jid)
    r = client.put(paths(cid, jid)[1], headers=auth(owner), json={"base_revision": revision, "recipe": recipe})
    assert r.status_code == 200, r.text
    return r.json()


def age(client: TestClient, aid: str, days: int = 5) -> None:
    async def change(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        app.stage_changed_at = datetime.now(UTC) - timedelta(days=days)
    db_call(client, change)


def queue(client: TestClient, owner: Any, cid: str, status: str = "all", **params: Any) -> Any:
    r = client.get(f"/v1/business/companies/{cid}/hiring-tasks", headers=auth(owner),
        params={"status": status, **params})
    assert r.status_code == 200, r.text
    return r.json()


def run(client: TestClient, owner: Any, cid: str, jid: str) -> Any:
    r = client.post(paths(cid, jid)[1] + "/run", headers=auth(owner))
    assert r.status_code == 200, r.text
    return r.json()


def manual(client: TestClient, owner: Any, cid: str, aid: str, **overrides: Any) -> Any:
    body = {"request_id": str(uuid.uuid4()), "title": "Arrange a follow-up conversation",
        "due_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(), **overrides}
    r = client.post(f"/v1/business/companies/{cid}/applications/{aid}/hiring-tasks", headers=auth(owner), json=body)
    assert r.status_code == 200, r.text
    return r.json(), body


def test_opt_in_preview_deduplicated_generation_and_no_candidate_messages(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    base, recipe = paths(cid, job["id"])
    assert queue(client, owner, cid)["items"] == []
    run(client, owner, cid, job["id"])
    preview = client.get(recipe + "/preview", headers=auth(owner))
    assert preview.status_code == 200 and preview.json()["counts"]["stalled"] == 1
    assert queue(client, owner, cid)["items"] == []
    saved = config(client, owner, cid, job["id"], default_assignee_id=uid(owner))
    assert saved["changes"]["created"] == 1
    for _ in range(3):
        assert run(client, owner, cid, job["id"])["changes"]["created"] == 0
    tasks = queue(client, owner, cid)
    assert len(tasks["items"]) == tasks["overdue"] == 1
    task = tasks["items"][0]
    assert task["assignee_id"] == uid(owner) and task["kind"] == "stalled"
    assert queue(client, owner, cid, mine=True)["items"] == tasks["items"]
    async def notifications(db: Any) -> int:
        return int(await db.scalar(select(func.count()).select_from(BizNotification).where(
            BizNotification.application_id == aid, BizNotification.kind == "automation")))
    assert db_call(client, notifications) == 1
    public = client.get(f"/v1/public/business/applications/{_token}/conversation").text
    assert "task_created" not in public and "stalled" not in public
    assert client.get(base + "/automations", headers=auth(owner)).json()["interval_seconds"] == 300


def test_question_source_clears_only_its_own_task(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    qid = question(client, token)
    second = question(client, token, "Please clarify how long the next conversation will take?")
    async def earlier(db: Any) -> None:
        for q in (qid, second):
            (await db.get(BizEvent, q)).created_at = datetime.now(UTC) - timedelta(days=2)
    db_call(client, earlier)
    config(client, owner, cid, job["id"])
    assert len(queue(client, owner, cid, "open")["items"]) == 2
    client.post(f"/v1/business/companies/{cid}/applications/{aid}/questions/{qid}/reply", headers=auth(owner),
        json={**answer(), "notify": False}).raise_for_status()
    run(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["counts"] == {"open": 1, "resolved": 1}


def test_new_stage_creates_new_episode_but_handled_task_does_not_repeat(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    config(client, owner, cid, job["id"])
    task = queue(client, owner, cid)["items"][0]
    action = {"base_revision": task["revision"], "action": "done", "note": "Contacted the coordinator today"}
    path = f"/v1/business/companies/{cid}/hiring-tasks/{task['id']}"
    client.post(path, headers=auth(owner), json=action).raise_for_status()
    assert client.post(path, headers=auth(owner), json=action).status_code == 409
    run(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["counts"] == {"done": 1}
    age(client, aid, 6)
    run(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["counts"] == {"done": 1, "open": 1}


def test_snooze_wakes_in_background_and_pause_resolves_without_duplicate(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    config(client, owner, cid, job["id"])
    task = queue(client, owner, cid)["items"][0]
    wake = datetime.now(UTC) + timedelta(hours=1)
    client.post(f"/v1/business/companies/{cid}/hiring-tasks/{task['id']}", headers=auth(owner), json={
        "base_revision": task["revision"], "action": "snooze", "until": wake.isoformat(),
        "note": "Waiting for the panel to respond"}).raise_for_status()
    assert queue(client, owner, cid)["counts"] == {"snoozed": 1}
    client.portal.call(automation.sweep, wake + timedelta(minutes=1))
    assert queue(client, owner, cid)["counts"] == {"open": 1}
    config(client, owner, cid, job["id"], enabled=False)
    assert queue(client, owner, cid)["counts"] == {"resolved": 1}
    config(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["counts"] == {"open": 1}
    assert queue(client, owner, cid)["items"][0]["id"] == task["id"]


@pytest.mark.parametrize("terminal", ["withdrawn", "rejected", "hired", "deletion", "job_closed", "job_paused"])
def test_terminal_lifecycle_resolves_automatic_and_manual_tasks(client: TestClient, terminal: str) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    config(client, owner, cid, job["id"])
    manual(client, owner, cid, aid)
    async def close(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        if terminal == "deletion":
            app.deletion_requested_at = datetime.now(UTC)
        elif terminal.startswith("job_"):
            (await db.get(BizJob, job["id"])).status = terminal[4:]
        else:
            app.status = terminal
    db_call(client, close)
    run(client, owner, cid, job["id"])
    data = queue(client, owner, cid)
    assert data["counts"] == {"resolved": 2} and not any(t["actionable"] for t in data["items"])
    assert client.post(f"/v1/business/companies/{cid}/hiring-tasks/{data['items'][0]['id']}", headers=auth(owner),
        json={"base_revision": data["items"][0]["revision"], "action": "reopen",
            "note": "Try reopening"}).status_code == 409


def test_feedback_and_assessment_tasks_resolve_on_actual_evidence(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    async def seed(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        app.stage_id = plan["plan"]["criteria"][0]["stage_id"]
        db.add(BizInterview(company_id=cid, application_id=aid, chosen=datetime.now(UTC) - timedelta(days=2),
            created_by=uid(owner), panel_user_ids=[uid(owner)]))
        db.add(BizEvent(company_id=cid, application_id=aid, job_id=job["id"], kind="saba_completed",
            created_at=datetime.now(UTC) - timedelta(days=2), data={}))
    db_call(client, seed)
    config(client, owner, cid, job["id"])
    assert {t["kind"] for t in queue(client, owner, cid, "open")["items"]} == {"feedback", "assessment"}
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    client.put(path + "/interview-feedback", headers=auth(owner),
        json={**feedback(plan), "submit": True}).raise_for_status()
    room = client.get(path + "/hiring-room", headers=auth(owner)).json()
    client.post(path + "/hiring-decision", headers=auth(owner), json={"outcome": "hold",
        "rationale": "Collect another direct example before deciding on the next round.",
        "base_evidence_version": room["evidence_version"]}).raise_for_status()
    run(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["counts"] == {"resolved": 2}


def test_manual_tasks_retry_assignment_and_deletion_cleanup(client: TestClient) -> None:
    owner, cid, _job, aid, _token = setup(client)
    task, body = manual(client, owner, cid, aid)
    base = f"/v1/business/companies/{cid}"
    path = f"{base}/applications/{aid}/hiring-tasks"
    assert client.post(path, headers=auth(owner), json=body).json()["id"] == task["id"]
    assert client.post(path, headers=auth(owner),
        json={**body, "title": "A changed title with the same key"}).status_code == 409
    assert client.post(f"{base}/hiring-tasks/{task['id']}", headers=auth(owner), json={"base_revision": 1,
        "action": "assign", "assignee_id": uid(owner), "note": "Owning this follow-up"}).status_code == 200
    assert len(queue(client, owner, cid, mine=True)["items"]) == 1
    client.delete(f"{base}/applications/{aid}", headers=auth(owner)).raise_for_status()
    assert queue(client, owner, cid)["items"] == []
    async def remaining(db: Any) -> int:
        return int(await db.scalar(select(func.count()).select_from(BizHiringTask).where(
            BizHiringTask.application_id == aid)))
    assert db_call(client, remaining) == 0


def test_tenant_job_roles_blind_review_suspension_and_invalid_owners(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    other, other_company, _ = new_company(client)
    task, _body = manual(client, owner, cid, aid)
    base, recipe = paths(cid, job["id"])
    assert client.get(base + "/automations", headers=auth(other)).status_code == 404
    assert client.get(base + "/hiring-tasks", headers=auth(other)).status_code == 404
    assert client.post(f"{base}/hiring-tasks/{task['id']}", headers=auth(other), json={
        "base_revision": 1, "action": "done", "note": "Try other tenant"}).status_code == 404
    wrong_path = f"/v1/business/companies/{other_company['id']}/hiring-tasks/{task['id']}"
    assert client.post(wrong_path, headers=auth(other), json={
        "base_revision": 1, "action": "done", "note": "Try other tenant"}).status_code == 404
    assert client.put(recipe, headers=auth(owner), json={"base_revision": 0,
        "recipe": {"enabled": True, "default_assignee_id": uid(other)}}).status_code == 422
    peer = register(client, f"automation-peer-{tag()}@example.com")
    async def member(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="hiring_manager"))
        (await db.get(BizCompany, cid)).blind_review = True
    db_call(client, member)
    assert client.get(recipe + "/preview", headers=auth(peer)).status_code == 404
    assert queue(client, peer, cid)["items"] == []
    assert queue(client, owner, cid)["items"][0]["name"] == f"Candidate {task['reference']}"
    async def suspend(db: Any) -> None:
        (await db.get(BizCompany, cid)).status = "suspended"
    db_call(client, suspend)
    assert client.post(recipe + "/run", headers=auth(owner)).status_code == 403
    assert client.post(f"{base}/hiring-tasks/{task['id']}", headers=auth(owner), json={
        "base_revision": 1, "action": "done", "note": "Try suspended"}).status_code == 403


def test_removed_owner_is_unassigned_and_interviewers_have_no_automation_access(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    peer = register(client, f"coordinator-{tag()}@example.com")
    async def member(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="recruiter"))
    db_call(client, member)
    age(client, aid)
    config(client, owner, cid, job["id"], default_assignee_id=uid(peer))
    async def downgrade(db: Any) -> None:
        row = await db.scalar(select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(peer)))
        row.role = "interviewer"
        (await db.get(BizApplication, aid)).interviewers = [uid(peer)]
    db_call(client, downgrade)
    base, _recipe = paths(cid, job["id"])
    assert client.get(base + "/automations", headers=auth(peer)).status_code == 403
    assert client.get(base + "/hiring-tasks", headers=auth(peer)).status_code == 403
    run(client, owner, cid, job["id"])
    assert queue(client, owner, cid)["items"][0]["assignee_id"] is None


def test_concurrent_saves_and_sweeps_keep_one_source_task(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    path = paths(cid, job["id"])[1]
    barrier = Barrier(2)
    def save(_: int) -> int:
        barrier.wait()
        return client.put(path, headers=auth(owner), json={"base_revision": 0, "recipe": {"enabled": True}}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, range(2))) == [200, 409]
    barrier = Barrier(2)
    def reconcile(_: int) -> int:
        barrier.wait()
        return client.post(path + "/run", headers=auth(owner)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(reconcile, range(2))) == [200, 200]
    assert len(queue(client, owner, cid)["items"]) == 1


def test_preview_disabled_rules_and_config_validation(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    path = paths(cid, job["id"])[1]
    assert client.get(path + "/preview?stalled_days=0&question_hours=0&feedback_hours=0&assessment_hours=0",
        headers=auth(owner)).json()["total"] == 0
    for invalid in ({"stalled_days": 0}, {"question_hours": 169}, {"unknown": True}):
        assert client.put(path, headers=auth(owner), json={"base_revision": 0, "recipe": invalid}).status_code == 422
    config(client, owner, cid, job["id"], stalled_days=None)
    assert queue(client, owner, cid)["items"] == []


def test_background_sweep_uses_saved_recipe_without_browser(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    config(client, owner, cid, job["id"])
    age(client, aid)
    now = datetime.now(UTC) + timedelta(minutes=6)
    client.portal.call(automation.sweep, now)
    assert queue(client, owner, cid)["items"][0]["kind"] == "stalled"
    async def last_run(db: Any) -> Any:
        return (await db.get(BizAutomation, job["id"])).last_run_at
    assert db_call(client, last_run) is not None


def test_large_role_scans_every_application_and_queue_pages_without_duplicates(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    age(client, aid)
    async def seed(db: Any) -> None:
        original = await db.get(BizApplication, aid)
        for i in range(205):
            stamp = uuid.uuid4().hex
            db.add(BizApplication(company_id=cid, job_id=job["id"], name=f"Test Candidate {i}",
                email=f"{stamp}@example.com", reference=f"T-{stamp[:8]}", status_token_hash=stamp + stamp,
                stage_id=original.stage_id, status="active", stage_changed_at=original.stage_changed_at))
    db_call(client, seed)
    saved = config(client, owner, cid, job["id"])
    assert saved["changes"]["created"] == 206
    page = queue(client, owner, cid)
    ids = [t["id"] for t in page["items"]]
    while page["next_after"]:
        page = queue(client, owner, cid, after=page["next_after"])
        ids += [t["id"] for t in page["items"]]
    assert len(ids) == len(set(ids)) == 206
    assert run(client, owner, cid, job["id"])["changes"]["created"] == 0


def test_blind_manual_titles_and_notes_do_not_reveal_candidate_identity(client: TestClient) -> None:
    owner, cid, _job, aid, _token = setup(client)
    async def blind(db: Any) -> str:
        (await db.get(BizCompany, cid)).blind_review = True
        return str((await db.get(BizApplication, aid)).name)
    name = db_call(client, blind)
    task, _body = manual(client, owner, cid, aid, title=f"Arrange a follow-up with {name}")
    assert name not in task["title"] and name not in queue(client, owner, cid)["items"][0]["title"]
    client.post(f"/v1/business/companies/{cid}/hiring-tasks/{task['id']}", headers=auth(owner), json={
        "base_revision": 1, "action": "done", "note": f"Spoke to {name} about their schedule"}).raise_for_status()
    detail = client.get(f"/v1/business/companies/{cid}/applications/{aid}", headers=auth(owner)).json()
    assert name not in str(detail["timeline"])
    audit_log = client.get(f"/v1/business/companies/{cid}/audit", headers=auth(owner)).json()
    assert name not in str(audit_log) and "Spoke to" not in str(audit_log)


def test_task_notes_respect_independent_feedback_and_notifications_open_queue(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    save_plan(client, owner, cid, job["id"])
    peer = register(client, f"private-notes-{tag()}@example.com")
    async def member(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        (await db.get(BizApplication, aid)).interviewers = [uid(peer), uid(owner)]
    db_call(client, member)
    task, _body = manual(client, owner, cid, aid)
    base = f"/v1/business/companies/{cid}"
    secret = "Private coordinator observation before independent review"
    client.post(f"{base}/hiring-tasks/{task['id']}", headers=auth(owner), json={"base_revision": 1,
        "action": "assign", "assignee_id": uid(owner), "note": secret}).raise_for_status()
    detail = client.get(f"{base}/applications/{aid}", headers=auth(peer)).json()
    assert secret not in str(detail["timeline"])
    own_detail = client.get(f"{base}/applications/{aid}", headers=auth(owner)).json()
    assert secret in str(own_detail["timeline"])
    alerts = client.get("/v1/business/notifications", headers=auth(owner)).json()
    task_alert = next(n for n in alerts if n["kind"] == "automation")
    assert task_alert["link"] == f"/business/app/{cid}/automations"
