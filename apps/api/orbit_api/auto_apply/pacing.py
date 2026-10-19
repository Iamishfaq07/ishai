"""What's due, enforced by the server (rules.py, rule 5). The executor asks `GET /v1/apply/next` and gets a packet only
when everything below allows one:

- the setup is consented to and not paused, and it isn't the candidate's quiet hours;
- today's (their own day's) submissions plus the one in hand are under their daily limit (at most 25);
- nothing else is leased right now (one application at a time), and the last one was 60 s or more ago;
- the packet's ATS board last saw one of theirs at least its random 3-8 minutes ago;
- its site isn't paused (by the admin, or by the kill switch below);
- the company has had fewer than two of theirs in 30 days;
- there's an application left to hold (quota.py).

The kill switch: after each result, the last 20 results on that site in the past day are read. With 8 or more of
them and 40% or more a captcha, a block or a failure, the site pauses for everyone for 6 hours.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import quota, rules
from orbit_api.auto_apply.setup import in_quiet_hours
from orbit_api.models import ApplicationPacket, ApplySiteState, AutoApplySetup, User
from orbit_api.transactions import lock_account

log = logging.getLogger(__name__)
OPEN = ("needs_answer", "review", "ready", "leased")  # prepared, not yet ended


def aware(when: datetime | None) -> datetime | None:
    return when if when is None or when.tzinfo else when.replace(tzinfo=UTC)


def local_day_start(now: datetime, tz_offset_min: int) -> datetime:
    """Midnight of the candidate's own day, in UTC."""
    local = now + timedelta(minutes=tz_offset_min)
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(minutes=tz_offset_min)


def quiet_until(setup: AutoApplySetup, now: datetime) -> datetime | None:
    """The end of the quiet hours the candidate is in now, or None."""
    local = now + timedelta(minutes=setup.tz_offset_min or 0)
    minute = local.hour * 60 + local.minute
    if not in_quiet_hours(setup.quiet_start, setup.quiet_end, minute):
        return None
    end = setup.quiet_end or 0
    wait = (end - minute) % 1440
    return (now + timedelta(minutes=wait)).replace(second=0, microsecond=0)


async def paused_sites(db: AsyncSession, now: datetime) -> dict[str, str]:
    rows = (await db.scalars(select(ApplySiteState))).all()
    out: dict[str, str] = {}
    for r in rows:
        until = aware(r.auto_paused_until)
        if r.admin_paused:
            out[r.site] = r.reason or "Paused by Orbit."
        elif until is not None and until > now:
            out[r.site] = r.reason or "Paused for a while: too many blocks on this site."
    return out


async def evaluate_site(db: AsyncSession, site: str, now: datetime) -> bool:
    """The kill switch, after a result on `site`. True when it just paused the site. The caller commits."""
    if site not in rules.ATS_SUPPORTED:
        return False
    rows = (await db.execute(
        select(ApplicationPacket.result_status, ApplicationPacket.result_reason)
        .where(ApplicationPacket.ats == site, ApplicationPacket.result_at >= now - rules.KILL_LOOKBACK,
               ApplicationPacket.result_status.is_not(None))
        .order_by(ApplicationPacket.result_at.desc()).limit(rules.KILL_WINDOW))).all()
    if len(rows) < rules.KILL_MIN_RESULTS:
        return False
    bad = sum(1 for status, reason in rows if status == "failed" or reason in rules.BAD_REASONS)
    if bad / len(rows) < rules.KILL_RATE:
        return False
    state = await db.get(ApplySiteState, site)
    if state is None:
        state = ApplySiteState(site=site)
        db.add(state)
    until = aware(state.auto_paused_until)
    if until is not None and until > now:
        return False
    state.auto_paused_until = now + rules.KILL_PAUSE
    state.reason = (f"Paused for {int(rules.KILL_PAUSE.total_seconds() // 3600)} hours: {bad} of the last "
                    f"{len(rows)} attempts hit a captcha, a block or an error.")
    log.warning("orbit apply: %s paused (%d/%d bad)", site, bad, len(rows))
    return True


async def expire(db: AsyncSession, now: datetime, user_id: str | None = None) -> int:
    """Leases that ran out go back in the queue (their hold given back), or end after MAX_ATTEMPTS; prepared packets
    past `expires_at` end. Returns how many changed. The caller commits."""
    q = select(ApplicationPacket).where(or_(
        (ApplicationPacket.status == "leased") & (ApplicationPacket.lease_until < now),
        ApplicationPacket.status.in_(("ready", "review", "needs_answer")) & (ApplicationPacket.expires_at < now)))
    if user_id is not None:
        q = q.where(ApplicationPacket.user_id == user_id)
    changed = 0
    for p in (await db.scalars(q.limit(500))).all():
        changed += 1
        if p.status == "leased":
            quota.release(db, p)
            if p.attempts >= rules.MAX_ATTEMPTS or (aware(p.expires_at) or now) < now:
                p.status, p.reason = "expired", "The browser didn't finish it in time, a few times. Try it again."
            else:
                p.status = "ready"
                p.not_before = now + rules.MIN_GAP
            p.lease_until = p.lease_holder = None
        else:
            p.status, p.reason = "expired", "Not sent in time: the post may have changed since it was prepared."
    return changed


@dataclass
class Due:
    packet: ApplicationPacket | None
    why: str | None = None  # not_set_up | paused | quiet_hours | daily_limit | busy | pacing | no_quota | none
    next_at: datetime | None = None


async def today_count(db: AsyncSession, user_id: str, setup: AutoApplySetup, now: datetime) -> int:
    start = local_day_start(now, setup.tz_offset_min or 0)
    n = await db.scalar(select(func.count()).select_from(ApplicationPacket).where(
        ApplicationPacket.user_id == user_id,
        or_((ApplicationPacket.status == "submitted") & (ApplicationPacket.submitted_at >= start),
            ApplicationPacket.status == "leased")))
    return int(n or 0)


def daily_limit(setup: AutoApplySetup) -> int:
    return max(1, min(setup.daily_limit or rules.DEFAULT_DAILY_LIMIT, rules.MAX_DAILY_LIMIT))


async def company_count(db: AsyncSession, user_id: str, company_key: str, now: datetime,
                        exclude_id: str | None = None) -> int:
    """This candidate's applications to one company in the last 30 days: submitted, leased or prepared to go."""
    q = select(func.count()).select_from(ApplicationPacket).where(
        ApplicationPacket.user_id == user_id, ApplicationPacket.company_key == company_key,
        or_((ApplicationPacket.status == "submitted") & (
            ApplicationPacket.submitted_at >= now - rules.PER_COMPANY_WINDOW),
            ApplicationPacket.status.in_(OPEN)))
    if exclude_id is not None:
        q = q.where(ApplicationPacket.id != exclude_id)
    return int(await db.scalar(q) or 0)


async def next_due(db: AsyncSession, user: User, now: datetime | None = None, holder: str = "",
                   allowed_ats: tuple[str, ...] = rules.ATS_SUPPORTED) -> Due:
    """The packet to lease now, held and leased (the caller commits), or why there's none and when to ask again.

    Idempotent for the device holding a lease (`holder`: its session id): while its lease runs, asking again returns
    the same packet, unchanged (same lease end, no second hold), so an executor that restarted mid-application picks
    up where it was instead of being told it's busy. Any other device is told `busy`: one application at a time."""
    now = now or datetime.now(UTC)
    await lock_account(db, user.id)
    await db.refresh(user)
    await expire(db, now, user.id)
    setup = await db.get(AutoApplySetup, user.id)
    if setup is None or setup.consent_at is None:
        return Due(None, "not_set_up")
    if setup.paused:
        return Due(None, "paused")
    mine = ApplicationPacket.user_id == user.id
    held = (await db.scalars(select(ApplicationPacket).where(mine, ApplicationPacket.status == "leased")
                             .order_by(ApplicationPacket.leased_at.desc()))).all()
    if held:
        current = held[0]
        if (current.lease_holder or "") == holder and (aware(current.lease_until) or now) > now:
            return Due(current)
        until = aware(current.lease_until)
        return Due(None, "busy", until if until is not None and until > now else now + rules.MIN_GAP)
    if (until := quiet_until(setup, now)) is not None:
        return Due(None, "quiet_hours", until)
    if await today_count(db, user.id, setup, now) >= daily_limit(setup):
        return Due(None, "daily_limit", local_day_start(now, setup.tz_offset_min or 0) + timedelta(days=1))
    last = aware(await db.scalar(select(func.max(ApplicationPacket.leased_at)).where(mine)))
    if last is not None and now - last < rules.MIN_GAP:
        return Due(None, "pacing", last + rules.MIN_GAP)
    paused = await paused_sites(db, now)
    candidates = (await db.scalars(select(ApplicationPacket).where(
        mine, ApplicationPacket.status == "ready", ApplicationPacket.ats.in_(allowed_ats),
        ApplicationPacket.expires_at > now).order_by(ApplicationPacket.not_before, ApplicationPacket.match_score.desc())
        .limit(100))).all()
    if not candidates:
        return Due(None, "none")
    tenant_last: dict[tuple[str, str], datetime] = {
        (ats, tenant): when for ats, tenant, when in (await db.execute(
            select(ApplicationPacket.ats, ApplicationPacket.tenant, func.max(ApplicationPacket.leased_at))
            .where(mine, ApplicationPacket.leased_at.is_not(None))
            .group_by(ApplicationPacket.ats, ApplicationPacket.tenant))).all() if when is not None}
    soonest: datetime | None = None
    for p in candidates:
        not_before = aware(p.not_before) or now
        if p.ats in paused:
            continue
        wait_until = not_before
        seen = aware(tenant_last.get((p.ats, p.tenant)))
        if seen is not None:
            wait_until = max(wait_until, seen + timedelta(seconds=p.tenant_gap_s))
        if wait_until > now:
            soonest = wait_until if soonest is None else min(soonest, wait_until)
            continue
        if await company_count(db, user.id, p.company_key, now, exclude_id=p.id) >= rules.PER_COMPANY_LIMIT:
            p.status, p.reason = "skipped", "Already two applications to this company in the last 30 days."
            continue
        if not await quota.hold(db, user, p):
            return Due(None, "no_quota")
        p.status, p.leased_at, p.lease_until, p.lease_holder = "leased", now, now + rules.LEASE, holder
        p.attempts += 1
        p.not_before = now
        return Due(p)
    return Due(None, "pacing" if soonest else "none", soonest)
