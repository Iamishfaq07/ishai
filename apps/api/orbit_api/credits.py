"""Credits: what a Free account can spend, and what a UPI pack buys. They never expire.

Two balances (rows in `credit_entries`):
- **resume**: one per resume-maker AI action (import, rewrite, tailor, cover letter); spent by resumes/allowance.py.
- **interview_seconds**: live interviews and mock interviews alike. The grants are entries; the spending is the
  usage rows the live socket already meters every heartbeat (`live_seconds` + `mock_seconds`), counted from the
  account's first interview grant, so a session ends cleanly when the balance runs out.

Credits come from:
- **the welcome grant** at sign-up (ORBIT_WELCOME_RESUME_CREDITS = 1 and ORBIT_WELCOME_INTERVIEW_MINUTES = 20). Sign-up
  needs no approval or email check, so a network (IP) gets one welcome per ORBIT_WELCOME_IP_DAYS (30), and at most
  ORBIT_WELCOME_DAILY accounts get one a rolling day. Another account from the same network starts at zero and can
  buy a pack;
- **UPI packs** (billing/packs.py), once the admin approves the payment;
- **the admin**, by hand.

Plans with their own allowances (the admin's Unlimited, Pro or Unlimited granted for a while) don't use credits:
`entitlements.plan_for` decides, and only the Free plan is credit-based.
"""

import asyncio
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.models import CreditEntry, UsageEvent, User

Kind = Literal["resume", "interview_seconds"]
INTERVIEW_METRICS = ("live_seconds", "mock_seconds")
# Like the rate limits: in the test environment every account gets its welcome credits (the suite signs everyone up
# from one address); welcome tests flip this.
ENFORCE_IN_TESTS = False
# One sign-up at a time decides and commits its welcome grant, so two at once from one network can't both get it.
# One API instance (docs/DECISIONS.md D12), so an in-process lock is enough.
_welcome_lock = asyncio.Lock()
_GMAIL = frozenset({"gmail.com", "googlemail.com"})


def ip_hash(ip: str) -> str:
    """A keyed hash of the caller's network (an IPv4 address or an IPv6 /64: one connection usually owns a whole
    /64), so the table never holds anyone's address and rotating within a /64 isn't a new network."""
    from orbit_api.ratelimit import network_of

    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"welcome:{network_of(ip)}".encode(), hashlib.sha256).hexdigest()


def inbox(email: str) -> str:
    """The mailbox an address really reaches: "+tags" dropped, and for Gmail the dots too (a.sha+1@gmail.com is
    asha@gmail.com), so one inbox can't collect a welcome per spelling."""
    local, _, domain = email.strip().lower().rpartition("@")
    local = local.split("+", 1)[0]
    if domain in _GMAIL:
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def email_hash(email: str) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"welcome-inbox:{inbox(email)}".encode(), hashlib.sha256).hexdigest()


def add(db: AsyncSession, user_id: str, kind: Kind, amount: int, reason: str, *, payment_id: str | None = None,
        ip: str | None = None, email: str | None = None) -> CreditEntry:
    """Stage one credit movement (the caller commits)."""
    entry = CreditEntry(user_id=user_id, kind=kind, amount=amount, reason=reason, payment_id=payment_id,
                        ip_hash=ip_hash(ip) if ip else None, email_hash=email_hash(email) if email else None)
    db.add(entry)
    return entry


async def grant_welcome(db: AsyncSession, user: User, ip: str) -> bool:
    """The welcome credits, unless this network had them recently, this inbox ever had them (however it's spelled,
    and after deleting the account), or today's cap is reached. Decided and committed under a lock; returns whether
    they were granted."""
    s = get_settings()
    if not (s.welcome_resume_credits or s.welcome_interview_minutes):
        return False
    async with _welcome_lock:
        now = datetime.now(UTC)
        welcome = CreditEntry.reason == "welcome"
        same_network = welcome & (CreditEntry.ip_hash == ip_hash(ip))
        if s.welcome_ip_days:
            same_network = same_network & (CreditEntry.created_at >= now - timedelta(days=s.welcome_ip_days))
        same_inbox = welcome & (CreditEntry.email_hash == email_hash(user.email))
        if s.env != "test" or ENFORCE_IN_TESTS:
            if await db.scalar(select(exists().where(same_network | same_inbox))):
                return False
            today = await db.scalar(select(func.count(func.distinct(CreditEntry.user_id))).where(
                welcome, CreditEntry.ip_hash.is_not(None), CreditEntry.created_at >= now - timedelta(days=1)))
            if (today or 0) >= s.welcome_daily_limit:
                return False
        if s.welcome_resume_credits:
            add(db, user.id, "resume", s.welcome_resume_credits, "welcome", ip=ip, email=user.email)
        if s.welcome_interview_minutes:
            add(db, user.id, "interview_seconds", s.welcome_interview_minutes * 60, "welcome", ip=ip,
                email=user.email)
        await db.commit()
    return True


async def resume_balance(db: AsyncSession, user_id: str) -> int:
    total = await db.scalar(select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
        CreditEntry.user_id == user_id, CreditEntry.kind == "resume"))
    return max(int(total or 0), 0)


async def interview_seconds(db: AsyncSession, user_id: str) -> tuple[int, float]:
    """(granted, used): interview seconds granted, and live + mock seconds used since the first grant."""
    granted, since = (await db.execute(
        select(func.coalesce(func.sum(CreditEntry.amount), 0), func.min(CreditEntry.created_at))
        .where(CreditEntry.user_id == user_id, CreditEntry.kind == "interview_seconds"))).one()
    if since is None:
        return 0, 0.0
    used = await db.scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
        UsageEvent.user_id == user_id, UsageEvent.metric.in_(INTERVIEW_METRICS), UsageEvent.created_at >= since))
    return int(granted or 0), float(used or 0.0)


async def interview_minutes_left(db: AsyncSession, user_id: str) -> float:
    granted, used = await interview_seconds(db, user_id)
    return max(granted - used, 0.0) / 60


async def balances(db: AsyncSession, user_ids: list[str]) -> dict[str, tuple[int, float]]:
    """Many accounts at once (the admin's list): user id -> (resume credits, interview minutes left), in 2 queries."""
    if not user_ids:
        return {}
    rows = (await db.execute(
        select(CreditEntry.user_id, CreditEntry.kind, func.sum(CreditEntry.amount))
        .where(CreditEntry.user_id.in_(user_ids)).group_by(CreditEntry.user_id, CreditEntry.kind))).all()
    resume = {uid: int(total or 0) for uid, kind, total in rows if kind == "resume"}
    granted = {uid: int(total or 0) for uid, kind, total in rows if kind == "interview_seconds"}
    used: dict[str, float] = {}
    if granted:
        first = (select(CreditEntry.user_id.label("uid"), func.min(CreditEntry.created_at).label("since"))
                 .where(CreditEntry.kind == "interview_seconds", CreditEntry.user_id.in_(list(granted)))
                 .group_by(CreditEntry.user_id).subquery())
        used = {uid: float(total or 0) for uid, total in (await db.execute(
            select(UsageEvent.user_id, func.sum(UsageEvent.quantity))
            .join(first, first.c.uid == UsageEvent.user_id)
            .where(UsageEvent.metric.in_(INTERVIEW_METRICS), UsageEvent.created_at >= first.c.since)
            .group_by(UsageEvent.user_id))).all()}
    return {uid: (max(resume.get(uid, 0), 0), max(granted.get(uid, 0) - used.get(uid, 0.0), 0.0) / 60)
            for uid in user_ids}
