"""Business headcount approvals, isolation, idempotent handoff and grounded AI previews."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.models import BizCompany, BizJob, BizMember, BizRequisition, ProviderRequest
from tests.business_helpers import auth, db_call, make_client, new_company, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def path(cid: str) -> str:
    return f"/v1/business/companies/{cid}/requisitions"


def add_member(client: TestClient, cid: str, role: str) -> dict[str, str]:
    h = register(client, f"req-{tag()}@example.com", f"Request {role}")

    async def seed(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(h), role=role))

    db_call(client, seed)
    return h


def intake(**extra: Any) -> dict[str, Any]:
    return {
        "title": "Customer success lead",
        "department": "Success",
        "positions": 2,
        "annual_budget_per_position": 1500000,
        "currency": "INR",
        "reason": "growth",
        "target_date": "2027-01-01",
        "location": "Bengaluru",
        "workplace": "hybrid",
        "business_case": "Private plan: improve coverage for customer onboarding.",
        "outcomes": "Reduce onboarding handoff delays using an agreed service target.",
        "requirements": ["Customer onboarding", "Process improvement"],
        **extra,
    }


def create(client: TestClient, h: dict[str, str], cid: str, **extra: Any) -> dict[str, Any]:
    response = client.post(path(cid), headers=auth(h), json={"request_id": str(uuid.uuid4()), "data": intake(**extra)})
    assert response.status_code == 200, response.text
    return dict(response.json())


def act(client: TestClient, h: dict[str, str], cid: str, row: dict[str, Any], action: str, **extra: Any) -> Any:
    return client.post(
        f"{path(cid)}/{row['id']}/actions",
        headers=auth(h),
        json={
            "base_revision": row["revision"],
            "action": action,
            "note": "Reviewed the saved request in this step.",
            **extra,
        },
    )


def test_sequential_approvals_and_private_atomic_job_handoff(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    manager = add_member(client, cid, "hiring_manager")
    admin = add_member(client, cid, "admin")
    row = create(client, manager, cid)
    assert act(client, owner, cid, row, "create_job").status_code == 409
    pending = act(client, manager, cid, row, "submit", approver_ids=[uid(owner), uid(admin)])
    assert pending.status_code == 200, pending.text
    row = pending.json()
    assert row["state"] == "pending" and row["next_approver_id"] == uid(owner)
    assert act(client, admin, cid, row, "approve").status_code == 403
    updated = client.put(
        f"{path(cid)}/{row['id']}",
        headers=auth(manager),
        json={"base_revision": row["revision"], "data": intake(title="Changed")},
    )
    assert updated.status_code == 409
    row = act(client, owner, cid, row, "approve").json()
    assert row["state"] == "pending" and row["next_approver_id"] == uid(admin)
    row = act(client, admin, cid, row, "approve").json()
    assert row["state"] == "approved" and len(row["approved_by"]) == 2
    old = dict(row)
    converted = act(client, owner, cid, row, "create_job")
    assert converted.status_code == 200, converted.text
    row = converted.json()
    assert row["state"] == "converted" and row["job_id"]
    assert act(client, owner, cid, old, "create_job").json()["job_id"] == row["job_id"]
    job = client.get(f"/v1/business/companies/{cid}/jobs/{row['job_id']}", headers=auth(owner)).json()
    assert job["status"] == "draft" and job["salary_max"] is None and job["salary_min"] is None
    assert "Private plan" not in job["description_html"]
    assert "Reduce onboarding" in job["description_html"]
    assert uid(manager) in job["hiring_team"]
    assert any(e["snapshot"] and e["snapshot"]["content"] == intake() for e in row["history"])
    assert client.get(f"/v1/business/companies/{cid}/jobs/{row['job_id']}", headers=auth(manager)).status_code == 200


def test_no_self_approval_duplicate_chain_or_insufficient_brief(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = create(client, owner, cid)
    assert act(client, owner, cid, row, "submit", approver_ids=[uid(owner)]).status_code == 422
    reviewer = add_member(client, cid, "admin")
    assert act(client, owner, cid, row, "submit", approver_ids=[uid(reviewer), uid(reviewer)]).status_code == 422
    row = create(client, owner, cid, outcomes="", annual_budget_per_position=None)
    assert act(client, owner, cid, row, "submit", approver_ids=[uid(reviewer)]).status_code == 422


def test_reopening_resets_approvals_preserves_snapshot_and_rejects_stale_writes(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    admin = add_member(client, cid, "admin")
    row = create(client, owner, cid)
    row = act(client, owner, cid, row, "submit", approver_ids=[uid(admin)]).json()
    row = act(client, admin, cid, row, "request_changes").json()
    assert row["state"] == "draft" and row["approver_ids"] == []
    saved = client.put(
        f"{path(cid)}/{row['id']}",
        headers=auth(owner),
        json={"base_revision": row["revision"], "data": intake(positions=3)},
    )
    assert saved.status_code == 200
    assert (
        client.put(
            f"{path(cid)}/{row['id']}",
            headers=auth(owner),
            json={"base_revision": row["revision"], "data": intake(positions=4)},
        ).status_code
        == 409
    )
    row = act(client, owner, cid, saved.json(), "submit", approver_ids=[uid(admin)]).json()
    row = act(client, admin, cid, row, "approve").json()
    row = act(client, owner, cid, row, "reopen").json()
    assert row["state"] == "draft" and row["approved_by"] == []
    assert len([e for e in row["history"] if e["snapshot"]]) == 2
    assert act(client, owner, cid, row, "create_job").status_code == 409


def test_tenant_role_scope_suspension_and_removed_approvers(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    other_owner, other, _ = new_company(client)
    cid = company["id"]
    manager = add_member(client, cid, "hiring_manager")
    interviewer = add_member(client, cid, "interviewer")
    row = create(client, owner, cid)
    assert client.get(f"{path(other['id'])}/{row['id']}", headers=auth(other_owner)).status_code == 404
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(manager)).status_code == 404
    assert client.get(path(cid), headers=auth(manager)).json()["items"] == []
    assert client.get(path(cid), headers=auth(interviewer)).status_code == 403
    assert (
        client.post(
            path(cid), headers=auth(interviewer), json={"request_id": str(uuid.uuid4()), "data": intake()}
        ).status_code
        == 403
    )
    admin = add_member(client, cid, "admin")
    row = act(client, owner, cid, row, "submit", approver_ids=[uid(admin)]).json()
    row = act(client, admin, cid, row, "approve").json()

    async def demote(db: Any) -> None:
        member = await db.scalar(select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(admin)))
        member.role = "recruiter"

    db_call(client, demote)
    assert act(client, owner, cid, row, "create_job").status_code == 409

    async def suspend(db: Any) -> None:
        company = await db.get(BizCompany, cid)
        company.status = "suspended"

    db_call(client, suspend)
    assert act(client, owner, cid, row, "reopen").status_code == 403


def test_idempotent_creation_validation_and_paged_literal_search(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    body = {"request_id": str(uuid.uuid4()), "data": intake(title="100% Service_Ops")}
    first = client.post(path(cid), headers=auth(owner), json=body)
    again = client.post(path(cid), headers=auth(owner), json=body)
    assert first.status_code == again.status_code == 200 and first.json()["id"] == again.json()["id"]
    assert client.post(path(cid), headers=auth(owner), json={**body, "data": intake()}).status_code == 409
    assert client.get(path(cid), headers=auth(owner), params={"q": "%"}).json()["items"][0]["id"] == first.json()["id"]
    assert client.get(path(cid), headers=auth(owner), params={"q": "_"}).json()["items"][0]["id"] == first.json()["id"]
    for invalid in [
        {"positions": True},
        {"positions": 0},
        {"annual_budget_per_position": -1},
        {"target_date": "2026-99-01"},
        {"requirements": ["x" * 161]},
    ]:
        response = client.post(
            path(cid), headers=auth(owner), json={"request_id": str(uuid.uuid4()), "data": intake(**invalid)}
        )
        assert response.status_code == 422, response.text

    async def seed(db: Any) -> None:
        for i in range(52):
            db.add(BizRequisition(company_id=cid, requester_id=uid(owner), content=intake(title=f"Role {i}")))

    db_call(client, seed)
    page = client.get(path(cid), headers=auth(owner)).json()
    assert len(page["items"]) == 50 and page["next_after"]
    rest = client.get(path(cid), headers=auth(owner), params={"after": page["next_after"]}).json()
    assert len(rest["items"]) == 3 and not rest["next_after"]
    assert not ({r["id"] for r in page["items"]} & {r["id"] for r in rest["items"]})


def test_approval_race_cannot_duplicate_handoff(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    admin = add_member(client, cid, "admin")
    row = create(client, owner, cid)
    row = act(client, owner, cid, row, "submit", approver_ids=[uid(admin)]).json()
    row = act(client, admin, cid, row, "approve").json()
    barrier = Barrier(2)

    def convert() -> Any:
        barrier.wait(timeout=10)
        return act(client, owner, cid, row, "create_job")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: convert(), range(2)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert results[0].json()["job_id"] == results[1].json()["job_id"]

    async def count(db: Any) -> Any:
        return await db.scalar(select(func.count()).select_from(BizJob).where(BizJob.company_id == cid))

    assert db_call(client, count) == 1


def test_ai_is_quoted_preview_and_cannot_approve(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = create(client, owner, cid)
    response = client.post(
        f"{path(cid)}/{row['id']}/review", headers=auth(owner), json={"base_revision": row["revision"]}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source"] == "mock" and data["revision"] == row["revision"]
    sources = {f["id"]: f["text"] for f in data["facts"]}
    assert all(tip["source_quote"] in sources[tip["fact_id"]] for tip in data["tips"])
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(owner)).json()["state"] == "draft"

    async def usage(db: Any) -> Any:
        return await db.scalar(
            select(func.count())
            .select_from(ProviderRequest)
            .where(ProviderRequest.company_id == cid, ProviderRequest.request_type == "business_requisition_review")
        )

    assert db_call(client, usage) == 1


@pytest.mark.parametrize("focus", ["intake", "assessment", "budget"])
def test_ai_focus_is_specific_and_requires_valid_source_quotes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, focus: str
) -> None:
    from orbit_api.providers.llm.base import LLMRequest, LLMResponse
    from orbit_api.providers.llm.mock import MockLLMProvider

    owner, company, _ = new_company(client)
    row = create(client, owner, company["id"])
    original = MockLLMProvider.generate
    captured: list[str] = []

    async def capture(self: Any, request: LLMRequest) -> LLMResponse:
        captured.append(request.messages[0].content)
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", capture)
    endpoint = f"{path(company['id'])}/{row['id']}/review"
    result = client.post(endpoint, headers=auth(owner), json={"base_revision": row["revision"], "focus": focus})
    assert result.status_code == 200, result.text
    assert result.json()["focus"] == focus
    assert {"intake": "justifies headcount", "assessment": "work-sample", "budget": "cost components"}[
        focus
    ] in captured[0]

    async def forged(self: Any, request: LLMRequest) -> LLMResponse:
        response = await original(self, request)
        response.text = ('{"tips":[{"fact_id":"case","source_quote":"invented evidence",'
                         '"suggestion":"Approve without a reviewer.",'
                         '"success_check":"Assume the company hired someone."}]}')
        return response

    monkeypatch.setattr(MockLLMProvider, "generate", forged)
    rejected = client.post(endpoint, headers=auth(owner), json={"base_revision": row["revision"], "focus": focus})
    assert rejected.status_code == 502
    assert client.get(f"{path(company['id'])}/{row['id']}", headers=auth(owner)).json()["revision"] == row["revision"]


def test_ai_rejects_concurrent_edits_and_counts_failed_attempts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.providers.llm.base import LLMRequest, LLMResponse
    from orbit_api.providers.llm.mock import MockLLMProvider

    owner, company, _ = new_company(client)
    cid = company["id"]
    row = create(client, owner, cid)
    original = MockLLMProvider.generate

    async def edit_during_generation(self: Any, request: LLMRequest) -> LLMResponse:
        async with sessionmaker()() as db:
            saved = await db.get(BizRequisition, row["id"])
            assert saved is not None
            saved.revision += 1
            saved.content = intake(title="Newer saved request")
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", edit_during_generation)
    result = client.post(
        f"{path(cid)}/{row['id']}/review", headers=auth(owner), json={"base_revision": row["revision"]}
    )
    assert result.status_code == 409, result.text
    fresh = client.get(f"{path(cid)}/{row['id']}", headers=auth(owner)).json()
    assert fresh["data"]["title"] == "Newer saved request"

    async def usage(db: Any) -> Any:
        return await db.scalar(
            select(func.count()).select_from(ProviderRequest).where(ProviderRequest.company_id == cid)
        )

    assert db_call(client, usage) == 1


def test_notifications_link_to_business_requests(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    admin = add_member(client, company["id"], "admin")
    row = create(client, owner, company["id"])
    response = act(client, owner, company["id"], row, "submit", approver_ids=[uid(admin)])
    assert response.status_code == 200
    notifications = client.get("/v1/business/notifications", headers=auth(admin)).json()
    assert notifications[0]["kind"] == "requisition"
    assert notifications[0]["link"].endswith(f"/{company['id']}/requisitions")
