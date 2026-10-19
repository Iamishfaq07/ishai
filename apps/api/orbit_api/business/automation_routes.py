"""Tenant- and job-scoped automation configuration, preview and shared hiring task queue."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import ratelimit
from orbit_api.business import automation, rules
from orbit_api.business.access import CompanyCtx, application_for, audit, job_for, lock_company, sees_job, timeline
from orbit_api.business.hiring import aware
from orbit_api.db import get_db
from orbit_api.documents.uploads import sanitize_text
from orbit_api.models import BizApplication, BizAutomation, BizHiringTask, BizJob, BizNotification

router = APIRouter(prefix="/v1/business/companies/{company_id}", tags=["business automations"])
_writes = ratelimit.SlidingWindow(rate_per_s=60 / 3600, burst=60)
Db = Annotated[AsyncSession, Depends(get_db)]


class RecipeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=0)
    recipe: automation.Recipe


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    title: str = Field(min_length=5, max_length=180)
    due_at: AwareDatetime
    assignee_id: str | None = Field(None, max_length=36)


class TaskAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=1)
    action: Literal["done", "snooze", "reopen", "assign"]
    assignee_id: str | None = Field(None, max_length=36)
    until: AwareDatetime | None = None
    note: str = Field(min_length=3, max_length=300)


def conflict() -> HTTPException:
    return HTTPException(409, "This changed in another tab. Refresh before saving.")


def active(app: BizApplication, job: BizJob) -> None:
    if app.status != "active" or app.deletion_requested_at or job.status != "open":
        raise HTTPException(409, "Tasks are paused because this application or job is no longer active.")


def notify_owner(db: AsyncSession, task: BizHiringTask) -> None:
    if task.assignee_id:
        db.add(BizNotification(company_id=task.company_id, application_id=task.application_id,
            user_id=task.assignee_id, kind="automation",
            text="A hiring follow-up was assigned to you. Open the shared task queue."))


async def owner_valid(db: AsyncSession, job: BizJob, user_id: str | None) -> None:
    if user_id is not None and user_id not in await automation.coordinators(db, job):
        raise HTTPException(422, "Choose a current coordinator who can access this job.")


@router.get("/automations")
async def settings(ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    jobs = list(await db.scalars(select(BizJob).where(BizJob.company_id == ctx.company.id)
        .order_by(BizJob.title, BizJob.id)))
    records = {r.job_id: r for r in await db.scalars(select(BizAutomation).where(
        BizAutomation.company_id == ctx.company.id))}
    items = []
    for job in jobs:
        if sees_job(ctx, job):
            items.append({"job_id": job.id, "title": job.title, "status": job.status,
                **automation.recipe_payload(records.get(job.id)), "owners": [
                    {"id": uid, "name": name} for uid, name in (await automation.coordinators(db, job)).items()]})
    return {"jobs": items, "interval_seconds": 300}


@router.put("/jobs/{job_id}/automation")
async def save(job_id: str, body: RecipeIn, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(job)
    await job_for(db, ctx, job_id)
    await owner_valid(db, job, body.recipe.default_assignee_id)
    row = await db.get(BizAutomation, job.id, populate_existing=True)
    if (row.revision if row else 0) != body.base_revision:
        raise conflict()
    if body.recipe.enabled and job.status != "open":
        raise HTTPException(409, "Open the job before enabling its automations.")
    ratelimit.check(_writes, f"biz-automation:{ctx.user.id}")
    if row is None:
        row = BizAutomation(company_id=ctx.company.id, job_id=job.id, revision=0, content={})
        db.add(row)
    row.content, row.revision = body.recipe.model_dump(), row.revision + 1
    audit(db, ctx.company.id, ctx.user, "automation.configured", job.title, job_id=job.id,
        revision=row.revision, recipe=row.content)
    counts = await automation.reconcile(db, ctx.company, job, row, datetime.now(UTC))
    await db.commit()
    return {**automation.recipe_payload(row), "changes": counts}


@router.get("/jobs/{job_id}/automation/preview")
async def preview(job_id: str, ctx: CompanyCtx, db: Db,
                  stalled_days: Annotated[int | None, Query(ge=0, le=90)] = 3,
                  question_hours: Annotated[int | None, Query(ge=0, le=168)] = 24,
                  feedback_hours: Annotated[int | None, Query(ge=0, le=168)] = 24,
                  assessment_hours: Annotated[int | None, Query(ge=0, le=168)] = 24) -> dict[str, Any]:
    ctx.require("move_applicants")
    job = await job_for(db, ctx, job_id)
    recipe = automation.Recipe(enabled=True, stalled_days=stalled_days or None, question_hours=question_hours or None,
        feedback_hours=feedback_hours or None, assessment_hours=assessment_hours or None)
    counts = dict.fromkeys(automation.TITLES, 0)
    cursor = ""
    while True:
        apps = list(await db.scalars(select(BizApplication).where(BizApplication.job_id == job.id,
            BizApplication.id > cursor).order_by(BizApplication.id).limit(200)))
        if not apps:
            break
        for pending in (await automation.signals(db, job, apps, recipe, datetime.now(UTC))).values():
            for kind, _deadline in pending.values():
                counts[kind] += 1
        cursor = apps[-1].id
    return {"counts": counts, "total": sum(counts.values()), "job_status": job.status,
        "description": "Current source conditions, including tasks already handled. Preview creates no tasks."}


@router.post("/jobs/{job_id}/automation/run")
async def run(job_id: str, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(job)
    await job_for(db, ctx, job_id)
    row = await db.get(BizAutomation, job.id, populate_existing=True)
    ratelimit.check(_writes, f"biz-automation:{ctx.user.id}")
    changes = await automation.reconcile(db, ctx.company, job, row, datetime.now(UTC))
    audit(db, ctx.company.id, ctx.user, "automation.run_requested", job.title, job_id=job.id, **changes)
    await db.commit()
    return {**automation.recipe_payload(row), "changes": changes}


def task_payload(task: BizHiringTask, app: BizApplication, job: BizJob, blind: bool) -> dict[str, Any]:
    return {"id": task.id, "application_id": app.id, "job_id": job.id, "job_title": job.title,
        "name": rules.candidate_label(app.reference) if blind else app.name, "reference": app.reference,
        "kind": task.kind,
        "title": rules.blind_text(task.title, app.name, app.email, app.phone) if blind else task.title,
        "status": task.status, "assignee_id": task.assignee_id,
        "due_at": aware(task.due_at).isoformat(), "snoozed_until": aware(task.snoozed_until).isoformat()
        if task.snoozed_until else None, "revision": task.revision, "resolution": task.resolution,
        "actionable": app.status == "active" and not app.deletion_requested_at and job.status == "open"}


@router.get("/hiring-tasks")
async def tasks(ctx: CompanyCtx, db: Db, status: Literal["open", "snoozed", "done", "resolved", "all"] = "open",
                mine: bool = False, job_id: str | None = None, after: str | None = None) -> dict[str, Any]:
    ctx.require("move_applicants")
    jobs = {j.id: j for j in await db.scalars(select(BizJob).where(BizJob.company_id == ctx.company.id))
        if sees_job(ctx, j)}
    if job_id and job_id not in jobs:
        raise HTTPException(404, "Not found.")
    scope = select(BizHiringTask).where(BizHiringTask.company_id == ctx.company.id,
        BizHiringTask.job_id.in_([job_id] if job_id else list(jobs)))
    if mine:
        scope = scope.where(BizHiringTask.assignee_id == ctx.user.id)
    grouped = {state: count for state, count in (await db.execute(select(BizHiringTask.status, func.count()).where(
        BizHiringTask.id.in_(scope.with_only_columns(BizHiringTask.id))).group_by(BizHiringTask.status))).all()}
    current = datetime.now(UTC)
    overdue = await db.scalar(select(func.count()).select_from(BizHiringTask).where(
        BizHiringTask.id.in_(scope.with_only_columns(BizHiringTask.id)),
        BizHiringTask.status == "open", BizHiringTask.due_at < current))
    query = scope if status == "all" else scope.where(BizHiringTask.status == status)
    if after:
        cursor = await db.scalar(query.where(BizHiringTask.id == after))
        if cursor is None:
            raise HTTPException(404, "Task page not found. Refresh the queue.")
        query = query.where(or_(BizHiringTask.due_at > cursor.due_at,
            and_(BizHiringTask.due_at == cursor.due_at, BizHiringTask.id > cursor.id)))
    rows = list(await db.scalars(query.order_by(BizHiringTask.due_at, BizHiringTask.id).limit(51)))
    apps = {a.id: a for a in await db.scalars(select(BizApplication).where(
        BizApplication.id.in_([t.application_id for t in rows[:50]])))}
    return {"items": [task_payload(t, apps[t.application_id], jobs[t.job_id], ctx.company.blind_review)
        for t in rows[:50]], "next_after": rows[49].id if len(rows) > 50 else None,
        "counts": grouped, "overdue": overdue or 0, "as_of": current.isoformat()}


@router.post("/applications/{application_id}/hiring-tasks")
async def create_task(application_id: str, body: TaskIn, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    await db.refresh(job)
    await application_for(db, ctx, application_id)
    key = str(body.request_id)
    title = sanitize_text(body.title).strip()
    if len(title) < 5:
        raise HTTPException(422, "Give the task a clear title.")
    task = await db.scalar(select(BizHiringTask).where(BizHiringTask.application_id == app.id,
        BizHiringTask.source_key == key))
    if task:
        if task.title != title or aware(task.due_at) != body.due_at or task.assignee_id != body.assignee_id:
            raise conflict()
        return task_payload(task, app, job, ctx.company.blind_review)
    active(app, job)
    now = datetime.now(UTC)
    if not now - timedelta(minutes=5) <= body.due_at <= now + timedelta(days=365):
        raise HTTPException(422, "Choose a due time within the next year.")
    await owner_valid(db, job, body.assignee_id)
    ratelimit.check(_writes, f"biz-task:{ctx.user.id}")
    task = BizHiringTask(company_id=ctx.company.id, application_id=app.id, job_id=job.id,
        source_key=key, kind="manual", title=title, due_at=body.due_at, assignee_id=body.assignee_id,
        status="open", revision=1)
    db.add(task)
    # Manual-only roles also participate in background lifecycle cleanup.
    if await db.get(BizAutomation, job.id) is None:
        db.add(BizAutomation(company_id=ctx.company.id, job_id=job.id, revision=0,
            content=automation.Recipe().model_dump()))
    await db.flush()
    notify_owner(db, task)
    timeline(db, app, "hiring_task_created", ctx.user, task_id=task.id, title=title)
    audit(db, ctx.company.id, ctx.user, "automation.manual_task_created", task.id, job_id=job.id)
    await db.commit()
    return task_payload(task, app, job, ctx.company.blind_review)


@router.post("/hiring-tasks/{task_id}")
async def update_task(task_id: str, body: TaskAction, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    task = await db.get(BizHiringTask, task_id)
    if task is None or task.company_id != ctx.company.id:
        raise HTTPException(404, "Not found.")
    app, job = await application_for(db, ctx, task.application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(task)
    await db.refresh(app)
    await db.refresh(job)
    await application_for(db, ctx, app.id)
    active(app, job)
    if task.revision != body.base_revision:
        raise conflict()
    note = sanitize_text(body.note).strip()
    if len(note) < 3:
        raise HTTPException(422, "Add a short reason for the audit trail.")
    if task.status == "resolved":
        raise HTTPException(409, "The source condition has cleared. Create a new task for new work.")
    if body.action == "assign":
        await owner_valid(db, job, body.assignee_id)
        previous_owner = task.assignee_id
        task.assignee_id = body.assignee_id
        if task.assignee_id != previous_owner:
            notify_owner(db, task)
    elif body.action == "snooze":
        now = datetime.now(UTC)
        if body.until is None or not now < body.until <= now + timedelta(days=30):
            raise HTTPException(422, "Snooze until a time within the next 30 days.")
        task.status, task.snoozed_until = "snoozed", body.until
    else:
        task.status = "done" if body.action == "done" else "open"
        task.snoozed_until = None
    ratelimit.check(_writes, f"biz-task:{ctx.user.id}")
    task.revision += 1
    timeline(db, app, "hiring_task_updated", ctx.user, task_id=task.id, action=body.action,
        note=note, assignee_id=task.assignee_id)
    audit(db, ctx.company.id, ctx.user, "automation.task_updated", task.id, job_id=job.id,
        task_action=body.action, note=note, assignee_id=task.assignee_id)
    await db.commit()
    return task_payload(task, app, job, ctx.company.blind_review)
