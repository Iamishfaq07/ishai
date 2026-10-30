"""Workflow graph invariants, bounded human execution and grounded AI review."""

import json
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from orbit_api.models import BizJob, BizWorkflowPlan, BizWorkflowRun, ProviderRequest, User
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, new_job, uid
from tests.test_business_requisitions import add_member


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def root(cid: str, jid: str = "") -> str:
    return f"/v1/business/companies/{cid}/workflow-studio" + (f"/{jid}" if jid else "")


def setup(client: TestClient) -> Any:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    return owner, cid, job["id"]


def workspace(client: TestClient, owner: Any, cid: str, jid: str) -> Any:
    response = client.get(root(cid, jid), headers=auth(owner))
    assert response.status_code == 200, response.text
    return response.json()


def save(client: TestClient, owner: Any, cid: str, jid: str, plan: Any = None) -> Any:
    current = workspace(client, owner, cid, jid)
    if plan is None:
        plan = client.get(root(cid), headers=auth(owner)).json()["templates"][0]["plan"]
    response = client.put(
        root(cid, jid) + "/plan",
        headers=auth(owner),
        json={"base_revision": current["revision"], "source_version": current["version"], "plan": plan},
    )
    assert response.status_code == 200, response.text
    return response.json()


def start(client: TestClient, owner: Any, cid: str, jid: str, **over: Any) -> Any:
    current = workspace(client, owner, cid, jid)
    return client.post(
        root(cid, jid) + "/runs",
        headers=auth(owner),
        json={
            "request_id": str(uuid.uuid4()),
            "base_revision": current["revision"],
            "start_date": datetime.now(UTC).date().isoformat(),
            **over,
        },
    )


def act(
    client: TestClient, owner: Any, cid: str, jid: str, run: Any, sid: str, action: str = "done", **over: Any
) -> Any:
    return client.post(
        root(cid, jid) + f"/runs/{run['id']}/steps/{sid}",
        headers=auth(owner),
        json={
            "base_revision": run["revision"],
            "action": action,
            "note": "Reviewed the preparation step with the team.",
            **over,
        },
    )


def test_template_draft_save_run_snapshot_and_actual_job_unchanged(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    initial = workspace(client, owner, cid, jid)
    assert initial["revision"] == 0 and initial["plan"] is None
    assert start(client, owner, cid, jid).status_code == 422
    saved = save(client, owner, cid, jid)
    result = start(client, owner, cid, jid, default_owner_id=uid(owner))
    assert result.status_code == 201, result.text
    run = result.json()
    assert run["counts"] == {"total": 4, "done": 0, "ready": 1, "blocked": 3, "overdue": 0, "unassigned": 0}
    assert all(s["owner_current"] and s["path"].startswith(f"/business/app/{cid}/") for s in run["steps"])
    changed = saved["plan"]
    changed["title"] = "Changed draft for the next run"
    save(client, owner, cid, jid, changed)
    original = client.get(root(cid, jid) + f"/runs/{run['id']}", headers=auth(owner)).json()
    assert original["title"] != changed["title"] and original["plan_revision"] == 1

    async def check(db: Any) -> None:
        assert (await db.get(BizJob, jid)).status == "open"

    db_call(client, check)


def test_dependency_completion_reopen_and_stale_revision(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    run = start(client, owner, cid, jid).json()
    assert act(client, owner, cid, jid, run, "criteria").status_code == 409
    assert act(client, owner, cid, jid, run, "missing").status_code == 404
    done = act(client, owner, cid, jid, run, "scope")
    assert done.status_code == 200, done.text
    assert act(client, owner, cid, jid, run, "scope").status_code == 409
    run = done.json()
    assert run["counts"]["ready"] == 2
    assert act(client, owner, cid, jid, run, "scope").status_code == 409
    run = act(client, owner, cid, jid, run, "criteria").json()
    assert act(client, owner, cid, jid, run, "scope", "reopen").status_code == 409
    run = act(client, owner, cid, jid, run, "panel").json()
    run = act(client, owner, cid, jid, run, "review").json()
    assert run["status"] == "completed" and run["counts"]["done"] == 4
    run = act(client, owner, cid, jid, run, "review", "reopen").json()
    assert run["status"] == "active" and run["counts"]["done"] == 3


@pytest.mark.parametrize("defect", ["cycle", "duplicate", "early", "unknown", "bool", "extra"])
def test_graph_rejects_invalid_dependencies_and_contract(client: TestClient, defect: str) -> None:
    owner, cid, jid = setup(client)
    plan = client.get(root(cid), headers=auth(owner)).json()["templates"][0]["plan"]
    if defect == "cycle":
        plan["steps"][0]["depends_on"] = ["review"]
    elif defect == "duplicate":
        plan["steps"][1]["id"] = "scope"
    elif defect == "early":
        plan["steps"][3]["days"] = 0
    elif defect == "unknown":
        plan["steps"][1]["depends_on"] = ["unknown"]
    elif defect == "bool":
        plan["steps"][1]["days"] = True
    else:
        plan["steps"][1]["webhook"] = "https://example.com"
    current = workspace(client, owner, cid, jid)
    result = client.put(
        root(cid, jid) + "/plan",
        headers=auth(owner),
        json={"base_revision": 0, "source_version": current["version"], "plan": plan},
    )
    assert result.status_code == 422
    assert workspace(client, owner, cid, jid)["plan"] is None


def test_start_retry_is_idempotent_and_conflicting_owner_rejected(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    request_id = str(uuid.uuid4())
    first = start(client, owner, cid, jid, request_id=request_id)
    second = start(client, owner, cid, jid, request_id=request_id)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert start(client, owner, cid, jid, request_id=request_id, default_owner_id=uid(owner)).status_code == 409
    assert len(workspace(client, owner, cid, jid)["runs"]) == 1


def test_role_and_job_scope_and_removed_owner(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    manager = add_member(client, cid, "hiring_manager")
    interviewer = add_member(client, cid, "interviewer")
    assert client.get(root(cid, jid), headers=auth(manager)).status_code == 404
    assert client.get(root(cid), headers=auth(manager)).json()["jobs"] == []
    assert client.get(root(cid), headers=auth(interviewer)).status_code == 403

    async def assign(db: Any) -> None:
        job = await db.get(BizJob, jid)
        job.hiring_team = [uid(manager)]

    db_call(client, assign)
    assert workspace(client, manager, cid, jid)["job"]["id"] == jid
    save(client, manager, cid, jid)
    assert start(client, owner, cid, jid, default_owner_id=uid(interviewer)).status_code == 422
    run = start(client, manager, cid, jid, default_owner_id=uid(manager)).json()

    async def remove(db: Any) -> None:
        user = await db.get(User, uid(manager))
        user.suspended_at = datetime.now(UTC)

    db_call(client, remove)
    current = client.get(root(cid, jid) + f"/runs/{run['id']}", headers=auth(owner)).json()
    assert current["counts"]["unassigned"] == 4
    assert act(client, owner, cid, jid, current, "scope", "assign", owner_id=uid(manager)).status_code == 422
    other, ocid, ojid = setup(client)
    assert client.get(root(cid, jid), headers=auth(other)).status_code == 404
    assert client.get(root(ocid, ojid) + f"/runs/{run['id']}", headers=auth(other)).status_code == 404


def test_cancel_freezes_and_deletion_requires_manage_permission(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    recruiter = add_member(client, cid, "recruiter")
    save(client, owner, cid, jid)
    run = start(client, owner, cid, jid).json()
    path = root(cid, jid) + f"/runs/{run['id']}"
    assert client.delete(path, headers=auth(owner)).status_code == 409
    response = client.post(path + "/cancel", headers=auth(recruiter), json={"base_revision": run["revision"]})
    assert response.status_code == 200
    assert act(client, owner, cid, jid, response.json(), "scope").status_code == 409
    assert client.delete(path, headers=auth(recruiter)).status_code == 403
    assert client.delete(path, headers=auth(owner)).status_code == 204
    assert client.get(path, headers=auth(owner)).status_code == 404


def test_grounded_ai_draft_is_not_saved_and_brief_excludes_notes_and_owners(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, cid, jid = setup(client)
    current = workspace(client, owner, cid, jid)
    original = MockLLMProvider.generate
    calls = []

    async def inspect(self: Any, request: Any) -> Any:
        calls.append(request)
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", inspect)
    result = client.post(root(cid, jid) + "/draft", headers=auth(owner), json={"version": current["version"]})
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "mock" and len(result.json()["sources"]) == 3
    assert workspace(client, owner, cid, jid)["plan"] is None
    save(client, owner, cid, jid, result.json()["plan"])
    run = start(client, owner, cid, jid).json()
    run = act(client, owner, cid, jid, run, "brief", note="PRIVATE NOTE NEVER SEND").json()
    brief = client.post(
        root(cid, jid) + f"/runs/{run['id']}/brief", headers=auth(owner), json={"version": run["version"]}
    )
    assert brief.status_code == 200, brief.text
    body = calls[-1].messages[-1].content
    assert "PRIVATE" not in body and uid(owner) not in body and "owner_id" not in body
    assert brief.json()["tips"]


@pytest.mark.parametrize("failure", ["quote", "cycle", "stale"])
def test_ai_rejects_ungrounded_invalid_or_stale_draft(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    owner, cid, jid = setup(client)
    current = workspace(client, owner, cid, jid)
    original = MockLLMProvider.generate

    async def broken(self: Any, request: Any) -> Any:
        response = await original(self, request)
        raw = json.loads(response.text)
        if failure == "quote":
            raw["sources"][0]["quote"] = "Invented source statement"
        elif failure == "cycle":
            raw["plan"]["steps"][0]["depends_on"] = ["review"]
        else:

            async def change(db: Any) -> None:
                (await db.get(BizJob, jid)).must_haves = ["New requirement after preview"]

            from orbit_api.db import sessionmaker

            async with sessionmaker()() as db:
                await change(db)
                await db.commit()
        response.text = json.dumps(raw)
        return response

    monkeypatch.setattr(MockLLMProvider, "generate", broken)
    result = client.post(root(cid, jid) + "/draft", headers=auth(owner), json={"version": current["version"]})
    assert result.status_code == (409 if failure == "stale" else 502), result.text
    assert workspace(client, owner, cid, jid)["plan"] is None

    async def check(db: Any) -> None:
        records = list(await db.scalars(select(ProviderRequest).where(ProviderRequest.company_id == cid)))
        assert len(records) == 1

    db_call(client, check)


def test_simultaneous_start_creates_one_run(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    request_id = str(uuid.uuid4())
    barrier = Barrier(2)

    def submit() -> Any:
        barrier.wait(timeout=10)
        return start(client, owner, cid, jid, request_id=request_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit) for _ in range(2)]
        result = [f.result(timeout=30) for f in futures]
    assert [r.status_code for r in result] == [201, 201]
    assert len(workspace(client, owner, cid, jid)["runs"]) == 1


def test_overdue_counts_and_job_deletion_cascades(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    run = start(client, owner, cid, jid, start_date=(datetime.now(UTC) - timedelta(days=10)).date().isoformat()).json()
    assert run["counts"]["overdue"] == 4

    async def remove(db: Any) -> None:
        await db.execute(delete(BizJob).where(BizJob.id == jid))

    db_call(client, remove)

    async def check(db: Any) -> None:
        assert await db.get(BizWorkflowPlan, jid) is None
        assert await db.get(BizWorkflowRun, run["id"]) is None

    db_call(client, check)


@pytest.mark.parametrize("kind", ["business_workflow_draft", "business_workflow_brief"])
def test_ai_allowances_count_failures_per_company(client: TestClient, kind: str) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    run = start(client, owner, cid, jid).json()

    async def fill(db: Any) -> None:
        for _ in range(10):
            db.add(
                ProviderRequest(
                    user_id=uid(owner), company_id=cid, provider="mock", model="mock", request_type=kind, ok=False
                )
            )

    db_call(client, fill)
    current = workspace(client, owner, cid, jid)
    path = root(cid, jid) + ("/draft" if kind.endswith("draft") else f"/runs/{run['id']}/brief")
    result = client.post(
        path, headers=auth(owner), json={"version": current["version"] if kind.endswith("draft") else run["version"]}
    )
    assert result.status_code == 429


def test_plan_revision_conflict_and_invalid_owner_and_caps(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    saved = save(client, owner, cid, jid)
    assert (
        client.put(
            root(cid, jid) + "/plan",
            headers=auth(owner),
            json={"base_revision": 0, "source_version": saved["version"], "plan": saved["plan"]},
        ).status_code
        == 409
    )

    async def seed(db: Any) -> None:
        for i in range(20):
            db.add(
                BizWorkflowRun(
                    id=str(uuid.uuid4()),
                    company_id=cid,
                    job_id=jid,
                    request_sha256="a" * 64,
                    plan_revision=1,
                    start_date="2026-10-30",
                    content=saved["plan"],
                    tasks={},
                    status="active",
                )
            )

    db_call(client, seed)
    assert start(client, owner, cid, jid).status_code == 409


def test_extreme_date_is_validation_error_not_server_error(client: TestClient) -> None:
    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    assert start(client, owner, cid, jid, start_date="9999-12-31").status_code == 422


@pytest.mark.parametrize("change", ["access", "run"])
def test_ai_brief_rechecks_access_and_run_state_after_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import BizMember

    owner, cid, jid = setup(client)
    save(client, owner, cid, jid)
    run = start(client, owner, cid, jid).json()
    original = MockLLMProvider.generate

    async def mutate(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            if change == "access":
                member = await db.scalar(
                    select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(owner))
                )
                member.role = "interviewer"
            else:
                row = await db.get(BizWorkflowRun, run["id"])
                row.revision += 1
                row.status = "cancelled"
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", mutate)
    result = client.post(
        root(cid, jid) + f"/runs/{run['id']}/brief", headers=auth(owner), json={"version": run["version"]}
    )
    assert result.status_code == (403 if change == "access" else 409), result.text
