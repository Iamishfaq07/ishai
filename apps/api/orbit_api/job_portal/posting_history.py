"""Bounded version comparisons for publicly sourced posts the candidate tracks."""
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import JobListing, JobPostingVersion, User

router = APIRouter(prefix="/v1/jobs/tracker", tags=["jobs"])
FIELDS = ("title", "company", "locations", "salary", "level", "visa", "relocation", "description")


def snapshot(row: JobListing) -> dict[str, Any]:
    return {key: getattr(row, key)[:20000] if key == "description" else getattr(row, key) for key in FIELDS}


async def capture(db: AsyncSession, row: JobListing, before: dict[str, Any], previous_at: datetime,
                  observed_at: datetime) -> None:
    after = snapshot(row)
    latest = await db.scalar(select(JobPostingVersion).where(JobPostingVersion.listing_id == row.id)
        .order_by(JobPostingVersion.observed_at.desc()).limit(1))
    if latest is None:
        db.add(JobPostingVersion(listing_id=row.id, observed_at=previous_at, data=before))
    if after != (latest.data if latest else before):
        db.add(JobPostingVersion(listing_id=row.id, observed_at=observed_at, data=after))
    await db.flush()
    excess = list(await db.scalars(select(JobPostingVersion.id).where(JobPostingVersion.listing_id == row.id)
        .order_by(JobPostingVersion.observed_at.desc(), JobPostingVersion.id).offset(20)))
    if excess:
        await db.execute(delete(JobPostingVersion).where(JobPostingVersion.id.in_(excess)))


@router.get("/{entry_id}/posting-history")
async def history(entry_id: str, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await owned(db, user, entry_id)
    rows = list(await db.scalars(select(JobPostingVersion).where(JobPostingVersion.listing_id == entry.listing_id)
        .order_by(JobPostingVersion.observed_at.desc(), JobPostingVersion.id).limit(20)))
    versions = []
    for i, row in enumerate(rows):
        previous = rows[i + 1].data if i + 1 < len(rows) else None
        changes = [{"field": key, "before": previous.get(key), "after": row.data.get(key)} for key in FIELDS
                   if previous is not None and previous.get(key) != row.data.get(key)]
        versions.append({"observed_at": row.observed_at.isoformat(), "changes": changes,
                         "baseline": previous is None})
    return {"versions": versions, "retained_limit": 20,
            "note": "Observed source changes, not proof that a role closed or was reposted. "
                    "History begins with refreshes after tracking. "
                    "Description comparisons cover the first 20,000 characters."}
