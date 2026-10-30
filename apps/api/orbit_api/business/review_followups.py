"""Bounded internal reminders and explicit handoffs; deadlines never approve a checkpoint."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business.access import CompanyCtx, audit, job_for, lock_company
from orbit_api.business.automation import coordinators
from orbit_api.business.hiring import aware
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.workflow_reviews import can_withdraw, current, payload, review_for
from orbit_api.business.workflow_reviews import router as router
from orbit_api.business.workflows import Db, check, context, run_data, run_for, version
from orbit_api.db import sessionmaker
from orbit_api.models import BizCompany, BizJob, BizNotification, BizWorkflowReview, BizWorkflowRun


class Followup(Contract):
    base_revision: int = Field(ge=1, strict=True)
    due_date: str | None = Field(None, min_length=10, max_length=10)
    reminders_enabled: bool = Field(False, strict=True)

    @field_validator("due_date")
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = date.fromisoformat(value)
            if parsed.isoformat() != value or parsed > datetime.now(UTC).date() + timedelta(days=365):
                raise ValueError("Choose a valid UTC due date no more than 365 days ahead.")
        return value

    @model_validator(mode="after")
    def needs_date(self) -> "Followup":
        if self.reminders_enabled and self.due_date is None:
            raise ValueError("Set a due date before enabling reminders.")
        return self


class Snooze(Contract):
    base_revision: int = Field(ge=1, strict=True)
    until_date: str | None = Field(None, min_length=10, max_length=10)

    @field_validator("until_date")
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = date.fromisoformat(value)
            today = datetime.now(UTC).date()
            if parsed.isoformat() != value or not today < parsed <= today + timedelta(days=30):
                raise ValueError("Snooze until a UTC date within the next 30 days.")
        return value


class Handoff(Contract):
    request_id: RequestId
    base_revision: int = Field(ge=1, strict=True)
    reviewer_id: str = Field(min_length=1, max_length=36)
    note: str = Field(min_length=20, max_length=600)


async def pending(
    db: AsyncSession, ctx: Any, jid: str, rid: str, sid: str, review_id: str, revision: int
) -> tuple[BizWorkflowRun, BizWorkflowReview]:
    row = await run_for(db, ctx, jid, rid)
    review = await review_for(db, ctx, row, sid, review_id)
    check(row.revision, revision)
    if (
        row.status != "active"
        or review.status != "pending"
        or review.invalidated_at is not None
        or row.tasks[sid].get("review_id") != review_id
        or not current(review, row)
    ):
        raise HTTPException(409, "Choose the current pending review with unchanged evidence.")
    return row, review


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews/{review_id}/followup")
async def configure(jid: str, rid: str, sid: str, review_id: str, body: Followup, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row, review = await pending(db, ctx, jid, rid, sid, review_id, body.base_revision)
    if not can_withdraw(ctx, row, review):
        raise HTTPException(403, "The requester, checkpoint owner or workspace administrator controls follow-ups.")
    review.due_date, review.reminders_enabled = body.due_date, body.reminders_enabled
    row.revision += 1
    audit(
        db,
        ctx.company.id,
        ctx.user,
        "workflow.review_followup",
        jid,
        review_id=review_id,
        due_date=body.due_date,
        reminders=body.reminders_enabled,
    )
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews/{review_id}/snooze")
async def snooze(jid: str, rid: str, sid: str, review_id: str, body: Snooze, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row, review = await pending(db, ctx, jid, rid, sid, review_id, body.base_revision)
    owners = await coordinators(db, await job_for(db, ctx, jid))
    if not payload(review, row, ctx, owners)["can_decide"]:
        raise HTTPException(403, "Only the named independent reviewer can snooze their reminders.")
    review.snoozed_until = (
        datetime.combine(date.fromisoformat(body.until_date), time(), UTC) if body.until_date else None
    )
    row.revision += 1
    audit(db, ctx.company.id, ctx.user, "workflow.review_snoozed", jid, review_id=review_id, until=body.until_date)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.post("/{jid}/runs/{rid}/steps/{sid}/reviews/{review_id}/handoff", status_code=201)
async def handoff(jid: str, rid: str, sid: str, review_id: str, body: Handoff, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    fingerprint = version({**body.model_dump(exclude={"request_id"}), "previous_review_id": review_id})
    existing = await db.get(BizWorkflowReview, body.request_id)
    if existing:
        if (
            existing.company_id != ctx.company.id
            or existing.run_id != rid
            or existing.step_id != sid
            or existing.requester_id != ctx.user.id
            or existing.request_sha256 != fingerprint
        ):
            raise HTTPException(409, "This handoff request key was already used.")
        return await run_data(db, ctx, jid, rid)
    row, old = await pending(db, ctx, jid, rid, sid, review_id, body.base_revision)
    if not can_withdraw(ctx, row, old):
        raise HTTPException(403, "The requester, checkpoint owner or workspace administrator must make the handoff.")
    owners = await coordinators(db, await job_for(db, ctx, jid))
    if body.reviewer_id not in owners:
        raise HTTPException(422, "Choose another current coordinator with access to this role.")
    excluded = {ctx.user.id, row.tasks[sid]["owner_id"], old.reviewer_id}
    previous: BizWorkflowReview | None = old
    for _ in range(20):
        if previous is None:
            break
        excluded.add(previous.requester_id)
        previous = await db.get(BizWorkflowReview, previous.previous_review_id) if previous.previous_review_id else None
    if body.reviewer_id in excluded:
        raise HTTPException(
            422, "Choose a different reviewer who did not request this review chain or own the checkpoint."
        )
    count = await db.scalar(
        select(func.count())
        .select_from(BizWorkflowReview)
        .where(BizWorkflowReview.run_id == rid, BizWorkflowReview.step_id == sid)
    )
    if (count or 0) >= 20:
        raise HTTPException(409, "This checkpoint has 20 review rounds. Start a new run for further revisions.")
    review = BizWorkflowReview(
        id=body.request_id,
        company_id=ctx.company.id,
        run_id=rid,
        step_id=sid,
        requester_id=ctx.user.id,
        reviewer_id=body.reviewer_id,
        request_sha256=fingerprint,
        fingerprint=old.fingerprint,
        evidence=old.evidence,
        request_note=old.request_note,
        due_date=old.due_date,
        reminders_enabled=old.reminders_enabled,
        reminder_count=old.reminder_count,
        last_reminded_at=old.last_reminded_at,
        previous_review_id=old.id,
        handoff_note=body.note,
    )
    old.invalidated_at, old.invalidation_reason = datetime.now(UTC), "reviewer_reassigned"
    db.add(review)
    tasks = {key: dict(value) for key, value in row.tasks.items()}
    tasks[sid]["review_id"] = review.id
    row.tasks, row.revision = tasks, row.revision + 1
    audit(db, ctx.company.id, ctx.user, "workflow.review_handoff", jid, review_id=review.id, previous_review_id=old.id)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


async def reconcile(db: AsyncSession, cid: str, now: datetime) -> int:
    """Caller holds company lock; notification and durable count commit in the same transaction."""
    company = await db.get(BizCompany, cid, populate_existing=True)
    if company is None or company.status != "active":
        return 0
    rows = await db.scalars(
        select(BizWorkflowReview).where(
            BizWorkflowReview.company_id == cid,
            BizWorkflowReview.reminders_enabled.is_(True),
            BizWorkflowReview.status == "pending",
            BizWorkflowReview.invalidated_at.is_(None),
            BizWorkflowReview.due_date < now.date().isoformat(),
            BizWorkflowReview.reminder_count < 3,
        )
    )
    count = 0
    for review in rows:
        run = await db.get(BizWorkflowRun, review.run_id, populate_existing=True)
        if (
            run is None
            or run.company_id != cid
            or run.status != "active"
            or run.tasks.get(review.step_id, {}).get("review_id") != review.id
            or not review.requester_id
            or not current(review, run)
        ):
            continue
        job = await db.get(BizJob, run.job_id, populate_existing=True)
        if job is None or job.company_id != cid:
            continue
        owners = await coordinators(db, job)
        if review.reviewer_id not in owners or review.reviewer_id in (
            review.requester_id,
            run.tasks[review.step_id]["owner_id"],
        ):
            continue
        if review.snoozed_until and aware(review.snoozed_until) > now:
            continue
        if review.last_reminded_at and aware(review.last_reminded_at) + timedelta(hours=24) > now:
            continue
        due = datetime.combine(date.fromisoformat(review.due_date or ""), time(), UTC) + timedelta(days=1)
        if now < due + timedelta(days=(0, 3, 7)[review.reminder_count]):
            continue
        db.add(
            BizNotification(
                company_id=cid,
                user_id=review.reviewer_id,
                kind="workflow_review",
                text="A workflow checkpoint assigned to you is overdue. Open your Business review inbox.",
            )
        )
        review.reminder_count += 1
        review.last_reminded_at = now
        audit(db, cid, None, "workflow.review_reminded", run.job_id, review_id=review.id, count=review.reminder_count)
        count += 1
    return count


@router.post("/review-inbox/reminders/run")
async def manual(ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    ctx.require("manage_company")
    count = await reconcile(db, ctx.company.id, datetime.now(UTC))
    await db.commit()
    return {"created": count}


async def sweep(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    async with sessionmaker()() as db:
        cids = list(
            await db.scalars(
                select(BizWorkflowReview.company_id)
                .where(
                    BizWorkflowReview.reminders_enabled.is_(True),
                    BizWorkflowReview.status == "pending",
                    BizWorkflowReview.invalidated_at.is_(None),
                    BizWorkflowReview.due_date < now.date().isoformat(),
                    BizWorkflowReview.reminder_count < 3,
                )
                .distinct()
            )
        )
        count = 0
        for cid in cids:
            await lock_company(db, cid)
            db.expire_all()
            count += await reconcile(db, cid, now)
            await db.commit()
        return count
