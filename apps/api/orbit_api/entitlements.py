"""Plan entitlements (spec §68). Features are checked by name, never by plan string at call sites.
Limits are placeholders — keep real numbers/prices in config, not code, once billing ships."""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.models import Subscription, UsageEvent, User


@dataclass(frozen=True)
class Plan:
    name: str
    live_minutes: int | None  # per calendar month; None = fair-use unlimited
    screenshots: int | None
    documents: int | None
    features: frozenset[str]


PLANS: dict[str, Plan] = {
    "free": Plan("free", 30, 10, 3, frozenset({"live", "documents", "mock"})),
    "pro": Plan("pro", 600, 500, 50, frozenset({"live", "documents", "mock", "coding", "vision"})),
    "unlimited": Plan("unlimited", None, None, None,
                      frozenset({"live", "documents", "mock", "coding", "vision"})),
}


async def is_admin(db: AsyncSession, user: User) -> bool:
    """ORBIT_ADMIN_EMAIL if set, else the first-registered user."""
    admin_email = get_settings().admin_email
    if admin_email:
        return user.email.lower() == admin_email.lower()
    first_id = await db.scalar(select(User.id).order_by(User.created_at.asc(), User.id.asc()).limit(1))
    return first_id == user.id


async def plan_for(db: AsyncSession, user_id: str) -> Plan:
    # The server owner pays the provider bills; capping them at the free tier's 30 live minutes would cut
    # a real interview off mid-way.
    user = await db.get(User, user_id)
    if user is not None and await is_admin(db, user):
        return PLANS["unlimited"]
    sub = await db.scalar(
        select(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
    )
    return PLANS.get(sub.plan if sub else "free", PLANS["free"])


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


async def live_minutes_remaining(db: AsyncSession, user_id: str) -> float | None:
    plan = await plan_for(db, user_id)
    if plan.live_minutes is None:
        return None
    used = await usage_this_month(db, user_id, "live_seconds") / 60
    return max(plan.live_minutes - used, 0.0)
