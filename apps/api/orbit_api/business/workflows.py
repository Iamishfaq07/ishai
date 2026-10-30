"""Role-scoped, human-executed playbooks. AI proposes drafts; no external tools or hiring actions execute."""

import copy
import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from orbit_api.business.access import CompanyCtx, Ctx, audit, job_for, sees_job
from orbit_api.business.automation import coordinators
from orbit_api.business.hiring import aware
from orbit_api.business.hiring_schema import Contract, Id, RequestId
from orbit_api.business.knowledge import fresh_context
from orbit_api.db import get_db
from orbit_api.models import BizJob, BizWorkflowPlan, BizWorkflowRun
from orbit_api.ratelimit import limit_user
from orbit_api.workflow_advice import INSTRUCTION, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

router = APIRouter(
    prefix="/v1/business/companies/{company_id}/workflow-studio",
    tags=["business workflow studio"],
    dependencies=[Depends(limit_user("business-workflows", rate_per_s=3, burst=30))],
)
Db = Annotated[AsyncSession, Depends(get_db)]
Workspace = Literal["pipeline", "interview-plan", "hiring-desk", "capacity", "experience"]


class Step(Contract):
    id: Id
    title: str = Field(min_length=5, max_length=100)
    instruction: str = Field(min_length=10, max_length=600)
    days: int = Field(0, ge=0, le=60, strict=True)
    depends_on: list[Id] = Field(default_factory=list, max_length=6)
    workspace: Workspace = "pipeline"
    approval: bool = Field(False, strict=True)


class Plan(Contract):
    title: str = Field(min_length=5, max_length=120)
    steps: list[Step] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def dag(self) -> "Plan":
        ids = {s.id for s in self.steps}
        if len(ids) != len(self.steps):
            raise ValueError("Each step needs a unique identifier.")
        done: set[str] = set()
        for step in self.steps:
            if len(set(step.depends_on)) != len(step.depends_on) or any(d not in done for d in step.depends_on):
                raise ValueError(
                    "Dependencies must refer to distinct earlier steps; cycles and forward links are not allowed."
                )
            if any(step.days < s.days for s in self.steps if s.id in step.depends_on):
                raise ValueError("A step cannot be due before a prerequisite.")
            done.add(step.id)
        return self


class SaveIn(Contract):
    base_revision: int = Field(ge=0, strict=True)
    plan: Plan
    source_version: str = Field(pattern=r"^[a-f0-9]{64}$")


class StartIn(Contract):
    request_id: RequestId
    base_revision: int = Field(ge=1, strict=True)
    start_date: str = Field(min_length=10, max_length=10)
    default_owner_id: str | None = Field(None, max_length=36)

    @field_validator("start_date")
    @classmethod
    def iso(cls, value: str) -> str:
        parsed = date.fromisoformat(value)
        if parsed > date.max - timedelta(days=60):
            raise ValueError("Choose a start date that leaves room for the playbook due dates.")
        if parsed.isoformat() != value:
            raise ValueError("Use YYYY-MM-DD.")
        return value


class ActionIn(Contract):
    base_revision: int = Field(ge=1, strict=True)
    action: Literal["done", "reopen", "assign"]
    owner_id: str | None = Field(None, max_length=36)
    note: str = Field(min_length=3, max_length=300)


class RevisionIn(Contract):
    base_revision: int = Field(ge=1, strict=True)


def version(data: Any) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


def templates() -> list[dict[str, Any]]:
    definitions = [
        (
            "launch",
            "Role launch",
            [
                (
                    "scope",
                    "Confirm the role brief",
                    "Review job-related requirements and the approved hiring scope.",
                    0,
                    [],
                    "pipeline",
                ),
                (
                    "criteria",
                    "Prepare interview criteria",
                    "Save consistent, job-related questions and evidence standards.",
                    1,
                    ["scope"],
                    "interview-plan",
                ),
                (
                    "panel",
                    "Coordinate the hiring team",
                    "Confirm panel responsibilities and scheduling coverage with the team.",
                    1,
                    ["scope"],
                    "hiring-desk",
                ),
                (
                    "review",
                    "Review launch readiness",
                    "Review the saved plan and ownership before publishing through the job workspace.",
                    2,
                    ["criteria", "panel"],
                    "pipeline",
                ),
            ],
        ),
        (
            "interview",
            "Interview readiness",
            [
                (
                    "criteria",
                    "Review assessment criteria",
                    "Check that questions and evidence standards relate to the role.",
                    0,
                    [],
                    "interview-plan",
                ),
                (
                    "panel",
                    "Confirm panel coverage",
                    "Review available coordinators and discuss workload before offering interview times.",
                    1,
                    ["criteria"],
                    "hiring-desk",
                ),
                (
                    "process",
                    "Prepare candidate guidance",
                    "Review next-step guidance and the process candidates can expect.",
                    2,
                    ["panel"],
                    "pipeline",
                ),
            ],
        ),
        (
            "improvement",
            "Hiring process improvement",
            [
                (
                    "listen",
                    "Review process feedback",
                    "Read released aggregate experience feedback where available; do not infer individual responses.",
                    0,
                    [],
                    "experience",
                ),
                (
                    "capacity",
                    "Review delivery capacity",
                    "Review approved hiring capacity and discuss any delivery constraints.",
                    1,
                    ["listen"],
                    "capacity",
                ),
                (
                    "experiment",
                    "Agree one process experiment",
                    "Agree an owner, a small process change and a date to review its effect.",
                    3,
                    ["capacity"],
                    "pipeline",
                ),
            ],
        ),
    ]
    result: list[dict[str, Any]] = [
        {
            "id": key,
            "plan": Plan(
                title=title,
                steps=[
                    Step(id=i, title=t, instruction=n, days=d, depends_on=deps, workspace=w)
                    for i, t, n, d, deps, w in rows
                ],
            ).model_dump(),
        }
        for key, title, rows in definitions
    ]
    checkpoint = copy.deepcopy(result[0]["plan"])
    checkpoint["title"] = "Independent launch review"
    checkpoint["steps"][-1]["approval"] = True
    result.append({"id": "approval", "plan": checkpoint})
    return result


async def context(db: AsyncSession, ctx: Ctx, *, write: bool = False) -> Ctx:
    if write:
        ctx = await fresh_context(db, ctx)
    ctx.require("move_applicants")
    ctx.writable()
    return ctx


def facts(job: BizJob) -> list[dict[str, str]]:
    return [{"id": "role", "text": f"Role: {job.title[:160]}"}] + [
        {"id": f"requirement-{i}", "text": f"Saved requirement: {text[:300]}"}
        for i, text in enumerate((job.must_haves or [])[:6])
    ]


async def workspace(db: AsyncSession, ctx: Ctx, jid: str) -> dict[str, Any]:
    job = await job_for(db, ctx, jid)
    row = await db.get(BizWorkflowPlan, jid, populate_existing=True)
    owners = await coordinators(db, job)
    data = {
        "job": {"id": jid, "title": job.title, "status": job.status},
        "revision": row.revision if row else 0,
        "plan": row.content if row else None,
        "owners": [{"id": k, "name": v} for k, v in sorted(owners.items())],
        "facts": facts(job),
    }
    data["version"] = version(data)
    runs = await db.scalars(
        select(BizWorkflowRun)
        .where(BizWorkflowRun.job_id == jid, BizWorkflowRun.company_id == ctx.company.id)
        .order_by(BizWorkflowRun.created_at.desc(), BizWorkflowRun.id)
        .limit(100)
    )
    data["runs"] = [
        {
            "id": r.id,
            "title": r.content["title"],
            "status": r.status,
            "revision": r.revision,
            "created_at": aware(r.created_at),
        }
        for r in runs
    ]
    return data


def check(actual: int | str, expected: int | str) -> None:
    if actual != expected:
        raise HTTPException(409, "This workflow changed. Download your draft and refresh before continuing.")


@router.get("")
async def index(ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx)
    query = (
        select(BizJob)
        .options(load_only(BizJob.id, BizJob.title, BizJob.status, BizJob.hiring_team, BizJob.created_at))
        .where(BizJob.company_id == ctx.company.id)
        .order_by(BizJob.created_at.desc(), BizJob.id)
    )
    if ctx.can("all_jobs"):
        query = query.limit(201)
    visible = []
    async for job in await db.stream_scalars(query):
        if sees_job(ctx, job):
            visible.append(job)
            if len(visible) == 201:
                break
    return {
        "jobs": [{"id": j.id, "title": j.title, "status": j.status} for j in visible[:200]],
        "truncated": len(visible) > 200,
        "templates": templates(),
    }


@router.get("/{jid}")
async def get_workspace(jid: str, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx)
    return await workspace(db, ctx, jid)


@router.put("/{jid}/plan")
async def save(jid: str, body: SaveIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    current = await workspace(db, ctx, jid)
    check(current["version"], body.source_version)
    check(current["revision"], body.base_revision)
    row = await db.get(BizWorkflowPlan, jid)
    if row is None:
        row = BizWorkflowPlan(job_id=jid, revision=0, content={})
        db.add(row)
    row.content, row.revision = body.plan.model_dump(), row.revision + 1
    audit(db, ctx.company.id, ctx.user, "workflow.plan_saved", jid, revision=row.revision, steps=len(body.plan.steps))
    await db.commit()
    return await workspace(db, ctx, jid)


@router.post("/{jid}/draft")
async def draft(jid: str, body: AdviceIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    current = await workspace(db, ctx, jid)
    check(current["version"], body.version)

    def validate(raw: Any) -> Plan:
        if not isinstance(raw, dict) or set(raw) != {"plan", "sources"}:
            raise ValueError("Use the workflow draft schema.")
        plan = Plan.model_validate(raw["plan"])
        if any(s.approval for s in plan.steps):
            raise ValueError("Approval policy must be chosen by the team, not an AI draft.")
        allowed = {f["id"]: f["text"] for f in current["facts"]}
        sources = raw["sources"]
        if not isinstance(sources, list) or len(sources) != len(plan.steps):
            raise ValueError("Cite every step.")
        by_id = {s["step_id"]: s for s in sources if isinstance(s, dict) and set(s) == {"step_id", "fact_id", "quote"}}
        if set(by_id) != {s.id for s in plan.steps}:
            raise ValueError("Cite each step once.")
        for source in by_id.values():
            if (
                not isinstance(source["quote"], str)
                or len(source["quote"]) < 4
                or source["quote"] not in allowed.get(source["fact_id"], "")
            ):
                raise ValueError("Use an exact supplied quote.")
        return plan

    instruction = (
        "Draft a small, human-executed hiring operations checklist, not candidate assessments. "
        'Return JSON {"plan":{"title":"...","steps":[{"id":"brief","title":"...","instruction":"...",'
        '"days":0,"depends_on":[],"workspace":"pipeline"}]},"sources":[{"step_id":"brief",'
        '"fact_id":"role","quote":"exact supplied substring"}]}. Use 3–6 steps ordered so prerequisites come first. '
        "IDs are lowercase letters/numbers/underscores. Titles 5–100 chars, instructions 10–600 chars, days 0–60. "
        "Each dependency must be an earlier step and have a due day no later than this step. Workspace must be "
        "pipeline, interview-plan, hiring-desk, capacity or experience. Cite every step. No owners, links, code, "
        "messages, candidate scoring, protected-trait screening or automatic hiring actions. Never claim execution."
    )
    # Preserve validated citations alongside the draft by validating twice against one captured response.
    captured: dict[str, Any] = {}

    def capture(raw: Any) -> Plan:
        plan = validate(raw)
        captured["sources"] = raw["sources"]
        return plan

    result, provider = await preview(
        db,
        ctx.user,
        "business_workflow_draft",
        instruction,
        json.dumps({"facts": current["facts"]}),
        capture,
        ctx.company.id,
    )
    ctx = await context(db, ctx, write=True)
    check((await workspace(db, ctx, jid))["version"], body.version)
    return {
        "plan": result.model_dump(),
        "sources": captured["sources"],
        "version": body.version,
        "source": "mock" if provider == "mock" else "ai",
    }


@router.post("/{jid}/runs", status_code=201)
async def start(jid: str, body: StartIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    job = await job_for(db, ctx, jid)
    if job.status == "closed" or job.taken_down_reason:
        raise HTTPException(409, "Reopen an available job before starting a workflow.")
    existing = await db.get(BizWorkflowRun, body.request_id)
    if existing:
        if (
            existing.company_id != ctx.company.id
            or existing.job_id != jid
            or existing.request_sha256 != version(body.model_dump(exclude={"request_id"}))
        ):
            raise HTTPException(409, "This start request was already used for another workflow.")
        return await run_data(db, ctx, jid, existing.id)
    row = await db.get(BizWorkflowPlan, jid)
    if row is None:
        raise HTTPException(409, "Save a playbook before starting a run.")
    check(row.revision, body.base_revision)
    owners = await coordinators(db, job)
    if body.default_owner_id is not None and body.default_owner_id not in owners:
        raise HTTPException(422, "Choose a current coordinator who can access this role.")
    count = await db.scalar(select(func.count()).select_from(BizWorkflowRun).where(BizWorkflowRun.job_id == jid))
    active = await db.scalar(
        select(func.count())
        .select_from(BizWorkflowRun)
        .where(BizWorkflowRun.job_id == jid, BizWorkflowRun.status == "active")
    )
    if (count or 0) >= 100 or (active or 0) >= 20:
        raise HTTPException(409, "Keep at most 20 active and 100 total runs per job. Close or remove older runs first.")
    plan = Plan.model_validate(row.content)
    run = BizWorkflowRun(
        id=body.request_id,
        request_sha256=version(body.model_dump(exclude={"request_id"})),
        company_id=ctx.company.id,
        job_id=jid,
        plan_revision=row.revision,
        start_date=body.start_date,
        content=plan.model_dump(),
        tasks={
            s.id: {
                "state": "pending",
                "owner_id": body.default_owner_id,
                "note": "",
                "completed_at": None,
                "completed_by": None,
            }
            for s in plan.steps
        },
    )
    db.add(run)
    await db.flush()
    audit(db, ctx.company.id, ctx.user, "workflow.started", jid, run_id=run.id, plan_revision=row.revision)
    await db.commit()
    return await run_data(db, ctx, jid, run.id)


async def run_for(db: AsyncSession, ctx: Ctx, jid: str, rid: str) -> BizWorkflowRun:
    await job_for(db, ctx, jid)
    row = await db.get(BizWorkflowRun, rid, populate_existing=True)
    if row is None or row.company_id != ctx.company.id or row.job_id != jid:
        raise HTTPException(404, "Workflow run not found.")
    return row


async def run_data(db: AsyncSession, ctx: Ctx, jid: str, rid: str) -> dict[str, Any]:
    row = await run_for(db, ctx, jid, rid)
    job = await job_for(db, ctx, jid)
    owners = await coordinators(db, job)
    plan = Plan.model_validate(row.content)
    from orbit_api.business.workflow_reviews import payloads

    reviews = await payloads(db, row, ctx, owners)
    today = datetime.now(UTC).date()
    steps = []
    for step in plan.steps:
        task = row.tasks[step.id]
        blocked = any(row.tasks[d]["state"] != "done" for d in step.depends_on)
        due = date.fromisoformat(row.start_date) + timedelta(days=step.days)
        path = {
            "pipeline": f"jobs/{jid}",
            "interview-plan": f"jobs/{jid}/interview-plan",
            "hiring-desk": "hiring-desk",
            "capacity": "capacity",
            "experience": f"experience?job={jid}",
        }[step.workspace]
        steps.append(
            {
                **step.model_dump(),
                **task,
                "blocked": blocked,
                "due_date": due.isoformat(),
                "overdue": task["state"] != "done" and due < today,
                "owner_current": task["owner_id"] in owners,
                "path": f"/business/app/{ctx.company.id}/{path}",
                "review": reviews.get(step.id),
            }
        )
    counts = {
        "total": len(steps),
        "done": sum(s["state"] == "done" for s in steps),
        "ready": sum(s["state"] != "done" and not s["blocked"] for s in steps),
        "blocked": sum(s["state"] != "done" and s["blocked"] for s in steps),
        "overdue": sum(s["overdue"] for s in steps),
        "unassigned": sum(s["state"] != "done" and not s["owner_current"] for s in steps),
    }
    facts = [
        {"id": key, "text": f"Workflow {key}: {value} of {counts['total']} steps."}
        for key, value in counts.items()
        if key != "total"
    ]
    review_counts = {
        "checkpoints": sum(s.approval for s in plan.steps),
        "pending": sum(r["status"] == "pending" and r["valid"] for r in reviews.values()),
        "changes_requested": sum(r["status"] == "changes_requested" and r["valid"] for r in reviews.values()),
        "overdue": sum(r["overdue"] for r in reviews.values()),
        "snoozed": sum(
            bool(
                r["status"] == "pending"
                and r["valid"]
                and r["snoozed_until"]
                and aware(r["snoozed_until"]) > datetime.now(UTC)
            )
            for r in reviews.values()
        ),
    }
    if review_counts["checkpoints"]:
        facts.insert(
            0,
            {
                "id": "reviews",
                "text": f"Workflow approval checkpoints: {review_counts['checkpoints']}; "
                f"pending reviews: {review_counts['pending']}; "
                f"changes requested: {review_counts['changes_requested']}; "
                f"overdue reviews: {review_counts['overdue']}; paused reminders: {review_counts['snoozed']}.",
            },
        )
    data = {
        "id": row.id,
        "job_id": jid,
        "title": plan.title,
        "revision": row.revision,
        "status": row.status,
        "start_date": row.start_date,
        "plan_revision": row.plan_revision,
        "steps": steps,
        "counts": counts,
        "reviews": review_counts,
        "owners": [{"id": k, "name": v} for k, v in sorted(owners.items())],
        "facts": facts,
    }
    data["version"] = version(data)
    return data


@router.get("/{jid}/runs/{rid}")
async def get_run(jid: str, rid: str, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx)
    return await run_data(db, ctx, jid, rid)


@router.post("/{jid}/runs/{rid}/steps/{sid}")
async def action(jid: str, rid: str, sid: str, body: ActionIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    check(row.revision, body.base_revision)
    if row.status == "cancelled":
        raise HTTPException(409, "Cancelled runs cannot be edited.")
    plan = Plan.model_validate(row.content)
    step = next((s for s in plan.steps if s.id == sid), None)
    if step is None:
        raise HTTPException(404, "Step not found.")
    from orbit_api.business.workflow_reviews import guard_dependents, invalidate

    await guard_dependents(db, row, sid)
    current_review = (await run_data(db, ctx, jid, rid))["steps"]
    review = next(s["review"] for s in current_review if s["id"] == sid)
    if step.approval and body.action == "done":
        raise HTTPException(409, "This checkpoint requires an independent review decision.")
    if (
        step.approval
        and body.action == "assign"
        and (row.tasks[sid]["state"] == "done" or (review and review["status"] == "pending" and review["valid"]))
    ):
        raise HTTPException(409, "Withdraw or reopen the checkpoint before changing its owner.")
    tasks = copy.deepcopy(row.tasks)
    if body.action == "done":
        if tasks[sid]["state"] == "done":
            raise HTTPException(409, "This step is already complete. Refresh the run.")
        if any(tasks[d]["state"] != "done" for d in step.depends_on):
            raise HTTPException(409, "Complete the prerequisite steps first.")
        tasks[sid].update(state="done", completed_at=datetime.now(UTC).isoformat(), completed_by=ctx.user.id)
    elif body.action == "reopen":
        if tasks[sid]["state"] != "done":
            raise HTTPException(409, "This step is already pending. Refresh the run.")
        if any(tasks[s.id]["state"] == "done" for s in plan.steps if sid in s.depends_on):
            raise HTTPException(409, "Reopen completed dependent steps first.")
        if step.approval:
            await invalidate(db, row, sid, "checkpoint_reopened")
        tasks[sid].update(state="pending", completed_at=None, completed_by=None)
    else:
        job = await job_for(db, ctx, jid)
        if body.owner_id is not None and body.owner_id not in await coordinators(db, job):
            raise HTTPException(422, "Choose a current coordinator who can access this role.")
        tasks[sid]["owner_id"] = body.owner_id
    tasks[sid]["note"] = body.note
    row.tasks, row.revision = tasks, row.revision + 1
    row.status = "completed" if all(t["state"] == "done" for t in tasks.values()) else "active"
    audit(db, ctx.company.id, ctx.user, "workflow.step_updated", jid, run_id=rid, step_id=sid, action_type=body.action)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.post("/{jid}/runs/{rid}/cancel")
async def cancel(jid: str, rid: str, body: RevisionIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    row = await run_for(db, ctx, jid, rid)
    check(row.revision, body.base_revision)
    from orbit_api.business.workflow_reviews import invalidate

    await invalidate(db, row, None, "run_cancelled")
    row.status, row.revision = "cancelled", row.revision + 1
    audit(db, ctx.company.id, ctx.user, "workflow.cancelled", jid, run_id=rid)
    await db.commit()
    return await run_data(db, ctx, jid, rid)


@router.delete("/{jid}/runs/{rid}", status_code=204)
async def remove(jid: str, rid: str, ctx: CompanyCtx, db: Db) -> None:
    ctx = await context(db, ctx, write=True)
    ctx.require("manage_company")
    row = await run_for(db, ctx, jid, rid)
    if row.status == "active":
        raise HTTPException(409, "Cancel or complete this run before deleting it.")
    await db.delete(row)
    audit(db, ctx.company.id, ctx.user, "workflow.deleted", jid, run_id=rid)
    await db.commit()


@router.post("/{jid}/runs/{rid}/brief")
async def brief(jid: str, rid: str, body: AdviceIn, ctx: CompanyCtx, db: Db) -> Any:
    ctx = await context(db, ctx, write=True)
    current = await run_data(db, ctx, jid, rid)
    check(current["version"], body.version)
    result, provider = await preview(
        db,
        ctx.user,
        "business_workflow_brief",
        INSTRUCTION
        + "Review aggregate internal checklist progress only. Do not infer hiring quality or completed hiring actions. "
        "Never approve or reject checkpoints or imply review authority; recommend human evidence review only.",
        json.dumps({"facts": current["facts"]}),
        lambda raw: validate_advice(raw, current["facts"]),
        ctx.company.id,
    )
    ctx = await context(db, ctx, write=True)
    check((await run_data(db, ctx, jid, rid))["version"], body.version)
    return {"version": body.version, "source": "mock" if provider == "mock" else "ai", **result.model_dump()}
