"""Promises to keep: what the candidate told an employer they'd do (send a portfolio link, a reference, an answer
they owed), kept as dated to-dos on one job until they tick them off.

Made by hand or from an interview debrief's "You said you would send" list (interview_debrief.py). Open ones due in
the next seven days, or overdue, appear on Today (actions.py). Orbit sends nothing for the candidate.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import JobApplication, JobCommitment, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/tracker", tags=["commitments"],
                   dependencies=[Depends(limit_user("job-commitments", rate_per_s=2, burst=30))])
MAX_PER_JOB = 30
HORIZON = timedelta(days=7)


def aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


class CommitmentIn(BaseModel):
    text: str = Field(min_length=2, max_length=300)
    due_at: datetime | None = None


class CommitmentPatch(BaseModel):
    done: bool | None = None
    due_at: datetime | None = None
    clear_due: bool = False


def out(c: JobCommitment) -> dict[str, Any]:
    return {"id": c.id, "text": c.text, "due_at": aware(c.due_at).isoformat() if c.due_at else None,
            "done_at": aware(c.done_at).isoformat() if c.done_at else None,
            "created_at": aware(c.created_at).isoformat()}


async def _mine(db: AsyncSession, user: User, entry_id: str, commitment_id: str) -> JobCommitment:
    row = await db.get(JobCommitment, commitment_id)
    if row is None or row.user_id != user.id or row.application_id != entry_id:
        raise HTTPException(404, "Not found")
    return row


@router.get("/{entry_id}/commitments")
async def list_commitments(entry_id: str, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> list[dict[str, Any]]:
    await owned(db, user, entry_id)
    rows = await db.scalars(select(JobCommitment).where(JobCommitment.user_id == user.id,
        JobCommitment.application_id == entry_id).order_by(JobCommitment.done_at.is_not(None),
        JobCommitment.due_at, JobCommitment.created_at))
    return [out(c) for c in rows]


@router.post("/{entry_id}/commitments", status_code=201)
async def add_commitment(entry_id: str, body: CommitmentIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    await owned(db, user, entry_id)
    same = await db.scalar(select(JobCommitment).where(JobCommitment.user_id == user.id,
        JobCommitment.application_id == entry_id, JobCommitment.done_at.is_(None),
        JobCommitment.text == body.text.strip()))
    if same is not None:  # the same promise added twice (a debrief run again): keep the one to-do
        return out(same)
    count = await db.scalar(select(func.count()).select_from(JobCommitment).where(
        JobCommitment.user_id == user.id, JobCommitment.application_id == entry_id)) or 0
    if count >= MAX_PER_JOB:
        raise HTTPException(409, f"Up to {MAX_PER_JOB} to-dos per job. Clear some done ones first.")
    row = JobCommitment(user_id=user.id, application_id=entry_id, text=body.text.strip(), due_at=body.due_at)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return out(row)


@router.patch("/{entry_id}/commitments/{commitment_id}")
async def update_commitment(entry_id: str, commitment_id: str, body: CommitmentPatch,
                            user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await _mine(db, user, entry_id, commitment_id)
    if body.done is not None:
        row.done_at = datetime.now(UTC) if body.done else None
    if body.clear_due:
        row.due_at = None
    elif body.due_at is not None:
        row.due_at = body.due_at
    await db.commit()
    return out(row)


@router.delete("/{entry_id}/commitments/{commitment_id}", status_code=204)
async def delete_commitment(entry_id: str, commitment_id: str, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await db.delete(await _mine(db, user, entry_id, commitment_id))
    await db.commit()


async def due_items(db: AsyncSession, user_id: str, now: datetime) -> list[dict[str, Any]]:
    """Open to-dos due within seven days or overdue, as Today's action items."""
    rows = (await db.execute(select(JobCommitment, JobApplication)
        .join(JobApplication, JobApplication.id == JobCommitment.application_id)
        .where(JobCommitment.user_id == user_id, JobCommitment.done_at.is_(None),
               JobCommitment.due_at.is_not(None), JobCommitment.due_at <= now + HORIZON)
        .order_by(JobCommitment.due_at).limit(50))).all()
    return [{"id": f"commitment:{c.id}", "kind": "follow_up", "title": f"{job.title} · {job.company}",
             "detail": f"You said you would: {c.text}", "due_at": aware(c.due_at).isoformat(),
             "overdue": aware(c.due_at) < now, "path": f"/jobs/mission/{job.id}?tab=interview",
             "action_label": "Do it, then tick it off", "rule": "commitment"}
            for c, job in rows if c.due_at is not None]
