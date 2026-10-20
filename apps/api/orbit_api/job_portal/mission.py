"""Job Mission Room: one tracked job as a workspace. It reads what Orbit already keeps (the tracker entry, fit checks,
the resume linked to the job, practice and live rounds, the offer) and adds two things only, both on the user's
say: a frozen copy of the resume as it was sent (`ResumeSnapshot`) and an offer's link to the job
(`JobOffer.application_id`).

The stages are facts, not a progress estimate: each is done only when a matching record exists. The next step is the
first gap, with the reason in words. Nothing is linked by guessing (a resume, a snapshot or an offer is attached only
when the user picks it); every id is checked against the signed-in account.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.timeline import timeline
from orbit_api.models import JobApplication, JobFitCheck, JobOffer, Resume, ResumeSnapshot, User
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import ResumeData, ResumeDesign

router = APIRouter(prefix="/v1/jobs/tracker", tags=["jobs"])
read_limit = Depends(limit_user("jobs-mission", rate_per_s=3, burst=60))
# Minutes east of UTC (India is 330), as the prep plan takes it: "today" and "tomorrow" are the person's days.
TzOffset = Annotated[int, Query(ge=-720, le=840)]
MAX_SNAPSHOTS = 20

Stage = Literal["discover", "prove", "prepare", "apply", "interview", "negotiate"]
STAGES: list[Stage] = ["discover", "prove", "prepare", "apply", "interview", "negotiate"]


class Requirement(BaseModel):
    requirement: str
    status: str
    job_quote: str = ""
    resume_quote: str = ""
    evidence_quote: str = ""


class FitSummary(BaseModel):
    verdict: str
    summary: str
    gaps: list[str]
    requirements: list[Requirement]
    checked_at: datetime


class LinkedResume(BaseModel):
    id: str
    title: str
    score: int
    updated_at: datetime


class SnapshotOut(BaseModel):
    id: str
    title: str
    score: int
    note: str
    resume_id: str | None  # null once the resume it came from is deleted (the snapshot stays)
    created_at: datetime


class OfferRef(BaseModel):
    id: str
    company: str
    role: str
    fixed: int
    currency: str
    status: str


class NextStep(BaseModel):
    key: str
    title: str
    why: str
    action: str
    # Where the action goes: an in-app path, or an in-room action ("link_resume", "snapshot", "link_offer",
    # "interview": the interview prep tab).
    to: str


class MissionOut(BaseModel):
    entry_id: str
    stages: dict[str, bool]
    fit: FitSummary | None
    resume: LinkedResume | None
    resume_missing: bool  # a resume was linked and has since been deleted
    snapshots: list[SnapshotOut]
    offer: OfferRef | None
    offers: list[OfferRef]  # the account's offers not linked to another job, for the user to pick from
    practice_rounds: int
    live_rounds: int
    next: NextStep | None


class Facts(BaseModel):
    status: str
    fit: bool
    resume: bool
    snapshot: bool
    applied: bool
    practice_rounds: int
    live_rounds: int
    offer: bool
    upcoming_days: int | None  # days to the next interview or follow-up, when it's from today on
    prep_doc: bool


def stages_for(f: Facts) -> dict[str, bool]:
    """Each stage done only on a record: a fit check (prove), a linked resume, saved job post or practice round
    (prepare), applied (apply), interviewing or a live round (interview), an offer (negotiate)."""
    moved = {"applied", "interviewing", "offer"}
    return {
        "discover": True,
        "prove": f.fit,
        "prepare": f.resume or f.prep_doc or f.practice_rounds > 0,
        "apply": f.applied or f.status in moved,
        "interview": f.status in {"interviewing", "offer"} or f.live_rounds > 0,
        "negotiate": f.status == "offer" or f.offer,
    }


def next_step(f: Facts, listing_path: str) -> NextStep | None:
    """The first gap, in the order a job is won, with why in words. None once nothing is left to suggest."""
    if f.status in {"withdrawn", "hired"}:
        return None
    if f.status == "rejected":
        return NextStep(key="debrief", title="Note what you learned", action="Add a note",
                        why="This one closed. A line on what they asked and what you'd change helps the next one.",
                        to="notes")
    if f.status == "offer" and not f.offer:
        return NextStep(key="offer", title="Add the offer to Offers", action="Add the offer",
                        why="See what it pays each month, compare it with the market and plan what to ask for.",
                        to="link_offer")
    if f.upcoming_days == 0 and f.status == "interviewing":
        return NextStep(key="interview_day", title="Your interview is today", action="Open interview prep",
                        why="It's today. The job post, the resume you sent and your stories are in one place, and "
                            "the copilot starts with them loaded.", to="interview")
    if f.upcoming_days is not None and f.upcoming_days <= 7 and f.status == "interviewing":
        when = "tomorrow" if f.upcoming_days == 1 else f"in {f.upcoming_days} days"
        return NextStep(key="practise", title="Practise for this interview", action="Prepare for it",
                        why=f"It's {when}. A mock round on this job post shows what to work on first.", to="interview")
    if not f.fit:
        return NextStep(key="fit", title="Check how well you fit", action="Run the fit check",
                        why="A requirement-by-requirement check against your resume shows what to prove and what's "
                            "missing before you apply.", to=listing_path)
    if not f.resume:
        return NextStep(key="resume", title="Pick the resume for this job", action="Link a resume",
                        why="Link the resume you'll send (or tailor one) so this page knows which version is yours.",
                        to="link_resume")
    if not f.applied and f.status == "saved":
        return NextStep(key="apply", title="Apply, then mark it applied", action="Mark as applied",
                        why="Your resume is linked. Review the materials and apply on the employer's site. "
                            "Mark this stage only after you have actually applied.",
                        to="mark_applied")
    if f.applied and not f.snapshot:
        return NextStep(key="snapshot", title="Keep the version you sent", action="Freeze this resume",
                        why="Editing the resume later won't change what they have. Keep a copy of what you sent.",
                        to="snapshot")
    if f.practice_rounds == 0 and f.status in {"applied", "interviewing"}:
        return NextStep(key="practise", title="Practise before they call", action="Start a mock interview",
                        why="One mock round on this job post now makes the first call easier.", to="practise")
    return None


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def _entry(db: AsyncSession, entry_id: str, user: User) -> JobApplication:
    entry = await db.get(JobApplication, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your tracker")
    return entry


def _score(data: dict[str, object], design: dict[str, object], job_text: str) -> int:
    return score_resume(ResumeData.model_validate(data or {}), ResumeDesign.model_validate(design or {}),
                        job_text).score


def _offer_ref(o: JobOffer) -> OfferRef:
    return OfferRef(id=o.id, company=o.company, role=o.role, fixed=o.fixed, currency=o.currency, status=o.status)


async def mission(db: AsyncSession, user: User, entry: JobApplication, now: datetime | None = None,
                  tz_offset: int = 0) -> MissionOut:
    """`tz_offset`: minutes east of UTC, so "today" and "tomorrow" are the person's own days, as in the prep plan."""
    now = now or datetime.now(UTC)
    fit_row = (await db.scalars(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
                                                          JobFitCheck.listing_id == entry.listing_id)
                                .order_by(JobFitCheck.created_at.desc()).limit(1))).first()
    fit = None
    if fit_row is not None and isinstance(fit_row.result, dict):
        r = fit_row.result
        fit = FitSummary(verdict=str(r.get("verdict", "")), summary=str(r.get("summary", "")),
                         gaps=[str(g) for g in r.get("gaps", [])][:6],
                         requirements=[Requirement.model_validate(q) for q in r.get("requirements", [])
                                       if isinstance(q, dict) and q.get("requirement")][:20],
                         checked_at=_aware(fit_row.created_at))

    resume = None
    missing = False
    if entry.resume_id:
        row = await db.get(Resume, entry.resume_id)
        if row is not None and row.user_id == user.id:
            score = await asyncio.to_thread(_score, row.data, row.design, row.job_text or "")
            resume = LinkedResume(id=row.id, title=row.title, score=score, updated_at=_aware(row.updated_at))
        else:
            missing = True

    snaps = (await db.scalars(select(ResumeSnapshot).where(ResumeSnapshot.user_id == user.id,
                                                           ResumeSnapshot.application_id == entry.id)
                              .order_by(ResumeSnapshot.created_at.desc()))).all()
    offers = (await db.scalars(select(JobOffer).where(JobOffer.user_id == user.id)
                               .order_by(JobOffer.created_at.desc()))).all()
    linked = next((o for o in offers if o.application_id == entry.id), None)
    events = await timeline(db, entry, now)
    rounds = [e for e in events if e.kind == "round"]
    practice = sum(1 for e in rounds if e.title == "Practice round")
    upcoming = None
    shift = timedelta(minutes=tz_offset)
    today = (now + shift).date()
    if entry.next_at and (_aware(entry.next_at) + shift).date() >= today:
        upcoming = ((_aware(entry.next_at) + shift).date() - today).days

    facts = Facts(status=entry.status, fit=fit is not None, resume=resume is not None, snapshot=bool(snaps),
                  applied=entry.applied_at is not None, practice_rounds=practice, live_rounds=len(rounds) - practice,
                  offer=linked is not None, upcoming_days=upcoming, prep_doc=entry.document_id is not None)
    return MissionOut(
        entry_id=entry.id, stages=stages_for(facts), fit=fit, resume=resume, resume_missing=missing,
        snapshots=[SnapshotOut(id=s.id, title=s.title, score=s.score, note=s.note, resume_id=s.resume_id,
                               created_at=_aware(s.created_at)) for s in snaps],
        offer=_offer_ref(linked) if linked else None,
        offers=[_offer_ref(o) for o in offers if o.application_id in (None, entry.id)],
        practice_rounds=practice, live_rounds=len(rounds) - practice,
        next=next_step(facts, f"/jobs/listing/{entry.listing_id}"))


@router.get("/{entry_id}/mission", response_model=MissionOut, dependencies=[read_limit])
async def get_mission(entry_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    return await mission(db, user, await _entry(db, entry_id, user), tz_offset=tz_offset)


class LinkResumeIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


@router.put("/{entry_id}/mission/resume", response_model=MissionOut, dependencies=[read_limit])
async def link_resume(entry_id: str, body: LinkResumeIn, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    """Link the resume for this job (or unlink with null). Only one of the account's own resumes."""
    entry = await _entry(db, entry_id, user)
    if body.resume_id is not None:
        r = await db.get(Resume, body.resume_id)
        if r is None or r.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
    entry.resume_id = body.resume_id
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)


class SnapshotIn(BaseModel):
    note: str = Field("", max_length=200)


@router.post("/{entry_id}/mission/snapshots", response_model=MissionOut, status_code=status.HTTP_201_CREATED,
             dependencies=[read_limit])
async def freeze_resume(entry_id: str, body: SnapshotIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    """Keep a copy of the linked resume as it is now: what was sent for this job."""
    entry = await _entry(db, entry_id, user)
    r = await db.get(Resume, entry.resume_id) if entry.resume_id else None
    if r is None or r.user_id != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link the resume you sent first.")
    count = len((await db.scalars(select(ResumeSnapshot.id).where(ResumeSnapshot.application_id == entry.id))).all())
    if count >= MAX_SNAPSHOTS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This job already keeps {MAX_SNAPSHOTS} versions. "
                                                      "Delete one to keep another.")
    score = await asyncio.to_thread(_score, r.data, r.design, r.job_text or "")
    db.add(ResumeSnapshot(user_id=user.id, application_id=entry.id, resume_id=r.id, title=r.title,
                          data=dict(r.data or {}), design=dict(r.design or {}), job_text=r.job_text or "",
                          score=score, note=body.note.strip()))
    entry.interview_version = None  # interview prep and the copilot use the version just sent (job_portal/interview.py)
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)


async def _snapshot(db: AsyncSession, entry: JobApplication, snapshot_id: str, user: User) -> ResumeSnapshot:
    s = await db.get(ResumeSnapshot, snapshot_id)
    if s is None or s.user_id != user.id or s.application_id != entry.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return s


class RestoredOut(BaseModel):
    resume_id: str


@router.post("/{entry_id}/mission/snapshots/{snapshot_id}/copy", response_model=RestoredOut,
             status_code=status.HTTP_201_CREATED, dependencies=[read_limit])
async def copy_snapshot(entry_id: str, snapshot_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> RestoredOut:
    """Open the sent version again as a new resume (the snapshot itself never changes)."""
    from orbit_api.resumes.routes import MAX_RESUMES

    entry = await _entry(db, entry_id, user)
    s = await _snapshot(db, entry, snapshot_id, user)
    # A new resume like any other: the same cap as making one in Resume AI.
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    date = (_aware(s.created_at) + timedelta(minutes=tz_offset)).strftime("%d %b %Y")  # their own day
    copy = Resume(user_id=user.id, title=f"{s.title} (sent {date})"[:160], data=dict(s.data or {}),
                  design=dict(s.design or {}), job_text=s.job_text or "")
    db.add(copy)
    await db.commit()
    return RestoredOut(resume_id=copy.id)


@router.delete("/{entry_id}/mission/snapshots/{snapshot_id}", response_model=MissionOut, dependencies=[read_limit])
async def delete_snapshot(entry_id: str, snapshot_id: str, user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    entry = await _entry(db, entry_id, user)
    await db.delete(await _snapshot(db, entry, snapshot_id, user))
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)


class LinkOfferIn(BaseModel):
    offer_id: str | None = Field(None, max_length=36)


@router.put("/{entry_id}/mission/offer", response_model=MissionOut, dependencies=[read_limit])
async def link_offer(entry_id: str, body: LinkOfferIn, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    """Link one of the account's offers to this job (null unlinks). An offer belongs to one job at a time."""
    entry = await _entry(db, entry_id, user)
    current = (await db.scalars(select(JobOffer).where(JobOffer.user_id == user.id,
                                                       JobOffer.application_id == entry.id))).all()
    for o in current:
        o.application_id = None
    if body.offer_id is not None:
        offer = await db.get(JobOffer, body.offer_id)
        if offer is None or offer.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
        offer.application_id = entry.id
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)
