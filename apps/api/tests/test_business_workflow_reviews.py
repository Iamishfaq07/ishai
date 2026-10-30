"""Independent reviewer identity, frozen evidence, immutable decisions and inbox isolation."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from orbit_api.models import BizJob, BizMember, BizWorkflowReview, BizWorkflowRun
from tests.business_helpers import auth, db_call, make_client, uid
from tests.test_business_requisitions import add_member
from tests.test_business_workflows import act, root, save, setup, start


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def prepared(client: TestClient) -> Any:
    owner, cid, jid = setup(client)
    reviewer = add_member(client, cid, "recruiter")
    plan = client.get(root(cid), headers=auth(owner)).json()["templates"][-1]["plan"]
    save(client, owner, cid, jid, plan)
    run = start(client, owner, cid, jid, default_owner_id=uid(owner)).json()
    for sid in ("scope", "criteria", "panel"):
        response = act(client, owner, cid, jid, run, sid)
        assert response.status_code == 200, response.text
        run = response.json()
    return owner, reviewer, cid, jid, run


def path(cid: str, jid: str, run: Any, sid: str = "review") -> str:
    return root(cid, jid) + f"/runs/{run['id']}/steps/{sid}/reviews"


def ask(client: TestClient, owner: Any, reviewer: Any, cid: str, jid: str, run: Any, **over: Any) -> Any:
    return client.post(
        path(cid, jid, run),
        headers=auth(owner),
        json={
            "request_id": str(uuid.uuid4()),
            "base_revision": run["revision"],
            "reviewer_id": uid(reviewer),
            "evidence_note": "Review the prepared criteria and panel responsibilities before launch.",
            **over,
        },
    )


def checkpoint(run: Any) -> Any:
    return next(s for s in run["steps"] if s["id"] == "review")


def decide(
    client: TestClient, actor: Any, cid: str, jid: str, run: Any, decision: str = "approved", **over: Any
) -> Any:
    review = checkpoint(run)["review"]
    return client.post(
        path(cid, jid, run) + f"/{review['id']}/decision",
        headers=auth(actor),
        json={
            "base_revision": run["revision"],
            "evidence_sha256": review["fingerprint"],
            "acknowledge": True,
            "decision": decision,
            "note": "Reviewed the frozen preparation evidence and recorded this team decision.",
            **over,
        },
    )


def withdraw(client: TestClient, owner: Any, cid: str, jid: str, run: Any) -> Any:
    review = checkpoint(run)["review"]
    return client.post(
        path(cid, jid, run) + f"/{review['id']}/withdraw",
        headers=auth(owner),
        json={"base_revision": run["revision"], "note": "Withdraw this request to revise the preparation evidence."},
    )


def test_gate_blocks_ordinary_completion_and_independent_reviewer_approves(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    assert checkpoint(run)["approval"]
    assert act(client, owner, cid, jid, run, "review").status_code == 409
    asked = ask(client, owner, reviewer, cid, jid, run)
    assert asked.status_code == 201, asked.text
    pending = asked.json()
    assert pending["reviews"]["pending"] == 1 and not checkpoint(pending)["review"]["can_decide"]
    assert decide(client, owner, cid, jid, pending).status_code == 403
    assert decide(client, reviewer, cid, jid, pending, acknowledge=False).status_code == 409
    assert decide(client, reviewer, cid, jid, pending, evidence_sha256="a" * 64).status_code == 409
    result = decide(client, reviewer, cid, jid, pending)
    assert result.status_code == 200, result.text
    approved = result.json()
    assert approved["status"] == "completed" and approved["counts"]["done"] == 4
    assert checkpoint(approved)["completed_by"] == uid(reviewer)
    assert checkpoint(approved)["review"]["status"] == "approved"
    assert decide(client, reviewer, cid, jid, approved, "changes_requested").status_code == 403

    async def unchanged(db: Any) -> None:
        assert (await db.get(BizJob, jid)).status == "open"

    db_call(client, unchanged)


def test_requester_and_owner_cannot_be_reviewer_and_only_named_person_can_decide(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    assert ask(client, owner, owner, cid, jid, run).status_code == 422
    assert ask(client, reviewer, owner, cid, jid, run).status_code == 422
    interviewer = add_member(client, cid, "interviewer")
    assert ask(client, owner, interviewer, cid, jid, run).status_code == 422
    third = add_member(client, cid, "recruiter")
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    assert decide(client, third, cid, jid, pending).status_code == 403
    assert withdraw(client, third, cid, jid, pending).status_code == 403


def test_changes_requested_preserves_evidence_and_new_round_can_approve(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    first_id = checkpoint(pending)["review"]["id"]
    rejected = decide(client, reviewer, cid, jid, pending, "changes_requested").json()
    assert rejected["status"] == "active" and checkpoint(rejected)["state"] == "pending"
    assert rejected["reviews"]["changes_requested"] == 1
    corrected = act(
        client,
        owner,
        cid,
        jid,
        rejected,
        "criteria",
        "assign",
        owner_id=uid(owner),
        note="Updated coordinator note after the review requested changes.",
    )
    assert corrected.status_code == 200, corrected.text
    pending2 = ask(client, owner, reviewer, cid, jid, corrected.json()).json()
    assert checkpoint(pending2)["review"]["id"] != first_id
    assert decide(client, reviewer, cid, jid, pending2).status_code == 200
    history = client.get(path(cid, jid, pending2), headers=auth(owner)).json()["items"]
    assert len(history) == 2
    first = next(r for r in history if r["id"] == first_id)
    assert first["status"] == "changes_requested" and first["response_note"]
    assert all("Updated coordinator note" not in p["record"]["note"] for p in first["evidence"]["prerequisites"])
    assert first["evidence"]["plan_revision"] == 1


def test_pending_review_freezes_prerequisite_evidence_until_withdrawn(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    assert act(client, owner, cid, jid, pending, "criteria", "assign", owner_id=uid(owner)).status_code == 409
    assert act(client, owner, cid, jid, pending, "criteria", "reopen").status_code == 409
    assert act(client, owner, cid, jid, pending, "review", "assign", owner_id=uid(reviewer)).status_code == 409
    assert ask(client, owner, reviewer, cid, jid, pending).status_code == 409
    removed = withdraw(client, owner, cid, jid, pending)
    assert removed.status_code == 200, removed.text
    assert not checkpoint(removed.json())["review"]["valid"]
    assert act(client, owner, cid, jid, removed.json(), "criteria", "reopen").status_code == 200


def test_approved_gate_must_reopen_before_evidence_edits(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    approved = decide(client, reviewer, cid, jid, pending).json()
    assert act(client, owner, cid, jid, approved, "criteria", "assign", owner_id=uid(owner)).status_code == 409
    reopened = act(client, owner, cid, jid, approved, "review", "reopen")
    assert reopened.status_code == 200, reopened.text
    current = reopened.json()
    assert current["status"] == "active" and checkpoint(current)["review"]["invalidated_at"]
    assert checkpoint(current)["review"]["status"] == "approved"  # Historical decision is preserved.
    assert act(client, owner, cid, jid, current, "criteria", "reopen").status_code == 200


def test_inbox_is_personal_current_scope_and_cancel_removes_pending_requests(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    endpoint = root(cid) + "/review-inbox/mine"
    assert client.get(endpoint, headers=auth(owner)).json()["items"] == []
    inbox = client.get(endpoint, headers=auth(reviewer))
    assert inbox.status_code == 200, inbox.text
    item = inbox.json()["items"][0]
    assert item["job_id"] == jid and f"run={run['id']}" in item["path"]
    assert "request_note" not in item and "evidence" not in item
    cancelled = client.post(
        root(cid, jid) + f"/runs/{run['id']}/cancel", headers=auth(owner), json={"base_revision": pending["revision"]}
    )
    assert cancelled.status_code == 200
    assert client.get(endpoint, headers=auth(reviewer)).json()["items"] == []
    assert decide(client, reviewer, cid, jid, cancelled.json()).status_code == 403


def test_reviewer_access_loss_and_other_tenants_do_not_leak_review(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()

    async def restrict(db: Any) -> None:
        member = await db.scalar(
            select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(reviewer))
        )
        member.role = "hiring_manager"  # Not assigned to this job.

    db_call(client, restrict)
    assert client.get(root(cid) + "/review-inbox/mine", headers=auth(reviewer)).json()["items"] == []
    assert decide(client, reviewer, cid, jid, pending).status_code == 404
    current = client.get(root(cid, jid) + f"/runs/{run['id']}", headers=auth(owner)).json()
    assert not checkpoint(current)["review"]["reviewer_current"]
    other, ocid, ojid = setup(client)
    assert client.get(path(cid, jid, run), headers=auth(other)).status_code == 404
    target = root(ocid, ojid) + f"/runs/{run['id']}/steps/review/reviews"
    assert client.get(target, headers=auth(other)).status_code == 404
    assert withdraw(client, owner, cid, jid, current).status_code == 200


def test_request_idempotence_and_conflicting_retry(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    request_id = str(uuid.uuid4())
    first = ask(client, owner, reviewer, cid, jid, run, request_id=request_id)
    second = ask(client, owner, reviewer, cid, jid, run, request_id=request_id)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert (
        ask(
            client,
            owner,
            reviewer,
            cid,
            jid,
            run,
            request_id=request_id,
            evidence_note="A conflicting review payload that must not replace the evidence.",
        ).status_code
        == 409
    )


def test_concurrent_decisions_cannot_overwrite_one_another(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    barrier = Barrier(2)

    def submit(value: str) -> Any:
        barrier.wait(timeout=10)
        return decide(client, reviewer, cid, jid, pending, value)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit, s) for s in ("approved", "changes_requested")]
        results = [f.result(timeout=30) for f in futures]
    assert sorted(r.status_code for r in results) == [200, 409]
    history = client.get(path(cid, jid, run), headers=auth(owner)).json()["items"]
    assert len(history) == 1 and history[0]["reviewed_at"]


def test_run_deletion_cascades_review_evidence(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    review_id = checkpoint(pending)["review"]["id"]

    async def remove(db: Any) -> None:
        await db.execute(delete(BizWorkflowRun).where(BizWorkflowRun.id == run["id"]))

    db_call(client, remove)

    async def check(db: Any) -> None:
        assert await db.get(BizWorkflowReview, review_id) is None

    db_call(client, check)


def test_ai_cannot_create_approval_policy_and_briefs_only_receive_counts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    from orbit_api.providers.llm.mock import MockLLMProvider
    from tests.test_business_workflows import workspace

    owner, reviewer, cid, jid, run = prepared(client)
    run = ask(
        client, owner, reviewer, cid, jid, run, evidence_note="CONFIDENTIAL EVIDENCE NOTE MUST NOT REACH A MODEL."
    ).json()
    original = MockLLMProvider.generate
    calls = []

    async def inspect(self: Any, request: Any) -> Any:
        calls.append(request)
        result = await original(self, request)
        if request.request_type == "business_workflow_draft":
            data = json.loads(result.text)
            data["plan"]["steps"][-1]["approval"] = True
            result.text = json.dumps(data)
        return result

    monkeypatch.setattr(MockLLMProvider, "generate", inspect)
    brief = client.post(
        root(cid, jid) + f"/runs/{run['id']}/brief", headers=auth(owner), json={"version": run["version"]}
    )
    assert brief.status_code == 200, brief.text
    body = calls[-1].messages[-1].content
    assert "CONFIDENTIAL" not in body and uid(reviewer) not in body and uid(owner) not in body
    assert "pending reviews: 1" in body
    current = workspace(client, owner, cid, jid)
    draft = client.post(root(cid, jid) + "/draft", headers=auth(owner), json={"version": current["version"]})
    assert draft.status_code == 502


def test_review_round_limit_is_enforced(client: TestClient) -> None:
    from orbit_api.business.workflow_reviews import evidence
    from orbit_api.business.workflows import version

    owner, reviewer, cid, jid, run = prepared(client)

    async def seed(db: Any) -> None:
        row = await db.get(BizWorkflowRun, run["id"])
        snapshot = evidence(row, "review")
        for _ in range(20):
            db.add(
                BizWorkflowReview(
                    id=str(uuid.uuid4()),
                    company_id=cid,
                    run_id=row.id,
                    step_id="review",
                    requester_id=uid(owner),
                    reviewer_id=uid(reviewer),
                    request_sha256="a" * 64,
                    fingerprint=version(snapshot),
                    evidence=snapshot,
                    request_note="Historical review request.",
                    status="changes_requested",
                    response_note="Earlier review requested changes.",
                )
            )

    db_call(client, seed)
    assert ask(client, owner, reviewer, cid, jid, run).status_code == 409


def test_changed_evidence_cannot_approve_but_can_be_withdrawn(client: TestClient) -> None:
    import copy

    owner, reviewer, cid, jid, run = prepared(client)
    assert ask(client, owner, reviewer, cid, jid, run).status_code == 201

    async def change(db: Any) -> None:
        row = await db.get(BizWorkflowRun, run["id"])
        tasks = copy.deepcopy(row.tasks)
        tasks["criteria"]["note"] = "Changed by a separate source after the evidence was captured."
        row.tasks = tasks
        row.revision += 1

    db_call(client, change)
    current = client.get(root(cid, jid) + f"/runs/{run['id']}", headers=auth(owner)).json()
    assert not checkpoint(current)["review"]["valid"]
    assert checkpoint(current)["review"]["can_withdraw"]
    assert decide(client, reviewer, cid, jid, current).status_code == 403
    assert withdraw(client, owner, cid, jid, current).status_code == 200
