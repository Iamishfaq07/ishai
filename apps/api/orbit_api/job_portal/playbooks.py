"""Account-owned rules for the Action desk. No applications, emails or outcomes are changed."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import CareerPlaybook, JobApplication, JobContact, User
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/jobs/playbook", tags=["career playbook"],
    dependencies=[Depends(limit_user("career-playbook", rate_per_s=1, burst=20))])


class Rules(BaseModel):
    model_config = ConfigDict(extra="forbid")
    follow_up_days: int | None = Field(None, ge=3, le=60, strict=True)
    prep_hours: int | None = Field(None, ge=1, le=168, strict=True)


class Save(Rules):
    base_revision: int = Field(ge=0, strict=True)


async def settings(db: AsyncSession, user_id: str) -> dict[str, Any]:
    row = await db.get(CareerPlaybook, user_id, populate_existing=True)
    return {"revision": row.revision if row else 0,
        "follow_up_days": row.follow_up_days if row else None, "prep_hours": row.prep_hours if row else None}


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
    row.follow_up_days, row.prep_hours = body.follow_up_days, body.prep_hours
    row.revision += 1
    await db.commit()
    return await settings(db, user.id)
