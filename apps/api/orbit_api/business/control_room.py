"""Operational signals, not candidate scores. Every query follows the caller's job scope."""
import hashlib
import json
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business.access import CompanyCtx, Ctx, company_ctx, forbidden, sees_job
from orbit_api.business.hiring import aware
from orbit_api.business.scheduling import panel as scheduled_panel
from orbit_api.db import get_db
from orbit_api.models import (
    BizApplication,
    BizAutomation,
    BizHiringPlan,
    BizHiringTask,
    BizInterview,
    BizJob,
    BizMember,
    User,
)
from orbit_api.workflow_advice import INSTRUCTION, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

router = APIRouter(prefix="/v1/business/companies/{company_id}/control-room", tags=["business operations"])


async def snapshot(db: AsyncSession, ctx: Ctx, now: datetime | None = None) -> dict[str, Any]:
    if ctx.role == "interviewer":
        raise forbidden("The control room is available to recruiting coordinators and assigned hiring managers.")
    now = now or datetime.now(UTC)
    query = select(BizJob).where(BizJob.company_id == ctx.company.id,
        BizJob.status.in_(("open", "draft", "paused"))).order_by(BizJob.created_at.desc(), BizJob.id)
    # Filter in SQL before the cap so a hiring manager's jobs cannot be crowded out by other teams.
    if not ctx.can("all_jobs"):
        rows = await db.scalars(query.execution_options(populate_existing=True))
        jobs = [j for j in rows if sees_job(ctx, j)]
    else:
        jobs = list(await db.scalars(query.limit(201).execution_options(populate_existing=True)))
    truncated, jobs = len(jobs) > 200, jobs[:200]
    ids = [j.id for j in jobs]
    plans = {p.job_id: p for p in await db.scalars(select(BizHiringPlan).where(BizHiringPlan.job_id.in_(ids))
        .execution_options(populate_existing=True))}
    recipes = {r.job_id: r for r in await db.scalars(select(BizAutomation).where(BizAutomation.job_id.in_(ids))
        .execution_options(populate_existing=True))}
    cutoff = now - timedelta(days=3)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for jid, sid, count, stalled, oldest in await db.execute(select(BizApplication.job_id, BizApplication.stage_id,
            func.count(), func.sum(case((BizApplication.stage_changed_at <= cutoff, 1), else_=0)),
            func.min(BizApplication.stage_changed_at)).where(BizApplication.company_id == ctx.company.id,
            BizApplication.job_id.in_(ids), BizApplication.status == "active",
            BizApplication.email_confirmed_at.is_not(None), BizApplication.deletion_requested_at.is_(None))
            .group_by(BizApplication.job_id, BizApplication.stage_id)):
        groups[jid].append({"stage_id": sid, "active": count, "stalled": int(stalled or 0),
                           "oldest_days": max(0, (now - aware(oldest)).days) if oldest else 0})
    roles = []
    facts = []
    for job in jobs:
        base = f"/business/app/{ctx.company.id}/jobs/{job.id}"
        checks = [
            {"id": "verification", "label": "Company verified", "ready": ctx.company.verified_at is not None,
             "path": f"/business/app/{ctx.company.id}/verify"},
            {"id": "requirements", "label": "Must-have requirements saved", "ready": bool(job.must_haves),
             "path": base + "/edit"},
            {"id": "plan", "label": "Interview criteria saved", "ready": bool(
                job.id in plans and plans[job.id].content.get("criteria")), "path": base + "/interview-plan"},
            {"id": "automation", "label": "Optional playbook enabled", "ready": bool(
                job.id in recipes and recipes[job.id].content.get("enabled")),
             "path": f"/business/app/{ctx.company.id}/automations"},
        ]
        names = {s["id"]: s["name"] for s in job.stages}
        stages = [{**g, "name": names.get(g["stage_id"], "Previous stage")}
                  for g in sorted(groups[job.id], key=lambda x: x["stage_id"])]
        active, stalled = sum(s["active"] for s in stages), sum(s["stalled"] for s in stages)
        roles.append({"id": job.id, "title": job.title, "status": job.status, "path": base,
            "checks": checks, "active": active, "stalled": stalled, "stages": stages})
        facts.append({"id": f"job:{job.id}", "label": job.title, "path": base,
            "text": f"{job.title}: {active} active confirmed applications; {stalled} in a stage for at least 3 days; "
                    f"{sum(not c['ready'] for c in checks)} setup suggestions outstanding."})
    # Latest interview per application, including a newer unbooked/cancelled offer of times.
    ranked = select(BizInterview.id.label("id"), func.row_number().over(
        partition_by=BizInterview.application_id,
        order_by=(BizInterview.created_at.desc(), BizInterview.id.desc())).label("n")).where(
        BizInterview.company_id == ctx.company.id).subquery()
    bookings = (await db.execute(select(BizInterview, BizApplication.interviewers).join(
        ranked, ranked.c.id == BizInterview.id).join(BizApplication,
        BizApplication.id == BizInterview.application_id).where(ranked.c.n == 1,
        BizApplication.job_id.in_(ids), BizApplication.status == "active",
        BizApplication.email_confirmed_at.is_not(None), BizApplication.deletion_requested_at.is_(None),
        BizInterview.chosen >= now, BizInterview.chosen < now + timedelta(days=7)))).all()
    members = {u.id: u.name or "Team member" for u in await db.scalars(select(User).join(
        BizMember, BizMember.user_id == User.id).where(BizMember.company_id == ctx.company.id,
                                                     User.suspended_at.is_(None)))}
    minutes: Counter[str] = Counter()
    interviews: Counter[str] = Counter()
    unassigned = 0
    for interview, assigned in bookings:
        panel = scheduled_panel(interview, assigned or [])
        valid = set(panel) & members.keys()
        if not valid:
            unassigned += 1
        for member in valid:
            minutes[member] += interview.duration_min
            interviews[member] += 1
    capacity = [{"id": member, "name": members[member], "interviews": interviews[member], "minutes": minutes[member]}
        for member in sorted(minutes, key=lambda m: (-minutes[m], m))]
    task_counts = {status: count for status, count in await db.execute(select(BizHiringTask.status, func.count()).where(
        BizHiringTask.company_id == ctx.company.id, BizHiringTask.job_id.in_(ids),
        BizHiringTask.status.in_(("open", "snoozed"))).group_by(BizHiringTask.status))}
    facts.insert(0, {"id": "operations", "label": "Hiring operations",
        "path": f"/business/app/{ctx.company.id}/automations",
        "text": f"{len(bookings)} booked interviews in seven days; {unassigned} without an active assigned panel; "
                f"{task_counts.get('open', 0)} open internal follow-up tasks in the selected jobs."})
    result: dict[str, Any] = {"jobs": roles, "capacity": capacity, "booked_interviews": len(bookings),
        "unassigned_interviews": unassigned, "tasks": task_counts, "facts": facts, "truncated": truncated,
        "stalled_days": 3, "horizon_days": 7}
    result["version"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    result["as_of"] = now.isoformat()
    return result


@router.get("")
async def get_room(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await snapshot(db, ctx)


@router.post("/brief")
async def brief(body: AdviceIn, ctx: CompanyCtx,
                 db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    from orbit_api.business.access import lock_company

    ctx.writable()
    source = await snapshot(db, ctx)
    if body.version != source["version"]:
        raise HTTPException(409, "Hiring operations changed. Refresh before requesting advice.")
    facts = source["facts"][:20]
    await lock_company(db, ctx.company.id)
    result, provider = await preview(db, ctx.user, "business_ops_brief", INSTRUCTION +
        'Help a recruiting coordinator improve process readiness, stage response times and panel workload. '
        'Only aggregate operational facts are supplied. Never recommend selecting, scoring, rejecting or hiring '
        'candidates. Do not judge employees from calendar load. Setup suggestions are not publishing requirements. '
        'Bookings are not completed interviews. Three-day aging uses elapsed calendar time, not business days.',
        json.dumps({"as_of": source["as_of"], "facts": facts}), lambda raw: validate_advice(raw, facts), ctx.company.id)
    cid, user = ctx.company.id, ctx.user
    db.expire_all()
    await db.refresh(user)
    fresh = await company_ctx(cid, user, db)
    fresh.writable()
    if (await snapshot(db, fresh))["version"] != source["version"]:
        raise HTTPException(409, "Hiring operations changed during generation. Refresh to continue.")
    return {"version": source["version"], **result.model_dump(), "source": "mock" if provider == "mock" else "ai"}
