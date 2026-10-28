"""Discover's "Not interested": a job, or every job from a company, left out of the candidate's feed and job alerts
until they bring it back.

- `GET /v1/jobs/hidden`: what's hidden, newest first.
- `POST /v1/jobs/hidden`: hide a listing (`listing_id`) or its company (`listing_id` + `company: true`).
- `DELETE /v1/jobs/hidden?kind=&value=`: bring one back (the undo, and the list in search settings).

A company is kept the way duplicates are told apart (postings.company_key), so "Acme Pvt Ltd" on one board and
"Acme" on another are both hidden. Nothing else changes: a hidden job already on the tracker stays there.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.postings import company_key
from orbit_api.models import HiddenJob, JobListing, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/hidden", tags=["jobs"])
_limit = Depends(limit_user("job-hidden", rate_per_s=2, burst=30))

MAX_HIDDEN = 1000  # per account: past this, the oldest hidden jobs come back first

Kind = Literal["job", "company"]


class HiddenItem(BaseModel):
    kind: Kind
    value: str
    label: str
    at: datetime


class HiddenOut(BaseModel):
    items: list[HiddenItem]


class HideIn(BaseModel):
    listing_id: str = Field(min_length=1, max_length=80)
    company: bool = False  # every job from this listing's company, not just this one


async def hidden_sets(db: AsyncSession, user_id: str) -> tuple[frozenset[str], frozenset[str]]:
    """(hidden listing ids, hidden company keys) for the feed and alerts to leave out."""
    rows = (await db.execute(select(HiddenJob.kind, HiddenJob.value).where(HiddenJob.user_id == user_id))).all()
    return (frozenset(v for k, v in rows if k == "job"), frozenset(v for k, v in rows if k == "company"))


async def _list(db: AsyncSession, user_id: str) -> HiddenOut:
    rows = (await db.scalars(select(HiddenJob).where(HiddenJob.user_id == user_id)
                             .order_by(HiddenJob.created_at.desc()).limit(MAX_HIDDEN))).all()
    return HiddenOut(items=[HiddenItem(kind=r.kind, value=r.value, label=r.label, at=r.created_at)
                            for r in rows])


@router.get("", response_model=HiddenOut, dependencies=[_limit])
async def list_hidden(user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> HiddenOut:
    return await _list(db, user.id)


@router.post("", response_model=HiddenOut, dependencies=[_limit])
async def hide(body: HideIn, user: Annotated[User, Depends(current_user)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> HiddenOut:
    listing = await db.get(JobListing, body.listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if body.company:
        kind, value, label = "company", company_key(listing.company), listing.company
        if not value:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This job doesn't name a company to hide.")
    else:
        kind, value, label = "job", listing.id, f"{listing.title} · {listing.company}"
    exists = await db.scalar(select(HiddenJob.id).where(HiddenJob.user_id == user.id, HiddenJob.kind == kind,
                                                        HiddenJob.value == value))
    if exists is None:
        db.add(HiddenJob(user_id=user.id, kind=kind, value=value, label=label[:300]))
        await db.flush()
        count = int(await db.scalar(select(func.count()).select_from(HiddenJob)
                                    .where(HiddenJob.user_id == user.id)) or 0)
        if count > MAX_HIDDEN:  # the oldest come back rather than the list growing without end
            oldest = select(HiddenJob.id).where(HiddenJob.user_id == user.id).order_by(
                HiddenJob.created_at).limit(count - MAX_HIDDEN)
            await db.execute(delete(HiddenJob).where(HiddenJob.id.in_(oldest)))
        await db.commit()
    return await _list(db, user.id)


@router.delete("", status_code=204, dependencies=[_limit])
async def unhide(kind: Kind, value: Annotated[str, Query(min_length=1, max_length=300)],
                 user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    await db.execute(delete(HiddenJob).where(HiddenJob.user_id == user.id, HiddenJob.kind == kind,
                                             HiddenJob.value == value))
    await db.commit()
    return Response(status_code=204)
