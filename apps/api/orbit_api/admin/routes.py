"""Admin-only: advanced settings (rotate provider API keys / models in-app), and who may use Orbit.

Users: with sign-up approval on (ORBIT_SIGNUP_APPROVAL), new accounts wait until the admin approves them for good
or grants a plan for a while ("Unlimited for 2 hours"); a grant runs out on its own.

Access is limited to the admin: ORBIT_ADMIN_EMAIL (required in production; in development/test the first
registered user stands in when it's unset).
Secret values are never returned in plaintext (only a "set" flag); they're stored encrypted via
ORBIT_CONFIG_SECRET and applied to live providers immediately after saving.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import GRANT_PLANS, active_grant, awaiting_approval, is_admin, plan_named
from orbit_api.live.metrics import summarize
from orbit_api.models import AppConfig, AuditLog, CreditEntry, LiveSessionRow, Payment, UsageEvent, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.runtime_config import (
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
async def update_config(body: ConfigIn, _: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ConfigOut:
    fields = body.model_dump(exclude_unset=True)
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
    return {"dependencies": health.snapshot(), "llm_failover": failover}


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


class AdminUsage(BaseModel):
    """What an account has had and used, all time."""
    resume_given: int = 0  # resume AI credits from the welcome, packs and the admin
    resume_used: int = 0
    interview_minutes_given: float = 0
    live_minutes_used: float = 0
    mock_minutes_used: float = 0
    sessions: int = 0
    paid_inr: int = 0  # approved UPI payments
    packs: int = 0
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
    totals: AdminTotals | None = None


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _month_start() -> datetime:
    return datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def _usage(db: AsyncSession, ids: list[str]) -> dict[str, AdminUsage]:
    """All-time usage per account, in four grouped queries (not one per account)."""
    out = {uid: AdminUsage() for uid in ids}
    if not ids:
        return out
    for uid, kind, given, spent in (await db.execute(
            select(CreditEntry.user_id, CreditEntry.kind,
                   func.sum(case((CreditEntry.amount > 0, CreditEntry.amount), else_=0)),
                   func.sum(case((CreditEntry.amount < 0, -CreditEntry.amount), else_=0)))
            .where(CreditEntry.user_id.in_(ids)).group_by(CreditEntry.user_id, CreditEntry.kind))).all():
        u = out[uid]
        if kind == "resume":
            u.resume_given, u.resume_used = int(given or 0), int(spent or 0)
        elif kind == "interview_seconds":
            u.interview_minutes_given = round(float(given or 0) / 60, 1)
    for uid, metric, total, last in (await db.execute(
            select(UsageEvent.user_id, UsageEvent.metric, func.sum(UsageEvent.quantity),
                   func.max(UsageEvent.created_at))
            .where(UsageEvent.user_id.in_(ids), UsageEvent.metric.in_(credits.INTERVIEW_METRICS))
            .group_by(UsageEvent.user_id, UsageEvent.metric))).all():
        u = out[uid]
        minutes = round(float(total or 0) / 60, 1)
        if metric == "live_seconds":
            u.live_minutes_used = minutes
        else:
            u.mock_minutes_used = minutes
        if last is not None:
            u.last_active = max(filter(None, (u.last_active, _aware(last))))
    for uid, n, last in (await db.execute(
            select(LiveSessionRow.user_id, func.count(), func.max(LiveSessionRow.created_at))
            .where(LiveSessionRow.user_id.in_(ids)).group_by(LiveSessionRow.user_id))).all():
        out[uid].sessions = int(n)
        if last is not None:
            out[uid].last_active = max(filter(None, (out[uid].last_active, _aware(last))))
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
        CreditEntry.kind == "resume", CreditEntry.amount < 0, CreditEntry.created_at >= month)) or 0)
    paid = int(await db.scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
        Payment.status == "approved")) or 0)
    paid_month = int(await db.scalar(select(func.coalesce(func.sum(Payment.amount_inr), 0)).where(
        Payment.status == "approved", Payment.decided_at >= month)) or 0)
    waiting = int(await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "submitted")) or 0)
    return AdminTotals(users=users, signups_7d=week, interview_minutes_this_month=round(seconds / 60, 1),
                       resume_credits_used_this_month=resume, paid_inr_total=paid, paid_inr_this_month=paid_month,
                       payments_waiting=waiting)


async def _admin_rows(db: AsyncSession, users: list[User]) -> list[AdminUser]:
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
            interview_minutes_left=round(wallets.get(u.id, (0, 0.0))[1], 1), usage=usage[u.id]))
    return out


@router.get("/users", response_model=UsersOut)
async def list_users(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                     only: Literal["all", "pending"] = "all",
                     q: Annotated[str | None, Query(max_length=120)] = None,
                     limit: Annotated[int, Query(ge=1, le=500)] = 200) -> UsersOut:
    """Newest first. "pending" lists the accounts waiting for you (and ones whose grant ran out); `q` finds an
    account by email or name."""
    query = select(User).order_by(User.created_at.desc()).limit(limit)
    if only == "pending":
        query = query.where(User.approved.is_(False))
    if q and q.strip():
        # Plain text, not a pattern: "%" and "_" mean themselves, so they're dropped (nothing left matches nobody).
        term = q.strip().lower().replace("\\", "").replace("%", "").replace("_", "")
        like = f"%{term}%"
        query = query.where(or_(func.lower(User.email).like(like), func.lower(func.coalesce(User.name, "")).like(like))
                            if term else false())
    rows = await _admin_rows(db, list((await db.scalars(query)).all()))
    if only == "pending":
        rows = [r for r in rows if r.access == "pending"]
    return UsersOut(approval_required=get_settings().approval_required, users=rows, totals=await _totals(db))


class ActivityItem(BaseModel):
    at: datetime
    kind: Literal["credit", "session", "payment"]
    text: str
    amount: str | None = None


class ActivityOut(BaseModel):
    items: list[ActivityItem]


_REASON = {"welcome": "Welcome credits", "purchase": "Pack bought", "admin": "Given by you", "resume_ai": "Resume AI"}


@router.get("/users/{user_id}/activity", response_model=ActivityOut)
async def user_activity(user_id: str, _: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ActivityOut:
    """One account's history, newest first: credits in and out, sessions with the minutes each used, payments."""
    if await db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    items: list[ActivityItem] = []
    for e in (await db.scalars(select(CreditEntry).where(CreditEntry.user_id == user_id)
                               .order_by(CreditEntry.created_at.desc()).limit(100))).all():
        unit = "resume credit" if e.kind == "resume" else "interview min"
        n = e.amount if e.kind == "resume" else round(e.amount / 60)
        items.append(ActivityItem(at=_aware(e.created_at), kind="credit", text=_REASON.get(e.reason, e.reason),
                                  amount=f"{'+' if n > 0 else ''}{n} {unit}{'s' if abs(n) != 1 else ''}"))
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
        assert body.plan in GRANT_PLANS
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
    return (await _admin_rows(db, [u]))[0]


class CreditsIn(BaseModel):
    resume: int = Field(0, ge=0, le=1_000)
    interview_minutes: int = Field(0, ge=0, le=6_000)


@router.post("/users/{user_id}/credits", response_model=AdminUser)
async def give_credits(user_id: str, body: CreditsIn, admin: Annotated[User, Depends(require_admin)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    """Add resume-AI credits and/or interview minutes to an account by hand (a goodwill top-up, a payment made some
    other way). They never expire."""
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not (body.resume or body.interview_minutes):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add some resume credits or interview minutes.")
    if body.resume:
        credits.add(db, u.id, "resume", body.resume, "admin")
    if body.interview_minutes:
        credits.add(db, u.id, "interview_seconds", body.interview_minutes * 60, "admin")
    db.add(AuditLog(user_id=admin.id, action="admin.credits",
                    target=f"{u.id} resume+{body.resume} interview+{body.interview_minutes}m"))
    await db.commit()
    return (await _admin_rows(db, [u]))[0]
