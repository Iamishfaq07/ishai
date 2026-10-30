"""Reminder timing and atomic handoff, without changing independent approval authority."""

import copy
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business.review_followups import sweep
from orbit_api.models import BizCompany, BizMember, BizNotification, BizWorkflowReview, BizWorkflowRun, User
from tests.business_helpers import auth, db_call, make_client, uid
from tests.test_business_requisitions import add_member
from tests.test_business_workflow_reviews import ask, checkpoint, decide, path, prepared
from tests.test_business_workflows import root, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def ready(client: TestClient) -> Any:
    owner, reviewer, cid, jid, run = prepared(client)
    pending = ask(client, owner, reviewer, cid, jid, run).json()
    return owner, reviewer, cid, jid, pending


def endpoint(cid: str, jid: str, run: Any, action: str) -> str:
    return path(cid, jid, run) + f"/{checkpoint(run)['review']['id']}/{action}"


def configure(client: TestClient, actor: Any, cid: str, jid: str, run: Any, enabled: bool = True, **over: Any) -> Any:
    return client.post(
        endpoint(cid, jid, run, "followup"),
        headers=auth(actor),
        json={
            "base_revision": run["revision"],
            "due_date": datetime.now(UTC).date().isoformat(),
            "reminders_enabled": enabled,
            **over,
        },
    )


def handoff(client: TestClient, actor: Any, next_reviewer: Any, cid: str, jid: str, run: Any, **over: Any) -> Any:
    return client.post(
        endpoint(cid, jid, run, "handoff"),
        headers=auth(actor),
        json={
            "request_id": str(uuid.uuid4()),
            "base_revision": run["revision"],
            "reviewer_id": uid(next_reviewer),
            "note": "Handing this pending checkpoint to another available independent coordinator.",
            **over,
        },
    )


def snooze(client: TestClient, actor: Any, cid: str, jid: str, run: Any, days: int | None) -> Any:
    value = (datetime.now(UTC) + timedelta(days=days)).date().isoformat() if days is not None else None
    return client.post(
        endpoint(cid, jid, run, "snooze"),
        headers=auth(actor),
        json={"base_revision": run["revision"], "until_date": value},
    )


def scan(client: TestClient, days: int) -> int:
    return client.portal.call(sweep, datetime.now(UTC) + timedelta(days=days))


def test_reminders_default_off_bounded_deduplicated_and_link_to_private_inbox(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    assert not checkpoint(run)["review"]["reminders_enabled"]
    assert scan(client, 10) == 0
    response = configure(client, owner, cid, jid, run)
    assert response.status_code == 200, response.text
    run = response.json()
    assert scan(client, 0) == 0
    assert scan(client, 1) == 1
    assert scan(client, 1) == 0
    assert scan(client, 2) == 0
    assert scan(client, 4) == 1
    assert scan(client, 8) == 1
    assert scan(client, 99) == 0
    notices = client.get("/v1/business/notifications", headers=auth(reviewer)).json()
    reminders = [n for n in notices if n["kind"] == "workflow_review"]
    assert len(reminders) == 3
    assert all(n["link"] == f"/business/app/{cid}/workflow-reviews" for n in reminders)
    assert all("evidence" not in n["text"].lower() and "@" not in n["text"] for n in reminders)

    async def check(db: Any) -> None:
        record = await db.get(BizWorkflowReview, checkpoint(run)["review"]["id"])
        assert record.reminder_count == 3 and record.status == "pending" and record.reviewed_at is None

    db_call(client, check)


def test_snooze_changes_only_personal_reminders_and_does_not_reset_budget(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    run = configure(client, owner, cid, jid, run).json()
    assert snooze(client, owner, cid, jid, run, 5).status_code == 403
    paused = snooze(client, reviewer, cid, jid, run, 5)
    assert paused.status_code == 200, paused.text
    run = paused.json()
    assert checkpoint(run)["review"]["due_date"] == datetime.now(UTC).date().isoformat()
    assert scan(client, 2) == 0
    assert scan(client, 5) == 1
    assert snooze(client, reviewer, cid, jid, run, 31).status_code == 422
    resumed = snooze(client, reviewer, cid, jid, run, None)
    assert resumed.status_code == 200
    assert checkpoint(resumed.json())["review"]["reminder_count"] == 1
    assert checkpoint(resumed.json())["review"]["snoozed_until"] is None
    assert configure(client, reviewer, cid, jid, resumed.json()).status_code == 403


def test_handoff_preserves_evidence_due_date_budget_and_old_history(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    next_reviewer = add_member(client, cid, "recruiter")
    run = configure(client, owner, cid, jid, run).json()
    assert scan(client, 1) == 1
    old = checkpoint(run)["review"]
    moved = handoff(client, owner, next_reviewer, cid, jid, run)
    assert moved.status_code == 201, moved.text
    run = moved.json()
    current = checkpoint(run)["review"]
    assert current["id"] != old["id"] and current["previous_review_id"] == old["id"]
    assert current["fingerprint"] == old["fingerprint"] and current["due_date"] == old["due_date"]
    assert current["reminder_count"] == 1 and current["handoff_note"]
    assert scan(client, 1) == 0
    assert client.get(root(cid) + "/review-inbox/mine", headers=auth(reviewer)).json()["items"] == []
    assert len(client.get(root(cid) + "/review-inbox/mine", headers=auth(next_reviewer)).json()["items"]) == 1
    assert decide(client, reviewer, cid, jid, run).status_code == 403
    assert decide(client, next_reviewer, cid, jid, run).status_code == 200
    history = client.get(path(cid, jid, run), headers=auth(owner)).json()["items"]
    previous = next(r for r in history if r["id"] == old["id"])
    assert previous["invalidation_reason"] == "reviewer_reassigned" and previous["status"] == "pending"
    assert history[0]["evidence"] == history[1]["evidence"]


def test_handoff_checks_independence_permission_and_request_idempotency(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    next_reviewer = add_member(client, cid, "recruiter")
    assert handoff(client, owner, owner, cid, jid, run).status_code == 422
    assert handoff(client, owner, reviewer, cid, jid, run).status_code == 422
    assert handoff(client, reviewer, next_reviewer, cid, jid, run).status_code == 403
    request_id = str(uuid.uuid4())
    first = handoff(client, owner, next_reviewer, cid, jid, run, request_id=request_id)
    second = handoff(client, owner, next_reviewer, cid, jid, run, request_id=request_id)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert (
        handoff(
            client,
            owner,
            next_reviewer,
            cid,
            jid,
            run,
            request_id=request_id,
            note="A different request must never replace a completed handoff transaction.",
        ).status_code
        == 409
    )


@pytest.mark.parametrize("restriction", ["company", "reviewer", "scope", "cancel", "pointer", "evidence"])
def test_worker_skips_ineligible_or_changed_reviews(client: TestClient, restriction: str) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    run = configure(client, owner, cid, jid, run).json()

    async def restrict(db: Any) -> None:
        row = await db.get(BizWorkflowRun, run["id"])
        if restriction == "company":
            (await db.get(BizCompany, cid)).status = "suspended"
        elif restriction == "reviewer":
            (await db.get(User, uid(reviewer))).suspended_at = datetime.now(UTC)
        elif restriction == "scope":
            member = await db.scalar(
                select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(reviewer))
            )
            member.role = "hiring_manager"
        elif restriction == "cancel":
            row.status = "cancelled"
        else:
            tasks = copy.deepcopy(row.tasks)
            if restriction == "pointer":
                tasks["review"]["review_id"] = None
            else:
                tasks["criteria"]["note"] = "Evidence changed after the snapshot."
            row.tasks = tasks

    db_call(client, restrict)
    scan(client, 10)  # Other companies may independently have due reviews in this shared test database.

    async def check(db: Any) -> None:
        record = await db.get(BizWorkflowReview, checkpoint(run)["review"]["id"])
        assert record.reminder_count == 0
        notices = list(
            await db.scalars(
                select(BizNotification).where(
                    BizNotification.company_id == cid, BizNotification.kind == "workflow_review"
                )
            )
        )
        assert notices == []

    db_call(client, check)


def test_concurrent_scans_deliver_once_and_keep_decision_pending(client: TestClient) -> None:
    owner, _reviewer, cid, jid, run = ready(client)
    configure(client, owner, cid, jid, run)
    barrier = Barrier(2)

    def execute() -> int:
        barrier.wait(timeout=10)
        return scan(client, 1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(execute) for _ in range(2)]
        results = [f.result(timeout=30) for f in futures]
    assert sorted(results) == [0, 1]

    async def check(db: Any) -> None:
        rows = list(
            await db.scalars(
                select(BizNotification).where(
                    BizNotification.company_id == cid, BizNotification.kind == "workflow_review"
                )
            )
        )
        assert len(rows) == 1
        review = await db.get(BizWorkflowReview, checkpoint(run)["review"]["id"])
        assert review.status == "pending" and review.reminder_count == 1

    db_call(client, check)


def test_followup_validation_closed_state_and_cross_company_access(client: TestClient) -> None:
    owner, reviewer, cid, jid, run = ready(client)
    assert configure(client, owner, cid, jid, run, due_date=None).status_code == 422
    assert configure(client, owner, cid, jid, run, reminders_enabled="true").status_code == 422
    assert (
        configure(
            client, owner, cid, jid, run, due_date=(datetime.now(UTC) + timedelta(days=366)).date().isoformat()
        ).status_code
        == 422
    )
    other, _, _ = setup(client)
    assert configure(client, other, cid, jid, run).status_code == 404
    assert client.post(root(cid) + "/review-inbox/reminders/run", headers=auth(reviewer), json={}).status_code == 403
    completed = decide(client, reviewer, cid, jid, run).json()
    assert configure(client, owner, cid, jid, completed).status_code == 409
    assert snooze(client, reviewer, cid, jid, completed, 1).status_code == 409


def test_inbox_filters_are_scoped_and_due_order_is_stable(client: TestClient) -> None:
    owner, reviewer, cid, _jid, run = ready(client)
    review_id = checkpoint(run)["review"]["id"]

    async def overdue(db: Any) -> None:
        review = await db.get(BizWorkflowReview, review_id)
        review.due_date = (datetime.now(UTC) - timedelta(days=2)).date().isoformat()
        review.snoozed_until = datetime.now(UTC) + timedelta(days=2)

    db_call(client, overdue)
    endpoint = root(cid) + "/review-inbox/mine"
    for view in ("all", "overdue", "snoozed"):
        response = client.get(endpoint, headers=auth(reviewer), params={"view": view})
        assert response.status_code == 200 and len(response.json()["items"]) == 1
        assert response.json()["items"][0]["overdue"]
        assert client.get(endpoint, headers=auth(owner), params={"view": view}).json()["items"] == []
    assert client.get(endpoint, headers=auth(reviewer), params={"view": "unknown"}).status_code == 422


def test_overdue_due_date_can_be_kept_when_reminders_are_disabled(client: TestClient) -> None:
    owner, _reviewer, cid, jid, run = ready(client)
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    enabled = configure(client, owner, cid, jid, run, due_date=yesterday)
    assert enabled.status_code == 200, enabled.text
    run = enabled.json()
    assert checkpoint(run)["review"]["overdue"]
    scan(client, 0)
    disabled = configure(client, owner, cid, jid, run, enabled=False, due_date=yesterday)
    assert disabled.status_code == 200, disabled.text
    assert checkpoint(disabled.json())["review"]["reminder_count"] == 1
    assert not checkpoint(disabled.json())["review"]["reminders_enabled"]


def test_notification_and_delivery_count_roll_back_together(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from orbit_api.business import review_followups

    owner, _reviewer, cid, jid, run = ready(client)
    configure(client, owner, cid, jid, run)
    original = review_followups.audit

    def fail(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("Simulated persistence failure before transaction commit")

    monkeypatch.setattr(review_followups, "audit", fail)
    with pytest.raises(RuntimeError, match="Simulated persistence"):
        scan(client, 1)

    async def unchanged(db: Any) -> None:
        record = await db.get(BizWorkflowReview, checkpoint(run)["review"]["id"])
        assert record.reminder_count == 0
        notices = list(
            await db.scalars(
                select(BizNotification).where(
                    BizNotification.company_id == cid, BizNotification.kind == "workflow_review"
                )
            )
        )
        assert notices == []

    db_call(client, unchanged)
    monkeypatch.setattr(review_followups, "audit", original)
    assert scan(client, 1) == 1


def test_ai_progress_brief_receives_only_followup_counts(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.llm.mock import MockLLMProvider

    owner, reviewer, cid, jid, run = ready(client)
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    run = configure(client, owner, cid, jid, run, due_date=yesterday).json()
    run = snooze(client, reviewer, cid, jid, run, 2).json()
    assert run["reviews"]["overdue"] == run["reviews"]["snoozed"] == 1
    original = MockLLMProvider.generate
    seen = []

    async def inspect(self: Any, request: Any) -> Any:
        seen.append(request.messages[-1].content)
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", inspect)
    result = client.post(
        root(cid, jid) + f"/runs/{run['id']}/brief", headers=auth(reviewer), json={"version": run["version"]}
    )
    assert result.status_code == 200, result.text
    assert "overdue reviews: 1" in seen[0] and "paused reminders: 1" in seen[0]
    assert uid(owner) not in seen[0] and uid(reviewer) not in seen[0]
    assert checkpoint(run)["review"]["request_note"] not in seen[0]
