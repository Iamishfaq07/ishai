"""Owned, record-derived outcomes; no inferred rejection or causal improvement claims."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import ApplicationStageEvent, GmailAttempt, JobApplication, JobInterviewRound, User

router = APIRouter(prefix="/v1/career/overview", tags=["career workspace"])


@router.get("")
async def overview(user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    interviewed = select(ApplicationStageEvent.application_id).where(ApplicationStageEvent.user_id == user.id,
        ApplicationStageEvent.to_status.in_(("interviewing", "offer", "hired")))
    completed = select(JobInterviewRound.application_id).where(JobInterviewRound.user_id == user.id,
        JobInterviewRound.status == "completed")
    ever_interview = or_(JobApplication.status.in_(("interviewing", "offer", "hired")),
        JobApplication.id.in_(interviewed), JobApplication.id.in_(completed))
    offered = select(ApplicationStageEvent.application_id).where(ApplicationStageEvent.user_id == user.id,
        ApplicationStageEvent.to_status.in_(("offer", "hired")))
    async def count(*conditions: Any) -> int:
        return int(await db.scalar(select(func.count()).select_from(JobApplication).where(
            JobApplication.user_id == user.id, *conditions)) or 0)
    now = datetime.now(UTC)
    email: dict[str, int] = dict((await db.execute(select(GmailAttempt.status, func.count()).where(
        GmailAttempt.user_id == user.id).group_by(GmailAttempt.status))).tuples().all())
    return {"tracked": await count(), "applications_recorded": await count(JobApplication.applied_at.is_not(None)),
            "ever_interviewed": await count(ever_interview),
            "ever_offered": await count(or_(JobApplication.status.in_(("offer", "hired")),
                                            JobApplication.id.in_(offered))),
            "upcoming_interviews": await count(JobApplication.status == "interviewing",
                JobApplication.next_at >= now, JobApplication.next_at <= now + timedelta(days=7)),
            "gmail_sent": email.get("sent", 0), "gmail_drafts": email.get("ready", 0),
            "gmail_needs_review": sum(email.get(s, 0) for s in ("sending", "uncertain", "rejected")),
            "note": "Counts reflect your saved records. Earlier unrecorded stages remain unknown. "
                    "Gmail acceptance is not employer receipt; counts do not measure causal resume performance."}
