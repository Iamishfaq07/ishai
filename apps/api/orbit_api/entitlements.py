"""Plans and entitlements — the one place limits live (spec §68; launch brief §6–§7).

Plans are server-side configuration: defaults below, overridden per plan by `ORBIT_PLANS_JSON` (for example
`{"pro": {"live_minutes": 900, "price_usd_month": 29, "stripe_price_id": "price_..."}}`) and, for the session
ceiling, by `FREE_/PRO_/UNLIMITED_MAX_SESSION_MINUTES`. Clients never decide limits or features: they read them
from `GET /v1/entitlements` (the signed-in user) and `GET /v1/plans` (public, for the pricing page). Call sites
check features by name (`plan.has("vision")`), never by plan id.

Usage is metered in `usage` rows per calendar month (UTC): `live_seconds` for real sessions, `mock_seconds` for
mock interviews, `screenshots` for delivered screenshot answers. Documents are counted, not metered.

The Free plan is credit-based (`Plan.credits`): its interview minutes (live and mock together) and resume AI come
from credits (credits.py: a welcome grant, UPI packs), which never expire, instead of a monthly allowance.

Interview time is charged to one balance as it's metered, and each usage row says which (`usage.pool`, see
`usage_pool`): the credits, or the allowance of the plan in force then. A plan's allowance counts only its own rows,
the credits only theirs, so time on a Pro grant doesn't come out of the credits when the grant ends, and credits spent
earlier in the month don't shrink a Pro allowance.
"""

import json
import logging
import os
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.config import get_settings
from orbit_api.models import Document, Subscription, UsageEvent, User

log = logging.getLogger(__name__)

# Feature names (checked by name at call sites).
# `resume_ai`: unlimited AI in the resume maker; without it each AI action spends a resume credit (credits.py).
FEATURES = ("live", "documents", "mock", "vision", "advanced_coding", "system_design", "provider_fallback",
            "resume_ai")


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
    # Interview time and resume AI come from credits (credits.py: the welcome grant, UPI packs) instead of a monthly
    # allowance; live_minutes / mock_minutes are then unused.
    credits: bool = False

    def has(self, feature: str) -> bool:
        return feature in self.features


_ALL = frozenset(FEATURES)
DEFAULT_PLANS: dict[str, Plan] = {
    "free": Plan("free", "Free", live_minutes=None, mock_minutes=None, screenshots=10, documents=3,
                 max_session_minutes=60, features=frozenset({"live", "documents", "mock", "vision"}),
                 price_usd_month=0, credits=True),
    # Sold by the month (billing/monthly.py): unlimited resume AI and a modest interview allowance.
    "basic": Plan("basic", "Basic", live_minutes=120, mock_minutes=180, screenshots=100, documents=20,
                  max_session_minutes=90, features=_ALL),
    "pro": Plan("pro", "Pro", live_minutes=600, mock_minutes=300, screenshots=500, documents=50,
                max_session_minutes=180, features=_ALL),
    # The paid plans' (billing/monthly.py): the copilot at the market's "unlimited" level, under a fair-use cap.
    "premium": Plan("premium", "Premium", live_minutes=3000, mock_minutes=1500, screenshots=None, documents=None,
                    max_session_minutes=240, features=_ALL),
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


# A new account the admin hasn't approved yet (ORBIT_SIGNUP_APPROVAL): nothing that costs anything. Not a real
# plan: never listed, never configurable.
PENDING = Plan("pending", "Awaiting approval", live_minutes=0, mock_minutes=0, screenshots=0, documents=0,
               max_session_minutes=1, features=frozenset())
GRANT_PLANS = ("basic", "pro", "premium", "unlimited")


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


# ---- plans for a while: the admin's grants and paid months (D57) ---------------------------------------------------
#
# The running grant is User.grant_plan until User.grant_until; grants waiting their turn are User.grant_queue, each
# starting when the one before it ends. Nothing given or paid is ever cut short: the same plan again is added on;
# a higher plan runs now and what's left of the running one waits behind it; a lower plan waits behind the running
# one. Readers work the timeline out at any moment (`current_grant`); writers `roll` it forward first.


@dataclass(frozen=True)
class Grant:
    plan: str
    start: datetime | None  # when it runs from (None: an older grant, start not kept)
    until: datetime
    paid: bool  # bought (a paid month), not given by the admin: for the record; both get the whole allowance
    anchor: datetime | None  # where its 30-day allowance windows count from (None: an older grant)


def tier(plan: str) -> int:
    return GRANT_PLANS.index(plan) if plan in GRANT_PLANS else -1


def _when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _aware(value)
    return _aware(datetime.fromisoformat(value)) if isinstance(value, str) and value else None


def grants(user: Any) -> list[Grant]:
    """The account's grants in the order they run: the running (or last) one, then the queue. `user` may be any
    object with the grant fields (tests use plain namespaces without the newer ones)."""
    plan, until = getattr(user, "grant_plan", None), getattr(user, "grant_until", None)
    if not plan or until is None:
        return []
    anchor = _when(getattr(user, "grant_started_at", None))
    out = [Grant(plan, anchor, _aware(until), bool(getattr(user, "grant_paid", False)), anchor)]
    for item in getattr(user, "grant_queue", None) or []:
        start = out[-1].until
        out.append(Grant(str(item["plan"]), start, start + timedelta(seconds=float(item["seconds"])),
                         bool(item.get("paid")), _when(item.get("anchor")) or start))
    return out


def current_grant(user: Any, now: datetime | None = None) -> Grant | None:
    """The grant in force at `now`, if any."""
    now = now or datetime.now(UTC)
    return next((g for g in grants(user) if g.until > now and (g.start is None or g.start <= now)), None)


def active_grant(user: Any, now: datetime | None = None) -> str | None:
    """The plan the admin granted, or that was bought, for a while, if one is running now."""
    g = current_grant(user, now)
    return g.plan if g else None


def roll(user: User, now: datetime | None = None) -> None:
    """Moves the stored timeline to `now`: grants that ended make way for the next in the queue (each starting when
    the one before ended). Readers don't need it; anything that changes the grants calls it first."""
    now = now or datetime.now(UTC)
    queue = list(user.grant_queue or [])
    while queue and user.grant_until is not None and _aware(user.grant_until) <= now:
        item, queue = queue[0], queue[1:]
        start = _aware(user.grant_until)
        user.grant_plan, user.grant_until = str(item["plan"]), start + timedelta(seconds=float(item["seconds"]))
        user.grant_started_at, user.grant_paid = _when(item.get("anchor")) or start, bool(item.get("paid"))
    user.grant_queue = queue or None


def add_grant(user: User, plan: str, length: timedelta, *, paid: bool, now: datetime | None = None) -> Grant:
    """`plan` for `length` more, without cutting anything short (D57). Returns that grant as it now stands (running,
    or waiting its turn). The caller commits.

    A paid one is a grant of its own even when the same plan runs: it starts where that one ends, with windows (and
    a whole allowance) of its own, so a week renewed early doesn't share the first week's. The admin's "more of the
    same" adds on to the grant running (or waiting)."""
    now = now or datetime.now(UTC)
    roll(user, now)
    running = current_grant(user, now)
    if running is None:  # nothing running (or only one that ended): it starts now
        user.grant_plan, user.grant_until, user.grant_started_at, user.grant_paid = plan, now + length, now, paid
        user.grant_queue = None
    elif running.plan == plan and not paid:  # the admin's "2 more hours": added on where it ends
        user.grant_until = running.until + length
    else:
        queue = [dict(q) for q in user.grant_queue or []]
        waiting = None if paid else next((q for q in queue if q["plan"] == plan), None)
        if waiting is not None:  # the admin's time for a plan already waiting its turn: that wait gets longer
            waiting["seconds"] = float(waiting["seconds"]) + length.total_seconds()
        elif running.plan != plan and tier(plan) > tier(running.plan):  # higher: now; the rest waits behind it
            anchor = running.anchor.isoformat() if running.anchor else None
            queue.insert(0, {"plan": running.plan, "seconds": (running.until - now).total_seconds(),
                             "paid": running.paid, "anchor": anchor})
            user.grant_plan, user.grant_until, user.grant_started_at, user.grant_paid = plan, now + length, now, paid
        else:  # a lower plan, or a paid renewal of this one: it waits until what's ahead of it ends
            queue.append({"plan": plan, "seconds": length.total_seconds(), "paid": paid, "anchor": None})
        queue.sort(key=lambda q: -tier(str(q["plan"])))  # the best of what's waiting runs next (stable: in order)
        user.grant_queue = queue or None
    return [g for g in grants(user) if g.plan == plan][-1]


def running_until(user: Any, now: datetime | None = None) -> datetime | None:
    """When the plan in force now stops: the end of its grant and of any of the same plan right after it (a renewal
    bought early is a grant of its own, but the plan doesn't stop in between)."""
    timeline = grants(user)
    g = current_grant(user, now)
    if g is None:
        return None
    end = g.until
    for later in timeline[timeline.index(g) + 1:]:
        if later.plan != g.plan or later.start != end:
            break
        end = later.until
    return end


def clear_grants(user: User) -> None:
    user.grant_plan = user.grant_until = user.grant_started_at = None
    user.grant_paid, user.grant_queue = False, None


async def roll_due_grants(now: datetime | None = None) -> int:
    """The sweeper's pass: accounts whose running grant ended with another waiting get that one stored as running, so
    lists that filter on grant_until (the admin's) see it. Each under its account lock, as payments take it. Returns
    how many moved on."""
    from orbit_api.db import sessionmaker
    from orbit_api.transactions import lock_account

    now = now or datetime.now(UTC)
    async with sessionmaker()() as db:
        ids = list((await db.scalars(select(User.id).where(User.grant_queue.is_not(None), User.grant_until <= now)
                                     .limit(500))).all())
        for uid in ids:
            await lock_account(db, uid)
            user = await db.get(User, uid, populate_existing=True)
            if user is not None:
                roll(user, now)
            await db.commit()
    return len(ids)


def awaiting_approval(user: User) -> bool:
    """Signed up while approval was on, and neither approved nor on a running grant. Turning approval off
    releases everyone."""
    return get_settings().approval_required and not user.approved and active_grant(user) is None


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
    if user is not None and (granted := active_grant(user)):
        return plan_named(granted)
    sub = await db.scalar(
        select(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
    )
    if sub is not None:
        return plan_named(sub.plan)
    return PENDING if user is not None and awaiting_approval(user) else plans()["free"]


def _month_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


PERIOD = timedelta(days=30)


def allowance_window(user: Any, now: datetime | None = None) -> tuple[datetime, datetime, Grant] | None:
    """The allowance window of the grant running now: 30 days at a time from when it was bought or given (so use from
    before never counts, and a month bought on the 28th is one allowance, not two calendar months'), the last one
    ending with the grant. Every window has the plan's whole allowance, a week's or a year's last few days included:
    it's a fair-use cap, and the pricing promises it ("50 hours of live interview help"). An older grant with no
    start kept counts its windows back from its end, as before."""
    now = now or datetime.now(UTC)
    g = current_grant(user, now)
    if g is None:
        return None
    if g.anchor is None:
        periods = -((now - g.until) // PERIOD)  # whole 30-day periods left, rounded up
        start = g.until - periods * PERIOD
    else:
        start = g.anchor + ((now - g.anchor) // PERIOD) * PERIOD
    return start, min(start + PERIOD, g.until), g


def period_start(user: Any, now: datetime | None = None) -> datetime:
    """Where this allowance period began: the window of a plan for a while (`allowance_window`); else the calendar
    month (UTC)."""
    now = now or datetime.now(UTC)
    window = allowance_window(user, now) if user is not None else None
    if window is not None:
        return window[0]
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def usage_this_month(db: AsyncSession, user_id: str, metric: str, pool: str | None = None) -> float:
    """This allowance period's total of `metric` (period_start: the calendar month, or the 30 days of a paid month);
    with `pool`, only the interview time drawn from that balance (and rows from before pools were recorded)."""
    since = period_start(await db.get(User, user_id))
    where = [UsageEvent.user_id == user_id, UsageEvent.metric == metric, UsageEvent.created_at >= since]
    if pool is not None:
        where.append(or_(UsageEvent.pool == pool, UsageEvent.pool.is_(None)))
    total = await db.scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(*where))
    return float(total or 0.0)


def minutes_metric(session_type: str) -> str:
    """Which monthly allowance a session draws on: mock interviews have their own."""
    return "mock_seconds" if session_type == "mock" else "live_seconds"


def usage_pool(plan: Plan) -> str:
    """The balance interview time comes out of while `plan` is the account's (`usage.pool`): the credits on a credit
    plan, else that plan's own monthly allowance. Fixed on each usage row when it's written."""
    return credits.POOL if plan.credits else plan.name


async def minutes_remaining(db: AsyncSession, user_id: str, session_type: str = "interview",
                            plan: Plan | None = None) -> float | None:
    """Minutes left for this kind of session (None = unlimited): the interview credits on a credit plan (live and
    mock draw on the same balance), else what this month's allowance has left after the time used on this plan.
    `plan`: the account's plan when the caller already has it."""
    plan = plan or await plan_for(db, user_id)
    if plan.credits:
        return await credits.interview_minutes_left(db, user_id)
    limit = plan.mock_minutes if session_type == "mock" else plan.live_minutes
    if limit is None:
        return None
    used = await usage_this_month(db, user_id, minutes_metric(session_type), usage_pool(plan)) / 60
    return max(limit - used, 0.0)


async def live_minutes_remaining(db: AsyncSession, user_id: str) -> float | None:
    return await minutes_remaining(db, user_id, "interview")


async def for_user(db: AsyncSession, user: User) -> dict[str, Any]:
    """Everything a client may show about the user's plan: limits, this month's usage, features."""
    s = get_settings()
    plan = await plan_for(db, user.id)
    docs = await db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user.id))
    grant_until = running_until(user)
    limits: dict[str, Any] = {k: getattr(plan, k) for k in _INT_FIELDS}
    live_used = round(await usage_this_month(db, user.id, "live_seconds", usage_pool(plan)) / 60, 1)
    mock_used = round(await usage_this_month(db, user.id, "mock_seconds", usage_pool(plan)) / 60, 1)
    wallet: dict[str, Any] | None = None
    if plan.credits:
        granted_s, used_s = await credits.interview_seconds(db, user.id)
        wallet = {
            "resume": None if plan.has("resume_ai") else await credits.resume_balance(db, user.id),
            "interview_minutes_left": round(max(granted_s - used_s, 0) / 60, 1),
            "interview_minutes_total": round(granted_s / 60, 1),
            # Signed up while the free starter credits were on offer but never got any (they go to one account per
            # network a month, and one per inbox): the app says why its balance is zero rather than leave a bare 0.
            "welcome_missed": bool(s.welcome_resume_credits or s.welcome_interview_minutes)
            and await credits.never_credited(db, user.id),
        }
        # Older clients read limits/usage: show the one interview balance there (live and mock share it).
        limits["live_minutes"] = limits["mock_minutes"] = round(granted_s / 60)
        live_used = mock_used = round(used_s / 60, 1)
    return {
        "plan": plan.name,
        "label": plan.label,
        # When the admin granted this plan for a while: when it runs out (then it's Free, or awaiting approval).
        "until": _aware(grant_until).isoformat() if grant_until else None,
        "limits": limits,
        "usage": {
            "live_minutes": live_used,
            "mock_minutes": mock_used,
            "screenshots": int(await usage_this_month(db, user.id, "screenshots", usage_pool(plan))),
            "documents": int(docs or 0),
        },
        "features": {f: plan.has(f) for f in FEATURES},
        # Credit plans: what's left to spend (never expires). None on plans with their own allowances.
        "credits": wallet,
    }


def public_plans() -> list[dict[str, Any]]:
    s = get_settings()
    out = []
    for p in plans().values():
        d = asdict(p)
        d["features"] = sorted(p.features)
        d.pop("stripe_price_id")  # server-side detail
        if p.credits:  # what a new account starts with
            d["welcome"] = {"resume_credits": s.welcome_resume_credits,
                            "interview_minutes": s.welcome_interview_minutes}
        out.append(d)
    return out
