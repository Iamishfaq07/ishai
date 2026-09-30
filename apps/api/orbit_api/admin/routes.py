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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import GRANT_PLANS, active_grant, awaiting_approval, is_admin, plan_named
from orbit_api.live.metrics import summarize
from orbit_api.models import AppConfig, AuditLog, LiveSessionRow, UsageEvent, User
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


class UsersOut(BaseModel):
    approval_required: bool
    users: list[AdminUser]


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


async def _admin_rows(db: AsyncSession, users: list[User]) -> list[AdminUser]:
    month = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    ids = [u.id for u in users]
    used: dict[str, float] = {}
    if ids:
        rows = await db.execute(
            select(UsageEvent.user_id, func.sum(UsageEvent.quantity))
            .where(UsageEvent.user_id.in_(ids), UsageEvent.metric == "live_seconds", UsageEvent.created_at >= month)
            .group_by(UsageEvent.user_id))
        used = {uid: float(total or 0) for uid, total in rows.all()}
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
            live_minutes_this_month=round(float(used.get(u.id) or 0) / 60, 1)))
    return out


@router.get("/users", response_model=UsersOut)
async def list_users(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                     only: Literal["all", "pending"] = "all",
                     limit: Annotated[int, Query(ge=1, le=500)] = 200) -> UsersOut:
    """Newest first. "pending" lists the accounts waiting for you (and ones whose grant ran out)."""
    q = select(User).order_by(User.created_at.desc()).limit(limit)
    if only == "pending":
        q = q.where(User.approved.is_(False))
    rows = await _admin_rows(db, list((await db.scalars(q)).all()))
    if only == "pending":
        rows = [r for r in rows if r.access == "pending"]
    return UsersOut(approval_required=get_settings().approval_required, users=rows)


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
