"""Open jobs at a company, for its public interview guide and Interview Atlas: no account needed.

- `GET /v1/public/companies/{slug}/jobs`: the company's recent posts in Orbit's job cache, newest first.

Only what a public post already says (title, place, when, where it's from, its own Apply link), with the credit each
feed's terms ask for. A guide's company is matched the way duplicates are told apart (postings.company_key), by its
name and its aliases, so "Tata Motors Limited" on a careers board finds the "tata-motors" guide.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from orbit_api.db import get_db
from orbit_api.job_portal.postings import company_key
from orbit_api.job_portal.sources import source_named
from orbit_api.models import JobListing
from orbit_api.question_bank import companies
from orbit_api.ratelimit import limit

router = APIRouter(prefix="/v1/public/companies", tags=["public"])
_limit = Depends(limit("public-company-jobs", 2, 30))

DAYS = 45
SHOWN = 8
_TTL_S = 600.0
_cache: dict[str, tuple[float, CompanyJobsOut]] = {}


class Credit(BaseModel):
    label: str
    url: str


class CompanyJob(BaseModel):
    title: str
    place: str
    posted_at: datetime
    apply_url: str | None
    source_label: str
    direct: bool  # from the company's own careers page
    credit: Credit | None  # the feed's name and link, where its terms ask for one


class CompanyJobsOut(BaseModel):
    company: str
    total: int  # posts in the last DAYS days
    items: list[CompanyJob]


def _keys(slug: str) -> tuple[str, list[str]]:
    guide = next((c for c in companies() if c.slug == slug), None)
    if guide is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    keys = {company_key(guide.name), *(company_key(a) for a in guide.aliases)}
    return guide.name, sorted(k for k in keys if len(k) >= 2)


def _place(row: JobListing) -> str:
    from orbit_api.job_portal.routes import _location_line

    return _location_line(row)


def clear_cache() -> None:
    _cache.clear()


@router.get("/{slug}/jobs", response_model=CompanyJobsOut, dependencies=[_limit])
async def company_jobs(slug: str, db: Annotated[AsyncSession, Depends(get_db)]) -> CompanyJobsOut:
    hit = _cache.get(slug)
    if hit is not None and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    name, keys = _keys(slug)
    since = datetime.now(UTC) - timedelta(days=DAYS)
    rows = (await db.scalars(
        select(JobListing).options(defer(JobListing.description))
        # Orbit for Business posts are left out here: their own careers pages show the open ones.
        .where(JobListing.posted_at >= since, JobListing.source.not_in(("manual", "orbit")),
               or_(*(JobListing.dedupe_key.like(f"{k}|%") for k in keys)))
        .order_by(JobListing.posted_at.desc()).limit(200))).all()
    # One per job (the same post on the company's board and a feed): its first, newest copy.
    seen: set[str] = set()
    unique = []
    for r in rows:
        if r.dedupe_key not in seen:
            seen.add(r.dedupe_key)
            unique.append(r)
    items = []
    for r in unique[:SHOWN]:
        source = source_named(r.source)
        credit = source.attribution if source else None
        items.append(CompanyJob(
            title=r.title, place=_place(r),
            posted_at=r.posted_at if r.posted_at.tzinfo else r.posted_at.replace(tzinfo=UTC),
            apply_url=r.apply_url or r.url, source_label=source.label if source else r.source,
            direct=bool(source and source.direct),
            credit=Credit(label=credit.label, url=credit.url) if credit else None))
    out = CompanyJobsOut(company=name, total=len(unique), items=items)
    _cache[slug] = (time.monotonic(), out)
    return out
