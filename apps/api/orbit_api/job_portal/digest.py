"""The opt-in weekly progress email: what moved in the candidate's search this week and what is due next.

Turned on in "Your workflow rules" on Today (playbooks.py, `weekly_digest`). Everything in it comes from the
candidate's own records: applications recorded, employer replies they confirmed, applications Orbit sent, interviews
coming up and the actions on Today. A week with nothing to report sends nothing. The stop link works without signing
in (`digest_token`), like job alerts (alerts.py).
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import ApplicationPacket, CareerPlaybook, JobApplication, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, get_email_sender
from orbit_api.ratelimit import limit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/jobs/playbook/digest", tags=["career playbook"])
WEEK = timedelta(days=7)
SLACK = timedelta(hours=2)  # a sweep that runs a little early still sends this week's email
BATCH = 50
MAX_ACTIONS = 5


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def new_token() -> str:
    return secrets.token_urlsafe(24)


async def summary(db: AsyncSession, user: User, now: datetime) -> dict[str, Any]:
    """This week's numbers and the next actions, from the candidate's records."""
    from orbit_api.job_portal.actions import queue

    since = now - WEEK
    mine = JobApplication.user_id == user.id
    applied = int(await db.scalar(select(func.count()).select_from(JobApplication)
        .where(mine, JobApplication.applied_at >= since)) or 0)
    moved: dict[str, int] = {status_: count for status_, count in (await db.execute(
        select(JobApplication.status, func.count()).where(
            mine, JobApplication.status_at >= since,
            JobApplication.status.in_(("interviewing", "offer", "rejected", "hired")))
        .group_by(JobApplication.status))).all()}
    sent = int(await db.scalar(select(func.count()).select_from(ApplicationPacket).where(
        ApplicationPacket.user_id == user.id, ApplicationPacket.status == "submitted",
        ApplicationPacket.submitted_at >= since)) or 0)
    upcoming = int(await db.scalar(select(func.count()).select_from(JobApplication).where(
        mine, JobApplication.status == "interviewing", JobApplication.next_at >= now,
        JobApplication.next_at <= now + WEEK)) or 0)
    actions = (await queue(db, user))["items"][:MAX_ACTIONS]
    return {"applied": applied, "sent_by_orbit": sent, "interviewing": int(moved.get("interviewing", 0)),
            "offers": int(moved.get("offer", 0)), "closed": int(moved.get("rejected", 0)),
            "hired": int(moved.get("hired", 0)), "upcoming_interviews": upcoming, "actions": actions}


def has_news(s: dict[str, Any]) -> bool:
    return bool(s["actions"]) or any(s[k] for k in ("applied", "sent_by_orbit", "interviewing", "offers", "closed",
                                                    "hired", "upcoming_interviews"))


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def email(user: User, s: dict[str, Any], token: str) -> OutgoingEmail:
    web = get_settings().web_url.rstrip("/")
    facts = [line for n, line in (
        (s["applied"], f"{plural(s['applied'], 'application')} recorded"),
        (s["sent_by_orbit"], f"{plural(s['sent_by_orbit'], 'application')} sent by Orbit"),
        (s["interviewing"], f"{plural(s['interviewing'], 'job')} moved to interviewing"),
        (s["offers"], plural(s["offers"], "offer")),
        (s["hired"], "hired"),
        (s["closed"], f"{plural(s['closed'], 'application')} closed"),
        (s["upcoming_interviews"], f"{plural(s['upcoming_interviews'], 'interview')} in the next 7 days"),
    ) if n]
    lines = [f"Hi {user.name or 'there'},", "", "Your week in Orbit:", ""]
    lines += [f"- {fact}" for fact in facts] or ["- No new activity recorded this week."]
    if s["actions"]:
        lines += ["", "Next up:"]
        for item in s["actions"]:
            lines += [f"- {item['title']}: {item.get('action_label') or 'Open'}", f"  {web}{item['path']}"]
    lines += ["", f"Everything on Today: {web}/", "",
              "Counts come from what you and Orbit recorded. Employer decisions are theirs; this is not a prediction.",
              "", f"Stop these weekly emails: {web}/jobs/digest/off?token={token}"]
    subject = (f"Your week: {facts[0]}" if facts else "Your week in Orbit: what's next")[:150]
    return OutgoingEmail(to=user.email, subject=subject, text="\n".join(lines))


async def send_due(now: datetime | None = None) -> int:
    """Send every weekly email that's due. Returns how many went."""
    if not can_deliver():
        return 0
    now = now or datetime.now(UTC)
    sent = 0
    async with sessionmaker()() as db:
        due = (await db.execute(select(CareerPlaybook, User).join(User, User.id == CareerPlaybook.user_id).where(
            CareerPlaybook.weekly_digest.is_(True), User.email_verified.is_(True), User.suspended_at.is_(None),
            or_(CareerPlaybook.digest_sent_at.is_(None), CareerPlaybook.digest_sent_at <= now - WEEK + SLACK))
            .order_by(CareerPlaybook.digest_sent_at).limit(BATCH))).all()
        for row, user in due:
            try:
                s = await summary(db, user, now)
                if has_news(s):
                    row.digest_token = row.digest_token or new_token()
                    await get_email_sender().send(email(user, s, row.digest_token))
                    sent += 1
            except Exception:
                log.exception("weekly digest for one account failed; it's tried again next week")
            row.digest_sent_at = now
            await db.commit()
    if sent:
        log.info("sent %d weekly digest(s)", sent)
    return sent


class OffIn(BaseModel):
    token: str = Field(min_length=16, max_length=64)


@router.post("/off", status_code=status.HTTP_204_NO_CONTENT,
             dependencies=[Depends(limit("weekly-digest-off", 0.2, 10))])
async def turn_off(body: OffIn, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """The email's stop link: no sign-in, the token says whose. Unknown tokens are 404."""
    row = await db.scalar(select(CareerPlaybook).where(CareerPlaybook.digest_token == body.token))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That link has expired. Turn it off in Today, workflow rules.")
    row.weekly_digest = False
    row.revision += 1
    await db.commit()
