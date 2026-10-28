"""Approved position accounting, access scopes, grounded AI and opt-in capacity alert episodes."""

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

from orbit_api.business.capacity import sweep
from orbit_api.models import (
    BizApplication,
    BizCapacityWatch,
    BizCompany,
    BizJob,
    BizMember,
    BizRequisition,
    ProviderRequest,
)
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, uid
from tests.test_business_requisitions import act, add_member, create, intake


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def path(cid: str) -> str:
    return f"/v1/business/companies/{cid}/capacity"


def snapshot(client: TestClient, who: dict[str, str], cid: str) -> dict[str, Any]:
    response = client.get(path(cid), headers=auth(who))
    assert response.status_code == 200, response.text
    return dict(response.json())


def seed(
    client: TestClient,
    cid: str,
    requester: str,
    *,
    state: str = "converted",
    positions: int = 2,
    currency: str = "INR",
    target_date: str = "2020-01-01",
    job_status: str = "open",
    **extra: Any,
) -> tuple[str, str]:
    async def go(db: Any) -> tuple[str, str]:
        job = BizJob(
            company_id=cid, title="Capacity role", slug=uuid.uuid4().hex, status=job_status, hiring_team=[requester]
        )
        db.add(job)
        await db.flush()
        req = BizRequisition(
            company_id=cid,
            requester_id=requester,
            state=state,
            content=intake(positions=positions, currency=currency, target_date=target_date, **extra),
            job_id=job.id if state == "converted" else None,
        )
        db.add(req)
        await db.flush()
        return req.id, job.id

    return db_call(client, go)  # type: ignore[no-any-return]


def applicant(
    client: TestClient, cid: str, jid: str, status: str = "hired", *, confirmed: bool = True, deleting: bool = False
) -> str:
    async def go(db: Any) -> str:
        token = uuid.uuid4().hex
        row = BizApplication(
            company_id=cid,
            job_id=jid,
            reference=token[:12],
            name="PRIVATE CANDIDATE NAME",
            email=token + "@example.com",
            stage_id="hired",
            status=status,
            status_token_hash=token,
            email_confirmed_at=datetime.now(UTC) if confirmed else None,
            deletion_requested_at=datetime.now(UTC) if deleting else None,
            resume_text="PRIVATE RESUME",
            ranking_status="done",
        )
        db.add(row)
        await db.flush()
        return str(row.id)

    return db_call(client, go)  # type: ignore[no-any-return]


def watch(
    client: TestClient,
    who: dict[str, str],
    cid: str,
    rid: str,
    revision: int = 0,
    *,
    enabled: bool = True,
    owner_id: str | None = None,
) -> Any:
    return client.put(
        path(cid) + f"/{rid}/watch",
        headers=auth(who),
        json={"base_revision": revision, "enabled": enabled, "owner_id": uid(who) if owner_id is None else owner_id},
    )


def run(client: TestClient, who: dict[str, str], cid: str) -> Any:
    return client.post(path(cid) + "/alerts/run", headers=auth(who))


def test_capacity_tracks_actual_current_hired_records_and_separate_currency_envelopes(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, jid = seed(client, cid, uid(owner), annual_budget_per_position=100)
    usd, _ = seed(
        client, cid, uid(owner), state="approved", currency="USD", positions=3, annual_budget_per_position=1000
    )
    hired = applicant(client, cid, jid)
    applicant(client, cid, jid, "active")
    applicant(client, cid, jid, confirmed=False)
    applicant(client, cid, jid, deleting=True)
    applicant(client, cid, jid, "withdrawn")
    data = snapshot(client, owner, cid)
    rows = {r["id"]: r for r in data["items"]}
    assert (rows[rid]["hired"], rows[rid]["remaining"], rows[rid]["active"]) == (1, 1, 1)
    assert rows[usd]["state"] == "awaiting_handoff" and rows[usd]["remaining"] == 3
    envelopes = {r["currency"]: r for r in data["envelopes"]}
    assert envelopes["INR"]["approved_annual_envelope"] == 200
    assert envelopes["INR"]["remaining_annual_envelope"] == 100
    assert envelopes["USD"]["approved_annual_envelope"] == 3000
    assert "PRIVATE" not in json.dumps(data) and hired not in json.dumps(data)

    async def reopen(db: Any) -> None:
        row = await db.get(BizApplication, hired)
        row.status = "active"

    db_call(client, reopen)
    after = snapshot(client, owner, cid)
    assert after["version"] != data["version"]
    assert next(r for r in after["items"] if r["id"] == rid)["remaining"] == 2


def test_closed_unfilled_overage_and_deleted_job_are_distinct(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    closed, _ = seed(client, cid, uid(owner), job_status="closed")
    over, jid = seed(client, cid, uid(owner), positions=1)
    applicant(client, cid, jid)
    applicant(client, cid, jid)
    missing, missing_job = seed(client, cid, uid(owner))

    async def remove(db: Any) -> None:
        await db.execute(delete(BizJob).where(BizJob.id == missing_job))

    db_call(client, remove)
    rows = {r["id"]: r for r in snapshot(client, owner, cid)["items"]}
    assert rows[closed]["state"] == "closed_unfilled"
    assert rows[over]["state"] == "overfilled" and rows[over]["overage"] == 1 and rows[over]["remaining"] == 0
    assert rows[missing]["state"] == "missing_job" and rows[missing]["remaining"] is None


def test_manager_request_scope_does_not_grant_linked_job_access(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    manager = add_member(client, cid, "hiring_manager")
    interviewer = add_member(client, cid, "interviewer")
    rid, jid = seed(client, cid, uid(manager))
    other, _ = seed(client, cid, uid(owner), title="PRIVATE OTHER REQUEST")
    applicant(client, cid, jid)
    data = snapshot(client, manager, cid)
    assert [r["id"] for r in data["items"]] == [rid]
    assert other not in json.dumps(data) and "PRIVATE OTHER" not in json.dumps(data)
    assert data["items"][0]["hired"] == 1

    async def remove_access(db: Any) -> None:
        job = await db.get(BizJob, jid)
        job.hiring_team = []

    db_call(client, remove_access)
    row = snapshot(client, manager, cid)["items"][0]
    assert row["state"] == "restricted_job" and row["hired"] is None and row["job_id"] is None
    assert row["remaining"] is None
    assert watch(client, manager, cid, rid).status_code == 403
    assert client.get(path(cid), headers=auth(interviewer)).status_code == 403
    outsider, other_company, _ = new_company(client)
    assert client.get(path(cid), headers=auth(outsider)).status_code == 404
    assert watch(client, outsider, other_company["id"], rid).status_code == 404


def test_shared_job_link_does_not_double_count_hires(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, jid = seed(client, cid, uid(owner))
    other, _ = seed(client, cid, uid(owner))
    applicant(client, cid, jid)

    async def link(db: Any) -> None:
        row = await db.get(BizRequisition, other)
        row.job_id = jid

    db_call(client, link)
    rows = {r["id"]: r for r in snapshot(client, owner, cid)["items"]}
    assert all(rows[r]["state"] == "shared_job" and rows[r]["hired"] is None for r in (rid, other))


def test_alerts_are_opt_in_concurrent_deduplicated_and_reset_after_healthy_run(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, jid = seed(client, cid, uid(owner), positions=1)
    assert run(client, owner, cid).json()["created"] == 0
    assert watch(client, owner, cid, rid).status_code == 200
    assert watch(client, owner, cid, rid).status_code == 409
    barrier = Barrier(2)

    def send() -> Any:
        barrier.wait(timeout=10)
        return run(client, owner, cid)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert sum(r.json()["created"] for r in results) == 1
    notes = client.get("/v1/business/notifications", headers=auth(owner)).json()
    assert any(n["kind"] == "capacity" and n["link"].endswith("/capacity") for n in notes)
    aid = applicant(client, cid, jid)
    assert run(client, owner, cid).json()["created"] == 0

    async def reopen(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        app.status = "active"

    db_call(client, reopen)
    assert run(client, owner, cid).json()["created"] == 1
    assert run(client, owner, cid).json()["created"] == 0


def test_removed_alert_owner_and_suspended_company_are_skipped(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    admin = add_member(client, cid, "admin")
    rid, _ = seed(client, cid, uid(owner))
    assert watch(client, owner, cid, rid, owner_id=uid(admin)).status_code == 200

    async def demote(db: Any) -> None:
        member = await db.scalar(select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(admin)))
        member.role = "interviewer"

    db_call(client, demote)
    assert run(client, owner, cid).json() == {"created": 0, "unavailable_owner": 1}
    assert watch(client, owner, cid, rid, revision=1, owner_id=uid(admin)).status_code == 422
    assert watch(client, owner, cid, rid, revision=1).status_code == 200
    assert client.portal.call(sweep) >= 1
    assert run(client, owner, cid).json()["created"] == 0

    async def suspend(db: Any) -> None:
        c = await db.get(BizCompany, cid)
        c.status = "suspended"

    db_call(client, suspend)
    assert run(client, owner, cid).status_code == 403
    assert client.portal.call(sweep) == 0


def test_reopening_approval_disables_its_watch(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    manager = add_member(client, cid, "hiring_manager")
    row = create(client, manager, cid)
    row = act(client, manager, cid, row, "submit", approver_ids=[uid(owner)]).json()
    row = act(client, owner, cid, row, "approve").json()
    assert watch(client, owner, cid, row["id"]).status_code == 200
    assert act(client, manager, cid, row, "reopen").status_code == 200

    async def load(db: Any) -> bool:
        return bool((await db.get(BizCapacityWatch, row["id"])).enabled)

    assert not db_call(client, load)
    assert snapshot(client, owner, cid)["items"] == []


def test_ai_is_quoted_read_only_and_rechecks_new_hires(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.db import sessionmaker

    owner, company, _ = new_company(client)
    cid = company["id"]
    _rid, jid = seed(client, cid, uid(owner))
    aid = applicant(client, cid, jid, "active")
    before = snapshot(client, owner, cid)
    response = client.post(
        path(cid) + "/brief", headers=auth(owner), json={"version": before["version"], "focus": "budget"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    facts = {f["id"]: f["text"] for f in data["facts"]}
    assert all(t["source_quote"] in facts[t["fact_id"]] for t in data["tips"])
    assert data["source"] == "mock" and snapshot(client, owner, cid)["version"] == before["version"]
    original = MockLLMProvider.generate

    async def mutate(self: Any, request: Any) -> Any:
        assert "PRIVATE CANDIDATE" not in request.messages[-1].content
        async with sessionmaker()() as db:
            app = await db.get(BizApplication, aid)
            app.status = "hired"
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", mutate)
    assert (
        client.post(path(cid) + "/brief", headers=auth(owner), json={"version": before["version"]}).status_code == 409
    )
    assert (
        client.post(path(cid) + "/brief", headers=auth(owner), json={"version": before["version"]}).status_code == 409
    )


def test_ai_company_quota_includes_failures(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    seed(client, cid, uid(owner))

    async def fill(db: Any) -> None:
        for _ in range(10):
            db.add(
                ProviderRequest(
                    user_id=uid(owner),
                    company_id=cid,
                    provider="mock",
                    model="mock",
                    request_type="business_capacity_brief",
                    ok=False,
                )
            )

    db_call(client, fill)
    data = snapshot(client, owner, cid)
    assert client.post(path(cid) + "/brief", headers=auth(owner), json={"version": data["version"]}).status_code == 429


def test_enabled_watches_are_prioritized_before_the_reporting_cap(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, _ = seed(client, cid, uid(owner), state="approved")
    assert watch(client, owner, cid, rid).status_code == 200

    async def many(db: Any) -> None:
        for i in range(205):
            db.add(
                BizRequisition(
                    company_id=cid,
                    requester_id=uid(owner),
                    state="approved",
                    content=intake(title=f"Request {i}"),
                    created_at=datetime.now(UTC) + timedelta(seconds=i),
                )
            )

    db_call(client, many)
    data = snapshot(client, owner, cid)
    assert data["truncated"] and len(data["items"]) == 200
    assert rid in [r["id"] for r in data["items"]] and len(data["facts"]) == 8


def test_ai_rejects_bad_quotes_and_revoked_access(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from dataclasses import replace

    from orbit_api.db import sessionmaker

    owner, company, _ = new_company(client)
    cid = company["id"]
    seed(client, cid, uid(owner))
    data = snapshot(client, owner, cid)
    original = MockLLMProvider.generate

    async def hallucinate(self: Any, request: Any) -> Any:
        result = await original(self, request)
        response = json.loads(result.text)
        for tip in response["tips"]:
            tip["source_quote"] = "An invented hiring policy that is absent from the saved facts."
        return replace(result, text=json.dumps(response))

    monkeypatch.setattr(MockLLMProvider, "generate", hallucinate)
    assert client.post(path(cid) + "/brief", headers=auth(owner), json={"version": data["version"]}).status_code == 502
    assert snapshot(client, owner, cid)["version"] == data["version"]

    async def revoke(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            member = await db.scalar(
                select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(owner))
            )
            member.role = "interviewer"
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", revoke)
    assert client.post(path(cid) + "/brief", headers=auth(owner), json={"version": data["version"]}).status_code == 403


def test_watch_activation_cap_and_strict_owner_contract(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, _ = seed(client, cid, uid(owner), state="approved")
    assert (
        client.put(
            path(cid) + f"/{rid}/watch",
            headers=auth(owner),
            json={"base_revision": 0, "enabled": True, "owner_id": None},
        ).status_code
        == 422
    )
    assert (
        client.put(
            path(cid) + f"/{rid}/watch",
            headers=auth(owner),
            json={"base_revision": False, "enabled": True, "owner_id": uid(owner)},
        ).status_code
        == 422
    )

    async def fill(db: Any) -> None:
        for _ in range(100):
            req = BizRequisition(company_id=cid, requester_id=uid(owner), state="approved", content=intake())
            db.add(req)
            await db.flush()
            db.add(BizCapacityWatch(requisition_id=req.id, company_id=cid, enabled=True, owner_id=uid(owner)))

    db_call(client, fill)
    assert watch(client, owner, cid, rid).status_code == 409


def test_reenable_starts_a_fresh_watch_episode(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    rid, _ = seed(client, cid, uid(owner), state="approved")
    assert watch(client, owner, cid, rid).status_code == 200
    assert run(client, owner, cid).json()["created"] == 1
    assert watch(client, owner, cid, rid, revision=1, enabled=False).status_code == 200
    assert run(client, owner, cid).json()["created"] == 0
    assert watch(client, owner, cid, rid, revision=2).status_code == 200
    assert run(client, owner, cid).json()["created"] == 1
    assert run(client, owner, cid).json()["created"] == 0
