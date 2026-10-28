"""Interview day (docs/DECISIONS.md D64): a tracked job prepared for its interview, the copilot started with that job
loaded, and the wrap-up after the round. Built on what Orbit already keeps for the job (its post, the resume linked to
it and the versions sent, the fit check) and on Resume AI's interview prep, the story bank and the documents a live
session grounds on. Every id is checked against the signed-in account (404 for anyone else's, as for a missing one).

- `GET  /v1/jobs/tracker/{id}/interview`: the prep view. When, and which round; the job post (its summary, and whether
  Orbit has its text); the resume version used, and the others to pick from; the stories that fit the job's
  requirements; the sessions started from this job. No AI call.
- `PUT  /v1/jobs/tracker/{id}/interview`: the date and time, the round (type and number), the stage, the resume
  version, and the job post (one of the account's documents, or pasted text for a job added by hand). Only the
  fields sent change.
- `POST /v1/jobs/tracker/{id}/interview/questions`: the questions likely for this job, from that resume version and
  the post: Resume AI's interview prep (`/v1/resumes/prep/questions`), one resume credit, given back if it fails.
  They're kept on the job (`interview_questions`) and come back with the prep view: paid for once; asking again
  (Regenerate) is another credit.
- `POST /v1/jobs/tracker/{id}/session-context`: what a live session (or a practice round) for this interview starts
  with: the role, company and round, the job's requirements, and the documents to ground on: the job post (saved to
  Documents once and linked to the job, as Prepare does) and the resume version (one document per version, brought
  up to date rather than copied). No AI, no credit. The session is then created with `application_id`. Documents
  saved here are Orbit's (`origin="orbit"`): outside the plan's documents, capped on their own (documents/routes.py).
- `POST /v1/jobs/tracker/{id}/wrap-up`: after a round, what the user confirmed: a next round (its type and date),
  waiting to hear (a date to follow up), an offer, or not this time. Nothing moves the job without it.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email, require_verified_user
from orbit_api.auth.security import current_user
from orbit_api.auto_apply import manual_jobs
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.routes import ORIGIN_ORBIT, Origin, _check_quota, _ingest
from orbit_api.documents.uploads import sanitize_text
from orbit_api.job_portal import manual, session_associations
from orbit_api.job_portal.mission import _score
from orbit_api.job_portal.resume_binding import for_job
from orbit_api.job_portal.round_journal import context_round
from orbit_api.job_portal.rounds import MAX_ROUND, RoundType, as_round_type, review_score, round_label
from orbit_api.job_portal.routes import FitOut, Status, _full_text, _job_text, _move, run_fit
from orbit_api.job_portal.routes import ai_limit as jobs_ai_limit
from orbit_api.job_portal.routes import ai_user_limit as jobs_ai_user_limit
from orbit_api.live import company_styles
from orbit_api.live.events import QuestionType
from orbit_api.models import (
    AuditLog,
    Document,
    DocumentChunk,
    JobApplication,
    JobFitCheck,
    JobListing,
    LiveSessionRow,
    Resume,
    ResumeSnapshot,
    SessionSummary,
    Story,
    User,
)
from orbit_api.ratelimit import limit_user
from orbit_api.resumes import ai as resume_ai
from orbit_api.resumes import interview_prep
from orbit_api.resumes.allowance import Allowance
from orbit_api.resumes.routes import (
    MAX_JOB_TEXT,
    CoverLetterIn,
    CoverLetterOut,
    account_allowance,
    ai_limit,
    ai_user_limit,
    cover_letter,
    prep_questions,
)
from orbit_api.resumes.schema import ResumeData
from orbit_api.retrieval.embeddings import get_embedder
from orbit_api.retrieval.index import SessionIndex
from orbit_api.stories.routes import DOC_KIND as STORY_KIND
from orbit_api.stories.routes import MAX_STORIES, index_chunk
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/jobs/tracker", tags=["jobs"])
read_limit = Depends(limit_user("jobs-interview", rate_per_s=3, burst=60))
# Starting a session or a practice round from a job: may save its post (and fetch the post's page once, as Prepare
# does) and a resume document. A few an hour is real use.
context_limit = Depends(limit_user("jobs-interview-context", rate_per_s=60 / 3600, burst=10))

MAX_REQUIREMENTS = 8  # shown with the stories; the first five go to the copilot
SESSION_REQUIREMENTS = 5
MAX_STORY_MATCHES = 5
MAX_ROUNDS = 10
MAX_TECH = 12
LINKED_RESUME = "resume"  # JobApplication.interview_version: the linked resume as it is now


class RoundOut(BaseModel):
    type: RoundType | None
    number: int | None
    label: str  # "Round 2 · Technical round", "" when neither is set
    at: datetime | None  # the tracker's next date: the interview's date and time


class JobPostOut(BaseModel):
    listing_id: str
    manual: bool  # added by hand (found elsewhere): no post in Orbit's feed
    live: bool  # its page in Jobs AI is still there
    url: str
    snippet: str  # the feed's summary; the whole post stays on the original site (D43)
    has_text: bool  # Orbit has the post's text to prepare from (the feed's copy, or a saved document)
    document_id: str | None  # the post saved to Documents for this job, which the copilot grounds on
    document_title: str | None


class VersionOut(BaseModel):
    kind: Literal["snapshot", "resume"]  # a version frozen as sent, or the linked resume as it is now
    id: str
    title: str
    score: int
    at: datetime  # when it was sent (frozen), or last edited
    note: str = ""


class StoryMatchOut(BaseModel):
    id: str
    title: str
    requirement: str  # the job's requirement it fits (matched on its words)


class RoundRefOut(BaseModel):
    id: str
    type: str
    title: str
    status: str
    at: datetime
    practice: bool
    stage: str | None
    score: int | None  # the review's overall score, 1-5, once the report has one


class SavedQuestionsOut(BaseModel):
    """The likely questions last generated for this job: paid for once, shown again for free."""
    result: interview_prep.QuestionsOut
    generated_at: datetime
    stale: bool  # made from another resume version than the one used now


class InterviewOut(BaseModel):
    round_history_enabled: bool = False
    entry_id: str
    status: Status
    company: str
    title: str
    round: RoundOut
    job: JobPostOut
    version: VersionOut | None  # what interview prep and the copilot use
    versions: list[VersionOut]  # to pick from: the versions sent (newest first), then the linked resume
    resume_missing: bool  # a resume was linked and has since been deleted
    requirements: list[str]
    stories: list[StoryMatchOut]
    stories_total: int
    rounds: list[RoundRefOut]  # sessions started from this job, newest first
    guide: str | None  # the company guide's name, when Orbit has one (the copilot uses it)
    questions: SavedQuestionsOut | None = None


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def _entry(db: AsyncSession, entry_id: str, user: User) -> JobApplication:
    entry = await db.get(JobApplication, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your tracker")
    return entry


# ---- what the job has ------------------------------------------------------------------------------------------


async def _post(db: AsyncSession, user: User, entry: JobApplication) -> tuple[JobListing | None, Document | None]:
    """The job's post in the feed's cache (none for a job added by hand, or once it's dropped) and its saved
    document (the account's own, ready)."""
    listing = None if manual.is_manual(entry.listing_id) else await db.get(JobListing, entry.listing_id)
    doc = await db.get(Document, entry.document_id) if entry.document_id else None
    if doc is not None and (doc.user_id != user.id or doc.status != "ready"):
        doc = None
    return listing, doc


Version = ResumeSnapshot | Resume


async def _versions(db: AsyncSession, user: User,
                    entry: JobApplication) -> tuple[list[ResumeSnapshot], Resume | None, bool]:
    """The versions sent for this job (newest first), the linked resume, and whether a linked one was deleted."""
    snaps = list((await db.scalars(select(ResumeSnapshot).where(ResumeSnapshot.user_id == user.id,
                                                                ResumeSnapshot.application_id == entry.id)
                                   .order_by(ResumeSnapshot.created_at.desc()))).all())
    resume = await db.get(Resume, entry.resume_id) if entry.resume_id else None
    if resume is not None and resume.user_id != user.id:
        resume = None
    return snaps, resume, bool(entry.resume_id) and resume is None


def chosen_version(choice: str | None, snaps: list[ResumeSnapshot], resume: Resume | None) -> Version | None:
    """The version prep and the copilot use: the one picked (a version sent, or the linked resume as it is now),
    else the newest version sent, else the linked resume."""
    if choice == LINKED_RESUME and resume is not None:
        return resume
    picked = next((s for s in snaps if s.id == choice), None) if choice else None
    return picked or (snaps[0] if snaps else resume)


async def _version_out(v: Version) -> VersionOut:
    if isinstance(v, ResumeSnapshot):
        return VersionOut(kind="snapshot", id=v.id, title=v.title, score=v.score, at=_aware(v.created_at),
                          note=v.note or "")
    score = await asyncio.to_thread(_score, v.data, v.design, v.job_text or "")
    return VersionOut(kind="resume", id=v.id, title=v.title, score=score, at=_aware(v.updated_at))


def _clean(text: str, limit: int) -> str:
    return " ".join(text.split())[:limit]


async def _requirements(db: AsyncSession, user: User, entry: JobApplication, listing: JobListing | None,
                        doc: Document | None) -> list[str]:
    """What the job asks for, in its own words: the fit check's requirements, else the saved post's requirement
    lines, else the skills the feed read from the post."""
    out: list[str] = []
    fit = (await db.scalars(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
                                                      JobFitCheck.listing_id == entry.listing_id)
                            .order_by(JobFitCheck.created_at.desc()).limit(1))).first()
    if fit is not None and isinstance(fit.result, dict):
        out = [_clean(str(r["requirement"]), 400) for r in fit.result.get("requirements") or []
               if isinstance(r, dict) and r.get("requirement")]
    if not out and doc is not None:
        lines = (await db.scalars(select(DocumentChunk.text).where(DocumentChunk.document_id == doc.id,
                                                                   DocumentChunk.category == "requirement")
                                  .order_by(DocumentChunk.ordinal).limit(MAX_REQUIREMENTS * 2))).all()
        out = [_clean(t, 400) for t in lines if len(t.split()) >= 3]
    if not out and listing is not None:
        out = [_clean(k, 100) for k in listing.keywords or []]
    return list(dict.fromkeys(x for x in out if x))[:MAX_REQUIREMENTS]


def _story_matches(stories: list[Story], requirements: list[str]) -> list[StoryMatchOut]:
    """For each requirement in turn, the best story from the bank that shares its words or meaning (each story
    once), so the prep view can say which example to tell for what."""
    embedder = get_embedder()
    current = embedder.ready
    index = SessionIndex([index_chunk(s, (s.embedding or []) if current and s.embedding_model == embedder.model_id
                                      else []) for s in stories])
    titles = {s.id: s.title for s in stories}
    out: list[StoryMatchOut] = []
    for req in requirements:
        hit = next((h for h in index.search(req, QuestionType.behavioral, k=3, doc_kind=STORY_KIND)
                    if h.chunk.id not in {m.id for m in out}), None)
        if hit is not None:
            out.append(StoryMatchOut(id=hit.chunk.id, title=titles.get(hit.chunk.id, ""), requirement=req))
        if len(out) >= MAX_STORY_MATCHES:
            break
    return out


async def _rounds(db: AsyncSession, user: User, entry: JobApplication) -> list[RoundRefOut]:
    rows = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user.id,
                                                          LiveSessionRow.application_id == entry.id,
                                                          LiveSessionRow.status != "created")
                             .order_by(LiveSessionRow.created_at.desc()).limit(MAX_ROUNDS))).all()
    scores: dict[str, int | None] = {}
    if rows:
        scores = {sid: review_score(c) for sid, c in (await db.execute(
            select(SessionSummary.session_id, SessionSummary.content)
            .where(SessionSummary.session_id.in_([r.id for r in rows])))).all()}
    return [RoundRefOut(id=r.id, type=r.type, title=r.title, status=r.status,
                        at=_aware(r.started_at or r.created_at), practice=r.type == "mock",
                        stage=r.interview_stage, score=scores.get(r.id)) for r in rows]


def _saved_questions(entry: JobApplication, chosen: Version | None) -> SavedQuestionsOut | None:
    stored = entry.interview_questions
    if not isinstance(stored, dict):
        return None
    try:
        result = interview_prep.QuestionsOut.model_validate(stored.get("result"))
        at = _aware(datetime.fromisoformat(str(stored.get("generated_at"))))
    except ValueError:
        return None
    return SavedQuestionsOut(result=result, generated_at=at,
                             stale=chosen is None or stored.get("version_id") != chosen.id)


def _guide(company: str) -> str | None:
    style = company_styles.match(company)
    return style.name if style else None


async def interview_out(db: AsyncSession, user: User, entry: JobApplication) -> InterviewOut:
    listing, doc = await _post(db, user, entry)
    snaps, resume, missing = await _versions(db, user, entry)
    chosen = chosen_version(entry.interview_version, snaps, resume)
    versions = [await _version_out(s) for s in snaps]
    if resume is not None:
        versions.append(await _version_out(resume))
    version = next((v for v in versions if chosen is not None and v.id == chosen.id), None)
    requirements = await _requirements(db, user, entry, listing, doc)
    stories = list((await db.scalars(select(Story).where(Story.user_id == user.id)
                                     .order_by(Story.updated_at.desc()).limit(MAX_STORIES))).all())
    matches = await asyncio.to_thread(_story_matches, stories, requirements) if stories and requirements else []
    round_type = as_round_type(entry.round_type)
    return InterviewOut(
        round_history_enabled=get_settings().personal_interview_rounds,
        entry_id=entry.id, status=entry.status, company=entry.company, title=entry.title,
        round=RoundOut(type=round_type, number=entry.round_number, label=round_label(round_type, entry.round_number),
                       at=_aware(entry.next_at) if entry.next_at else None),
        job=JobPostOut(listing_id=entry.listing_id, manual=manual.is_manual(entry.listing_id), live=listing is not None,
                       url=entry.url, snippet=(listing.snippet if listing else "")[:2_000],
                       has_text=doc is not None or bool(listing and (listing.description or listing.snippet)),
                       document_id=doc.id if doc else None, document_title=doc.title if doc else None),
        version=version, versions=versions, resume_missing=missing, requirements=requirements,
        stories=matches, stories_total=len(stories), rounds=await _rounds(db, user, entry),
        guide=_guide(entry.company), questions=_saved_questions(entry, chosen))


class SessionAssociationIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)
    confirmed: Literal[True]


@router.post("/{entry_id}/sessions/link", dependencies=[read_limit])
async def link_reviewed_session(entry_id: str, body: SessionAssociationIn,
                                user: Annotated[User, Depends(current_user)],
                                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    """A candidate-reviewed existing session association; never infer it from a company or URL."""
    await lock_account(db, user.id)
    entry = await _entry(db, entry_id, user)
    session = await db.scalar(select(LiveSessionRow).where(LiveSessionRow.id == body.session_id,
        LiveSessionRow.user_id == user.id).with_for_update().execution_options(populate_existing=True))
    if session is None:
        raise HTTPException(404, "Session not found")
    if session.application_id and session.application_id != entry.id:
        raise HTTPException(409, "This session already belongs to another opportunity.")
    if session.status != "ended":
        raise HTTPException(409, "Finish the session before reviewing its association.")
    if session.application_id != entry.id:
        db.add(AuditLog(user_id=user.id, action=session_associations.LINK,
            target=session_associations.target(entry.id, session.id)))
        session.application_id = entry.id
    await db.commit()
    return {"session_id": session.id, "application_id": entry.id}


@router.post("/{entry_id}/sessions/unlink", dependencies=[read_limit])
async def unlink_reviewed_session(entry_id: str, body: SessionAssociationIn,
                                  user: Annotated[User, Depends(current_user)],
                                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str | None]:
    """Remove attribution only. Recorded transcript, context and report remain unchanged."""
    await lock_account(db, user.id)
    entry = await _entry(db, entry_id, user)
    session = await db.scalar(select(LiveSessionRow).where(LiveSessionRow.id == body.session_id,
        LiveSessionRow.user_id == user.id).with_for_update().execution_options(populate_existing=True))
    if session is None:
        raise HTTPException(404, "Session not found")
    if session.application_id not in (None, entry.id):
        raise HTTPException(409, "This session belongs to another opportunity. Refresh before changing it.")
    if session.status != "ended":
        raise HTTPException(409, "Finish the session before changing its association.")
    if session.application_id == entry.id:
        db.add(AuditLog(user_id=user.id, action=session_associations.UNLINK,
            target=session_associations.target(entry.id, session.id)))
        session.application_id = None
    await db.commit()
    return {"session_id": session.id, "application_id": session.application_id}


@router.get("/{entry_id}/interview", response_model=InterviewOut, dependencies=[read_limit])
async def get_interview(entry_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> InterviewOut:
    return await interview_out(db, user, await _entry(db, entry_id, user))


# ---- setting it up ---------------------------------------------------------------------------------------------


async def keep_document(db: AsyncSession, user: User, kind: str, title: str, text: str, *,
                        update: bool = True, origin: Origin = "user") -> Document:
    """A document of the account's with this text: one of this kind that already has it word for word (the same
    resume sent to three jobs is one document), else (`update`) its pasted, not uploaded, one of this title brought up
    to date, else a new one (402 past the plan's documents). Starting the same interview again never copies anything.
    A version sent never changes, so its document is never updated: `update=False`. A new one Orbit saves for the
    job's interview (`origin="orbit"`) is outside the plan's documents, within Orbit's own cap (402 past it)."""
    text, title = sanitize_text(text), title[:300]
    same = (await db.scalars(select(Document).where(Document.user_id == user.id, Document.kind == kind,
                                                    Document.status == "ready", Document.source_text == text)
                             .order_by(Document.created_at.desc()).limit(1))).first()
    if same is not None:
        return same
    found = (await db.scalars(select(Document).where(Document.user_id == user.id, Document.kind == kind,
                                                     Document.title == title, Document.filename.is_(None))
                              .order_by(Document.created_at.desc()).limit(1))).first() if update else None
    if found is not None:
        if found.source_text != text or found.status != "ready":
            await _ingest(db, found, text)
            found.size_bytes = len(text.encode())
        return found
    await _check_quota(db, user, origin)
    doc = Document(user_id=user.id, title=title, kind=kind, size_bytes=len(text.encode()), origin=origin)
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, text)
    return doc


class InterviewIn(BaseModel):
    """Only the fields sent change (null clears the date, the round type or number, or picks the default version)."""
    at: datetime | None = None
    round_type: RoundType | None = None
    round_number: int | None = Field(None, ge=1, le=MAX_ROUND)
    status: Status | None = None  # e.g. "interviewing" once they've invited you
    version: str | None = Field(None, max_length=36)  # a version sent (its id), "resume", or null for the default
    resume_id: str | None = Field(None, min_length=1, max_length=36)  # link this resume (and use it)
    document_id: str | None = Field(None, min_length=1, max_length=36)  # the post: one of the account's documents
    job_text: str | None = Field(None, min_length=40, max_length=MAX_JOB_TEXT)  # or the post pasted


@router.put("/{entry_id}/interview", response_model=InterviewOut, dependencies=[read_limit])
async def update_interview(entry_id: str, body: InterviewIn, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> InterviewOut:
    await lock_account(db, user.id)
    entry = await _entry(db, entry_id, user)
    sent = body.model_fields_set
    if {"at", "round_type", "round_number"} & sent:
        entry.preparation_round_id = entry.preparation_round_revision = None
    if "at" in sent:
        entry.next_at = body.at
    if "round_type" in sent:
        entry.round_type = body.round_type
    if "round_number" in sent:
        entry.round_number = body.round_number
    if body.status is not None:
        _move(entry, body.status)
        if body.status in ("interviewing", "offer") and entry.applied_at is None:
            entry.applied_at = datetime.now(UTC)
    if body.resume_id is not None:
        r = await db.get(Resume, body.resume_id)
        if r is None or r.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
        entry.resume_id = (await for_job(db, user, entry, r)).id
        if "version" not in sent:  # use it: as it is now if versions of another one were sent, else by default
            snaps = await db.scalar(select(ResumeSnapshot.id).where(ResumeSnapshot.application_id == entry.id).limit(1))
            entry.interview_version = LINKED_RESUME if snaps else None
    if "version" in sent:
        if body.version == LINKED_RESUME:
            linked = await db.get(Resume, entry.resume_id) if entry.resume_id else None
            if linked is None or linked.user_id != user.id:
                raise HTTPException(status.HTTP_409_CONFLICT, "Link a resume to this job first.")
        elif body.version is not None:
            snap = await db.get(ResumeSnapshot, body.version)
            if snap is None or snap.user_id != user.id or snap.application_id != entry.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
        entry.interview_version = body.version
    if body.document_id is not None:
        d = await db.get(Document, body.document_id)
        if d is None or d.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
        if d.kind != "job_description":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a job description document.")
        entry.document_id = d.id
    elif body.job_text is not None:
        doc = await keep_document(db, user, "job_description", f"{entry.title} — {entry.company}", body.job_text,
                                  origin=ORIGIN_ORBIT)
        entry.document_id = doc.id
    await db.commit()
    await db.refresh(entry)
    return await interview_out(db, user, entry)


class FitIn(BaseModel):
    job_text: str | None = Field(None, min_length=40, max_length=MAX_JOB_TEXT)  # else the post saved on the job


@router.post("/{entry_id}/fit", response_model=FitOut,
             dependencies=[Depends(jobs_ai_limit), Depends(jobs_ai_user_limit)])
async def manual_fit(entry_id: str, body: FitIn, user: Annotated[User, Depends(require_verified_email)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> FitOut:
    """The fit check for a job added by hand, which has no post in Orbit: against the post pasted here (kept on the
    job, as the interview prep keeps one) or the one already saved. Same allowance and cache as a listing's check."""
    entry = await _entry(db, entry_id, user)
    if not manual.is_manual(entry.listing_id):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This job has its post in Orbit: check your fit from its listing.")
    if body.job_text is not None:
        text = body.job_text
        doc = await keep_document(db, user, "job_description", f"{entry.title} — {entry.company}", text,
                                  origin=ORIGIN_ORBIT)
        entry.document_id = doc.id
        await db.commit()
    else:
        _, saved = await _post(db, user, entry)
        text = (saved.source_text or "") if saved is not None else ""
    if len(text.strip()) < 40:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Paste the job description first: the fit check compares it with your resume.")
    text = text[:MAX_JOB_TEXT]
    return await run_fit(None, db, user, manual_jobs.post_listing(entry, text), text, pasted=True)


@router.post("/{entry_id}/interview/questions", response_model=interview_prep.QuestionsOut,
             dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def interview_questions(entry_id: str, user: Annotated[User, Depends(require_verified_email)],
                              db: Annotated[AsyncSession, Depends(get_db)],
                              allowance: Annotated[Allowance, Depends(account_allowance)]
                              ) -> interview_prep.QuestionsOut:
    """The questions likely for this job, from the resume version it uses and its post: Resume AI's interview prep,
    one resume credit (nothing is spent when there's no resume to prepare from). Kept on the job, so the prep view
    shows them again without asking (and paying) again."""
    entry = await _entry(db, entry_id, user)
    snaps, resume, _ = await _versions(db, user, entry)
    chosen = chosen_version(entry.interview_version, snaps, resume)
    if chosen is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link or choose a resume version for this job first.")
    listing, doc = await _post(db, user, entry)
    job = (doc.source_text or "") if doc is not None else (
        _job_text(listing, listing.description or listing.snippet) if listing is not None else "")
    body = interview_prep.PrepIn(data=ResumeData.model_validate(chosen.data or {}), job_text=job[:MAX_JOB_TEXT])
    out = await prep_questions(body, user, db, allowance)
    entry.interview_questions = {"version_id": chosen.id, "generated_at": datetime.now(UTC).isoformat(),
                                 "result": out.model_dump(mode="json")}
    await db.commit()
    return out


class JobLetterIn(BaseModel):
    tone: resume_ai.LetterTone = "professional"
    length: resume_ai.LetterLength = "standard"


@router.post("/{entry_id}/cover-letter", response_model=CoverLetterOut,
             dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def job_cover_letter(entry_id: str, body: JobLetterIn, user: Annotated[User, Depends(require_verified_email)],
                           db: Annotated[AsyncSession, Depends(get_db)],
                           allowance: Annotated[Allowance, Depends(account_allowance)]) -> CoverLetterOut:
    """A cover letter for this job, from the resume version it uses and its saved post: Resume AI's letter, one resume
    credit, grounded the same way (nothing the resume doesn't say). Without a saved post it's written to the role and
    company alone; nothing is spent when there's no resume to write from."""
    entry = await _entry(db, entry_id, user)
    snaps, resume, _ = await _versions(db, user, entry)
    chosen = chosen_version(entry.interview_version, snaps, resume)
    if chosen is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link a resume to this job first.")
    listing, doc = await _post(db, user, entry)
    job = (doc.source_text or "") if doc is not None else (
        _job_text(listing, listing.description or listing.snippet) if listing is not None else "")
    if not job.strip():
        job = f"{entry.title} at {entry.company}"
    letter = CoverLetterIn(data=ResumeData.model_validate(chosen.data or {}), job_text=job[:MAX_JOB_TEXT],
                           tone=body.tone, length=body.length)
    return await cover_letter(letter, user, db, allowance)


class ContextDoc(BaseModel):
    id: str
    kind: str
    title: str


class SessionContextOut(BaseModel):
    """What a session for this interview starts with. Create it with these fields and `application_id`."""
    application_id: str
    interview_round_id: str | None = None
    interview_round_revision: int | None = None
    title: str
    role: str
    company: str
    interview_stage: str
    key_requirements: list[str]
    tech_stack: list[str]
    document_ids: list[str]  # the job post first, then the resume version
    documents: list[ContextDoc]
    resume_included: bool  # false: no resume linked to the job, so setup keeps the resumes it would pick anyway
    version: VersionOut | None
    round: RoundOut
    guide: str | None
    notes: list[str]  # what's missing, in words


def resume_document_text(data: ResumeData) -> str:
    """The resume as a document, under the section headings the document reader splits on (documents/parsing.py),
    so each role's lines keep their role: the same shape as the web's "Use in Orbit" text."""
    d = data.visible()
    b = d.basics
    out = [b.name, b.headline, " | ".join(x for x in (b.email, b.phone, b.location) if x)]
    if b.summary.strip():
        out += ["", "SUMMARY", b.summary]
    if d.experience:
        out += ["", "EXPERIENCE"]
        for e in d.experience:
            when = " - ".join(x for x in (e.start, "Present" if e.current else e.end) if x)
            head = ", ".join(x for x in (e.title, e.company) if x) + (f" — {e.location}" if e.location else "")
            out += [f"{head} ({when})" if when else head, *(f"- {t}" for t in e.bullets if t.strip())]
    if d.skills:
        out += ["", "SKILLS", *(f"{s.name}: {', '.join(s.items)}" if s.name else ", ".join(s.items) for s in d.skills)]
    if d.projects:
        out += ["", "PROJECTS"]
        for p in d.projects:
            out += [p.name, p.description, *(f"- {t}" for t in p.bullets if t.strip())]
    if d.education:
        out += ["", "EDUCATION", *(", ".join(x for x in (ed.degree, ed.field, ed.school, ed.grade) if x)
                                   for ed in d.education)]
    if d.certifications:
        out += ["", "CERTIFICATIONS", *(", ".join(x for x in (c.name, c.issuer, c.date) if x)
                                        for c in d.certifications)]
    for x in d.extras:
        items = [t for t in x.items if t.strip()]
        if x.title.strip() and items:
            out += ["", x.title.strip().upper(), *(f"- {t}" for t in items)]
    return "\n".join(out).strip()


def _version_title(v: Version, tz_offset: int) -> str:
    """A version sent is named for the day it was sent (the person's own day), not for a job: the same version sent
    to two jobs is one document. The linked resume is named by its own title (as "Use in Orbit" names it), so it's the
    same document Resume AI keeps up to date."""
    if isinstance(v, ResumeSnapshot):
        return f"{v.title} (saved {(_aware(v.created_at) + timedelta(minutes=tz_offset)).strftime('%d %b %Y')})"
    return v.title


async def _saved(db: AsyncSession, user: User, kind: str, title: str, text: str, what: str, notes: list[str],
                 update: bool = True) -> Document | None:
    """keep_document for the job's interview, or a note when its documents are all in use: the session still
    starts, linked to the job."""
    try:
        return await keep_document(db, user, kind, title, text, update=update, origin=ORIGIN_ORBIT)
    except HTTPException as e:
        if e.status_code != status.HTTP_402_PAYMENT_REQUIRED:
            raise
        notes.append(f"{e.detail} Until then, {what} isn't loaded for the copilot.")
        return None


@router.post("/{entry_id}/session-context", response_model=SessionContextOut, dependencies=[context_limit])
async def session_context(entry_id: str, user: Annotated[User, Depends(require_verified_user)],
                          db: Annotated[AsyncSession, Depends(get_db)], tz_offset: int = 0) -> SessionContextOut:
    """`tz_offset`: minutes east of UTC, so a version sent is named for the person's own day."""
    entry = await _entry(db, entry_id, user)
    tz = max(-720, min(840, tz_offset))
    listing, doc = await _post(db, user, entry)
    notes: list[str] = []
    if doc is None and listing is not None:
        text, note = await _full_text(db, listing)
        doc = await _saved(db, user, "job_description", f"{listing.title} — {listing.company}",
                           _job_text(listing, text), "the job post", notes)
        if doc is not None:
            entry.document_id = doc.id
        if note:
            notes.append(note)
    elif doc is None:
        notes.append("There's no job post on file for this job. Paste it in its interview prep so answers fit the "
                     "role.")
    snaps, resume, _ = await _versions(db, user, entry)
    chosen = chosen_version(entry.interview_version, snaps, resume)
    resume_doc = None
    if chosen is not None:
        text = resume_document_text(ResumeData.model_validate(chosen.data or {}))
        if len(text) >= 20:
            resume_doc = await _saved(
                db, user, "resume", _version_title(chosen, tz), text, "the selected resume version",
                notes, update=not isinstance(chosen, ResumeSnapshot))
    else:
        notes.append("No resume is linked to this job, so the copilot uses the resumes you tick in setup.")
    await db.commit()
    requirements = await _requirements(db, user, entry, listing, doc)
    round_type = as_round_type(entry.round_type)
    selected_round = await context_round(db, entry)
    label = selected_round.label if selected_round else round_label(round_type, entry.round_number)
    docs = [d for d in (doc, resume_doc) if d is not None]
    return SessionContextOut(
        application_id=entry.id,
        interview_round_id=selected_round.id if selected_round else None,
        interview_round_revision=selected_round.revision if selected_round else None,
        title=f"{entry.company} — {label or entry.title}"[:300],
        role=entry.title[:300], company=entry.company[:120],
        interview_stage=(label or "Interview")[:80],
        key_requirements=requirements[:SESSION_REQUIREMENTS],
        tech_stack=[_clean(k, 100) for k in (listing.keywords if listing else [])][:MAX_TECH],
        document_ids=[d.id for d in docs], documents=[ContextDoc(id=d.id, kind=d.kind, title=d.title) for d in docs],
        resume_included=resume_doc is not None,
        version=await _version_out(chosen) if chosen is not None else None,
        round=RoundOut(type=round_type, number=entry.round_number, label=label,
                       at=_aware(entry.next_at) if entry.next_at else None),
        guide=_guide(entry.company), notes=notes)


# ---- after the round -------------------------------------------------------------------------------------------

Outcome = Literal["next_round", "waiting", "offer", "rejected"]


class WrapUpIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)
    outcome: Outcome
    round_type: RoundType | None = None  # the next round's, when it's known
    at: datetime | None = None  # the next round's date and time, or when to follow up


@router.post("/{entry_id}/wrap-up", response_model=InterviewOut, dependencies=[read_limit])
async def wrap_up(entry_id: str, body: WrapUpIn, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> InterviewOut:
    """What the user says happened after a round started from this job. Only then does the job move. The round fields
    are the upcoming round's: a next round is the one after this (its number from the round set, else from the live
    rounds started from the job); waiting, an offer or not this time has none, and the date is then a follow-up's."""
    entry = await _entry(db, entry_id, user)
    entry.preparation_round_id = entry.preparation_round_revision = None
    s = await db.get(LiveSessionRow, body.session_id)
    if s is None or s.user_id != user.id or s.application_id != entry.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    now = datetime.now(UTC)
    if body.outcome == "next_round":
        done = entry.round_number or int(await db.scalar(select(func.count()).select_from(LiveSessionRow).where(
            LiveSessionRow.user_id == user.id, LiveSessionRow.application_id == entry.id,
            LiveSessionRow.type != "mock", LiveSessionRow.status == "ended")) or 1)
        entry.round_number, entry.round_type = min(done + 1, MAX_ROUND), body.round_type
    else:
        entry.round_number = entry.round_type = None
    if body.outcome in ("next_round", "waiting"):
        if entry.status in ("saved", "applied", "rejected"):
            _move(entry, "interviewing")
        entry.applied_at = entry.applied_at or now
        entry.next_at = body.at
    elif body.outcome == "offer":
        _move(entry, "offer")
        entry.next_at = body.at
    else:
        _move(entry, "rejected")
        entry.next_at = None
    await db.commit()
    await db.refresh(entry)
    return await interview_out(db, user, entry)

