"""The tailoring queue (after Resume-Matcher's): one resume tailored to several jobs, one after another, in the
background, so nobody waits on a page for ten AI runs.

- `POST /v1/resumes/{resume_id}/tailor-queue` {jobs: [{job_text, label?} | {listing_id}]}: each job becomes a durable
  background job (orbit_api/jobs.py, kind "tailor"), run in order by the API's worker; it survives a restart.
- `GET /v1/resumes/tailor-queue`: the account's recent items and how each went.
- `DELETE /v1/resumes/tailor-queue/{item_id}`: cancel one still waiting, or clear a finished one from the list.

Each item makes a copy of the resume with that job's post attached ("<resume> · <job>"), then runs "Fix everything
with AI" on it with the job post (resumes/autofix.py: the flagged lines, the job's keywords where the candidate's own
work supports them, re-scored), with its changes applied. What the AI can't prove (a skill only the job post names) is
never applied: it's counted, for the candidate to confirm in the editor. A job from Jobs AI is also saved to the
tracker with the new resume attached. One resume credit per item, the same as the fix costs by hand, given back when
the AI isn't used or fails; checked up front so a queue never runs past the credits there are.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import Job, JobListing, Resume, User
from orbit_api.ratelimit import limit_user
from orbit_api.resumes import ai, autofix
from orbit_api.resumes.allowance import allowance_for
from orbit_api.resumes.apply import apply_suggestion
from orbit_api.resumes.routes import MAX_JOB_TEXT, MAX_RESUMES, _generate
from orbit_api.resumes.schema import ResumeData, ResumeDesign

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/resumes", tags=["resumes"])
queue_limit = limit_user("resume-tailor-queue", rate_per_s=10 / 3600, burst=5)

KIND = "tailor"
MAX_PER_REQUEST = 10
MAX_PENDING = 10  # waiting or running at once, per account
SHOWN = 30
TIMEOUT_S = 300  # a whole fix: two AI passes and the keyword pass
jobs.timeout(KIND, TIMEOUT_S)


def _prefix(user_id: str) -> str:
    return f"{KIND}:{user_id}:"


class QueueJobIn(BaseModel):
    job_text: str = Field("", max_length=MAX_JOB_TEXT)
    listing_id: str | None = Field(None, max_length=64)  # a job from Jobs AI
    label: str = Field("", max_length=120)

    @model_validator(mode="after")
    def _one(self) -> "QueueJobIn":
        if not self.listing_id and len(self.job_text.strip()) < 80:
            raise ValueError("paste the whole job post (at least a few lines), or pick a saved job")
        return self


class QueueIn(BaseModel):
    jobs: list[QueueJobIn] = Field(min_length=1, max_length=MAX_PER_REQUEST)


class QueueResult(BaseModel):
    resume_id: str | None = None
    title: str = ""
    score_before: int | None = None
    score_after: int | None = None
    changes: int = 0
    to_confirm: int = 0  # claims the resume doesn't prove: offered in the editor, never applied
    questions: int = 0  # numbers only the candidate knows


class QueueItem(BaseModel):
    id: str
    label: str
    source_resume_id: str
    status: Literal["queued", "running", "done", "failed"]
    result: QueueResult | None = None
    error: str | None = None
    created_at: datetime


def _item(job: Job) -> QueueItem:
    p = job.payload or {}
    failed = job.status == "failed" or bool(p.get("error"))
    state: Any = "failed" if failed else job.status
    return QueueItem(id=job.id, label=str(p.get("label") or "Job"), source_resume_id=str(p.get("source_id") or ""),
                     status=state, result=QueueResult(**p["result"]) if p.get("result") else None,
                     error=str(p.get("error") or "") or ("It couldn't be tailored. Try it again." if failed else None),
                     created_at=job.created_at)


def _label(job: QueueJobIn) -> str:
    if job.label.strip():
        return job.label.strip()[:120]
    return ai.job_title(job.job_text) or "Job post"


async def _items(db: AsyncSession, user_id: str) -> list[Job]:
    return list((await db.scalars(select(Job).where(Job.kind == KIND, Job.dedupe_key.like(f"{_prefix(user_id)}%"))
                                  .order_by(Job.created_at.desc()).limit(SHOWN))).all())


@router.get("/tailor-queue", response_model=list[QueueItem])
async def list_queue(user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> list[QueueItem]:
    return [_item(j) for j in await _items(db, user.id)]


@router.post("/{resume_id}/tailor-queue", response_model=list[QueueItem], status_code=202,
             dependencies=[Depends(queue_limit)])
async def enqueue(resume_id: str, body: QueueIn, user: Annotated[User, Depends(require_verified_email)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> list[QueueItem]:
    source = await db.get(Resume, resume_id)
    if source is None or source.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
    pending = await db.scalar(select(func.count()).select_from(Job).where(
        Job.kind == KIND, Job.dedupe_key.like(f"{_prefix(user.id)}%"), Job.status.in_(("queued", "running")))) or 0
    if pending + len(body.jobs) > MAX_PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Up to {MAX_PENDING} jobs can wait in the queue: {pending} already are.")
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id)) or 0
    if count + pending + len(body.jobs) > MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes, and each job makes "
                                                      "one. Delete some first.")
    allowance = await allowance_for(db, user)
    if not allowance.unlimited:
        status_ = await allowance.status()
        if status_.credits_left < pending + len(body.jobs):
            raise allowance.exhausted() if status_.credits_left <= pending else HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                f"Each job uses 1 resume credit and you have {status_.credits_left - pending} free for the queue: "
                "queue fewer, or get more credits.")
    made: list[Job] = []
    for job in body.jobs:
        item_id = str(uuid.uuid4())
        row = Job(id=item_id, kind=KIND, dedupe_key=f"{_prefix(user.id)}{item_id}", payload={
            "item": item_id, "user_id": user.id, "source_id": source.id, "label": _label(job),
            "job_text": job.job_text.strip(), "listing_id": job.listing_id})
        db.add(row)
        made.append(row)
    await db.commit()
    for row in made:
        await db.refresh(row)
    return [_item(j) for j in made]


@router.delete("/tailor-queue/{item_id}", status_code=204)
async def remove(item_id: str, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """Cancel one still waiting, or clear a finished one from the list (a resume it made stays)."""
    job = await db.get(Job, item_id)
    if job is None or job.kind != KIND or not (job.dedupe_key or "").startswith(_prefix(user.id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your queue")
    if job.status == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "It's being tailored right now: it'll be done in a moment.")
    await db.delete(job)
    await db.commit()


# ---- the worker's part -----------------------------------------------------------------------------------------


async def _save(item_id: str, **changes: Any) -> None:
    async with sessionmaker()() as db:
        job = await db.get(Job, item_id)
        if job is not None:
            job.payload = {**(job.payload or {}), **changes}  # a new dict, so the JSON column is written
            await db.commit()


@jobs.handler(KIND)
async def run(payload: dict[str, Any]) -> None:
    """One item: the copy with the job post (made once, even across retries), then the fix on it. Problems the
    candidate has to solve (out of credits, too many resumes, the resume deleted) end the item with a message;
    anything else (the AI down) is retried by the worker."""
    item_id = str(payload["item"])
    async with sessionmaker()() as db:
        user = await db.get(User, payload["user_id"])
        if user is None:
            return
        copy = await db.get(Resume, payload["resume_id"]) if payload.get("resume_id") else None
        if copy is None:
            source = await db.get(Resume, payload["source_id"])
            if source is None or source.user_id != user.id:
                await _save(item_id, error="The resume was deleted before it could be tailored.")
                return
            count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id)) or 0
            if count >= MAX_RESUMES:
                await _save(item_id, error=f"You have {MAX_RESUMES} resumes, the most you can keep. Delete one, then "
                                           "queue this job again.")
                return
            text = str(payload.get("job_text") or "")
            listing = None
            if payload.get("listing_id"):
                from orbit_api.job_portal import routes as portal  # Jobs AI imports resumes: only at run time

                listing = await db.get(JobListing, payload["listing_id"])
                if listing is None:
                    await _save(item_id, error="That job isn't listed anymore. Paste its post instead.")
                    return
                full, _ = await portal._full_text(db, listing)
                text = portal._job_text(listing, full)
            copy = Resume(user_id=user.id, title=f"{source.title} · {payload.get('label') or 'Job'}"[:160],
                          data=source.data, design=source.design, job_text=text[:MAX_JOB_TEXT], cover_letter="")
            db.add(copy)
            await db.flush()
            if listing is not None:
                from orbit_api.job_portal import routes as portal

                entry = await portal._track(db, user, listing)
                entry.resume_id = copy.id
            await db.commit()
            await _save(item_id, resume_id=copy.id)

        allowance = await allowance_for(db, user)
        if not await allowance.can_spend():
            await _save(item_id, error="Out of resume credits: the copy with the job post is made, so you can "
                                       "tailor it yourself once you have credits.",
                        result={"resume_id": copy.id, "title": copy.title})
            return
        data = ResumeData.model_validate(copy.data or {})
        design = ResumeDesign.model_validate(copy.design or {})
        body = autofix.FixIn(data=data.visible(), design=design, job_text=copy.job_text or "")
        try:
            out, used_ai = await autofix.fix_resume(body, user, allowance.can_spend,
                                                    lambda req: _generate(db, user, req, "tailor queue", allowance))
        except HTTPException as e:
            await allowance.release()
            if e.status_code == status.HTTP_402_PAYMENT_REQUIRED:
                await _save(item_id, error="Out of resume credits before this one ran.",
                            result={"resume_id": copy.id, "title": copy.title})
                return
            raise
        except Exception:
            await allowance.release()
            raise
        if not used_ai:
            await allowance.release()
        fixed = data
        for s in out.suggestions:
            fixed = apply_suggestion(fixed, s)
        if out.order:
            rank = {rid: i for i, rid in enumerate(out.order)}
            fixed = fixed.model_copy(update={"experience": sorted(fixed.experience, key=lambda e: rank.get(e.id, 99))})
        # Sections hidden in the editor were left out of the fix: they come back as they were.
        merged = ResumeData.model_validate(copy.data or {})
        hidden = set(merged.hidden or [])
        basics = fixed.basics if "summary" not in hidden else fixed.basics.model_copy(
            update={"summary": merged.basics.summary})
        merged = merged.model_copy(update={"basics": basics, **{k: getattr(fixed, k) for k in (
            "experience", "skills", "projects", "education") if k not in hidden}})
        copy = await db.get(Resume, copy.id)
        if copy is None:
            await _save(item_id, error="The tailored copy was deleted while it was being made.")
            return
        copy.data = merged.model_dump(mode="json")
        copy.design = design.model_copy(update=out.design).model_dump(mode="json")
        copy.updated_at = datetime.now(UTC)
        copy.revision = (copy.revision or 0) + 1  # an editor open on it sees a newer version, as after any save
        await db.commit()
        await _save(item_id, error=None if used_ai or not out.ai_error else out.ai_error, result={
            "resume_id": copy.id, "title": copy.title, "score_before": out.score_before, "score_after": out.score_after,
            "changes": len(out.suggestions) + len(out.design) + (1 if out.order else 0), "to_confirm": len(out.review),
            "questions": len(out.questions)})
        log.info("tailor queue item %s: %s -> %s", item_id, out.score_before, out.score_after)
