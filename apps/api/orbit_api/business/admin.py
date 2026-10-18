"""The Orbit team's side of Orbit for Business: review companies (verify by hand, suspend), grant a plan, take a job
down, and work through "Report this job". Admin only (admin/routes.require_admin). Every action is in both the
Orbit admin audit log and the company's own."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin
from orbit_api.business import indexing, rules
from orbit_api.business.access import audit
from orbit_api.business.companies import AuditOut, effective_plan
from orbit_api.business.jobs import public_url
from orbit_api.db import get_db
from orbit_api.models import AuditLog, BizApplication, BizAudit, BizCompany, BizJob, BizMember, BizReport, User

router = APIRouter(prefix="/v1/admin/business", tags=["admin-business"])
Admin = Annotated[User, Depends(require_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]


def now() -> datetime:
    return datetime.now(UTC)


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


class AdminCompany(BaseModel):
    id: str
    slug: str
    name: str
    website: str
    domain: str
    country: str
    size: str
    status: str
    suspended_reason: str | None
    verified: bool
    verification_method: str | None
    plan: str
    plan_until: datetime | None
    owner_email: str | None
    members: int
    open_jobs: int
    applicants: int
    open_reports: int
    pending_plan_request: str | None
    created_at: datetime


class AdminJob(BaseModel):
    id: str
    title: str
    status: str
    taken_down_reason: str | None
    public_url: str
    published_at: datetime | None
    applicants: int


class ReportOut(BaseModel):
    id: str
    job_id: str
    job_title: str
    company_id: str
    company_name: str
    reason: str
    details: str
    status: str
    created_at: datetime


class AdminCompanyDetail(AdminCompany):
    about: str
    jobs: list[AdminJob]
    reports: list[ReportOut]


async def _count(db: AsyncSession, q: object) -> int:
    return int(await db.scalar(q) or 0)  # type: ignore[call-overload]


async def _company(db: AsyncSession, c: BizCompany) -> AdminCompany:
    owner = await db.scalar(select(User.email).join(BizMember, BizMember.user_id == User.id).where(
        BizMember.company_id == c.id, BizMember.role == "owner"))
    return AdminCompany(
        id=c.id, slug=c.slug, name=c.name, website=c.website, domain=c.domain, country=c.country, size=c.size,
        status=c.status, suspended_reason=c.suspended_reason, verified=c.verified_at is not None,
        verification_method=c.verification_method, plan=effective_plan(c), plan_until=_aware(c.plan_until),
        owner_email=owner,
        members=await _count(db, select(func.count()).select_from(BizMember).where(BizMember.company_id == c.id)),
        open_jobs=await _count(db, select(func.count()).select_from(BizJob).where(BizJob.company_id == c.id,
                                                                                 BizJob.status == "open")),
        applicants=await _count(db, select(func.count()).select_from(BizApplication)
                                .where(BizApplication.company_id == c.id)),
        open_reports=await _count(db, select(func.count()).select_from(BizReport).where(
            BizReport.company_id == c.id, BizReport.status == "open")),
        pending_plan_request=c.plan_request, created_at=_aware(c.created_at) or now())


def _report(r: BizReport, job: BizJob | None, c: BizCompany | None) -> ReportOut:
    return ReportOut(id=r.id, job_id=r.job_id, job_title=job.title if job else "", company_id=r.company_id,
                     company_name=c.name if c else "", reason=r.reason, details=r.details, status=r.status,
                     created_at=_aware(r.created_at) or now())


async def _detail(db: AsyncSession, c: BizCompany) -> AdminCompanyDetail:
    jobs = (await db.scalars(select(BizJob).where(BizJob.company_id == c.id).order_by(BizJob.created_at.desc()))).all()
    out_jobs = [AdminJob(id=j.id, title=j.title, status=j.status, taken_down_reason=j.taken_down_reason,
                         public_url=public_url(c, j), published_at=_aware(j.published_at),
                         applicants=await _count(db, select(func.count()).select_from(BizApplication)
                                                 .where(BizApplication.job_id == j.id))) for j in jobs]
    by_id = {j.id: j for j in jobs}
    reports = (await db.scalars(select(BizReport).where(BizReport.company_id == c.id)
                                .order_by(BizReport.created_at.desc()).limit(100))).all()
    base = await _company(db, c)
    return AdminCompanyDetail(**base.model_dump(), about=c.about or "", jobs=out_jobs,
                              reports=[_report(r, by_id.get(r.job_id), c) for r in reports])


def _log(db: AsyncSession, admin: User, action: str, target: str) -> None:
    db.add(AuditLog(user_id=admin.id, action=f"admin.business.{action}", target=target))


async def _get(db: AsyncSession, company_id: str) -> BizCompany:
    c = await db.get(BizCompany, company_id)
    if c is None:
        raise HTTPException(404, "Not found.")
    return c


@router.get("/companies", response_model=list[AdminCompany])
async def companies(_: Admin, db: DB, q: Annotated[str | None, Query(max_length=100)] = None,
                    status: Annotated[Literal["all", "active", "suspended", "unverified", "requests"], Query()] = "all",
                    ) -> list[AdminCompany]:
    query = select(BizCompany)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(BizCompany.name).like(like), BizCompany.domain.like(like),
                                BizCompany.slug.like(like)))
    if status in {"active", "suspended"}:
        query = query.where(BizCompany.status == status)
    elif status == "unverified":
        query = query.where(BizCompany.verified_at.is_(None))
    elif status == "requests":
        query = query.where(BizCompany.plan_request.is_not(None))
    rows = (await db.scalars(query.order_by(BizCompany.created_at.desc()).limit(200))).all()
    return [await _company(db, c) for c in rows]


@router.get("/companies/{company_id}", response_model=AdminCompanyDetail)
async def company(company_id: str, _: Admin, db: DB) -> AdminCompanyDetail:
    return await _detail(db, await _get(db, company_id))


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


async def _job_urls(db: AsyncSession, c: BizCompany) -> list[str]:
    jobs = (await db.scalars(select(BizJob).where(BizJob.company_id == c.id, BizJob.status == "open"))).all()
    return [public_url(c, j) for j in jobs]


@router.post("/companies/{company_id}/suspend", response_model=AdminCompanyDetail)
async def suspend(company_id: str, body: ReasonIn, admin: Admin, db: DB) -> AdminCompanyDetail:
    c = await _get(db, company_id)
    c.status, c.suspended_reason = "suspended", body.reason.strip()
    for url in await _job_urls(db, c):  # its pages answer 404 now: tell Google
        await indexing.notify(db, url, deleted=True)
    _log(db, admin, "suspend", f"{c.id} {c.name}")
    audit(db, c.id, None, "company.suspended_by_orbit", c.name, reason=c.suspended_reason)
    await db.commit()
    return await _detail(db, c)


@router.post("/companies/{company_id}/unsuspend", response_model=AdminCompanyDetail)
async def unsuspend(company_id: str, admin: Admin, db: DB) -> AdminCompanyDetail:
    c = await _get(db, company_id)
    c.status, c.suspended_reason = "active", None
    for url in await _job_urls(db, c):
        await indexing.notify(db, url, deleted=False)
    _log(db, admin, "unsuspend", f"{c.id} {c.name}")
    audit(db, c.id, None, "company.unsuspended_by_orbit", c.name)
    await db.commit()
    return await _detail(db, c)


@router.post("/companies/{company_id}/verify", response_model=AdminCompanyDetail)
async def verify(company_id: str, admin: Admin, db: DB) -> AdminCompanyDetail:
    c = await _get(db, company_id)
    if c.verified_at is None:
        c.verified_at, c.verification_method = now(), "admin"
        _log(db, admin, "verify", f"{c.id} {c.name}")
        audit(db, c.id, None, "company.verified", c.domain, method="admin")
        await db.commit()
    return await _detail(db, c)


class PlanIn(BaseModel):
    plan: Literal["free", "starter", "growth"]
    days: int | None = Field(None, ge=1, le=3660)  # None: until changed


@router.post("/companies/{company_id}/plan", response_model=AdminCompanyDetail)
async def grant_plan(company_id: str, body: PlanIn, admin: Admin, db: DB) -> AdminCompanyDetail:
    c = await _get(db, company_id)
    c.plan = body.plan
    c.plan_until = now() + timedelta(days=body.days) if body.days and body.plan != "free" else None
    c.plan_request = c.plan_request_at = None
    _log(db, admin, "plan", f"{c.id} {c.name} {body.plan} {body.days or 'open-ended'}")
    audit(db, c.id, None, "plan.granted", rules.PLANS[body.plan].label, days=body.days)
    await db.commit()
    return await _detail(db, c)


@router.post("/jobs/{job_id}/take-down", response_model=AdminCompanyDetail)
async def take_down(job_id: str, body: ReasonIn, admin: Admin, db: DB) -> AdminCompanyDetail:
    job = await db.get(BizJob, job_id)
    if job is None:
        raise HTTPException(404, "Not found.")
    c = await _get(db, job.company_id)
    if job.status == "open":
        await indexing.notify(db, public_url(c, job), deleted=True)
        job.status = "paused"
    job.taken_down_reason = body.reason.strip()
    _log(db, admin, "take_down", f"{job.id} {job.title}")
    audit(db, c.id, None, "job.taken_down_by_orbit", job.title, job_id=job.id, reason=job.taken_down_reason)
    await db.commit()
    return await _detail(db, c)


@router.post("/jobs/{job_id}/restore", response_model=AdminCompanyDetail)
async def restore(job_id: str, admin: Admin, db: DB) -> AdminCompanyDetail:
    job = await db.get(BizJob, job_id)
    if job is None:
        raise HTTPException(404, "Not found.")
    c = await _get(db, job.company_id)
    job.taken_down_reason = None
    _log(db, admin, "restore", f"{job.id} {job.title}")
    audit(db, c.id, None, "job.restored_by_orbit", job.title, job_id=job.id)
    await db.commit()
    return await _detail(db, c)


@router.get("/companies/{company_id}/audit", response_model=list[AuditOut])
async def company_audit(company_id: str, _: Admin, db: DB) -> list[AuditOut]:
    """The company's own audit log, for the Orbit team: who moved or rejected whom, and each ranking's model version
    (which company members never see outside this log)."""
    c = await _get(db, company_id)
    rows = (await db.scalars(select(BizAudit).where(BizAudit.company_id == c.id)
                             .order_by(BizAudit.created_at.desc()).limit(300))).all()
    return [AuditOut(id=r.id, actor=r.actor_name, actor_id=r.actor_id, action=r.action, target=r.target,
                     detail=r.detail or {}, created_at=_aware(r.created_at) or now()) for r in rows]


@router.get("/reports", response_model=list[ReportOut])
async def reports(_: Admin, db: DB,
                  status: Annotated[Literal["open", "dismissed", "actioned", "all"], Query()] = "open",
                  ) -> list[ReportOut]:
    q = select(BizReport, BizJob, BizCompany).join(BizJob, BizJob.id == BizReport.job_id).join(
        BizCompany, BizCompany.id == BizReport.company_id)
    if status != "all":
        q = q.where(BizReport.status == status)
    rows = (await db.execute(q.order_by(BizReport.created_at.desc()).limit(200))).all()
    return [_report(r, j, c) for r, j, c in rows]


class ReportStatusIn(BaseModel):
    status: Literal["open", "dismissed", "actioned"]


@router.post("/reports/{report_id}", response_model=ReportOut)
async def set_report(report_id: str, body: ReportStatusIn, admin: Admin, db: DB) -> ReportOut:
    r = await db.get(BizReport, report_id)
    if r is None:
        raise HTTPException(404, "Not found.")
    r.status = body.status
    _log(db, admin, "report", f"{r.id} {body.status}")
    await db.commit()
    return _report(r, await db.get(BizJob, r.job_id), await db.get(BizCompany, r.company_id))
