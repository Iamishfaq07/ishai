"""Weekly targets with progress from actual records and an optional AI experiment coach."""
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import CareerWeeklyGoal, JobApplication, JobContact, LiveSessionRow, User
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account
from orbit_api.workflow_advice import INSTRUCTION, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

router = APIRouter(prefix="/v1/jobs/weekly", tags=["career planning"],
    dependencies=[Depends(limit_user("career-weekly", rate_per_s=1, burst=20))])
DEFAULTS = {"applications": 5, "practice": 2, "contacts": 2}
LABELS = {"applications": "Applications recorded", "practice": "Mock interviews completed",
          "contacts": "Contacts reached"}
PATHS = {"applications": "/jobs/tracker", "practice": "/mock", "contacts": "/jobs/outreach#people"}


def aware(t: datetime) -> datetime:
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


async def snapshot(db: AsyncSession, user: User, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    row = await db.get(CareerWeeklyGoal, user.id, populate_existing=True)
    targets = {key: getattr(row, key) for key in DEFAULTS} if row else DEFAULTS.copy()
    activity: dict[str, list[datetime]] = {
        "applications": list(await db.scalars(select(JobApplication.applied_at).where(
            JobApplication.user_id == user.id, JobApplication.applied_at >= start, JobApplication.applied_at <= now))),
        "practice": list(await db.scalars(select(LiveSessionRow.ended_at).where(
            LiveSessionRow.user_id == user.id, LiveSessionRow.type == "mock", LiveSessionRow.status == "ended",
            LiveSessionRow.ended_at >= start, LiveSessionRow.ended_at <= now))),
        "contacts": list(await db.scalars(select(JobContact.last_contacted_at).where(
            JobContact.user_id == user.id, JobContact.last_contacted_at >= start,
            JobContact.last_contacted_at <= now))),
    }
    metrics = [{"id": key, "label": LABELS[key], "count": len(activity[key]), "target": targets[key],
        "path": PATHS[key],
        "text": f"{LABELS[key]}: {len(activity[key])} recorded this UTC week; target {targets[key]}."}
        for key in DEFAULTS]
    days = Counter(aware(stamp).date().isoformat() for values in activity.values() for stamp in values)
    result: dict[str, Any] = {"week_start": start.date().isoformat(),
        "week_end": (start + timedelta(days=7)).date().isoformat(), "revision": row.revision if row else 0,
        "targets": targets, "metrics": metrics,
        "days": [{"day": (start + timedelta(days=i)).date().isoformat(),
                  "count": days[(start + timedelta(days=i)).date().isoformat()]} for i in range(7)]}
    result["version"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    result["as_of"] = now.isoformat()
    return result


class TargetsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=0)
    applications: int = Field(ge=0, le=100, strict=True)
    practice: int = Field(ge=0, le=30, strict=True)
    contacts: int = Field(ge=0, le=50, strict=True)


@router.get("")
async def get_week(user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await snapshot(db, user)


@router.put("/targets")
async def targets(body: TargetsIn, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    await lock_account(db, user.id)
    row = await db.get(CareerWeeklyGoal, user.id, populate_existing=True)
    if (row.revision if row else 0) != body.base_revision:
        raise HTTPException(409, "Your targets changed in another tab. Refresh before saving.")
    if row is None:
        row = CareerWeeklyGoal(user_id=user.id, revision=0)
        db.add(row)
    for key in DEFAULTS:
        setattr(row, key, getattr(body, key))
    row.revision += 1
    await db.commit()
    return await snapshot(db, user)


@router.post("/coach")
async def coach(body: AdviceIn, user: Annotated[User, Depends(require_verified_email)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    source = await snapshot(db, user)
    if source["version"] != body.version:
        raise HTTPException(409, "Your weekly progress changed. Refresh before coaching.")
    facts = source["metrics"]
    result, provider = await preview(db, user, "career_weekly_coach", INSTRUCTION +
        'Help a job seeker plan a sustainable week from their saved goals and recorded activity. '
        'Suggest focused, truthful applications, practice and useful outreach. A zero target means paused; '
        'respect it. Do not recommend mass applying, fabricated experience or bypassing employer checks. '
        'Contacts counts unique contacts by most recent contact date, not messages sent. '
        'Only completed mock interviews count as practice. No automatic changes to goals.',
        json.dumps({"week_start": source["week_start"], "as_of": source["as_of"], "facts": facts}),
        lambda raw: validate_advice(raw, facts))
    if (await snapshot(db, user))["version"] != source["version"]:
        raise HTTPException(409, "Your weekly progress changed during coaching. Refresh to continue.")
    return {"version": source["version"], **result.model_dump(), "source": "mock" if provider == "mock" else "ai"}
