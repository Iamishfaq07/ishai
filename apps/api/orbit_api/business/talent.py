"""Explicit, application-linked talent consent and reviewed portal role suggestions."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import rules
from orbit_api.business.access import CompanyCtx, Ctx, audit, job_for, lock_company
from orbit_api.business.apply import _by_token
from orbit_api.business.hiring import aware
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.knowledge import fresh_context
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import BizApplication, BizCompany, BizJob, BizTalentMember, BizTalentPool, BizTalentSuggestion
from orbit_api.ratelimit import limit_user

router = APIRouter(
    prefix="/v1/business/companies/{company_id}/talent",
    tags=["business talent community"],
    dependencies=[Depends(limit_user("business-talent", rate_per_s=3, burst=30))],
)
public_router = APIRouter(prefix="/v1/public/business/applications/{token}/talent", tags=["candidate talent community"])
NOTICE_VERSION = "2026-10-29.1"
NOTICE = (
    "Joining is optional and does not change your application or assessment. This company's owners, admins and "
    "recruiters can discover your name, the skills and interests you share here, and your existing application "
    "while consent is current. They can suggest published jobs in this portal. Joining does not apply to another "
    "job, permit marketing email, or extend your application's retention. Leave at any time here. Your membership "
    "and role suggestions are deleted when you leave or the application is deleted. Expired memberships stop "
    "appearing immediately and scheduled cleanup deletes them. Changed pool terms require fresh consent. "
    "Do not include sensitive personal details in your skills or interests."
)


class PoolIn(Contract):
    name: str = Field(min_length=3, max_length=120)
    purpose: str = Field(min_length=20, max_length=1200)
    retention_days: int = Field(180, ge=30, le=365, strict=True)
    enabled: bool = Field(False, strict=True)
    base_revision: int = Field(0, ge=0, strict=True)


class JoinIn(Contract):
    request_id: RequestId
    terms_revision: int = Field(ge=1, strict=True)
    notice_version: str = Field(max_length=40)
    acknowledge: bool = Field(strict=True)
    skills: list[str] = Field(min_length=1, max_length=12)
    interests: str = Field(min_length=10, max_length=600)

    @field_validator("skills")
    @classmethod
    def clean_skills(cls, values: list[str]) -> list[str]:
        result = [v.strip() for v in values]
        if any(not 2 <= len(v) <= 60 for v in result) or len({v.casefold() for v in result}) != len(result):
            raise ValueError("Share 1–12 distinct skills, each 2–60 characters.")
        return result


class SuggestIn(Contract):
    job_id: str = Field(min_length=1, max_length=36)


def pool_data(pool: BizTalentPool) -> dict[str, Any]:
    return {
        k: getattr(pool, k)
        for k in ("id", "name", "purpose", "retention_days", "enabled", "revision", "terms_revision")
    }


async def staff(db: AsyncSession, ctx: Ctx, *, write: bool = False) -> Ctx:
    if write:
        ctx = await fresh_context(db, ctx)
    ctx.require("all_jobs")
    ctx.writable()
    return ctx


async def pool_for(db: AsyncSession, cid: str, pid: str) -> BizTalentPool:
    row = await db.get(BizTalentPool, pid, populate_existing=True)
    if row is None or row.company_id != cid:
        raise HTTPException(404, "Talent community not found.")
    return row


def eligible() -> Any:
    return (
        BizTalentPool.enabled.is_(True),
        BizTalentMember.notice_version == NOTICE_VERSION,
        BizTalentMember.terms_revision == BizTalentPool.terms_revision,
        BizTalentMember.expires_at > datetime.now(UTC),
        BizApplication.email_confirmed_at.is_not(None),
        BizApplication.deletion_requested_at.is_(None),
        BizApplication.company_id == BizTalentPool.company_id,
    )


@router.get("")
async def pools(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    ctx = await staff(db, ctx)
    rows = await db.scalars(
        select(BizTalentPool)
        .where(BizTalentPool.company_id == ctx.company.id)
        .order_by(BizTalentPool.created_at, BizTalentPool.id)
        .limit(25)
    )
    return {"items": [pool_data(p) for p in rows]}


@router.post("", status_code=201)
async def create_pool(body: PoolIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    ctx = await staff(db, ctx, write=True)
    ctx.require("manage_company")
    if body.base_revision != 0:
        raise HTTPException(409, "A new community starts at revision zero.")
    count = await db.scalar(
        select(func.count()).select_from(BizTalentPool).where(BizTalentPool.company_id == ctx.company.id)
    )
    if (count or 0) >= 25:
        raise HTTPException(409, "This workspace already has 25 communities.")
    row = BizTalentPool(company_id=ctx.company.id, **body.model_dump(exclude={"base_revision"}))
    db.add(row)
    await db.flush()
    audit(db, ctx.company.id, ctx.user, "talent.pool_created", row.id)
    await db.commit()
    return pool_data(row)


@router.put("/{pid}")
async def update_pool(pid: str, body: PoolIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    ctx = await staff(db, ctx, write=True)
    ctx.require("manage_company")
    row = await pool_for(db, ctx.company.id, pid)
    if row.revision != body.base_revision:
        raise HTTPException(409, "Community changed. Refresh before saving.")
    if any(getattr(row, k) != getattr(body, k) for k in ("name", "purpose", "retention_days")):
        row.terms_revision += 1
        # Old consent cannot silently carry over; remove profiles and suggestions immediately.
        await db.execute(delete(BizTalentMember).where(BizTalentMember.pool_id == pid))
    for key, value in body.model_dump(exclude={"base_revision"}).items():
        setattr(row, key, value)
    row.revision += 1
    audit(db, ctx.company.id, ctx.user, "talent.pool_updated", pid, revision=row.revision, enabled=row.enabled)
    await db.commit()
    return pool_data(row)


@router.delete("/{pid}", status_code=204)
async def delete_pool(pid: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    ctx = await staff(db, ctx, write=True)
    ctx.require("manage_company")
    row = await pool_for(db, ctx.company.id, pid)
    await db.delete(row)
    audit(db, ctx.company.id, ctx.user, "talent.pool_deleted", pid)
    await db.commit()


@router.get("/{pid}/members")
async def members(
    pid: str,
    ctx: CompanyCtx,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str, Query(max_length=80)] = "",
    after: Annotated[str, Query(max_length=36)] = "",
) -> Any:
    ctx = await staff(db, ctx)
    await pool_for(db, ctx.company.id, pid)
    if ctx.company.verified_at is None:
        return {"items": [], "next_cursor": None}
    query = (
        select(BizTalentMember, BizApplication.name)
        .join(BizTalentPool)
        .join(BizApplication)
        .where(BizTalentPool.id == pid, *eligible(), BizTalentMember.id > after)
    )
    if q.strip():
        query = query.where(BizTalentMember.search_text.contains(q.strip().casefold(), autoescape=True))
    rows = list((await db.execute(query.order_by(BizTalentMember.id).limit(51))).all())
    return {
        "items": [
            {
                "id": m.id,
                "name": name,
                "application_id": m.application_id,
                "skills": m.skills,
                "interests": m.interests,
                "expires_at": aware(m.expires_at),
                "consented_at": aware(m.consented_at),
            }
            for m, name in rows[:50]
        ],
        "next_cursor": rows[49][0].id if len(rows) > 50 else None,
    }


async def member_for(db: AsyncSession, ctx: Ctx, pid: str, mid: str) -> BizTalentMember:
    await pool_for(db, ctx.company.id, pid)
    row = await db.scalar(
        select(BizTalentMember)
        .join(BizTalentPool)
        .join(BizApplication)
        .where(BizTalentPool.id == pid, BizTalentMember.id == mid, *eligible())
    )
    if row is None or ctx.company.verified_at is None:
        raise HTTPException(404, "Membership is no longer current.")
    return row


@router.post("/{pid}/members/{mid}/suggestions", status_code=201)
async def suggest(
    pid: str, mid: str, body: SuggestIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]
) -> Any:
    ctx = await staff(db, ctx, write=True)
    member = await member_for(db, ctx, pid, mid)
    job = await job_for(db, ctx, body.job_id)
    if job.status != "open" or job.taken_down_reason or not ctx.company.verified_at:
        raise HTTPException(409, "Choose a currently published role from a verified company.")
    existing = await db.scalar(
        select(BizTalentSuggestion).where(BizTalentSuggestion.member_id == mid, BizTalentSuggestion.job_id == job.id)
    )
    if existing:
        return {"id": existing.id, "job_id": job.id}
    count = await db.scalar(
        select(func.count()).select_from(BizTalentSuggestion).where(BizTalentSuggestion.member_id == mid)
    )
    if (count or 0) >= 20:
        raise HTTPException(409, "Remove an older suggestion before adding another (maximum 20).")
    row = BizTalentSuggestion(member_id=member.id, job_id=job.id)
    db.add(row)
    await db.flush()
    audit(db, ctx.company.id, ctx.user, "talent.role_suggested", pid, job_id=job.id)
    await db.commit()
    return {"id": row.id, "job_id": row.job_id}


@router.get("/{pid}/members/{mid}/suggestions")
async def suggestions(pid: str, mid: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    ctx = await staff(db, ctx)
    await member_for(db, ctx, pid, mid)
    rows = await db.execute(
        select(BizTalentSuggestion, BizJob.title, BizJob.status)
        .join(BizJob)
        .where(BizTalentSuggestion.member_id == mid, BizJob.company_id == ctx.company.id)
    )
    return {"items": [{"id": s.id, "job_id": s.job_id, "title": title, "status": status} for s, title, status in rows]}


@router.delete("/{pid}/members/{mid}/suggestions/{sid}", status_code=204)
async def remove_suggestion(
    pid: str, mid: str, sid: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]
) -> None:
    ctx = await staff(db, ctx, write=True)
    await member_for(db, ctx, pid, mid)
    await db.execute(
        delete(BizTalentSuggestion).where(BizTalentSuggestion.id == sid, BizTalentSuggestion.member_id == mid)
    )
    await db.commit()


async def candidate(db: AsyncSession, token: str, request: Request, *, write: bool = False) -> Any:
    app, job, company = await _by_token(db, token, request)
    if write:
        await lock_company(db, company.id)
        db.expire_all()
        app, job, company = await _by_token(db, token, request)
    if not app.email_confirmed_at:
        raise HTTPException(403, "Confirm your application email first.")
    return app, job, company


async def own_data(db: AsyncSession, app: BizApplication, company: BizCompany) -> dict[str, Any]:
    rows = list(
        await db.scalars(
            select(BizTalentPool)
            .where(BizTalentPool.company_id == company.id)
            .order_by(BizTalentPool.created_at, BizTalentPool.id)
            .limit(25)
        )
    )
    own = {
        m.pool_id: m for m in await db.scalars(select(BizTalentMember).where(BizTalentMember.application_id == app.id))
    }
    result = []
    for pool in rows:
        member = own.get(pool.id)
        available = (
            pool.enabled
            and company.status == "active"
            and company.verified_at is not None
            and app.deletion_requested_at is None
        )
        active = bool(
            available
            and member
            and member.notice_version == NOTICE_VERSION
            and member.terms_revision == pool.terms_revision
            and aware(member.expires_at) > datetime.now(UTC)
        )
        roles = []
        if active and member:
            jobs = await db.execute(
                select(BizJob.id, BizJob.title, BizJob.slug)
                .join(BizTalentSuggestion)
                .where(
                    BizTalentSuggestion.member_id == member.id,
                    BizJob.status == "open",
                    BizJob.taken_down_reason.is_(None),
                    BizJob.company_id == company.id,
                )
                .order_by(BizJob.title, BizJob.id)
            )
            roles = [
                {"id": jid, "title": title, "href": f"/company/{company.slug}/jobs/{slug}"} for jid, title, slug in jobs
            ]
        if available or member:
            result.append(
                {
                    **pool_data(pool),
                    "available": available,
                    "active": active,
                    "membership": {
                        "notice_sha256": member.notice_sha256,
                        "notice_version": member.notice_version,
                        "skills": member.skills,
                        "interests": member.interests,
                        "consented_at": aware(member.consented_at),
                        "expires_at": aware(member.expires_at),
                    }
                    if member
                    else None,
                    "suggestions": roles,
                }
            )
    return {"notice_version": NOTICE_VERSION, "notice": NOTICE, "items": result}


@public_router.get("")
async def own(token: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    app, _, company = await candidate(db, token, request)
    return await own_data(db, app, company)


@public_router.put("/{pid}")
async def join(
    pid: str, token: str, body: JoinIn, request: Request, db: Annotated[AsyncSession, Depends(get_db)]
) -> Any:
    app, _, company = await candidate(db, token, request, write=True)
    pool = await pool_for(db, company.id, pid)
    if not pool.enabled or company.status != "active" or not company.verified_at or app.deletion_requested_at:
        raise HTTPException(409, "Joining this community is not available.")
    if not body.acknowledge or body.notice_version != NOTICE_VERSION or body.terms_revision != pool.terms_revision:
        raise HTTPException(409, "Review the current community terms and choose to join.")
    row = await db.scalar(
        select(BizTalentMember).where(BizTalentMember.pool_id == pid, BizTalentMember.application_id == app.id)
    )
    if row and row.request_id == body.request_id:
        if (
            row.skills != body.skills
            or row.interests != body.interests
            or row.notice_version != body.notice_version
            or row.terms_revision != body.terms_revision
        ):
            raise HTTPException(409, "This request was already used with different details.")
        return await own_data(db, app, company)
    if row:
        await db.execute(delete(BizTalentSuggestion).where(BizTalentSuggestion.member_id == row.id))
    else:
        row = BizTalentMember(pool_id=pid, application_id=app.id)
        db.add(row)
    row.terms_revision, row.request_id = pool.terms_revision, body.request_id
    row.notice_version = NOTICE_VERSION
    row.notice_sha256 = rules.digest(f"{NOTICE_VERSION}\n{NOTICE}\n{pool.name}\n{pool.purpose}\n{pool.retention_days}")
    row.skills, row.interests = body.skills, body.interests
    row.search_text = ("\n".join(body.skills) + "\n" + body.interests).casefold()
    row.consented_at = datetime.now(UTC)
    row.expires_at = row.consented_at + timedelta(days=pool.retention_days)
    await db.commit()
    return await own_data(db, app, company)


@public_router.delete("/{pid}")
async def leave(pid: str, token: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    app, _, company = await candidate(db, token, request, write=True)
    await pool_for(db, company.id, pid)
    await db.execute(
        delete(BizTalentMember).where(BizTalentMember.pool_id == pid, BizTalentMember.application_id == app.id)
    )
    await db.commit()
    return await own_data(db, app, company)


@public_router.delete("/{pid}/suggestions/{jid}")
async def dismiss(
    pid: str, jid: str, token: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)]
) -> Any:
    app, _, company = await candidate(db, token, request, write=True)
    await pool_for(db, company.id, pid)
    member_ids = select(BizTalentMember.id).where(
        BizTalentMember.pool_id == pid, BizTalentMember.application_id == app.id
    )
    await db.execute(
        delete(BizTalentSuggestion).where(
            BizTalentSuggestion.member_id.in_(member_ids), BizTalentSuggestion.job_id == jid
        )
    )
    await db.commit()
    return await own_data(db, app, company)


async def sweep() -> int:
    """Expiry is enforced at read time even if cleanup is delayed; no email or provider calls."""
    async with sessionmaker()() as db:
        # Serialize with consent renewals per company, using the same lock order as every write.
        cids = await db.scalars(
            select(BizTalentPool.company_id)
            .join(BizTalentMember)
            .where(BizTalentMember.expires_at <= datetime.now(UTC))
            .distinct()
        )
        count = 0
        for cid in list(cids):
            await lock_company(db, cid)
            rows = await db.execute(
                delete(BizTalentMember).where(
                    BizTalentMember.pool_id.in_(select(BizTalentPool.id).where(BizTalentPool.company_id == cid)),
                    BizTalentMember.expires_at <= datetime.now(UTC),
                )
            )
            count += rows.rowcount  # type: ignore[attr-defined]
            await db.commit()
        return count
