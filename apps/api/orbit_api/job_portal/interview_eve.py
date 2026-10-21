"""The interview-eve email: the day before a recorded interview, one short email with everything for it in one place.

Opt-in (workflow rules on Today, `interview_eve_email`). For a job marked interviewing whose recorded next date
(`JobApplication.next_at`) is between 2 and 30 hours away, it links the job's interview prep, the "Tell me about
yourself" answer and Saba practice, the resume's first look, and lists any open promises for that employer. Sent once
per interview time (`eve_reminded_for`); a rescheduled interview gets its own email. Needs a verified email.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import CareerPlaybook, JobApplication, JobCommitment, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, get_email_sender

log = logging.getLogger(__name__)
EARLIEST = timedelta(hours=2)  # closer than this, an email is noise
LATEST = timedelta(hours=30)
BATCH = 100


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def email(user: User, job: JobApplication, promises: list[str]) -> OutgoingEmail:
    web = get_settings().web_url.rstrip("/")
    room = f"{web}/jobs/mission/{job.id}"
    assert job.next_at is not None
    when = _aware(job.next_at).strftime("%a %d %b, %H:%M UTC")
    lines = [f"Hi {user.name or 'there'},", "",
             f"Your interview for {job.title} at {job.company} is coming up ({when}, the time you recorded).", "",
             "Ready in one place:",
             f"- Interview prep and likely questions: {room}?tab=interview",
             f"- Your \"Tell me about yourself\" answer and practice with Saba: {room}?tab=practice",
             f"- Recruiter first look at your resume: {room}?tab=resume"]
    if promises:
        lines += ["", "You told them you would:", *[f"- {p}" for p in promises]]
    lines += ["", "Afterwards, a debrief while it's fresh helps with the next round.", "",
              f"Turn these emails off in Today, Your workflow rules: {web}/#follow-up-rules"]
    return OutgoingEmail(to=user.email, subject=f"Tomorrow: {job.title} at {job.company}"[:150], text="\n".join(lines))


async def send_due(now: datetime | None = None) -> int:
    """Send every interview-eve email that's due. Returns how many went."""
    if not can_deliver():
        return 0
    now = now or datetime.now(UTC)
    sent = 0
    async with sessionmaker()() as db:
        rows = (await db.execute(select(JobApplication, User)
            .join(User, User.id == JobApplication.user_id)
            .join(CareerPlaybook, CareerPlaybook.user_id == JobApplication.user_id)
            .where(CareerPlaybook.interview_eve_email.is_(True), User.email_verified.is_(True),
                   User.suspended_at.is_(None), JobApplication.status == "interviewing",
                   JobApplication.next_at >= now + EARLIEST, JobApplication.next_at <= now + LATEST,
                   or_(JobApplication.eve_reminded_for.is_(None),
                       JobApplication.eve_reminded_for != JobApplication.next_at))
            .limit(BATCH))).all()
        for job, user in rows:
            try:
                promises = list(await db.scalars(select(JobCommitment.text).where(
                    JobCommitment.application_id == job.id, JobCommitment.done_at.is_(None)).limit(5)))
                await get_email_sender().send(email(user, job, promises))
                sent += 1
            except Exception:
                log.exception("interview-eve email for one job failed; it's tried again next pass")
                continue
            job.eve_reminded_for = job.next_at
            await db.commit()
    if sent:
        log.info("sent %d interview-eve email(s)", sent)
    return sent
