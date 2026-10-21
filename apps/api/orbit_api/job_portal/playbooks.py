"""Account-owned rules for the Action desk. No applications, emails or outcomes are changed.

Each rule is off until the candidate enables it, and only adds a suggested action to Today, derived from their own
records. Patterns from open-source job-search tools (docs/PERSONAL_WORKFLOW_RESEARCH_2026_10.md): a follow-up after
silence, a thank-you note after an interview, a decision point for an application that has gone quiet (as in
MadsLorentzen/ai-job-search's stale-application check) and a decision on saved jobs left unapplied. Drafts and
decisions stay with the candidate: nothing here sends a message, closes an application or removes a job.
"""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.action_priority import TERMINAL_JOBS
from orbit_api.models import CareerPlaybook, JobApplication, JobContact, JobInterviewRound, User
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/jobs/playbook", tags=["career playbook"],
    dependencies=[Depends(limit_user("career-playbook", rate_per_s=1, burst=20))])


class Rules(BaseModel):
    model_config = ConfigDict(extra="forbid")
    follow_up_days: int | None = Field(None, ge=3, le=60, strict=True)
    prep_hours: int | None = Field(None, ge=1, le=168, strict=True)
    thank_you_hours: int | None = Field(None, ge=2, le=72, strict=True)
    stale_days: int | None = Field(None, ge=14, le=90, strict=True)
    saved_days: int | None = Field(None, ge=3, le=60, strict=True)
    rejection_days: int | None = Field(None, ge=1, le=14, strict=True)
    weekly_digest: StrictBool = False  # the weekly progress email (digest.py)
    auto_tailor: StrictBool = False  # a tailored resume for each job saved from the feed (tailor_queue.on_save)
    interview_eve_email: StrictBool = False  # an email the day before a recorded interview (interview_eve.py)


class Save(Rules):
    base_revision: int = Field(ge=0, strict=True)


async def settings(db: AsyncSession, user_id: str) -> dict[str, Any]:
    row = await db.get(CareerPlaybook, user_id, populate_existing=True)
    return {"revision": row.revision if row else 0, **{key: getattr(row, key) if row else None for key in RULES},
            "weekly_digest": bool(row and row.weekly_digest), "auto_tailor": bool(row and row.auto_tailor),
            "interview_eve_email": bool(row and row.interview_eve_email)}


RULES = ("follow_up_days", "prep_hours", "thank_you_hours", "stale_days", "saved_days", "rejection_days")


def aware(t: datetime) -> datetime:
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


async def followups(db: AsyncSession, user_id: str, days: int | None,
                    now: datetime) -> tuple[list[dict[str, Any]], bool]:
    if days is None:
        return [], False
    cutoff = now - timedelta(days=days)
    candidates = list(await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "applied", JobApplication.next_at.is_(None),
        JobApplication.applied_at <= cutoff, JobApplication.status_at <= cutoff,
        ~select(JobContact.id).where(JobContact.user_id == user_id,
            JobContact.application_id == JobApplication.id, JobContact.last_contacted_at > cutoff,
            JobContact.last_contacted_at <= now).exists())
        .order_by(JobApplication.applied_at, JobApplication.id).limit(201)))
    ids = [a.id for a in candidates]
    contact_rows = (await db.execute(select(JobContact.application_id, func.max(JobContact.last_contacted_at))
        .where(JobContact.user_id == user_id, JobContact.application_id.in_(ids), JobContact.last_contacted_at <= now)
        .group_by(JobContact.application_id))).all()
    contacted = {key: stamp for key, stamp in contact_rows if key is not None and stamp is not None}
    items = []
    for job in candidates[:200]:
        assert job.applied_at
        anchor = max(aware(job.applied_at), aware(job.status_at))
        if (stamp := contacted.get(job.id)) is not None:
            anchor = max(anchor, aware(stamp))
        due = anchor + timedelta(days=days)
        if due > now:
            continue
        items.append({"id": f"playbook:{job.id}", "kind": "follow_up", "title": f"{job.title} · {job.company}",
            "detail": f"Your {days}-day follow-up rule is due. Review the employer's process and draft a follow-up "
                "if appropriate. No next-step date is saved; no message has been sent.",
            "due_at": due.isoformat(), "overdue": True, "path": f"/jobs/mission/{job.id}",
            "rule": "application_follow_up"})
    return items, len(candidates) > 200


async def thank_yous(db: AsyncSession, user_id: str, hours: int | None, now: datetime) -> list[dict[str, Any]]:
    """Interview rounds that happened in the last `hours`, with no contact logged since: draft a thank-you note."""
    if hours is None:
        return []
    rows = (await db.execute(select(JobInterviewRound, JobApplication)
        .join(JobApplication, JobApplication.id == JobInterviewRound.application_id)
        .where(JobInterviewRound.user_id == user_id, JobInterviewRound.status != "cancelled",
               JobInterviewRound.scheduled_at <= now, JobInterviewRound.scheduled_at >= now - timedelta(hours=hours),
               JobApplication.status.not_in(TERMINAL_JOBS),
               ~select(JobContact.id).where(JobContact.user_id == user_id,
                   JobContact.application_id == JobApplication.id,
                   JobContact.last_contacted_at >= JobInterviewRound.scheduled_at).exists())
        .order_by(JobInterviewRound.scheduled_at, JobInterviewRound.id).limit(50))).all()
    items = []
    for interview, job in rows:
        assert interview.scheduled_at is not None
        items.append({"id": f"thanks:{interview.id}", "kind": "follow_up", "title": f"{job.title} · {job.company}",
            "detail": f"Your {interview.label or 'interview'} took place. A short thank-you note is common within a "
                "day. Draft one, review it and send it yourself; Orbit sends nothing.",
            "due_at": (aware(interview.scheduled_at) + timedelta(hours=hours)).isoformat(), "overdue": False,
            "path": f"/jobs/outreach?view=messages&job={job.listing_id}", "action_label": "Draft a thank-you note",
            "rule": "interview_thank_you"})
    return items


async def quiet(db: AsyncSession, user_id: str, days: int | None, now: datetime) -> list[dict[str, Any]]:
    """Applied with no update, next step or contact for `days`: a decision point, not an automatic close."""
    if days is None:
        return []
    cutoff = now - timedelta(days=days)
    jobs = await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "applied", JobApplication.next_at.is_(None),
        JobApplication.applied_at <= cutoff, JobApplication.status_at <= cutoff,
        ~select(JobContact.id).where(JobContact.user_id == user_id, JobContact.application_id == JobApplication.id,
            JobContact.last_contacted_at > cutoff).exists())
        .order_by(JobApplication.status_at, JobApplication.id).limit(50))
    return [{"id": f"quiet:{job.id}", "kind": "follow_up", "title": f"{job.title} · {job.company}",
        "detail": f"No recorded reply or next step in {days} days. Decide: one last follow-up, keep waiting, or "
            "record it as closed. Nothing changes until you do.",
        "due_at": (aware(job.status_at) + timedelta(days=days)).isoformat(),
        "overdue": True, "path": f"/jobs/mission/{job.id}?tab=timeline", "action_label": "Decide next step",
        "rule": "application_quiet"} for job in jobs]


async def saved(db: AsyncSession, user_id: str, days: int | None, now: datetime) -> list[dict[str, Any]]:
    """Saved and not applied to for `days`: apply, prepare it, or let it go to keep the shortlist focused."""
    if days is None:
        return []
    jobs = await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "saved", JobApplication.next_at.is_(None),
        JobApplication.status_at <= now - timedelta(days=days))
        .order_by(JobApplication.status_at, JobApplication.id).limit(50))
    return [{"id": f"saved:{job.id}", "kind": "application", "title": f"{job.title} · {job.company}",
        "detail": f"Saved {days}+ days ago and not applied to yet. Apply, prepare it with auto-apply, or remove it "
            "to keep your shortlist focused.",
        "due_at": (aware(job.status_at) + timedelta(days=days)).isoformat(), "overdue": True,
        "path": f"/jobs/mission/{job.id}", "action_label": "Apply or let it go", "rule": "saved_job_decision"}
        for job in jobs]


async def after_rejection(db: AsyncSession, user_id: str, days: int | None, now: datetime) -> list[dict[str, Any]]:
    """A "no" recorded in the last `days` with no contact logged since: a short note asking for feedback and keeping
    the door open is common practice. A suggestion only; nothing is sent."""
    if days is None:
        return []
    rows = await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "rejected", JobApplication.status_at >= now - timedelta(days=days),
        ~select(JobContact.id).where(JobContact.user_id == user_id, JobContact.application_id == JobApplication.id,
            JobContact.last_contacted_at >= JobApplication.status_at).exists())
        .order_by(JobApplication.status_at.desc()).limit(30))
    return [{"id": f"rejection:{job.id}", "kind": "follow_up", "title": f"{job.title} · {job.company}",
        "detail": "They said no this time. A short, gracious note asking for feedback keeps the door open for the "
            "next role. Draft it, review it and send it yourself, or skip it.",
        "due_at": (aware(job.status_at) + timedelta(days=days)).isoformat(), "overdue": False,
        "path": f"/jobs/outreach?view=messages&job={job.listing_id}", "action_label": "Draft a note",
        "rule": "after_rejection"} for job in rows]


async def wrap_up(db: AsyncSession, user_id: str, now: datetime) -> list[dict[str, Any]]:
    """After a hire is recorded (in the last 30 days), the other applications still open: telling those employers
    you've accepted another role is a courtesy that keeps doors open. One item each; a note template is on the job's
    page. Nothing is sent, and a tracker change never notifies an employer."""
    hired = await db.scalar(select(JobApplication.status_at).where(JobApplication.user_id == user_id,
        JobApplication.status == "hired", JobApplication.status_at >= now - timedelta(days=30))
        .order_by(JobApplication.status_at.desc()).limit(1))
    if hired is None:
        return []
    rows = await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status.in_(("applied", "interviewing", "offer")))
        .order_by(JobApplication.status_at.desc()).limit(20))
    return [{"id": f"wrap-up:{job.id}", "kind": "application", "title": f"{job.title} · {job.company}",
        "detail": "You've accepted a role. Let this employer know you're withdrawing, so they can move on and "
            "remember you well. A short note is ready to edit on the job's page; then mark it withdrawn.",
        "due_at": None, "overdue": False, "path": f"/jobs/mission/{job.id}?tab=timeline&withdraw=1",
        "action_label": "Write the note", "rule": "wrap_up"} for job in rows]


async def find_contacts(db: AsyncSession, user_id: str, now: datetime) -> list[dict[str, Any]]:
    """Applied in the last 7 days, still waiting, and nobody saved at that company: a short note to the recruiter or
    hiring manager is one of the few things that moves an application. Links to the contact finder on the job's
    Company tab. A suggestion only: nothing is searched or sent until the candidate asks."""
    from orbit_api.models import JobContact
    from orbit_api.sessions.loop_memory import same_company

    rows = (await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "applied", JobApplication.status_at >= now - timedelta(days=7))
        .order_by(JobApplication.status_at.desc()).limit(20))).all()
    if not rows:
        return []
    companies = (await db.scalars(select(JobContact.company).where(JobContact.user_id == user_id))).all()
    return [{"id": f"contacts:{job.id}", "kind": "application", "title": f"{job.title} · {job.company}",
        "detail": "You applied, but you haven't saved anyone at this company. Find the recruiter or hiring manager "
            "from public sources, then choose whether to write to them.",
        "due_at": None, "overdue": False, "path": f"/jobs/mission/{job.id}?tab=company&contacts=1",
        "action_label": "Find who's hiring", "rule": "find_contacts"}
        for job in rows if not any(same_company(c, job.company) for c in companies)][:5]


async def gone_postings(db: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    """Saved jobs from a company's own careers board whose post is no longer there: a board's fetch replaces its
    listings (refresh.py), so a post taken down drops out. Worth checking before preparing an application. Always
    shown: it's what the employer's own board says. Feeds and searches don't count (their cache simply ages out)."""
    from orbit_api.job_portal.sources import source_named
    from orbit_api.models import JobListing

    rows = await db.scalars(select(JobApplication).where(JobApplication.user_id == user_id,
        JobApplication.status == "saved",
        ~select(JobListing.id).where(JobListing.id == JobApplication.listing_id).exists())
        .order_by(JobApplication.status_at.desc()).limit(40))
    out = []
    for job in rows:
        source = source_named(job.source)
        if source is None or not source.direct:
            continue
        out.append({"id": f"gone:{job.id}", "kind": "application", "title": f"{job.title} · {job.company}",
            "detail": "This post is no longer on the company's careers page. It may have closed: check before "
                "spending time on it, or remove it from your shortlist.",
            "due_at": None, "overdue": False, "path": f"/jobs/mission/{job.id}", "action_label": "Check or remove"})
    return out[:20]


async def offer_deadlines(db: AsyncSession, user_id: str, now: datetime) -> list[dict[str, Any]]:
    """Offers still being considered whose response deadline is within a week or past: always shown, from the offer
    the candidate recorded in Offer AI."""
    from orbit_api.models import JobOffer

    rows = await db.scalars(select(JobOffer).where(JobOffer.user_id == user_id, JobOffer.status == "considering",
        JobOffer.deadline.is_not(None), JobOffer.deadline <= now + timedelta(days=7)).order_by(JobOffer.deadline)
        .limit(20))
    out = []
    for offer in rows:
        assert offer.deadline is not None
        due = aware(offer.deadline)
        out.append({"id": f"offer:{offer.id}", "kind": "interview", "title": f"{offer.role} · {offer.company}",
            "detail": ("The response date you recorded has passed. Check with the employer before deciding."
                       if due < now else "Your offer response date is coming up. Compare, negotiate or decide."),
            "due_at": due.isoformat(), "overdue": due < now, "path": f"/offers/{offer.id}",
            "action_label": "Review the offer"})
    return out


@router.get("")
async def get(user: Annotated[User, Depends(current_user)],
              db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await settings(db, user.id)


@router.put("")
async def save(body: Save, user: Annotated[User, Depends(current_user)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    await lock_account(db, user.id)
    row = await db.get(CareerPlaybook, user.id, populate_existing=True)
    if (row.revision if row else 0) != body.base_revision:
        raise HTTPException(409, "Your playbook changed in another tab. Refresh before saving.")
    if row is None:
        row = CareerPlaybook(user_id=user.id, revision=0)
        db.add(row)
    for key in RULES:
        setattr(row, key, getattr(body, key))
    if body.weekly_digest and not row.weekly_digest:
        from orbit_api.job_portal.digest import new_token

        row.digest_token = row.digest_token or new_token()
        row.digest_sent_at = None  # the first email goes out on the next pass, then weekly
    row.weekly_digest = body.weekly_digest
    row.auto_tailor = body.auto_tailor
    row.interview_eve_email = body.interview_eve_email
    row.revision += 1
    await db.commit()
    return await settings(db, user.id)
