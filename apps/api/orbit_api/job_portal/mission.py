"""Job Mission Room: one tracked job as a workspace. It reads what Orbit already keeps (the tracker entry, fit checks,
the resume linked to the job, practice and live rounds, the offer) and adds two things only, both on the user's
say: a frozen candidate-saved resume copy (`ResumeSnapshot`) and an offer's link to the job
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
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import (
    ApplicationPacket,
    JobApplication,
    JobFitCheck,
    JobOffer,
    LiveSessionRow,
    Resume,
    ResumeSnapshot,
    User,
)
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import ResumeData, ResumeDesign
from orbit_api.transactions import lock_account

from .requirement_practice import RequirementPractice, practice_source
from .resume_binding import for_job, needs_copy
from .resume_lineage import SnapshotOrigin, VersionComparison, capture_origin, comparison, snapshot_origin
from .source_review import SourceReview
from .source_review import review as review_source

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
    resume_id: str | None  # live link only; immutable origin survives deletion
    origin: SnapshotOrigin | None = None
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


class ApplicationRef(BaseModel):
    id: str
    status: str
    submission_uncertain: bool
    updated_at: datetime


class MissionOut(BaseModel):
    entry_id: str
    application: ApplicationRef | None = None
    stages: dict[str, bool]
    fit: FitSummary | None
    resume: LinkedResume | None
    resume_missing: bool  # a resume was linked and has since been deleted
    resume_requires_copy: bool = False
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
                        why="It's today. The job post, selected resume version and stories are in one place, and "
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
        return NextStep(key="snapshot", title="Keep a resume version for this job", action="Save this resume version",
                        why="Save a separate copy for later review. Confirm it is the version you used; "
                            "saving a copy does not prove it was submitted or received.",
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
                                .order_by(JobFitCheck.created_at.desc(), JobFitCheck.id).limit(1))).first()
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
    requires_copy = False
    if entry.resume_id:
        row = await db.get(Resume, entry.resume_id)
        if row is not None and row.user_id == user.id:
            requires_copy = await needs_copy(db, user, entry, row)
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
    # Counts are source aggregates, not the bounded timeline preview (which may show only ten sessions).
    counts = {kind: count for kind, count in (await db.execute(select(LiveSessionRow.type, func.count()).where(
        LiveSessionRow.user_id == user.id, LiveSessionRow.application_id == entry.id,
        LiveSessionRow.status == "ended").group_by(LiveSessionRow.type))).all()}
    practice = counts.get("mock", 0)
    live_rounds = sum(counts.values()) - practice
    upcoming = None
    shift = timedelta(minutes=tz_offset)
    today = (now + shift).date()
    if entry.next_at and (_aware(entry.next_at) + shift).date() >= today:
        upcoming = ((_aware(entry.next_at) + shift).date() - today).days

    # Project only status and identity, not the stored resume, answers, contact values or worker credentials.
    # user/listing is unique; an explicit conflicting tracker link must never silently attach elsewhere.
    packet = (await db.execute(select(ApplicationPacket.id, ApplicationPacket.status,
                                      ApplicationPacket.submission_started_at, ApplicationPacket.updated_at)
        .where(ApplicationPacket.user_id == user.id, ApplicationPacket.listing_id == entry.listing_id,
               (ApplicationPacket.application_id.is_(None)) | (ApplicationPacket.application_id == entry.id))
        .limit(1))).first()
    application = ApplicationRef(id=packet.id, status=packet.status,
        submission_uncertain=packet.submission_started_at is not None and packet.status not in ("submitted", "applied"),
        updated_at=_aware(packet.updated_at)) if packet else None
    facts = Facts(status=entry.status, fit=fit is not None, resume=resume is not None, snapshot=bool(snaps),
                  applied=entry.applied_at is not None, practice_rounds=practice, live_rounds=live_rounds,
                  offer=linked is not None, upcoming_days=upcoming, prep_doc=entry.document_id is not None)
    return MissionOut(
        entry_id=entry.id, application=application, stages=stages_for(facts), fit=fit,
        resume=resume, resume_missing=missing, resume_requires_copy=requires_copy,
        snapshots=[SnapshotOut(id=s.id, title=s.title, score=s.score, note=s.note, resume_id=s.resume_id,
                               created_at=_aware(s.created_at), origin=snapshot_origin(s)) for s in snaps],
        offer=_offer_ref(linked) if linked else None,
        offers=[_offer_ref(o) for o in offers if o.application_id in (None, entry.id)],
        practice_rounds=practice, live_rounds=live_rounds,
        next=next_step(facts, f"/jobs/listing/{entry.listing_id}"))


@router.get("/{entry_id}/mission", response_model=MissionOut, dependencies=[read_limit])
async def get_mission(entry_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    return await mission(db, user, await _entry(db, entry_id, user), tz_offset=tz_offset)


class OpportunityContext(BaseModel):
    entry_id: str
    title: str
    company: str
    evidence_enabled: bool


@router.get("/{entry_id}/mission/context", response_model=OpportunityContext, dependencies=[read_limit])
async def get_opportunity_context(entry_id: str, user: Annotated[User, Depends(current_user)],
                                  db: Annotated[AsyncSession, Depends(get_db)]) -> OpportunityContext:
    entry = await _entry(db, entry_id, user)
    return OpportunityContext(entry_id=entry.id, title=entry.title, company=entry.company,
                              evidence_enabled=get_settings().evidence_vault)


@router.get("/{entry_id}/mission/source", response_model=SourceReview, dependencies=[read_limit])
async def get_source_review(entry_id: str, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> SourceReview:
    return await review_source(db, await _entry(db, entry_id, user))


@router.get("/{entry_id}/mission/practice", response_model=RequirementPractice, dependencies=[read_limit])
async def get_requirement_practice(entry_id: str, user: Annotated[User, Depends(current_user)],
                                   db: Annotated[AsyncSession, Depends(get_db)]) -> RequirementPractice:
    entry = await _entry(db, entry_id, user)
    fit = await db.scalar(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
        JobFitCheck.listing_id == entry.listing_id).order_by(JobFitCheck.created_at.desc(), JobFitCheck.id)
        .limit(1).execution_options(populate_existing=True))
    return practice_source(entry.id, fit.id if fit else None, fit.created_at if fit else None,
                           fit.result if fit else None, get_settings().evidence_vault)


class LinkResumeIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


@router.put("/{entry_id}/mission/resume", response_model=MissionOut, dependencies=[read_limit])
async def link_resume(entry_id: str, body: LinkResumeIn, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    """Link the resume for this job (or unlink with null). Only one of the account's own resumes."""
    await lock_account(db, user.id)
    entry = await _entry(db, entry_id, user)
    if body.resume_id is not None:
        r = await db.get(Resume, body.resume_id)
        if r is None or r.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
        entry.resume_id = (await for_job(db, user, entry, r)).id
    else:
        entry.resume_id = None
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)


class SnapshotIn(BaseModel):
    note: str = Field("", max_length=200)
    resume_id: str | None = Field(None, max_length=36)
    updated_at: datetime | None = None


@router.post("/{entry_id}/mission/snapshots", response_model=MissionOut, status_code=status.HTTP_201_CREATED,
             dependencies=[read_limit])
async def freeze_resume(entry_id: str, body: SnapshotIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> MissionOut:
    """Keep a copy of the linked resume. Saving is not evidence of submission or delivery."""
    await lock_account(db, user.id)
    entry = await _entry(db, entry_id, user)
    r = await db.scalar(select(Resume).where(Resume.id == entry.resume_id, Resume.user_id == user.id)
        .with_for_update().execution_options(populate_existing=True)) if entry.resume_id else None
    if r is None or r.user_id != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link the resume you want to save first.")
    if (body.resume_id is not None and body.resume_id != r.id) or (
        body.updated_at is not None and _aware(body.updated_at) != _aware(r.updated_at)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "The linked resume changed. Refresh and review it before saving.")
    count = len((await db.scalars(select(ResumeSnapshot.id).where(ResumeSnapshot.application_id == entry.id))).all())
    if count >= MAX_SNAPSHOTS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This job already keeps {MAX_SNAPSHOTS} versions. "
                                                      "Delete one to keep another.")
    score = await asyncio.to_thread(_score, r.data, r.design, r.job_text or "")
    db.add(ResumeSnapshot(user_id=user.id, application_id=entry.id, resume_id=r.id, title=r.title,
                          data=dict(r.data or {}), design=dict(r.design or {}), job_text=r.job_text or "",
                          score=score, note=body.note.strip(), origin=capture_origin(r, kind="resume",
                              source_id=r.id, source_revision=r.revision)))
    entry.interview_version = None  # preparation defaults to the newly saved copy, not a delivery claim
    await db.commit()
    return await mission(db, user, entry, tz_offset=tz_offset)


async def _snapshot(db: AsyncSession, entry: JobApplication, snapshot_id: str, user: User) -> ResumeSnapshot:
    s = await db.get(ResumeSnapshot, snapshot_id)
    if s is None or s.user_id != user.id or s.application_id != entry.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return s


class RestoredOut(BaseModel):
    resume_id: str


@router.get("/{entry_id}/mission/snapshots/{snapshot_id}/compare", response_model=VersionComparison,
            dependencies=[read_limit])
async def compare_snapshot(entry_id: str, snapshot_id: str, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> VersionComparison:
    entry = await _entry(db, entry_id, user)
    saved = await _snapshot(db, entry, snapshot_id, user)
    current = await db.scalar(select(Resume).where(Resume.id == entry.resume_id, Resume.user_id == user.id)
        .execution_options(populate_existing=True)) if entry.resume_id else None
    return comparison(entry.id, saved, current)


@router.post("/{entry_id}/mission/snapshots/{snapshot_id}/copy", response_model=RestoredOut,
             status_code=status.HTTP_201_CREATED, dependencies=[read_limit])
async def copy_snapshot(entry_id: str, snapshot_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> RestoredOut:
    """Open a saved version as a new resume; the snapshot itself never changes."""
    from orbit_api.resumes.routes import MAX_RESUMES

    entry = await _entry(db, entry_id, user)
    s = await _snapshot(db, entry, snapshot_id, user)
    # A new resume like any other: the same cap as making one in Resume AI.
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    date = (_aware(s.created_at) + timedelta(minutes=tz_offset)).strftime("%d %b %Y")  # their own day
    copy = Resume(user_id=user.id, title=f"{s.title} (saved {date})"[:160], data=dict(s.data or {}),
                  design=dict(s.design or {}), job_text=s.job_text or "",
                  prep_context={"source_snapshot_id": s.id, "application_id": entry.id,
                                "snapshot_origin": s.origin})
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
