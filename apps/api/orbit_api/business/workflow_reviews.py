"""Independent checkpoint decisions against frozen run evidence; never model-made approvals."""

import copy
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business.access import CompanyCtx, Ctx, audit, job_for, sees_job
from orbit_api.business.automation import coordinators
from orbit_api.business.hiring import aware
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.workflows import Db, Plan, check, context, run_data, run_for, version
from orbit_api.business.workflows import router as router
from orbit_api.models import BizJob, BizWorkflowReview, BizWorkflowRun


class RequestIn(Contract):
    request_id: RequestId
    base_revision: int = Field(ge=1, strict=True)
    reviewer_id: str = Field(min_length=1, max_length=36)
    evidence_note: str = Field(min_length=20, max_length=1200)


class DecisionIn(Contract):
    base_revision: int = Field(ge=1, strict=True)
    evidence_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    acknowledge: bool = Field(strict=True)
    decision: Literal["approved", "changes_requested"]
    note: str = Field(min_length=20, max_length=1200)


class WithdrawIn(Contract):
    base_revision: int = Field(ge=1, strict=True)
    note: str = Field(min_length=10, max_length=300)


def evidence(row: BizWorkflowRun, sid: str) -> dict[str, Any]:
    plan = Plan.model_validate(row.content)
    step = next(s for s in plan.steps if s.id == sid)
    ancestors = set(step.depends_on)
    for candidate in reversed(plan.steps):
        if candidate.id in ancestors:
            ancestors.update(candidate.depends_on)
    return {
        "playbook_title": plan.title,
        "plan_revision": row.plan_revision,
        "start_date": row.start_date,
        "checkpoint": step.model_dump(),
        "checkpoint_owner_id": row.tasks[sid]["owner_id"],
        "prerequisites": [
            {
                "step": s.model_dump(),
                "record": {
                    k: row.tasks[s.id].get(k) for k in ("state", "owner_id", "note", "completed_at", "completed_by")
                },
            }
            for s in plan.steps
            if s.id in ancestors
        ],
    }


def can_withdraw(ctx: Ctx, row: BizWorkflowRun, review: BizWorkflowReview) -> bool:
    return ctx.can("manage_company") or ctx.user.id in (review.requester_id, row.tasks[review.step_id]["owner_id"])


def current(review: BizWorkflowReview, row: BizWorkflowRun) -> bool:
    return review.invalidated_at is None and review.fingerprint == version(evidence(row, review.step_id))


def payload(review: BizWorkflowReview, row: BizWorkflowRun, ctx: Ctx, owners: dict[str, str]) -> dict[str, Any]:
    valid = current(review, row)
    independent = ctx.user.id not in (review.requester_id, row.tasks[review.step_id]["owner_id"])
    pending = row.status == "active" and review.status == "pending" and review.invalidated_at is None
    active = pending and valid
    return {
        "id": review.id,
        "fingerprint": review.fingerprint,
        "status": review.status,
        "requested_at": aware(review.created_at),
        "reviewed_at": aware(review.reviewed_at) if review.reviewed_at else None,
        "requester_id": review.requester_id,
        "reviewer_id": review.reviewer_id,
        "requester_name": owners.get(review.requester_id or "", "Former coordinator"),
        "reviewer_name": owners.get(review.reviewer_id or "", "Unavailable reviewer"),
        "reviewer_current": review.reviewer_id in owners,
        "request_note": review.request_note,
        "response_note": review.response_note,
        "valid": valid,
        "invalidated_at": aware(review.invalidated_at) if review.invalidated_at else None,
        "invalidation_reason": review.invalidation_reason,
        "can_decide": bool(
            active
            and independent
            and review.requester_id
            and ctx.user.id == review.reviewer_id
            and ctx.user.id in owners
        ),
        "can_withdraw": bool(pending and can_withdraw(ctx, row, review)),
        "can_manage_followup": bool(active and can_withdraw(ctx, row, review)),
        "due_date": review.due_date,
        "overdue": bool(active and review.due_date and review.due_date < datetime.now(UTC).date().isoformat()),
        "reminders_enabled": review.reminders_enabled,
        "snoozed_until": aware(review.snoozed_until) if review.snoozed_until else None,
        "reminder_count": review.reminder_count,
        "last_reminded_at": aware(review.last_reminded_at) if review.last_reminded_at else None,
        "previous_review_id": review.previous_review_id,
        "handoff_note": review.handoff_note,
    }


async def payloads(db: AsyncSession, row: BizWorkflowRun, ctx: Ctx, owners: dict[str, str]) -> dict[str, Any]:
    ids = [t["review_id"] for t in row.tasks.values() if t.get("review_id")]
    if not ids:
        return {}
    rows = await db.scalars(
        select(BizWorkflowReview).where(
            BizWorkflowReview.id.in_(ids),
            BizWorkflowReview.run_id == row.id,
            BizWorkflowReview.company_id == ctx.company.id,
        )
    )
    return {r.step_id: payload(r, row, ctx, owners) for r in rows}


async def invalidate(db: AsyncSession, row: BizWorkflowRun, sid: str | None, reason: str) -> None:
    query = select(BizWorkflowReview).where(
        BizWorkflowReview.run_id == row.id, BizWorkflowReview.invalidated_at.is_(None)
    )
    if sid:
        query = query.where(BizWorkflowReview.id == row.tasks[sid].get("review_id"))
    else:
        query = query.where(BizWorkflowReview.status == "pending")
    for review in await db.scalars(query):
        review.invalidated_at, review.invalidation_reason = datetime.now(UTC), reason


async def guard_dependents(db: AsyncSession, row: BizWorkflowRun, sid: str) -> None:
    """Freeze evidence while downstream review is pending/approved, requiring explicit withdrawal/reopening."""
    descendants = {sid}
    for step in Plan.model_validate(row.content).steps:
        if descendants.intersection(step.depends_on):
            descendants.add(step.id)
    descendants.discard(sid)
    for step_id in descendants:
        rid = row.tasks[step_id].get("review_id")
        if rid:
            review = await db.get(BizWorkflowReview, rid)
            if review and review.invalidated_at is None and review.status in ("pending", "approved"):
                raise HTTPException(
                    409, "Withdraw or reopen downstream review checkpoints before editing their evidence."
                )


@router.get("/review-inbox/mine")
async def inbox(ctx: CompanyCtx, db: Db, view: Literal["all", "overdue", "snoozed"] = "all") -> Any:
    ctx = await context(db, ctx)
    query = (
        select(BizWorkflowReview, BizWorkflowRun, BizJob)
        .join(BizWorkflowRun, BizWorkflowRun.id == BizWorkflowReview.run_id)
        .join(BizJob, BizJob.id == BizWorkflowRun.job_id)
        .where(
            BizWorkflowReview.company_id == ctx.company.id,
            BizWorkflowReview.reviewer_id == ctx.user.id,
            BizWorkflowReview.status == "pending",
            BizWorkflowReview.invalidated_at.is_(None),
            BizWorkflowRun.company_id == ctx.company.id,
            BizJob.company_id == ctx.company.id,
            BizWorkflowRun.status == "active",
        )
        .order_by(BizWorkflowReview.due_date.asc().nulls_last(), BizWorkflowReview.created_at, BizWorkflowReview.id)
    )
    items = []
    async for review, run, job in await db.stream(query):
        if not sees_job(ctx, job) or run.tasks.get(review.step_id, {}).get("review_id") != review.id:
            continue
        if not current(review, run):
            continue
        overdue = bool(review.due_date and review.due_date < datetime.now(UTC).date().isoformat())
        snoozed = bool(review.snoozed_until and aware(review.snoozed_until) > datetime.now(UTC))
        if (view == "overdue" and not overdue) or (view == "snoozed" and not snoozed):
            continue
        step = next(s for s in Plan.model_validate(run.content).steps if s.id == review.step_id)
        items.append(
            {
                "id": review.id,
                "run_id": run.id,
                "job_id": job.id,
                "job_title": job.title,
                "step_title": step.title,
                "requested_at": aware(review.created_at),
                "due_date": review.due_date,
                "overdue": overdue,
                "snoozed_until": aware(review.snoozed_until) if review.snoozed_until else None,
                "path": f"/business/app/{ctx.company.id}/workflow-studio?job={job.id}&run={run.id}",
            }
        )
        if len(items) == 51:
            break
    return {"items": items[:50], "truncated": len(items) > 50}


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews", status_code=201)
async def request_review(jid: str, rid: str, sid: str, body: RequestIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    prior = await db.get(BizWorkflowReview, body.request_id)
    fingerprint = version(body.model_dump(exclude={"request_id"}))
    if prior:
        if (
            prior.company_id != ctx.company.id
            or prior.run_id != rid
            or prior.step_id != sid
            or prior.requester_id != ctx.user.id
            or prior.request_sha256 != fingerprint
        ):
            raise HTTPException(409, "This review request key has already been used.")
        return await run_data(db, ctx, jid, rid)
    check(row.revision, body.base_revision)
    if row.status != "active":
        raise HTTPException(409, "Request reviews only for active runs.")
    step = next((s for s in Plan.model_validate(row.content).steps if s.id == sid), None)
    if step is None:
        raise HTTPException(404, "Checkpoint not found.")
    if not step.approval or row.tasks[sid]["state"] == "done":
        raise HTTPException(409, "Choose an unfinished approval checkpoint.")
    if any(row.tasks[d]["state"] != "done" for d in step.depends_on):
        raise HTTPException(409, "Complete the checkpoint prerequisites first.")
    job = await job_for(db, ctx, jid)
    owners = await coordinators(db, job)
    if body.reviewer_id not in owners:
        raise HTTPException(422, "Choose a current coordinator with access to this role.")
    if body.reviewer_id in (ctx.user.id, row.tasks[sid]["owner_id"]):
        raise HTTPException(422, "The reviewer must be different from the requester and checkpoint owner.")
    existing_id = row.tasks[sid].get("review_id")
    old = await db.get(BizWorkflowReview, existing_id) if existing_id else None
    if old and old.status == "pending" and old.invalidated_at is None:
        raise HTTPException(409, "Withdraw the pending review before requesting another.")
    count = await db.scalar(
        select(func.count())
        .select_from(BizWorkflowReview)
        .where(BizWorkflowReview.run_id == rid, BizWorkflowReview.step_id == sid)
    )
    if (count or 0) >= 20:
        raise HTTPException(409, "This checkpoint has 20 review rounds. Start a new run for further revisions.")
    snapshot = evidence(row, sid)
    review = BizWorkflowReview(
        id=body.request_id,
        company_id=ctx.company.id,
        run_id=rid,
        step_id=sid,
        requester_id=ctx.user.id,
        reviewer_id=body.reviewer_id,
        request_sha256=fingerprint,
        fingerprint=version(snapshot),
        evidence=snapshot,
        request_note=body.evidence_note,
    )
    db.add(review)
    tasks = copy.deepcopy(row.tasks)
    tasks[sid]["review_id"] = review.id
    row.tasks, row.revision = tasks, row.revision + 1
    audit(db, ctx.company.id, ctx.user, "workflow.review_requested", jid, run_id=rid, step_id=sid, review_id=review.id)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


async def review_for(db: AsyncSession, ctx: Ctx, row: BizWorkflowRun, sid: str, review_id: str) -> BizWorkflowReview:
    review = await db.get(BizWorkflowReview, review_id, populate_existing=True)
    if review is None or review.company_id != ctx.company.id or review.run_id != row.id or review.step_id != sid:
        raise HTTPException(404, "Review round not found.")
    return review


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews/{review_id}/decision")
async def decide(jid: str, rid: str, sid: str, review_id: str, body: DecisionIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    review = await review_for(db, ctx, row, sid, review_id)
    check(row.revision, body.base_revision)
    owners = await coordinators(db, await job_for(db, ctx, jid))
    if not body.acknowledge or body.evidence_sha256 != review.fingerprint:
        raise HTTPException(409, "Review and acknowledge this checkpoint evidence snapshot first.")
    if not payload(review, row, ctx, owners)["can_decide"] or row.tasks[sid].get("review_id") != review_id:
        raise HTTPException(403, "Only the current independent reviewer can decide this pending request.")
    if any(
        row.tasks[d]["state"] != "done"
        for d in next(s for s in Plan.model_validate(row.content).steps if s.id == sid).depends_on
    ):
        raise HTTPException(409, "Prerequisite evidence is no longer complete.")
    review.status, review.response_note, review.reviewed_at = body.decision, body.note, datetime.now(UTC)
    tasks = copy.deepcopy(row.tasks)
    if body.decision == "approved":
        tasks[sid].update(state="done", completed_at=review.reviewed_at.isoformat(), completed_by=ctx.user.id)
    row.tasks, row.revision = tasks, row.revision + 1
    row.status = "completed" if all(t["state"] == "done" for t in tasks.values()) else "active"
    audit(
        db,
        ctx.company.id,
        ctx.user,
        "workflow.review_decided",
        jid,
        run_id=rid,
        step_id=sid,
        review_id=review_id,
        decision=body.decision,
    )
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews/{review_id}/withdraw")
async def withdraw(jid: str, rid: str, sid: str, review_id: str, body: WithdrawIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    review = await review_for(db, ctx, row, sid, review_id)
    check(row.revision, body.base_revision)
    if (
        row.status != "active"
        or review.status != "pending"
        or review.invalidated_at is not None
        or row.tasks[sid].get("review_id") != review_id
    ):
        raise HTTPException(409, "Only a pending review on an active run can be withdrawn.")
    if not can_withdraw(ctx, row, review):
        raise HTTPException(
            403, "The requester, checkpoint owner or workspace administrator must withdraw this review."
        )
    review.invalidated_at, review.invalidation_reason = datetime.now(UTC), "withdrawn"
    review.response_note = body.note
    row.revision += 1
    audit(db, ctx.company.id, ctx.user, "workflow.review_withdrawn", jid, run_id=rid, review_id=review_id)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.get("/{jid}/runs/{rid}/steps/{sid}/reviews")
async def history(jid: str, rid: str, sid: str, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx)
    row = await run_for(db, ctx, jid, rid)
    if sid not in row.tasks:
        raise HTTPException(404, "Checkpoint not found.")
    owners = await coordinators(db, await job_for(db, ctx, jid))
    rows = await db.scalars(
        select(BizWorkflowReview)
        .where(
            BizWorkflowReview.company_id == ctx.company.id,
            BizWorkflowReview.run_id == rid,
            BizWorkflowReview.step_id == sid,
        )
        .order_by(BizWorkflowReview.created_at.desc(), BizWorkflowReview.id)
        .limit(20)
    )
    return {"items": [{**payload(r, row, ctx, owners), "evidence": r.evidence} for r in rows]}
