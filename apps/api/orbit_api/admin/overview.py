"""Admin: the server at a glance, and the audit log.

- `GET /v1/admin/stats`: sign-ups per day and interview minutes per day (in the admin's time zone), active accounts,
  and this month's minutes, resume AI, Jobs AI fit checks and revenue.
- `GET /v1/admin/audit`: what was done, newest first: admin actions (or every audited event), filterable by action,
  by account (as the one who acted or the one it was about) and by a search.

Read-only: nothing here changes anything, so nothing is audited.
"""

from collections import Counter
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits, ratelimit
from orbit_api import db as database
from orbit_api.admin.accounts import AuditItem, about_account, audit_items
from orbit_api.admin.routes import activity_subquery, require_admin, search_term
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import (
    AuditLog,
    ContactMessage,
    CreditEntry,
    JobFitCheck,
    Payment,
    UsageEvent,
    User,
    UserTwoFactor,
)

router = APIRouter(prefix="/v1/admin", tags=["admin"])


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


class DayValue(BaseModel):
    day: str  # YYYY-MM-DD, in the time zone asked for
    value: float


class StatsOut(BaseModel):
    days: int
    signups: list[DayValue]  # one per day, oldest first, zeros included
    interview_minutes: list[DayValue]  # live + mock, by the day the connection started
    users: int
    active_7d: int  # used Orbit in the last 7 days (admin/routes.AdminUsage.last_active)
    active_30d: int
    suspended: int
    paid_accounts: int  # accounts with an approved payment
    interview_minutes_month: float  # this calendar month (UTC), all accounts
    resume_credits_used_month: int
    fit_checks_month: int  # Jobs AI fit checks
    revenue_month_inr: int  # approved payments decided this month
    revenue_total_inr: int  # includes payments of deleted accounts: they stay on the books
    payments_waiting: int
    # Server settings the admin must fix, as short codes: "proxy_secret" (ORBIT_PROXY_SECRET missing or weak in
    # production, so per-IP limits key on a spoofable address and welcome credits are held); "proxy_unsigned"
    # (the web Worker's requests arrive without that secret, so every visitor is priced as in India and web users
    # share rate limits by Cloudflare's address); "api_cloudflare_proxied" (the API's own DNS record goes through
    # Cloudflare's proxy, so desktop users share limits by Cloudflare's edge address); "database_read_only" (the
    # database answers reads but refuses every write, so sign-ins, payments and sessions fail: DECISIONS D56).
    warnings: list[str] = []


def setup_warnings() -> list[str]:
    s = get_settings()
    if s.env != "production":
        return []
    if s.proxy_secret is None:
        return ["proxy_secret"]
    out = []
    if ratelimit.site_worker_unsigned():
        out.append("proxy_unsigned")
    if ratelimit.api_behind_cloudflare():
        out.append("api_cloudflare_proxied")
    return out


@router.get("/stats", response_model=StatsOut)
async def stats(admin: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                days: Annotated[int, Query(ge=7, le=90)] = 30,
                tz_offset: Annotated[int, Query(ge=-720, le=840)] = 0) -> StatsOut:
    """`tz_offset`: minutes east of UTC (India is 330), so a day is the admin's own day."""
    now = datetime.now(UTC)
    shift = timedelta(minutes=tz_offset)
    today = (now + shift).date()
    day_list = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    since = datetime.combine(day_list[0], time.min, tzinfo=UTC) - shift
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def local_day(at: datetime) -> str:
        return (_aware(at) + shift).date().isoformat()

    signups = Counter(local_day(at) for at in (await db.scalars(
        select(User.created_at).where(User.created_at >= since))).all())
    minutes: dict[str, float] = {}
    for at, quantity in (await db.execute(select(UsageEvent.created_at, UsageEvent.quantity).where(
            UsageEvent.metric.in_(credits.INTERVIEW_METRICS), UsageEvent.created_at >= since))).all():
        day = local_day(at)
        minutes[day] = minutes.get(day, 0.0) + float(quantity or 0) / 60

    # Both counts from one pass over the activity tables (it reads every account's latest use: the dominant cost).
    activity = activity_subquery()
    week, month_ago = now - timedelta(days=7), now - timedelta(days=30)

    def active_since(when: datetime) -> Any:
        return func.coalesce(func.sum(case((activity.c.last_active >= when, 1), else_=0)), 0)

    active = (await db.execute(select(active_since(week), active_since(month_ago)).select_from(activity)
                               .join(User, User.id == activity.c.uid))).one()

    async def scalar(query: Any) -> float:
        return float(await db.scalar(query) or 0)

    return StatsOut(
        days=days,
        signups=[DayValue(day=d.isoformat(), value=signups.get(d.isoformat(), 0)) for d in day_list],
        interview_minutes=[DayValue(day=d.isoformat(), value=round(minutes.get(d.isoformat(), 0.0), 1))
                           for d in day_list],
        users=int(await scalar(select(func.count()).select_from(User))),
        active_7d=int(active[0]),
        active_30d=int(active[1]),
        suspended=int(await scalar(select(func.count()).select_from(User).where(User.suspended_at.is_not(None)))),
        paid_accounts=int(await scalar(select(func.count(func.distinct(Payment.user_id))).where(
            Payment.status == "approved", Payment.user_id.is_not(None)))),
        interview_minutes_month=round(await scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
            UsageEvent.metric.in_(credits.INTERVIEW_METRICS), UsageEvent.created_at >= month)) / 60, 1),
        resume_credits_used_month=int(await scalar(select(func.coalesce(func.sum(-CreditEntry.amount), 0)).where(
            CreditEntry.kind == "resume", CreditEntry.reason == "resume_ai", CreditEntry.created_at >= month))),
        fit_checks_month=int(await scalar(select(func.count()).select_from(JobFitCheck).where(
            JobFitCheck.created_at >= month))),
        revenue_month_inr=int(await scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
            Payment.status == "approved", Payment.decided_at >= month))),
        revenue_total_inr=int(await scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
            Payment.status == "approved"))),
        payments_waiting=int(await scalar(select(func.count()).select_from(Payment).where(
            Payment.status == "submitted"))),
        warnings=setup_warnings() + (["database_read_only"] if await database.refuses_writes(db) else [])
        + ([] if await db.scalar(select(UserTwoFactor.enabled_at).where(
            UserTwoFactor.user_id == admin.id)) else ["admin_two_factor"]),
    )


class AuditOut(BaseModel):
    items: list[AuditItem]
    total: int
    offset: int
    has_more: bool
    actions: list[str]  # every action in this scope, for the filter


@router.get("/audit", response_model=AuditOut)
async def audit_log(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                    scope: Literal["admin", "all"] = "admin",
                    action: Annotated[str | None, Query(max_length=64, pattern=r"^[a-z_.]+$")] = None,
                    user_id: Annotated[str | None, Query(max_length=36)] = None,
                    q: Annotated[str | None, Query(max_length=120)] = None,
                    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
                    limit: Annotated[int, Query(ge=1, le=200)] = 50) -> AuditOut:
    """Newest first. "admin": what an admin did; "all": every audited event (sign-ins, password changes, ...).
    `user_id`: entries by that account or about it. `q`: an email or name (whoever acted or it was about), or any
    text in the entry's target (a deleted account's email is kept there)."""
    in_scope = AuditLog.action.like("admin.%") if scope == "admin" else AuditLog.action.is_not(None)
    query = select(AuditLog).where(in_scope)
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        payments = list((await db.scalars(select(Payment.id).where(Payment.user_id == user_id).limit(50))).all())
        sent = list((await db.scalars(select(ContactMessage.id).where(ContactMessage.user_id == user_id)
                                      .limit(50))).all())
        query = query.where(or_(AuditLog.user_id == user_id, about_account(user_id, payments + sent)))
    term = search_term(q)
    if term is not None:
        like = f"%{term}%"
        ids = list((await db.scalars(select(User.id).where(or_(
            func.lower(User.email).like(like), func.lower(func.coalesce(User.name, "")).like(like))).limit(50))).all())
        query = query.where(or_(func.lower(func.coalesce(AuditLog.target, "")).like(like),
                                AuditLog.user_id.in_(ids), *(AuditLog.target.like(f"{i}%") for i in ids))
                            if term else AuditLog.id.is_(None))
    total = int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list((await db.scalars(query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                                  .offset(offset).limit(limit))).all())
    actions = sorted((await db.scalars(select(AuditLog.action).where(in_scope).distinct().limit(200))).all())
    return AuditOut(items=await audit_items(db, rows), total=total, offset=offset,
                    has_more=offset + len(rows) < total, actions=actions)
