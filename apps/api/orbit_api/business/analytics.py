"""Basic hiring analytics: applicants per job and source, how far they get (each stage reached, in the job's order),
and how long until someone at the company first acts on an application."""

import statistics
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business.access import CompanyCtx, forbidden, job_for, sees_job
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizEvent, BizJob

router = APIRouter(prefix="/v1/business/companies/{company_id}", tags=["business"])


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


class FunnelStep(BaseModel):
    stage_id: str
    name: str
    reached: int
    rate: float


class JobAnalytics(BaseModel):
    job_id: str
    title: str
    applicants: int
    by_source: dict[str, int]
    funnel: list[FunnelStep]
    median_first_response_hours: float | None
    responded: int


class Daily(BaseModel):
    day: str
    count: int


class CompanyAnalytics(BaseModel):
    open_jobs: int
    applicants_total: int
    applicants_30d: int
    hired: int
    withdrawn: int
    median_first_response_hours: float | None
    by_source: dict[str, int]
    jobs: list[JobAnalytics]
    daily: list[Daily]


def _hours(apps: list[BizApplication]) -> list[float]:
    return [(_aware(a.first_response_at) - _aware(a.created_at)).total_seconds() / 3600
            for a in apps if a.first_response_at is not None]


async def job_analytics(db: AsyncSession, job: BizJob) -> JobAnalytics:
    apps = list((await db.scalars(select(BizApplication).where(BizApplication.job_id == job.id))).all())
    moves = (await db.execute(select(BizEvent.application_id, BizEvent.data).where(
        BizEvent.job_id == job.id, BizEvent.kind == "stage"))).all()
    return _job_analytics(job, apps, [(aid, data) for aid, data in moves])


def _job_analytics(job: BizJob, apps: list[BizApplication], moves: list[tuple[str, dict[str, Any]]]) -> JobAnalytics:
    order = {s["id"]: i for i, s in enumerate(job.stages) if s["kind"] != "rejected"}
    furthest: dict[str, int] = {a.id: order.get(a.stage_id, 0) for a in apps}
    for app_id, data in moves:
        idx = order.get(str((data or {}).get("to", "")))
        if app_id in furthest and idx is not None:
            furthest[app_id] = max(furthest[app_id], idx)
    total = len(apps)
    funnel: list[FunnelStep] = []
    for s in job.stages:
        if s["kind"] == "rejected":
            reached = sum(1 for a in apps if a.status == "rejected")
        else:
            reached = sum(1 for v in furthest.values() if v >= order[s["id"]])
        funnel.append(FunnelStep(stage_id=s["id"], name=s["name"], reached=reached,
                                 rate=round(reached / total, 3) if total else 0.0))
    hours = _hours(apps)
    return JobAnalytics(job_id=job.id, title=job.title, applicants=total,
                        by_source=dict(Counter(a.source for a in apps)), funnel=funnel,
                        median_first_response_hours=round(statistics.median(hours), 1) if hours else None,
                        responded=len(hours))


@router.get("/jobs/{job_id}/analytics", response_model=JobAnalytics)
async def get_job_analytics(job_id: str, ctx: CompanyCtx,
                            db: Annotated[AsyncSession, Depends(get_db)]) -> JobAnalytics:
    if ctx.role == "interviewer":
        raise forbidden()
    return await job_analytics(db, await job_for(db, ctx, job_id))


@router.get("/analytics", response_model=CompanyAnalytics)
async def get_company_analytics(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> CompanyAnalytics:
    if ctx.role == "interviewer":
        raise forbidden()
    jobs = [j for j in (await db.scalars(select(BizJob).where(BizJob.company_id == ctx.company.id)
                                         .order_by(BizJob.created_at.desc()))).all() if sees_job(ctx, j)]
    ids = [j.id for j in jobs]
    apps = list(await db.scalars(select(BizApplication).where(BizApplication.job_id.in_(ids)))) if ids else []
    now = datetime.now(UTC)
    since = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=29)
    days = Counter(_aware(a.created_at).date().isoformat() for a in apps if since <= _aware(a.created_at) <= now)
    grouped: dict[str, list[BizApplication]] = defaultdict(list)
    for a in apps:
        grouped[a.job_id].append(a)
    moves: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    if ids:
        for jid, aid, data in await db.execute(select(BizEvent.job_id, BizEvent.application_id, BizEvent.data).where(
                BizEvent.job_id.in_(ids[:50]), BizEvent.kind == "stage")):
            moves[jid].append((aid, data))
    hours = _hours(apps)
    return CompanyAnalytics(
        open_jobs=sum(1 for j in jobs if j.status == "open"), applicants_total=len(apps),
        applicants_30d=sum(days.values()), hired=sum(1 for a in apps if a.status == "hired"),
        withdrawn=sum(1 for a in apps if a.status == "withdrawn"),
        median_first_response_hours=round(statistics.median(hours), 1) if hours else None,
        by_source=dict(Counter(a.source for a in apps)),
        jobs=[_job_analytics(j, grouped[j.id], moves[j.id]) for j in jobs[:50]],
        daily=[Daily(day=(since + timedelta(days=i)).date().isoformat(),
                     count=days.get((since + timedelta(days=i)).date().isoformat(), 0)) for i in range(30)])
