"""Admin-only: advanced settings (rotate provider API keys / models in-app), and who may use Orbit.

Users: with sign-up approval on (ORBIT_SIGNUP_APPROVAL), new accounts wait until the admin approves them for good
or grants a plan for a while ("Unlimited for 2 hours"); a grant runs out on its own.

Access is limited to the admin: ORBIT_ADMIN_EMAIL (required in production; in development/test the first
registered user stands in when it's unset).
Secret values are never returned in plaintext (only a "set" flag); they're stored encrypted via
ORBIT_CONFIG_SECRET and applied to live providers immediately after saving.
"""

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import Select, Subquery, case, false, func, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import GRANT_PLANS, active_grant, awaiting_approval, is_admin, plan_named
from orbit_api.live.metrics import summarize
from orbit_api.models import (
    AppConfig,
    AuditLog,
    CreditEntry,
    JobApplication,
    JobFitCheck,
    LiveSessionRow,
    Payment,
    Resume,
    UsageEvent,
    User,
)
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.runtime_config import (
    ANNOUNCEMENT_MAX,
    EDITABLE_KEYS,
    ConfigSecretMissing,
    encrypt_secret,
    get_effective_config,
    refresh,
    secrets_editable,
    validate_value,
)
from orbit_api.sessions.feedback import FeedbackReport, feedback_report

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def require_admin(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    if not await is_admin(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


class ConfigOut(BaseModel):
    secrets_editable: bool  # false when ORBIT_CONFIG_SECRET isn't set (keys can't be stored in-app)
    llm_provider: str
    stt_provider: str
    deepseek_base_url: str
    deepseek_model: str
    deepseek_reasoning_model: str
    deepgram_model: str
    deepseek_api_key_set: bool  # masked — plaintext is never returned
    deepgram_api_key_set: bool
    # The site-wide announcement banner ("" = none) and its tone.
    announcement: str = ""
    announcement_tone: str = "info"


class ConfigIn(BaseModel):
    llm_provider: str | None = None
    stt_provider: str | None = None
    deepseek_base_url: str | None = Field(None, max_length=300)
    deepseek_model: str | None = Field(None, max_length=100)
    deepseek_reasoning_model: str | None = Field(None, max_length=100)
    deepgram_model: str | None = Field(None, max_length=100)
    # Secrets: a non-empty value stores/rotates the key; an empty string clears the override
    # (falls back to the environment). Omit the field to leave it unchanged.
    deepseek_api_key: str | None = None
    deepgram_api_key: str | None = None
    announcement: str | None = Field(None, max_length=ANNOUNCEMENT_MAX)  # "" takes it down
    announcement_tone: Literal["info", "warning"] | None = None


def _snapshot() -> ConfigOut:
    cfg = get_effective_config()
    return ConfigOut(
        secrets_editable=secrets_editable(),
        llm_provider=cfg.llm_provider,
        stt_provider=cfg.stt_provider,
        deepseek_base_url=cfg.deepseek_base_url,
        deepseek_model=cfg.deepseek_model,
        deepseek_reasoning_model=cfg.deepseek_reasoning_model,
        deepgram_model=cfg.deepgram_model,
        deepseek_api_key_set=bool(cfg.deepseek_api_key),
        deepgram_api_key_set=bool(cfg.deepgram_api_key),
        announcement=cfg.announcement,
        announcement_tone=cfg.announcement_tone,
    )


@router.get("/config", response_model=ConfigOut)
async def get_config(_: Annotated[User, Depends(require_admin)]) -> ConfigOut:
    return _snapshot()


async def _upsert(db: AsyncSession, key: str, value: str | None, is_secret: bool) -> None:
    row = await db.get(AppConfig, key)
    if value is None:  # clear override
        if row is not None:
            await db.delete(row)
        return
    if row is None:
        db.add(AppConfig(key=key, value=value, is_secret=is_secret))
    else:
        row.value = value
        row.is_secret = is_secret


@router.put("/config", response_model=ConfigOut)
async def update_config(body: ConfigIn, admin: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ConfigOut:
    fields = body.model_dump(exclude_unset=True)
    changed = sorted(k for k in fields if k in EDITABLE_KEYS)
    if changed:  # which settings, never their values (some are API keys)
        db.add(AuditLog(user_id=admin.id, action="admin.config", target=" ".join(changed)))
    for key, raw in fields.items():
        if key not in EDITABLE_KEYS:
            continue
        is_secret = EDITABLE_KEYS[key]
        if is_secret:
            # "" clears the override; anything else is encrypted and stored.
            if raw is None or raw == "":
                await _upsert(db, key, None, True)
            else:
                try:
                    await _upsert(db, key, encrypt_secret(raw), True)
                except ConfigSecretMissing as e:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        else:
            if raw is None or raw == "":
                await _upsert(db, key, None, False)
            else:
                try:
                    await _upsert(db, key, validate_value(key, str(raw)), False)
                except ValueError as e:
                    raise HTTPException(422, str(e)) from e
    await db.commit()
    await refresh(db)
    return _snapshot()


class AnnouncementOut(BaseModel):
    """The site-wide banner the admin set, or no text. `id` changes with the text, so a dismissed banner comes back
    when there's something new to say."""
    id: str | None = None
    text: str | None = None
    tone: Literal["info", "warning"] = "info"


# Public: the banner shows above every signed-in page (and costs one in-memory read).
public_router = APIRouter(prefix="/v1", tags=["announcement"])


@public_router.get("/announcement", response_model=AnnouncementOut)
async def announcement() -> AnnouncementOut:
    cfg = get_effective_config()
    if not cfg.announcement:
        return AnnouncementOut()
    tone: Literal["info", "warning"] = "warning" if cfg.announcement_tone == "warning" else "info"
    digest = hashlib.sha256(f"{tone}:{cfg.announcement}".encode()).hexdigest()[:12]
    return AnnouncementOut(id=digest, text=cfg.announcement, tone=tone)


class AdminStatus(BaseModel):
    is_admin: bool


@router.get("/status", response_model=AdminStatus)
async def admin_status(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AdminStatus:
    """Cheap check so the UI can decide whether to show Advanced settings (no 403 noise)."""
    return AdminStatus(is_admin=await is_admin(db, user))


class LatencyOut(BaseModel):
    days: int
    sessions: int
    # metric → {n, p50, p95, p99} in ms (see orbit_api/live/metrics.py for what each metric measures)
    metrics: dict[str, dict[str, int]]


@router.get("/latency", response_model=LatencyOut)
async def latency(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                  days: Annotated[int, Query(ge=1, le=90)] = 7) -> LatencyOut:
    """Live-latency percentiles across recent sessions (diagnostics; timings only)."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (await db.scalars(select(LiveSessionRow.metrics).where(
        LiveSessionRow.created_at >= since, LiveSessionRow.metrics.is_not(None)))).all()
    return LatencyOut(days=days, sessions=len(rows), metrics=summarize(r for r in rows if r))


@router.get("/providers")
async def provider_health(_: Annotated[User, Depends(require_admin)]) -> dict[str, Any]:
    """Admin diagnostics: every dependency's recent health, and the LLM failover state. Never shown to users."""
    from orbit_api.providers import health
    from orbit_api.providers.llm import get_llm_provider
    from orbit_api.providers.llm.fallback import FallbackProvider

    llm = get_llm_provider()
    failover: dict[str, Any] | None = None
    if isinstance(llm, FallbackProvider):
        failover = {"primary": llm.primary.name, "backup": llm.fallback.name if llm.fallback else None,
                    "breaker": llm.breaker.state, "first_token_timeout_s": llm.first_token_timeout_s}
    from orbit_api.providers.stt import create_stt_provider

    return {"dependencies": health.snapshot(), "llm_failover": failover, "env": get_settings().env,
            "providers": {"llm": llm.name, "stt": create_stt_provider().name}}


@router.get("/feedback", response_model=FeedbackReport)
async def feedback(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                   days: Annotated[int, Query(ge=1, le=90)] = 30) -> FeedbackReport:
    """Answer ratings: satisfaction, 👎 reasons, and by question type and model (counts only, no content)."""
    return await feedback_report(db, days)


@router.get("/costs")
async def costs(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                days: Annotated[int, Query(ge=1, le=90)] = 30) -> dict[str, Any]:
    """Provider costs: totals, per live hour / session, cache hit ratio, tokens per answer, per model, type, user and
    plan. Unpriced calls are counted, never shown as $0 (see admin/costs.py)."""
    from orbit_api.admin.costs import cost_report

    return await cost_report(db, days)


# ---- users & access ------------------------------------------------------------------------------------------

MAX_GRANT_HOURS = 24 * 90
# Ledger reasons for credits the admin adds and takes away by hand (credit_entries.reason).
GIVEN, REMOVED = "admin", "admin_remove"


class AdminUsage(BaseModel):
    """What an account has had and used, all time."""
    resume_given: int = 0  # resume AI credits from the welcome, packs and the admin
    resume_used: int = 0  # spent on resume AI actions
    resume_removed: int = 0  # taken away by the admin
    interview_minutes_given: float = 0
    interview_minutes_removed: float = 0  # taken away by the admin
    live_minutes_used: float = 0
    mock_minutes_used: float = 0
    sessions: int = 0
    paid_inr: int = 0  # approved UPI payments
    packs: int = 0
    # The last time the account used Orbit: a session, interview time, a resume AI action or resume edit, a Jobs AI
    # fit check or tracker change. Signing in alone doesn't count.
    last_active: datetime | None = None


class AdminUser(BaseModel):
    id: str
    email: str
    name: str | None
    created_at: datetime
    email_verified: bool
    # admin: always full access · pending: waiting for you · granted: a plan until grant_until · approved: for good
    access: Literal["admin", "pending", "granted", "approved"]
    plan_label: str
    grant_until: datetime | None
    live_minutes_this_month: float
    # Credits left (the Free plan's balance; they never expire).
    resume_credits: int = 0
    interview_minutes_left: float = 0
    usage: AdminUsage = Field(default_factory=AdminUsage)
    # Suspended by the admin (can't sign in or use the API), and the reason they're shown.
    suspended_at: datetime | None = None
    suspended_reason: str | None = None
    has_note: bool = False  # the admin wrote private notes on it


class AdminTotals(BaseModel):
    """The whole server at a glance."""
    users: int
    signups_7d: int
    interview_minutes_this_month: float
    resume_credits_used_this_month: int
    paid_inr_total: int
    paid_inr_this_month: int
    payments_waiting: int


class UsersOut(BaseModel):
    approval_required: bool
    users: list[AdminUser]
    totals: AdminTotals | None = None  # on the first page only
    total: int = 0  # accounts matching the filter and the search, all pages
    offset: int = 0
    has_more: bool = False


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _month_start() -> datetime:
    return datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def activity_subquery(ids: list[str] | None = None) -> Subquery:
    """(uid, last_active) per account: the latest of everything that counts as using Orbit (see
    AdminUsage.last_active). `ids` narrows every part to those accounts."""
    def part(uid: Any, at: Any, *where: Any) -> Select[Any]:
        q = select(uid.label("uid"), func.max(at).label("at")).where(*where).group_by(uid)
        return q.where(uid.in_(ids)) if ids is not None else q

    parts = union_all(
        part(UsageEvent.user_id, UsageEvent.created_at),
        part(LiveSessionRow.user_id, LiveSessionRow.created_at),
        part(CreditEntry.user_id, CreditEntry.created_at, CreditEntry.reason == "resume_ai"),
        part(Resume.user_id, Resume.updated_at),
        part(JobFitCheck.user_id, JobFitCheck.created_at),
        part(JobApplication.user_id, JobApplication.updated_at),
    ).subquery("activity_parts")
    return (select(parts.c.uid, func.max(parts.c.at).label("last_active"))
            .group_by(parts.c.uid).subquery("activity"))


async def _usage(db: AsyncSession, ids: list[str]) -> dict[str, AdminUsage]:
    """All-time usage per account, in a few grouped queries (not one per account)."""
    out = {uid: AdminUsage() for uid in ids}
    if not ids:
        return out
    given_s: dict[str, float] = {}
    removed_s: dict[str, float] = {}
    for uid, kind, reason, given, spent in (await db.execute(
            select(CreditEntry.user_id, CreditEntry.kind, CreditEntry.reason,
                   func.sum(case((CreditEntry.amount > 0, CreditEntry.amount), else_=0)),
                   func.sum(case((CreditEntry.amount < 0, -CreditEntry.amount), else_=0)))
            .where(CreditEntry.user_id.in_(ids))
            .group_by(CreditEntry.user_id, CreditEntry.kind, CreditEntry.reason))).all():
        u = out[uid]
        if kind == "resume":
            u.resume_given += int(given or 0)
            if reason == REMOVED:
                u.resume_removed += int(spent or 0)
            else:
                u.resume_used += int(spent or 0)
        elif kind == "interview_seconds":
            given_s[uid] = given_s.get(uid, 0.0) + float(given or 0)
            removed_s[uid] = removed_s.get(uid, 0.0) + float(spent or 0)
    for uid in ids:
        out[uid].interview_minutes_given = round(given_s.get(uid, 0.0) / 60, 1)
        out[uid].interview_minutes_removed = round(removed_s.get(uid, 0.0) / 60, 1)
    for uid, metric, total in (await db.execute(
            select(UsageEvent.user_id, UsageEvent.metric, func.sum(UsageEvent.quantity))
            .where(UsageEvent.user_id.in_(ids), UsageEvent.metric.in_(credits.INTERVIEW_METRICS))
            .group_by(UsageEvent.user_id, UsageEvent.metric))).all():
        minutes = round(float(total or 0) / 60, 1)
        if metric == "live_seconds":
            out[uid].live_minutes_used = minutes
        else:
            out[uid].mock_minutes_used = minutes
    for uid, n in (await db.execute(
            select(LiveSessionRow.user_id, func.count())
            .where(LiveSessionRow.user_id.in_(ids)).group_by(LiveSessionRow.user_id))).all():
        out[uid].sessions = int(n)
    activity = activity_subquery(ids)
    for uid, last in (await db.execute(select(activity.c.uid, activity.c.last_active))).all():
        if uid in out and last is not None:
            out[uid].last_active = _aware(last)
    for uid, paid, n in (await db.execute(
            select(Payment.user_id, func.sum(Payment.amount_inr), func.count())
            .where(Payment.user_id.in_(ids), Payment.status == "approved").group_by(Payment.user_id))).all():
        out[uid].paid_inr, out[uid].packs = int(paid or 0), int(n)
    return out


async def _totals(db: AsyncSession) -> AdminTotals:
    month = _month_start()
    users = int(await db.scalar(select(func.count()).select_from(User)) or 0)
    week = int(await db.scalar(select(func.count()).select_from(User).where(
        User.created_at >= datetime.now(UTC) - timedelta(days=7))) or 0)
    seconds = float(await db.scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
        UsageEvent.metric.in_(credits.INTERVIEW_METRICS), UsageEvent.created_at >= month)) or 0)
    resume = int(await db.scalar(select(func.coalesce(func.sum(-CreditEntry.amount), 0)).where(
        CreditEntry.kind == "resume", CreditEntry.reason == "resume_ai", CreditEntry.created_at >= month)) or 0)
    paid = int(await db.scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
        Payment.status == "approved")) or 0)
    paid_month = int(await db.scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
        Payment.status == "approved", Payment.decided_at >= month)) or 0)
    waiting = int(await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "submitted")) or 0)
    return AdminTotals(users=users, signups_7d=week, interview_minutes_this_month=round(seconds / 60, 1),
                       resume_credits_used_this_month=resume, paid_inr_total=paid, paid_inr_this_month=paid_month,
                       payments_waiting=waiting)


async def admin_rows(db: AsyncSession, users: Sequence[User]) -> list[AdminUser]:
    """The admin's view of each account (the list's rows), in a handful of queries for the whole page."""
    month = _month_start()
    ids = [u.id for u in users]
    used: dict[str, float] = {}
    if ids:
        rows = await db.execute(
            select(UsageEvent.user_id, func.sum(UsageEvent.quantity))
            .where(UsageEvent.user_id.in_(ids), UsageEvent.metric == "live_seconds", UsageEvent.created_at >= month)
            .group_by(UsageEvent.user_id))
        used = {uid: float(total or 0) for uid, total in rows.all()}
    wallets = await credits.balances(db, ids)
    usage = await _usage(db, ids)
    out = []
    for u in users:
        granted = active_grant(u)
        access: Literal["admin", "pending", "granted", "approved"] = (
            "admin" if await is_admin(db, u) else "granted" if granted else
            "pending" if awaiting_approval(u) else "approved")
        label = ("Unlimited" if access == "admin" else plan_named(granted).label if granted
                 else "No access yet" if access == "pending" else "Free")
        out.append(AdminUser(
            id=u.id, email=u.email, name=u.name, created_at=u.created_at, email_verified=u.email_verified,
            access=access, plan_label=label, grant_until=_aware(u.grant_until) if granted and u.grant_until else None,
            live_minutes_this_month=round(float(used.get(u.id) or 0) / 60, 1),
            resume_credits=wallets.get(u.id, (0, 0.0))[0],
            interview_minutes_left=round(wallets.get(u.id, (0, 0.0))[1], 1), usage=usage[u.id],
            suspended_at=_aware(u.suspended_at) if u.suspended_at else None, suspended_reason=u.suspended_reason,
            has_note=bool((u.admin_note or "").strip())))
    return out


# "active": used Orbit in the last 7 days · "never_used": signed up and never used it (see AdminUsage.last_active)
UserFilter = Literal["all", "pending", "granted", "paid", "active", "never_used", "suspended"]
UserSort = Literal["created", "email", "last_active", "paid", "minutes", "resume_credits"]
ACTIVE_DAYS = 7


def search_term(q: str | None) -> str | None:
    """The search as plain text, not a pattern: "%" and "_" mean themselves, so they're dropped. None: no search;
    "" (only those characters): matches nobody."""
    if not q or not q.strip():
        return None
    return q.strip().lower().replace("\\", "").replace("%", "").replace("_", "")


def users_query(only: UserFilter = "all", q: str | None = None, sort: UserSort = "created",
                order: Literal["asc", "desc"] = "desc") -> Select[tuple[User]]:
    """Accounts matching a filter and a search, sorted, for the list and its CSV. Only the per-account totals a filter
    or sort needs are joined in."""
    now = datetime.now(UTC)
    query = select(User)
    activity = paid = minutes = resume = None
    if only in ("active", "never_used") or sort == "last_active":
        activity = activity_subquery()
        query = query.outerjoin(activity, activity.c.uid == User.id)
    if only == "paid" or sort == "paid":
        paid = (select(Payment.user_id.label("uid"), func.sum(Payment.amount_inr).label("inr"))
                .where(Payment.status == "approved").group_by(Payment.user_id).subquery("paid"))
        query = query.outerjoin(paid, paid.c.uid == User.id)
    if sort == "minutes":
        minutes = (select(UsageEvent.user_id.label("uid"), func.sum(UsageEvent.quantity).label("seconds"))
                   .where(UsageEvent.metric.in_(credits.INTERVIEW_METRICS)).group_by(UsageEvent.user_id)
                   .subquery("minutes"))
        query = query.outerjoin(minutes, minutes.c.uid == User.id)
    if sort == "resume_credits":
        resume = (select(CreditEntry.user_id.label("uid"), func.sum(CreditEntry.amount).label("credits"))
                  .where(CreditEntry.kind == "resume").group_by(CreditEntry.user_id).subquery("resume"))
        query = query.outerjoin(resume, resume.c.uid == User.id)

    if only == "pending":  # as entitlements.awaiting_approval: not approved, and no grant running
        query = query.where(User.approved.is_(False), or_(User.grant_until.is_(None), User.grant_until <= now)
                            if get_settings().approval_required else false())
    elif only == "granted":
        query = query.where(User.grant_plan.is_not(None), User.grant_until > now)
    elif only == "paid" and paid is not None:
        query = query.where(paid.c.inr > 0)
    elif only == "active" and activity is not None:
        query = query.where(activity.c.last_active >= now - timedelta(days=ACTIVE_DAYS))
    elif only == "never_used" and activity is not None:
        query = query.where(activity.c.last_active.is_(None))
    elif only == "suspended":
        query = query.where(User.suspended_at.is_not(None))
    term = search_term(q)
    if term is not None:
        like = f"%{term}%"
        query = query.where(or_(func.lower(User.email).like(like), func.lower(func.coalesce(User.name, "")).like(like))
                            if term else false())

    key: Any = {
        "created": User.created_at, "email": User.email,
        "last_active": activity.c.last_active if activity is not None else None,
        "paid": func.coalesce(paid.c.inr, 0) if paid is not None else None,
        "minutes": func.coalesce(minutes.c.seconds, 0) if minutes is not None else None,
        "resume_credits": func.coalesce(resume.c.credits, 0) if resume is not None else None,
    }[sort]
    first = key.asc() if order == "asc" else key.desc()
    if sort == "last_active":
        first = first.nulls_last()  # never used: at the end either way
    return query.order_by(first, User.created_at.desc(), User.id)


@router.get("/users", response_model=UsersOut)
async def list_users(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                     only: UserFilter = "all",
                     q: Annotated[str | None, Query(max_length=120)] = None,
                     sort: UserSort = "created",
                     order: Literal["asc", "desc"] = "desc",
                     offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
                     limit: Annotated[int, Query(ge=1, le=500)] = 200) -> UsersOut:
    """Newest first unless sorted otherwise. "pending" lists the accounts waiting for you (and ones whose grant ran
    out); `q` finds an account by email or name. A page at a time: `offset` and `limit`, with `total` and
    `has_more`."""
    query = users_query(only, q, sort, order)
    total = int(await db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0)
    page = list((await db.scalars(query.offset(offset).limit(limit))).all())
    rows = await admin_rows(db, page)
    return UsersOut(approval_required=get_settings().approval_required, users=rows,
                    totals=await _totals(db) if offset == 0 else None, total=total, offset=offset,
                    has_more=offset + len(rows) < total)


class ActivityItem(BaseModel):
    at: datetime
    kind: Literal["credit", "session", "payment"]
    text: str
    amount: str | None = None


class ActivityOut(BaseModel):
    items: list[ActivityItem]


_REASON = {"welcome": "Welcome credits", "purchase": "Pack bought", GIVEN: "Given by you", REMOVED: "Removed by you",
           "resume_ai": "Resume AI"}


def credit_text(entry: CreditEntry) -> str:
    """One ledger line in words: why, and the admin's own reason when it was by hand."""
    label = _REASON.get(entry.reason, entry.reason)
    return f"{label}: {entry.note}" if entry.note else label


def credit_amount(entry: CreditEntry) -> str:
    unit = "resume credit" if entry.kind == "resume" else "interview min"
    n: float = entry.amount if entry.kind == "resume" else round(entry.amount / 60, 1)
    return f"{'+' if n > 0 else ''}{n:g} {unit}{'s' if abs(n) != 1 else ''}"


@router.get("/users/{user_id}/activity", response_model=ActivityOut)
async def user_activity(user_id: str, _: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ActivityOut:
    """One account's history, newest first: credits in and out, sessions with the minutes each used, payments."""
    if await db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    items: list[ActivityItem] = []
    for e in (await db.scalars(select(CreditEntry).where(CreditEntry.user_id == user_id,
                                                         CreditEntry.kind != "resume_fix")
                               .order_by(CreditEntry.created_at.desc()).limit(100))).all():
        items.append(ActivityItem(at=_aware(e.created_at), kind="credit", text=credit_text(e),
                                  amount=credit_amount(e)))
    used: dict[str | None, float] = {sid: float(total or 0) for sid, total in (await db.execute(
        select(UsageEvent.session_id, func.sum(UsageEvent.quantity))
        .where(UsageEvent.user_id == user_id, UsageEvent.metric.in_(credits.INTERVIEW_METRICS))
        .group_by(UsageEvent.session_id))).all()}
    for row in (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user_id)
                                 .order_by(LiveSessionRow.created_at.desc()).limit(100))).all():
        minutes = round(float(used.get(row.id) or 0) / 60, 1)
        items.append(ActivityItem(at=_aware(row.started_at or row.created_at), kind="session",
                                  text=f"{row.type.capitalize()} session · {row.status}",
                                  amount=f"-{minutes:g} interview min" if minutes else None))
    for pay in (await db.scalars(select(Payment).where(Payment.user_id == user_id)
                                 .order_by(Payment.created_at.desc()).limit(50))).all():
        items.append(ActivityItem(at=_aware(pay.decided_at or pay.submitted_at or pay.created_at), kind="payment",
                                  text=f"{pay.plan.capitalize()} pack · {pay.status.replace('_', ' ')}",
                                  amount=f"₹{pay.amount_inr:,}"))
    items.sort(key=lambda i: i.at, reverse=True)
    return ActivityOut(items=items[:150])


class AccessIn(BaseModel):
    # grant: a plan for `hours` (from now, or added on to a running grant of the same plan) · approve: Free for good
    # (or whatever they pay for) · revoke: back to waiting, grant cancelled
    action: Literal["grant", "approve", "revoke"]
    plan: Literal["pro", "unlimited"] = "unlimited"
    hours: float = Field(2, gt=0, le=MAX_GRANT_HOURS)


def _until_text(until: datetime) -> str:
    return f"{until:%d %b %Y}, {until:%H:%M} UTC".lstrip("0")


@router.post("/users/{user_id}/access", response_model=AdminUser)
async def set_access(user_id: str, body: AccessIn, background: BackgroundTasks,
                     admin: Annotated[User, Depends(require_admin)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if await is_admin(db, u):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "That's the admin account: it always has full access.")
    now = datetime.now(UTC)
    web = get_settings().web_url.rstrip("/")
    mail: OutgoingEmail | None = None
    if body.action == "grant":
        if body.plan not in GRANT_PLANS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown plan")
        running = active_grant(u, now) == body.plan and u.grant_until is not None
        start = _aware(u.grant_until) if running and u.grant_until else now  # "2 more hours" extends
        u.grant_plan, u.grant_until = body.plan, start + timedelta(hours=body.hours)
        label, until = plan_named(body.plan).label, _until_text(u.grant_until)
        mail = OutgoingEmail(to=u.email, subject=f"You have Orbit {label} until {until}",
                             text=(f"Your Orbit account now has the {label} plan until {until}.\n\n"
                                   f"Sign in and start a session: {web}/login"))
    elif body.action == "approve":
        u.approved = True
        mail = OutgoingEmail(to=u.email, subject="Your Orbit account is ready",
                             text=f"Your Orbit account has been approved. Sign in to get started: {web}/login")
    else:
        u.approved, u.grant_plan, u.grant_until = False, None, None
    db.add(AuditLog(user_id=admin.id, action=f"admin.access.{body.action}",
                    target=f"{u.id} {body.plan} {body.hours}h" if body.action == "grant" else u.id))
    await db.commit()
    await db.refresh(u)
    if mail is not None:
        background.add_task(send_safely, mail)
    return (await admin_rows(db, [u]))[0]


AdminNote = Annotated[str | None, Field(max_length=300)]


class CreditsIn(BaseModel):
    resume: int = Field(0, ge=0, le=1_000)
    interview_minutes: int = Field(0, ge=0, le=6_000)
    # Why, in the admin's words ("refund for a dropped call"): shown in the account's history.
    note: AdminNote = None


@router.post("/users/{user_id}/credits", response_model=AdminUser)
async def give_credits(user_id: str, body: CreditsIn, admin: Annotated[User, Depends(require_admin)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    """Add resume-AI credits and/or interview minutes to an account by hand (a goodwill top-up, a payment made some
    other way). They never expire. (Taking them away: POST /users/{id}/credits/remove.)"""
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not (body.resume or body.interview_minutes):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add some resume credits or interview minutes.")
    note = " ".join((body.note or "").split()) or None
    if body.resume:
        credits.add(db, u.id, "resume", body.resume, GIVEN).note = note
    if body.interview_minutes:
        credits.add(db, u.id, "interview_seconds", body.interview_minutes * 60, GIVEN).note = note
    db.add(AuditLog(user_id=admin.id, action="admin.credits",
                    target=f"{u.id} resume+{body.resume} interview+{body.interview_minutes}m"))
    await db.commit()
    return (await admin_rows(db, [u]))[0]
