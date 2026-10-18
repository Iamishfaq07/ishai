"""What Orbit Apply may spend: the applications a plan includes (rules.PLAN_APPLICATIONS per allowance window,
entitlements.period_start; the Free plan's rules.FREE_TRIAL_APPLICATIONS once per account), then top-up credits
(credits.py entries of kind "apply", which never expire).

Only confirmed submissions are charged (rules.py, rule 6). A lease takes one application on hold: from the plan
(`charge` "plan", counted while it's leased) or from the credits (`charge` "credit", a -1 entry). When the lease ends
any way but "submitted" (it runs out, fails, is skipped, needs the candidate), the hold is given back: a plan hold
just stops counting, and a credit hold gets its +1 back.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.auto_apply import rules
from orbit_api.entitlements import period_start, plan_for
from orbit_api.models import ApplicationPacket, User


@dataclass(frozen=True)
class Quota:
    plan: str
    included: int  # this window's (or the Free trial's) applications
    used: int  # of those: submitted, or on hold in a lease
    credits: int  # top-up credits left
    window_start: datetime | None  # None: the Free trial, once per account
    trial: bool

    @property
    def left(self) -> int:
        return max(self.included - self.used, 0) + self.credits


def included_for(plan: str) -> tuple[int, bool]:
    """(applications included, whether they're the once-per-account trial)."""
    if plan in rules.PLAN_APPLICATIONS:
        return rules.PLAN_APPLICATIONS[plan], False
    return rules.FREE_TRIAL_APPLICATIONS, True


async def quota(db: AsyncSession, user: User, now: datetime | None = None) -> Quota:
    now = now or datetime.now(UTC)
    plan = (await plan_for(db, user.id)).name
    included, trial = included_for(plan)
    start = None if trial else period_start(user, now)
    on_plan = (ApplicationPacket.user_id == user.id) & (ApplicationPacket.charge == "plan")
    submitted = ApplicationPacket.status == "submitted"
    if start is not None:
        submitted = submitted & (ApplicationPacket.submitted_at >= start)
    counted = or_(ApplicationPacket.status == "leased", submitted)
    used = await db.scalar(select(func.count()).select_from(ApplicationPacket).where(on_plan, counted)) or 0
    left = await credits.resume_balance(db, user.id, rules.CREDIT_KIND)
    return Quota(plan=plan, included=included, used=int(used), credits=left, window_start=start, trial=trial)


async def hold(db: AsyncSession, user: User, packet: ApplicationPacket) -> bool:
    """Put one application on hold for this lease. False: none left. The caller commits."""
    q = await quota(db, user)
    if q.used < q.included:
        packet.charge = "plan"
        return True
    if q.credits > 0:
        credits.add(db, user.id, rules.CREDIT_KIND, -1, "apply_hold")
        packet.charge = "credit"
        return True
    return False


def release(db: AsyncSession, packet: ApplicationPacket) -> None:
    """Give back the hold of a lease that didn't end in a submission. The caller commits."""
    if packet.charge == "credit":
        credits.add(db, packet.user_id, rules.CREDIT_KIND, 1, "apply_refund")
    packet.charge = None
