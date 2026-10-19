"""Shared joining plans after an accepted offer or a human-confirmed hire.

Tasks and progress are append-only application events, deleted with the application.
Completion is an owner's report, never identity verification or a signed agreement.
"""
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import conversations, emails, hiring, offers
from orbit_api.business.access import CompanyCtx, application_for, audit, lock_company, timeline
from orbit_api.business.apply import _by_token
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.screening import _writes
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizCompany, BizEvent, User
from orbit_api.ratelimit import check

router = APIRouter(prefix="/v1/business/companies/{company_id}/applications/{application_id}/handoff",
    tags=["business joining plans"])
public_router = APIRouter(prefix="/v1/public/business/applications/{token}/handoff", tags=["candidate joining plans"])
KINDS = ("handoff_published", "handoff_task_added", "handoff_progress")


class TaskIn(Contract):
    title: str = Field(min_length=3, max_length=120)
    instructions: str = Field(min_length=12, max_length=2000)
    owner: Literal["team", "candidate"]
    due_date: date | None = None


class PlanIn(Contract):
    introduction: str = Field(min_length=20, max_length=3000)
    start_date: date
    tasks: list[TaskIn] = Field(min_length=1, max_length=12)
    request_id: RequestId


class AddTask(TaskIn):
    base_revision: int = Field(ge=1)
    request_id: RequestId


class Progress(Contract):
    status: Literal["todo", "blocked", "done"]
    note: str = Field("", max_length=1000)
    base_revision: int = Field(ge=0)
    request_id: RequestId

    @model_validator(mode="after")
    def explain_blocker(self) -> "Progress":
        if self.status != "done" and len(self.note) < 10:
            raise ValueError("Explain the blocker or what needs to happen next in at least 10 characters.")
        return self


async def records(db: AsyncSession, app: BizApplication) -> list[BizEvent]:
    return list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind.in_(KINDS)).order_by(BizEvent.created_at, BizEvent.id)))


def render(rows: list[BizEvent], *, mask: Callable[[str], str] = str) -> dict[str, Any] | None:
    published = next((e for e in rows if e.kind == "handoff_published"), None)
    if published is None:
        return None
    tasks = [{**t, "created_at": conversations.iso(published.created_at)} for t in published.data["tasks"]]
    additions = sorted((e for e in rows if e.kind == "handoff_task_added"), key=lambda e: e.data["revision"])
    tasks.extend({**e.data["task"], "created_at": conversations.iso(e.created_at)} for e in additions)
    for task in tasks:
        updates = sorted((e for e in rows if e.kind == "handoff_progress" and e.data["task_id"] == task["id"]),
            key=lambda e: e.data["revision"])
        task.update(status=updates[-1].data["status"] if updates else "todo",
            revision=updates[-1].data["revision"] if updates else 0,
            history=[{"id": e.id, "status": e.data["status"], "note": mask(e.data["note"]),
                "by": e.data["by"], "created_at": conversations.iso(e.created_at)} for e in reversed(updates)])
        task["title"], task["instructions"] = mask(task["title"]), mask(task["instructions"])
        # Dates use the employer's calendar, not the server's UTC date. No premature overdue verdict.
    return {"id": published.id, "introduction": mask(published.data["introduction"]),
        "start_date": published.data["start_date"], "created_at": conversations.iso(published.created_at),
        "revision": 1 + len(additions), "tasks": tasks,
        "completed": sum(t["status"] == "done" for t in tasks),
        "blocked": sum(t["status"] == "blocked" for t in tasks)}


def writable(app: BizApplication, company: BizCompany) -> bool:
    return (company.status == "active" and app.status in ("active", "hired")
        and app.deletion_requested_at is None and app.email_confirmed_at is not None)


async def view(db: AsyncSession, app: BizApplication, company: BizCompany, *,
               mask: Callable[[str], str] = str) -> dict[str, Any]:
    plan = render(await records(db, app), mask=mask)
    eligible = app.status == "hired" or ((await offers.state(db, app))["offer"] or {}).get("status") == "accepted"
    return {"plan": plan, "eligible": eligible, "accepting": writable(app, company) and eligible}


async def lock_write(db: AsyncSession, app: BizApplication, company: BizCompany) -> list[BizEvent]:
    await lock_company(db, company.id)
    await db.refresh(app)
    await db.refresh(company)
    if not writable(app, company):
        raise HTTPException(409, "This application is not collecting joining updates.")
    if app.status != "hired" and ((await offers.state(db, app))["offer"] or {}).get("status") != "accepted":
        raise HTTPException(409, "Joining updates require an accepted offer or a confirmed hire.")
    check(_writes, f"handoff:{app.id}")
    return await records(db, app)


def retry(rows: list[BizEvent], kind: str, content: dict[str, Any], request_id: str,
          actor: User | None) -> bool:
    previous = next((e for e in rows if e.data.get("request_id") == request_id), None)
    if previous is None:
        return False
    if previous.kind != kind or previous.actor_id != (actor.id if actor else None) or previous.data["input"] != content:
        raise HTTPException(409, "This request already saved a different joining update.")
    return True


@router.get("")
async def staff_get(application_id: str, ctx: CompanyCtx,
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    app, _ = await application_for(db, ctx, application_id)
    return await view(db, app, ctx.company, mask=lambda text: hiring.blind_text(ctx, app, text))


@router.post("")
async def publish(application_id: str, body: PlanIn, ctx: CompanyCtx,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    import uuid

    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    rows = await lock_write(db, app, ctx.company)
    content = body.model_dump(mode="json", exclude={"request_id"})
    if retry(rows, "handoff_published", content, body.request_id, ctx.user):
        return await staff_get(application_id, ctx, db)
    if render(rows) is not None or not (await view(db, app, ctx.company))["eligible"]:
        raise HTTPException(409, "Publish once after an accepted offer or a confirmed hire. Refresh the joining plan.")
    tasks = [{"id": str(uuid.uuid4()), **t.model_dump(mode="json")} for t in body.tasks]
    timeline(db, app, "handoff_published", ctx.user, input=content, request_id=body.request_id,
        introduction=body.introduction, start_date=body.start_date.isoformat(), tasks=tasks)
    audit(db, ctx.company.id, ctx.user, "hiring.handoff_published", app.reference)
    await db.commit()
    token = emails.status_token_for(app)
    if token:
        await emails.send_to_applicant(ctx.company, app, f"Your joining plan: {job.title}",
            f"The hiring team shared the next steps for joining. Read your plan on your private application page:\n"
            f"{emails.status_link(token)}", ctx.user.email)
    return await staff_get(application_id, ctx, db)


@router.post("/tasks")
async def add_task(application_id: str, body: AddTask, ctx: CompanyCtx,
                      db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    import uuid

    ctx.require("move_applicants")
    ctx.writable()
    app, _ = await application_for(db, ctx, application_id)
    rows = await lock_write(db, app, ctx.company)
    content = body.model_dump(mode="json", exclude={"request_id"})
    if retry(rows, "handoff_task_added", content, body.request_id, ctx.user):
        return await staff_get(application_id, ctx, db)
    plan = render(rows)
    if not plan or plan["revision"] != body.base_revision or len(plan["tasks"]) >= 20:
        raise HTTPException(409, "Refresh the joining plan. A plan can contain at most 20 tasks.")
    task = {"id": str(uuid.uuid4()), **body.model_dump(mode="json", exclude={"base_revision", "request_id"})}
    timeline(db, app, "handoff_task_added", ctx.user, input=content, request_id=body.request_id,
        task=task, revision=plan["revision"] + 1)
    audit(db, ctx.company.id, ctx.user, "hiring.handoff_task_added", app.reference, task_id=task["id"])
    await db.commit()
    return await staff_get(application_id, ctx, db)


async def update(db: AsyncSession, app: BizApplication, company: BizCompany, task_id: str,
                 body: Progress, actor: User | None) -> None:
    rows = await lock_write(db, app, company)
    content = {"task_id": task_id, **body.model_dump(exclude={"request_id"})}
    if retry(rows, "handoff_progress", content, body.request_id, actor):
        return
    plan = render(rows)
    task = next((t for t in plan["tasks"] if t["id"] == task_id), None) if plan else None
    if task is None:
        raise HTTPException(404, "Joining task not found.")
    owner = "team" if actor else "candidate"
    if task["owner"] != owner:
        raise HTTPException(403, "Only the task's owner can report its progress.")
    if task["revision"] != body.base_revision:
        raise HTTPException(409, "This task changed. Refresh before saving your update.")
    if sum(e.kind == "handoff_progress" for e in rows) >= 200:
        raise HTTPException(409, "This plan has reached its update limit. Contact the hiring team for next steps.")
    timeline(db, app, "handoff_progress", actor, input=content, request_id=body.request_id,
        task_id=task_id, status=body.status, note=body.note, by=owner, revision=task["revision"] + 1)
    if actor:
        audit(db, company.id, actor, "hiring.handoff_progress", app.reference, task_id=task_id)
    await db.commit()


@router.post("/tasks/{task_id}/progress")
async def staff_progress(application_id: str, task_id: str, body: Progress, ctx: CompanyCtx,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, _ = await application_for(db, ctx, application_id)
    await update(db, app, ctx.company, task_id, body, ctx.user)
    return await staff_get(application_id, ctx, db)


@public_router.get("")
async def candidate_get(token: str, request: Request,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, _, company = await _by_token(db, token, request)
    return await view(db, app, company)


@public_router.post("/tasks/{task_id}/progress")
async def candidate_progress(token: str, task_id: str, body: Progress, request: Request,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, _, company = await _by_token(db, token, request)
    await update(db, app, company, task_id, body, None)
    return await view(db, app, company)
