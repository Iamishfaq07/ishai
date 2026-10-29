"""Orbit's weekly tips and offers email, for the accounts that chose it (opt-in only).

- `GET  /v1/newsletter`: the account's choice: true, false, or null when it was never asked (Today asks once).
- `PUT  /v1/newsletter`: change it ({subscribed, source}). Sign-up can choose it too (auth/routes.py).
- `POST /v1/newsletter/off`: the email's stop link ({token}), without signing in.
- `GET  /v1/admin/newsletter`: how many chose it, said no, or were never asked, and how many got it this week.
- `POST /v1/admin/newsletter/preview`: this week's email for the admin's own account, sent to the admin.

The email is built from what's true that week, never invented: two of Orbit's tools (the same ones the site
describes), interview guides added or re-checked in the last seven days, the FIRST10 offer only while it runs and
only for accounts that haven't bought anything, and, when the account has an interview coming up, its prep. Sent at
most once a week by the sweeper (sessions/cleanup.py). Nobody who didn't choose it gets it. The admin can put a
note at the top (an offer, news), with a link (runtime_config.py `newsletter_note`, `newsletter_link`).
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import JobApplication, NewsletterChoice, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, get_email_sender
from orbit_api.ratelimit import limit, limit_user
from orbit_api.runtime_config import get_effective_config

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/newsletter", tags=["account"])
_limit = Depends(limit_user("newsletter", rate_per_s=1, burst=10))
_off_limit = Depends(limit("newsletter-off", 0.2, 10))

WEEK = timedelta(days=7)
SLACK = timedelta(hours=2)
BATCH = 50
MAX_GUIDES = 5
Source = Literal["signup", "settings", "today"]

# The tools a week's email can feature, two at a time in turn: what each does, in the site's own words.
TOOLS: tuple[tuple[str, str, str], ...] = (
    ("Interview Atlas", "Search any company or role for its interview process, what interviewers listen for and "
     "practice questions, free.", "/interview-questions"),
    ("Plan my prep", "On any company guide, pick your interview date and get a day-by-day plan you can add to your "
     "calendar, free.", "/interview-questions"),
    ("Your questions, from your resume", "On any guide, Orbit's AI reads your resume and writes the questions you're "
     "most likely to get, with answer outlines from your own experience.", "/interview-questions"),
    ("Mock interviews", "Practise out loud with an AI interviewer that follows up on what you say and scores every "
     "answer.", "/mock"),
    ("Resume ATS score", "See how your resume scores against a job post and what's missing; the score and downloads "
     "are free.", "/resume-ai"),
    ("Jobs matched to you", "New jobs from companies' own careers pages, matched to your resume, with a tracker.",
     "/jobs"),
    ("LinkedIn check", "A score out of 100 for your profile and the fixes to paste in.", "/linkedin"),
    ("Free warm-up", "Answer a few interview questions out loud and see what to tighten, no AI minutes used.",
     "/warmup"),
)


def new_token() -> str:
    return secrets.token_urlsafe(24)


def tools_for(week: date) -> list[tuple[str, str, str]]:
    """This week's two tools: a different pair each ISO week, round the list."""
    n = week.isocalendar().week
    return [TOOLS[(2 * n) % len(TOOLS)], TOOLS[(2 * n + 1) % len(TOOLS)]]


def fresh_guides(now: datetime) -> list[tuple[str, str]]:
    """Guides added or re-checked in the last week: (name, path)."""
    from orbit_api.question_bank import companies, roles

    since = (now - WEEK).date()
    out = [(c.name, f"/companies/{c.slug}", c.reviewed) for c in companies() if c.reviewed >= since]
    out += [(r.name, f"/roles/{r.slug}", r.reviewed) for r in roles() if r.reviewed >= since]
    out.sort(key=lambda g: (g[2], g[0]), reverse=True)
    return [(name, path) for name, path, _ in out[:MAX_GUIDES]]


def _guide_for(company: str) -> str | None:
    from orbit_api.question_bank import companies

    key = company.strip().lower()
    for c in companies():
        if key == c.name.lower() or key in c.aliases:
            return f"/companies/{c.slug}"
    return None


async def _next_interview(db: AsyncSession, user: User, now: datetime) -> tuple[str, datetime] | None:
    row = (await db.execute(select(JobApplication.company, JobApplication.next_at).where(
        JobApplication.user_id == user.id, JobApplication.status == "interviewing",
        JobApplication.next_at >= now, JobApplication.next_at <= now + timedelta(days=14))
        .order_by(JobApplication.next_at).limit(1))).first()
    return (row[0] or "", row[1]) if row else None


async def compose(db: AsyncSession, user: User, token: str, now: datetime) -> OutgoingEmail:
    from orbit_api.billing.referrals import has_paid

    web = get_settings().web_url.rstrip("/")
    offer = get_settings().first_purchase_percent > 0 and not await has_paid(db, user.id)
    tools = tools_for(now.date())
    guides = fresh_guides(now)
    interview = await _next_interview(db, user, now)

    lines = [f"Hi {(user.name or '').split(' ')[0] or 'there'},", ""]
    cfg = get_effective_config()
    if cfg.newsletter_note:
        link = cfg.newsletter_link
        lines += [cfg.newsletter_note] + ([f"{web}{link}" if link.startswith("/") else link] if link else []) + [""]
    if interview:
        company, when = interview
        when = when if when.tzinfo else when.replace(tzinfo=UTC)
        path = _guide_for(company) if company else None
        lines += [f"Your {company or 'next'} interview is on {when:%a %d %b}. Get ready with a day-by-day plan "
                  "and practice questions:", f"{web}{path or '/interview-questions'}", ""]
    if offer:
        lines += [f"Your first pack is {get_settings().first_purchase_percent}% off: enter FIRST10 in the cart. "
                  "First purchase only, one use per account.", f"{web}/billing", ""]
    lines += ["This week's tools:", ""]
    for name, line, path in tools:
        lines += [f"{name}: {line}", f"{web}{path}", ""]
    if guides:
        lines += ["New and updated interview guides:"]
        lines += [f"- {name}: {web}{path}" for name, path in guides]
        lines += [""]
    lines += [f"Everything else is on Today: {web}/"]
    subject = ("Your interview prep, and this week in Orbit" if interview
               else f"{get_settings().first_purchase_percent}% off your first pack, and this week in Orbit" if offer
               else f"This week in Orbit: {tools[0][0]}")
    stop = f"{web}/newsletter/off?token={token}"
    footer = ("You're getting this because you chose Orbit's weekly tips and offers. "
              f"Stop them in one click: {stop} (or in Settings).")
    return OutgoingEmail(to=user.email, subject=subject[:150], text="\n".join(lines), footer=footer,
                         unsubscribe=stop)


async def set_choice(db: AsyncSession, user_id: str, subscribed: bool, source: str) -> NewsletterChoice:
    """Record the choice (staged; the caller commits)."""
    row = await db.get(NewsletterChoice, user_id)
    if row is None:
        row = NewsletterChoice(user_id=user_id, subscribed=subscribed, source=source)
        db.add(row)
    row.subscribed, row.source, row.changed_at = subscribed, source, datetime.now(UTC)
    if subscribed and not row.token:
        row.token = new_token()
    return row


async def send_due(now: datetime | None = None) -> int:
    """Send every weekly email that's due. Returns how many went."""
    if not can_deliver():
        return 0
    now = now or datetime.now(UTC)
    sent = 0
    async with sessionmaker()() as db:
        due = (await db.execute(select(NewsletterChoice, User).join(User, User.id == NewsletterChoice.user_id).where(
            NewsletterChoice.subscribed.is_(True), User.email_verified.is_(True), User.suspended_at.is_(None),
            or_(NewsletterChoice.sent_at.is_(None), NewsletterChoice.sent_at <= now - WEEK + SLACK))
            .order_by(NewsletterChoice.sent_at).limit(BATCH))).all()
        for row, user in due:
            try:
                row.token = row.token or new_token()
                await get_email_sender().send(await compose(db, user, row.token, now))
                sent += 1
            except Exception:
                log.exception("weekly tips email for one account failed; it's tried again next week")
            row.sent_at = now
            await db.commit()
    if sent:
        log.info("sent %d weekly tips email(s)", sent)
    return sent


admin_router = APIRouter(prefix="/v1/admin/newsletter", tags=["admin"])


class StatsOut(BaseModel):
    subscribed: int
    declined: int  # said no, or stopped it
    never_asked: int  # verified accounts with no choice yet (Today asks them once)
    sent_last_week: int


class PreviewOut(BaseModel):
    to: str


@admin_router.get("", response_model=StatsOut)
async def stats(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)]) -> StatsOut:
    by: dict[bool, int] = {bool(k): int(n) for k, n in (await db.execute(
        select(NewsletterChoice.subscribed, func.count()).group_by(NewsletterChoice.subscribed))).all()}
    users = int(await db.scalar(select(func.count()).select_from(User).where(User.email_verified.is_(True))) or 0)
    chose = int(await db.scalar(select(func.count()).select_from(NewsletterChoice).join(
        User, User.id == NewsletterChoice.user_id).where(User.email_verified.is_(True))) or 0)
    week = int(await db.scalar(select(func.count()).select_from(NewsletterChoice).where(
        NewsletterChoice.sent_at >= datetime.now(UTC) - WEEK)) or 0)
    return StatsOut(subscribed=int(by.get(True, 0)), declined=int(by.get(False, 0)),
                    never_asked=max(0, users - chose), sent_last_week=week)


@admin_router.post("/preview", response_model=PreviewOut, dependencies=[_limit])
async def preview(admin: Annotated[User, Depends(require_admin)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> PreviewOut:
    """This week's email as the admin's own account would get it (its stop link is a dummy), to the admin."""
    mail = await compose(db, admin, "preview", datetime.now(UTC))
    await get_email_sender().send(OutgoingEmail(to=mail.to, subject=f"[Preview] {mail.subject}", text=mail.text,
                                                footer=mail.footer, unsubscribe=mail.unsubscribe))
    return PreviewOut(to=admin.email)


class ChoiceOut(BaseModel):
    subscribed: bool | None  # null: never asked


class ChoiceIn(BaseModel):
    subscribed: bool
    source: Source = "settings"


class OffIn(BaseModel):
    token: str = Field(min_length=16, max_length=64)


@router.get("", response_model=ChoiceOut, dependencies=[_limit])
async def get_choice(user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> ChoiceOut:
    row = await db.get(NewsletterChoice, user.id)
    return ChoiceOut(subscribed=row.subscribed if row else None)


@router.put("", response_model=ChoiceOut, dependencies=[_limit])
async def put_choice(body: ChoiceIn, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> ChoiceOut:
    row = await set_choice(db, user.id, body.subscribed, body.source)
    await db.commit()
    return ChoiceOut(subscribed=row.subscribed)


@router.post("/off", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_off_limit])
async def turn_off(body: OffIn, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """The email's stop link: no sign-in, the token says whose. Unknown tokens are 404."""
    row = await db.scalar(select(NewsletterChoice).where(NewsletterChoice.token == body.token))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That link has expired. Turn the weekly email off in Settings.")
    row.subscribed, row.source, row.changed_at = False, "email", datetime.now(UTC)
    await db.commit()
