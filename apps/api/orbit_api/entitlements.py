"""Plans and entitlements — the one place limits live (spec §68; launch brief §6–§7).

Plans are server-side configuration: defaults below, overridden per plan by `ORBIT_PLANS_JSON` (for example
`{"pro": {"live_minutes": 900, "price_usd_month": 29, "stripe_price_id": "price_..."}}`) and, for the session
ceiling, by `FREE_/PRO_/UNLIMITED_MAX_SESSION_MINUTES`. Clients never decide limits or features: they read them
from `GET /v1/entitlements` (the signed-in user) and `GET /v1/plans` (public, for the pricing page). Call sites
check features by name (`plan.has("vision")`), never by plan id.

Usage is metered in `usage` rows per calendar month (UTC): `live_seconds` for real sessions, `mock_seconds` for
mock interviews, `screenshots` for delivered screenshot answers. Documents are counted, not metered.
"""

import json
import logging
import os
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.models import Document, Subscription, UsageEvent, User

log = logging.getLogger(__name__)

# Feature names (checked by name at call sites).
FEATURES = ("live", "documents", "mock", "vision", "advanced_coding", "system_design", "provider_fallback")


@dataclass(frozen=True)
class Plan:
    name: str
    label: str
    live_minutes: int | None  # per calendar month; None = fair-use unlimited
    mock_minutes: int | None
    screenshots: int | None
    documents: int | None
    # Hard ceiling for one session, even on unlimited plans: an interview left running by accident must end.
    max_session_minutes: int
    features: frozenset[str]
    price_usd_month: float | None = None  # display only; billing charges what Stripe's price says
    stripe_price_id: str | None = None

    def has(self, feature: str) -> bool:
        return feature in self.features


_ALL = frozenset(FEATURES)
DEFAULT_PLANS: dict[str, Plan] = {
    "free": Plan("free", "Free", live_minutes=30, mock_minutes=30, screenshots=10, documents=3,
                 max_session_minutes=60, features=frozenset({"live", "documents", "mock", "vision"}),
                 price_usd_month=0),
    "pro": Plan("pro", "Pro", live_minutes=600, mock_minutes=300, screenshots=500, documents=50,
                max_session_minutes=180, features=_ALL),
    "unlimited": Plan("unlimited", "Unlimited", live_minutes=None, mock_minutes=None, screenshots=None,
                      documents=None, max_session_minutes=240, features=_ALL),
}
_INT_FIELDS = ("live_minutes", "mock_minutes", "screenshots", "documents", "max_session_minutes")


def plans() -> dict[str, Plan]:
    """Defaults + ORBIT_PLANS_JSON + *_MAX_SESSION_MINUTES. Invalid overrides fail loudly (checked at boot)."""
    out = dict(DEFAULT_PLANS)
    raw = get_settings().plans_json
    overrides: dict[str, dict[str, Any]] = json.loads(raw) if raw else {}
    for name, fields in overrides.items():
        if name not in out:
            raise ValueError(f"ORBIT_PLANS_JSON: unknown plan {name!r} (plans are {sorted(out)})")
        changes: dict[str, Any] = {}
        for key, value in fields.items():
            if key in _INT_FIELDS:
                if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                    raise ValueError(f"ORBIT_PLANS_JSON: {name}.{key} must be a non-negative integer or null")
                changes[key] = value
            elif key == "features":
                unknown = set(value) - _ALL
                if unknown:
                    raise ValueError(f"ORBIT_PLANS_JSON: {name}.features has unknown {sorted(unknown)}")
                changes[key] = frozenset(value)
            elif key in ("label", "stripe_price_id", "price_usd_month"):
                changes[key] = value
            else:
                raise ValueError(f"ORBIT_PLANS_JSON: {name}.{key} is not a plan setting")
        out[name] = replace(out[name], **changes)
    for name in out:
        env = os.environ.get(f"{name.upper()}_MAX_SESSION_MINUTES")
        if env:
            out[name] = replace(out[name], max_session_minutes=int(env))
    for p in out.values():
        if p.max_session_minutes is None or p.max_session_minutes <= 0:
            raise ValueError(f"{p.name}: max_session_minutes must be a positive number of minutes")
    return out


def plan_named(name: str) -> Plan:
    return plans().get(name, plans()["free"])


async def is_admin(db: AsyncSession, user: User) -> bool:
    """ORBIT_ADMIN_EMAIL, once that address is verified. Only outside production (where it's optional) does the
    first-registered user stand in: production refuses to start without it, and admin is never inferred from
    registration order there."""
    settings = get_settings()
    if settings.admin_email:
        if user.email.strip().lower() != settings.admin_email.strip().lower():
            return False
        # Whoever registered the address first would otherwise be admin without ever proving the inbox. Only an
        # admin-only deploy with no way to send mail (no SMTP in production) skips the proof: nobody could verify.
        from orbit_api.providers.email import can_deliver

        return user.email_verified or not (settings.verification_required and can_deliver())
    if settings.env == "production":
        return False
    first_id = await db.scalar(select(User.id).order_by(User.created_at.asc(), User.id.asc()).limit(1))
    return first_id == user.id


async def plan_for(db: AsyncSession, user_id: str) -> Plan:
    # The server owner pays the provider bills; capping them at the free tier would cut a real interview off.
    user = await db.get(User, user_id)
    if user is not None and await is_admin(db, user):
        return plans()["unlimited"]
    sub = await db.scalar(
        select(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
    )
    return plan_named(sub.plan if sub else "free")


def _month_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def usage_this_month(db: AsyncSession, user_id: str, metric: str) -> float:
    total = await db.scalar(
        select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
            UsageEvent.user_id == user_id, UsageEvent.metric == metric, UsageEvent.created_at >= _month_start()
        )
    )
    return float(total or 0.0)


def minutes_metric(session_type: str) -> str:
    """Which monthly allowance a session draws on: mock interviews have their own."""
    return "mock_seconds" if session_type == "mock" else "live_seconds"


async def minutes_remaining(db: AsyncSession, user_id: str, session_type: str = "interview") -> float | None:
    """Minutes left this month for this kind of session (None = unlimited)."""
    plan = await plan_for(db, user_id)
    limit = plan.mock_minutes if session_type == "mock" else plan.live_minutes
    if limit is None:
        return None
    used = await usage_this_month(db, user_id, minutes_metric(session_type)) / 60
    return max(limit - used, 0.0)


async def live_minutes_remaining(db: AsyncSession, user_id: str) -> float | None:
    return await minutes_remaining(db, user_id, "interview")


async def for_user(db: AsyncSession, user: User) -> dict[str, Any]:
    """Everything a client may show about the user's plan: limits, this month's usage, features."""
    plan = await plan_for(db, user.id)
    docs = await db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user.id))
    return {
        "plan": plan.name,
        "label": plan.label,
        "limits": {k: getattr(plan, k) for k in _INT_FIELDS},
        "usage": {
            "live_minutes": round(await usage_this_month(db, user.id, "live_seconds") / 60, 1),
            "mock_minutes": round(await usage_this_month(db, user.id, "mock_seconds") / 60, 1),
            "screenshots": int(await usage_this_month(db, user.id, "screenshots")),
            "documents": int(docs or 0),
        },
        "features": {f: plan.has(f) for f in FEATURES},
    }


def public_plans() -> list[dict[str, Any]]:
    out = []
    for p in plans().values():
        d = asdict(p)
        d["features"] = sorted(p.features)
        d.pop("stripe_price_id")  # server-side detail
        out.append(d)
    return out
