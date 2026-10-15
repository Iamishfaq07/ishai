"""Job alerts: an email of the new jobs that match the user's profile, daily or weekly (after the saved-search alerts
every job app has). Sent from the sweeper's pass (sessions/cleanup.py) to whoever is due; a run with nothing new
sends nothing but still counts, so a quiet week doesn't turn into a daily retry. Each email has a one-click way to
stop them, no sign-in needed (`alert_token`).

New means first seen by Orbit since the last alert, matching the profile the way the feed does, not already on the
tracker, and a decent match: an alert is worth opening only if what it lists is worth applying to.
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db, sessionmaker
from orbit_api.job_portal import refresh
from orbit_api.job_portal.profile import search_queries
from orbit_api.models import JobListing, JobSearchProfile, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, get_email_sender
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)

Frequency = Literal["off", "daily", "weekly"]
PERIOD = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
SLACK = timedelta(hours=1)  # a sweep a little early still counts: the send time doesn't creep later each day
MIN_SCORE = 55  # the feed's match score: below this a job isn't worth an email
MAX_JOBS = 10
BATCH = 50  # profiles per sweep: the rest wait for the next pass

router = APIRouter(prefix="/v1/jobs/alerts", tags=["jobs"])
_limit = Depends(limit_user("job-alerts", rate_per_s=1, burst=20))
_off_limit = Depends(limit("job-alerts-off", 0.2, 10))


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


class AlertOut(BaseModel):
    frequency: Frequency
    sent_at: datetime | None
    can_email: bool  # the server can send mail and the address is verified
    email: str


class AlertIn(BaseModel):
    frequency: Frequency


class OffIn(BaseModel):
    token: str = Field(min_length=16, max_length=64)


def _out(row: JobSearchProfile | None, user: User) -> AlertOut:
    return AlertOut(frequency=(row.alert if row and row.alert in PERIOD else "off"),
                    sent_at=_aware(row.alert_sent_at) if row and row.alert_sent_at else None,
                    can_email=can_deliver() and user.email_verified, email=user.email)


@router.get("", response_model=AlertOut, dependencies=[_limit])
async def get_alert(user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> AlertOut:
    return _out(await db.get(JobSearchProfile, user.id), user)


@router.put("", response_model=AlertOut, dependencies=[_limit])
async def set_alert(body: AlertIn, user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> AlertOut:
    from orbit_api.job_portal.routes import _profile

    row, prefs, resume = await _profile(db, user)
    if row is None:  # alerts need a saved profile: save the one the feed is using now
        row = JobSearchProfile(user_id=user.id, prefs=prefs.model_dump(mode="json"),
                               resume_id=resume.id if resume else None)
        db.add(row)
    if body.frequency != "off" and row.alert == "off":
        # Starting now: the first email lists what's new from here, not the whole feed.
        row.alert_sent_at = datetime.now(UTC)
    row.alert = body.frequency
    row.alert_token = row.alert_token or secrets.token_urlsafe(24)
    await db.commit()
    return _out(row, user)


@router.post("/off", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_off_limit])
async def turn_off(body: OffIn, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """The email's "stop these emails" link: no sign-in, the token says whose. Unknown tokens are 404."""
    row = await db.scalar(select(JobSearchProfile).where(JobSearchProfile.alert_token == body.token))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That link has expired. Turn alerts off in Jobs AI, Profile.")
    row.alert = "off"
    await db.commit()


# ---- sending -------------------------------------------------------------------------------------------------------


def _email(user: User, frequency: str, jobs: list[tuple[JobListing, int]], token: str) -> OutgoingEmail:
    web = get_settings().web_url.rstrip("/")
    when = "today" if frequency == "daily" else "this week"
    lines = [f"Hi {user.name or 'there'},", "",
             f"{len(jobs)} new job{'' if len(jobs) == 1 else 's'} {when} that match{'es' if len(jobs) == 1 else ''} "
             "your Jobs AI profile:", ""]
    for row, score in jobs:
        lines += [f"{row.title} at {row.company} ({score}% match)",
                  *([f"  {row.salary}"] if row.salary else []),
                  f"  {web}/jobs/listing/{row.id}", ""]
    lines += [f"All your matches: {web}/jobs/matches",
              f"Change what you're looking for: {web}/jobs/profile", "",
              f"Stop these emails: {web}/jobs/alerts/off?token={token}"]
    subject = (f"{jobs[0][0].title} at {jobs[0][0].company}" if len(jobs) == 1
               else f"{len(jobs)} new jobs for you, {jobs[0][0].company} and more")
    return OutgoingEmail(to=user.email, subject=subject[:150], text="\n".join(lines))


async def _new_matches(db: AsyncSession, user: User, row: JobSearchProfile,
                       since: datetime) -> list[tuple[JobListing, int]]:
    from orbit_api.job_portal.profile import JobPrefs
    from orbit_api.job_portal.routes import _country, _data, _matches, _resume_for, _search, _tracked

    prefs = JobPrefs.model_validate(row.prefs or {})
    search, _ = _search(prefs, "", _country(user))
    await refresh.ensure_fresh(db, search_queries(prefs, "", _country(user)))
    data = _data(await _resume_for(db, user, row))
    good = [m for m in await _matches(db, user, search, data, "best") if m.score >= MIN_SCORE]
    if not good:
        return []
    ids = [m.id for m in good[:200]]
    fresh = {r.id: r for r in (await db.scalars(select(JobListing).where(JobListing.id.in_(ids),
                                                                         JobListing.created_at > since))).all()}
    tracked = await _tracked(db, user, list(fresh))
    return [(fresh[m.id], m.score) for m in good if m.id in fresh and m.id not in tracked][:MAX_JOBS]


async def send_due(now: datetime | None = None) -> int:
    """Send every alert that's due. Returns how many emails went."""
    if not can_deliver():
        return 0
    now = now or datetime.now(UTC)
    sent = 0
    async with sessionmaker()() as db:
        due = (await db.execute(
            select(JobSearchProfile, User).join(User, User.id == JobSearchProfile.user_id)
            .where(JobSearchProfile.alert.in_(list(PERIOD)), User.email_verified.is_(True),
                   or_(JobSearchProfile.alert_sent_at.is_(None),
                       JobSearchProfile.alert_sent_at <= now - PERIOD["daily"] + SLACK))
            .order_by(JobSearchProfile.alert_sent_at).limit(BATCH))).all()
        for row, user in due:
            last = _aware(row.alert_sent_at) if row.alert_sent_at else now - PERIOD[row.alert]
            if now - last < PERIOD[row.alert] - SLACK:
                continue  # weekly, and not a week yet
            try:
                jobs = await _new_matches(db, user, row, last)
                if jobs:
                    row.alert_token = row.alert_token or secrets.token_urlsafe(24)
                    await get_email_sender().send(_email(user, row.alert, jobs, row.alert_token))
                    sent += 1
            except Exception:
                log.exception("job alert for one profile failed; it's tried again next period")
            row.alert_sent_at = now
            await db.commit()
    if sent:
        log.info("sent %d job alert(s)", sent)
    return sent
