"""Joining plans, role/tenant boundaries, original offer versions and real concurrent writes."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.models import BizApplication, BizCompany, BizEvent, BizMember
from tests.business_helpers import auth, db_call, make_client, new_company, outbox, register, uid
from tests.test_business_hiring_studio import setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def key() -> str:
    return str(uuid.uuid4())


def plan() -> dict[str, Any]:
    return {
        "introduction": "Review your joining arrangements with the team and report any blockers here.",
        "start_date": "2026-11-02",
        "request_id": key(),
        "tasks": [
            {
                "title": "Prepare equipment",
                "instructions": "Arrange equipment and first-day access without sharing secrets.",
                "owner": "team",
                "due_date": "2026-10-30",
            },
            {
                "title": "Confirm joining arrangements",
                "instructions": "Review the agreed first-day instructions and ask about anything unclear.",
                "owner": "candidate",
                "due_date": None,
            },
        ],
    }


def hire(client: TestClient) -> tuple[dict[str, str], str, str, str, str]:
    owner, cid, _job, aid, token = setup(client)
    r = client.post(
        f"/v1/business/companies/{cid}/applications/move", headers=auth(owner), json={"ids": [aid], "stage_id": "hired"}
    )
    assert r.status_code == 200, r.text
    return owner, cid, aid, token, f"/v1/business/companies/{cid}/applications/{aid}/handoff"


def progress(**overrides: Any) -> dict[str, Any]:
    return {"status": "done", "note": "", "base_revision": 0, "request_id": key(), **overrides}


def test_joining_plan_requires_offer_or_hire_and_each_owner_reports_their_own_progress(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    public = f"/v1/public/business/applications/{token}"
    assert client.post(base + "/handoff", headers=auth(owner), json=plan()).status_code == 409
    offer = {
        "role": "Engineer",
        "compensation": "INR 2,400,000/year",
        "start_date": "November 2",
        "terms": "The team will arrange the formal agreement and joining details separately.",
        "base_offer_id": None,
        "request_id": key(),
    }
    oid = client.post(base + "/offer", headers=auth(owner), json=offer).json()["offer"]["id"]
    assert (
        client.post(
            public + "/offer/respond",
            json={"offer_id": oid, "response": "accepted", "acknowledge": True, "request_id": key()},
        ).status_code
        == 200
    )
    body = plan()
    published = client.post(base + "/handoff", headers=auth(owner), json=body)
    assert published.status_code == 200, published.text
    shared = published.json()
    assert shared["accepting"] and shared["plan"]["revision"] == 1
    def mail_count() -> int:
        return sum(f"/application/{token}" in m.text and "joining plan" in m.subject for m in outbox().sent)
    before = mail_count()
    assert client.post(base + "/handoff", headers=auth(owner), json=body).json() == shared
    assert mail_count() == before == 1
    assert (
        client.post(base + "/handoff", headers=auth(owner), json={**body, "start_date": "2026-11-03"}).status_code
        == 409
    )
    tasks = shared["plan"]["tasks"]
    team_task, candidate_task = (t["id"] for t in tasks)
    p = f"{public}/handoff/tasks/{candidate_task}/progress"
    assert client.post(f"{public}/handoff/tasks/{team_task}/progress", json=progress()).status_code == 403
    assert (
        client.post(f"{base}/handoff/tasks/{candidate_task}/progress", headers=auth(owner), json=progress()).status_code
        == 403
    )
    assert client.post(p, json=progress(status="blocked")).status_code == 422
    blocked = progress(status="blocked", note="Please clarify where to meet on the first day.")
    saved = client.post(p, json=blocked)
    assert saved.status_code == 200, saved.text
    assert client.post(p, json=blocked).json() == saved.json()
    assert (
        client.post(p, json={**blocked, "note": "Different content must not overwrite the original note."}).status_code
        == 409
    )
    assert client.post(p, json=progress()).status_code == 409
    complete = client.post(p, json=progress(base_revision=1, note="The team clarified our arrangements."))
    task = complete.json()["plan"]["tasks"][1]
    assert complete.status_code == 200 and task["status"] == "done" and task["revision"] == 2
    assert [e["status"] for e in task["history"]] == ["done", "blocked"]
    assert task["history"][1]["note"] == blocked["note"] and task["history"][0]["by"] == "candidate"

    async def status(db: Any) -> str:
        return str((await db.get(BizApplication, aid)).status)

    assert db_call(client, status) == "active"
    activity = client.get(public + "/conversation").json()["activity"]
    assert any(e["label"] == "Joining plan available" for e in activity)
    assert "note" not in str(activity) and "actor_id" not in str(complete.json())


def test_joining_continues_after_hire_and_questions_remain_available(client: TestClient) -> None:
    owner, cid, aid, token, path = hire(client)
    assert client.post(path, headers=auth(owner), json=plan()).status_code == 200
    public = f"/v1/public/business/applications/{token}"
    assert client.get(public + "/conversation").json()["accepting"]
    question = client.post(
        public + "/clarification",
        json={"message": "Who should I contact when I arrive on my first day?", "request_id": key()},
    )
    assert question.status_code == 201, question.text
    task = client.get(path, headers=auth(owner)).json()["plan"]["tasks"][0]
    update = f"{path}/tasks/{task['id']}/progress"
    assert client.post(update, headers=auth(owner), json=progress()).status_code == 200
    # A subsequent human rejection serializes with joining writes and freezes progress without hiding old records.
    assert (
        client.post(
            f"/v1/business/companies/{cid}/applications/reject", headers=auth(owner), json={"ids": [aid]}
        ).status_code
        == 200
    )
    assert not client.get(path, headers=auth(owner)).json()["accepting"]
    assert client.post(update, headers=auth(owner), json=progress(base_revision=1)).status_code == 409
    assert (
        client.post(
            public + "/clarification", json={"message": "Can I still send a new question?", "request_id": key()}
        ).status_code
        == 409
    )
    assert client.get(public + "/handoff").json()["plan"]["tasks"][0]["status"] == "done"


def test_joining_additions_tenant_roles_blind_text_and_deletion(client: TestClient) -> None:
    owner, cid, aid, token, path = hire(client)
    body = plan()
    async def identity(db: Any) -> tuple[str, str]:
        app = await db.get(BizApplication, aid)
        return app.name, app.email
    name, email = db_call(client, identity)
    body["introduction"] += f" {name} {email} should review this."
    assert client.post(path, headers=auth(owner), json=body).status_code == 200
    other, _, _ = new_company(client)
    peer = register(client, f"interviewer-{key()}@example.com")

    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(peer)]
        company = await db.get(BizCompany, cid)
        company.blind_review = True

    db_call(client, assign)
    hidden = client.get(path, headers=auth(owner)).json()["plan"]["introduction"]
    assert name not in hidden and email not in hidden
    visible = client.get(f"/v1/public/business/applications/{token}/handoff").json()["plan"]["introduction"]
    assert name in visible and email in visible
    assert client.get(path, headers=auth(other)).status_code == 404
    assert client.get(path, headers=auth(peer)).status_code == 403
    assert client.post(path + "/tasks/foreign/progress", headers=auth(owner), json=progress()).status_code == 404
    extra = {**body["tasks"][0], "base_revision": 1, "request_id": key()}
    added = client.post(path + "/tasks", headers=auth(owner), json=extra)
    assert added.status_code == 200 and added.json()["plan"]["revision"] == 2, added.text
    assert client.post(path + "/tasks", headers=auth(owner), json=extra).json() == added.json()
    assert client.post(path + "/tasks", headers=auth(owner), json={**extra, "request_id": key()}).status_code == 409

    async def deleting(db: Any) -> None:
        from datetime import UTC, datetime

        app = await db.get(BizApplication, aid)
        app.deletion_requested_at = datetime.now(UTC)

    db_call(client, deleting)
    assert client.post(path + "/tasks", headers=auth(owner), json={**extra, "base_revision": 2}).status_code == 409

    async def purge(db: Any) -> None:
        from orbit_api.business.access import delete_application_rows

        await delete_application_rows(db, aid)

    db_call(client, purge)
    assert client.get(f"/v1/public/business/applications/{token}/handoff").status_code == 404

    async def remaining(db: Any) -> list[BizEvent]:
        return list(await db.scalars(select(BizEvent).where(BizEvent.application_id == aid)))

    assert db_call(client, remaining) == []


def test_joining_races_preserve_one_progress_record_and_one_append(client: TestClient) -> None:
    owner, _cid, _aid, _token, path = hire(client)
    shared = client.post(path, headers=auth(owner), json=plan()).json()["plan"]
    barrier = Barrier(2)

    def save(note: str) -> int:
        barrier.wait()
        return client.post(
            f"{path}/tasks/{shared['tasks'][0]['id']}/progress", headers=auth(owner), json=progress(note=note)
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ("First update", "Second update"))) == [200, 409]
    assert len(client.get(path, headers=auth(owner)).json()["plan"]["tasks"][0]["history"]) == 1
    barrier = Barrier(2)

    def append(title: str) -> int:
        barrier.wait()
        return client.post(
            path + "/tasks",
            headers=auth(owner),
            json={**plan()["tasks"][0], "title": title, "base_revision": 1, "request_id": key()},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(append, ("Confirm first-day contact", "Confirm office arrangements"))) == [200, 409]
    assert len(client.get(path, headers=auth(owner)).json()["plan"]["tasks"]) == 3


def test_offer_history_retains_original_terms_and_paginates_without_staff_identity(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    path = f"/v1/business/companies/{cid}/applications/{aid}/offer"
    public = f"/v1/public/business/applications/{token}/offer"
    base_id = None
    for i in range(22):
        result = client.post(
            path,
            headers=auth(owner),
            json={
                "role": f"Engineer version {i + 1}",
                "compensation": f"INR {2_000_000 + i * 10000}/year",
                "start_date": "November 2",
                "terms": f"Original terms for version {i + 1}; formal agreement will be arranged with the team.",
                "base_offer_id": base_id,
                "request_id": key(),
            },
        )
        assert result.status_code == 200, result.text
        base_id = result.json()["offer"]["id"]
    accepted = client.post(
        public + "/respond",
        json={"offer_id": base_id, "response": "accepted", "acknowledge": True, "request_id": key()},
    )
    assert accepted.status_code == 200
    first = client.get(public + "/history").json()
    assert len(first["versions"]) == 20 and first["versions"][0]["status"] == "accepted"
    assert first["versions"][1]["status"] == "superseded" and first["next_before_revision"] == 3
    second = client.get(public + "/history?before_revision=3").json()
    assert [v["revision"] for v in second["versions"]] == [2, 1] and second["next_before_revision"] is None
    assert second["versions"][-1]["compensation"] == "INR 2000000/year"
    assert "Original terms for version 1;" in second["versions"][-1]["terms"]
    assert "actor_id" not in str(first) and "request_id" not in str(first)
    assert client.get(path + "/history", headers=auth(owner)).json() == first
    outsider, _, _ = new_company(client)
    assert client.get(path + "/history", headers=auth(outsider)).status_code == 404


@pytest.mark.parametrize("pause", ["suspended", "unconfirmed", "deletion"])
def test_joining_updates_stop_when_application_or_company_cannot_accept_them(client: TestClient, pause: str) -> None:
    from datetime import UTC, datetime

    owner, cid, aid, token, path = hire(client)
    shared = client.post(path, headers=auth(owner), json=plan()).json()["plan"]
    async def stop(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        if pause == "suspended":
            (await db.get(BizCompany, cid)).status = "suspended"
        elif pause == "unconfirmed":
            app.email_confirmed_at = None
        else:
            app.deletion_requested_at = datetime.now(UTC)
    db_call(client, stop)
    public = f"/v1/public/business/applications/{token}/handoff"
    assert not client.get(public).json()["accepting"]
    result = client.post(f"{public}/tasks/{shared['tasks'][1]['id']}/progress", json=progress())
    assert result.status_code == 409, result.text


def test_joining_desk_pages_hired_plans_and_scopes_hiring_managers(client: TestClient) -> None:
    from datetime import UTC, datetime

    from orbit_api.models import BizJob

    owner, cid, aid, _token, _path = hire(client)
    manager = register(client, f"manager-{key()}@example.com")
    ids: list[str] = []
    cursor_ids: list[str] = []
    async def seed(db: Any) -> None:
        original = await db.get(BizApplication, aid)
        db.add(BizMember(company_id=cid, user_id=uid(manager), role="hiring_manager"))
        when = datetime.now(UTC)
        for i in range(21):
            app = BizApplication(id=key(), reference="A-" + uuid.uuid4().hex[:8], company_id=cid,
                job_id=original.job_id, name=f"Joining Candidate {i}", email=f"joining-{key()}@example.com",
                stage_id="hired", status="hired", status_token_hash=uuid.uuid4().hex + uuid.uuid4().hex,
                email_confirmed_at=when)
            db.add(app)
            await db.flush()
            ids.append(app.id)
            event = BizEvent(id=key(), company_id=cid, job_id=app.job_id, application_id=app.id,
                kind="handoff_published", created_at=when, data={"introduction": "Welcome to the team.",
                    "start_date": "2026-11-02", "tasks": [{"id": key(), **plan()["tasks"][0]}]})
            db.add(event)
            cursor_ids.append(event.id)
    db_call(client, seed)
    path = f"/v1/business/companies/{cid}/joining-desk"
    first = client.get(path, headers=auth(owner)).json()
    assert len(first["items"]) == 20 and first["next_before"]
    last = client.get(path + "?before=" + first["next_before"], headers=auth(owner)).json()
    assert len(last["items"]) == 1 and last["next_before"] is None
    assert {r["application_id"] for r in first["items"] + last["items"]} == set(ids)
    assert client.get(path, headers=auth(manager)).json()["items"] == []
    assert client.get(path + "?before=" + cursor_ids[0], headers=auth(manager)).status_code == 404
    async def scope(db: Any) -> None:
        job = await db.get(BizJob, (await db.get(BizApplication, aid)).job_id)
        job.hiring_team = [uid(manager)]
    db_call(client, scope)
    assert len(client.get(path, headers=auth(manager)).json()["items"]) == 20
    outsider, _, _ = new_company(client)
    assert client.get(path, headers=auth(outsider)).status_code == 404
