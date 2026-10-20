"""Read-only comparison of an owned tracker record with the shared public job cache.

No provider requests, inferred closure, historical description reconstruction or tracker writes.
"""
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import JobApplication, JobListing

from .resume_lineage import digest
from .routes import AttributionOut, _location_line
from .sources import source_named

Status = Literal["manual", "missing", "unknown", "stale", "recent"]


class SourceField(BaseModel):
    key: str
    label: str
    saved: str
    current: str | None
    changed: bool | None


class DuplicatePost(BaseModel):
    id: str
    title: str
    company: str
    source_label: str
    last_seen_at: datetime | None
    attribution: AttributionOut | None


class SourceReview(BaseModel):
    entry_id: str
    version: str
    status: Status
    source_label: str
    direct: bool
    saved_at: datetime
    last_seen_at: datetime | None
    first_seen_at: datetime | None
    freshness_window_hours: int
    changed_count: int | None
    fields: list[SourceField]
    duplicates: list[DuplicatePost]
    more_duplicates: bool
    attribution: AttributionOut | None


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def credit_for(source_id: str) -> AttributionOut | None:
    provider = source_named(source_id)
    credit = provider.attribution if provider else None
    return AttributionOut(label=credit.label, url=credit.url, large=credit.large) if credit else None


async def review(db: AsyncSession, entry: JobApplication, now: datetime | None = None) -> SourceReview:
    """Caller must supply an owned entry. Missing cache never establishes an employer outcome."""
    now = now or datetime.now(UTC)
    manual = entry.listing_id.startswith("ext:")
    row = await db.scalar(select(JobListing).where(JobListing.id == entry.listing_id,
        JobListing.source == entry.source).execution_options(populate_existing=True)) if not manual else None
    source = source_named(entry.source)
    window = max(24, int(source.ttl.total_seconds() * 2 / 3600)) if source else 24
    last_seen = aware(row.fetched_at) if row else None
    status: Status
    if manual:
        status = "manual"
    elif row is None:
        status = "missing"
    elif last_seen is None or last_seen > now or source is None:
        status = "unknown"
    elif now - last_seen > timedelta(hours=window):
        status = "stale"
    else:
        status = "recent"

    values = (("title", "Role", entry.title, row.title if row else None),
        ("company", "Company", entry.company, row.company if row else None),
        ("location", "Location and work mode", entry.location, _location_line(row) if row else None),
        ("url", "Post link", entry.url, row.url if row else None),
        ("apply_url", "Application link", entry.apply_url, row.apply_url if row else None))
    fields = [SourceField(key=key, label=label, saved=saved or "", current=current,
        changed=(saved or "") != current if current is not None else None)
        for key, label, saved, current in values]
    duplicates: list[JobListing] = []
    if row is not None and row.dedupe_key:
        # A shared normalized key is a possible duplicate, not proof of the same vacancy or a repost.
        duplicates = list((await db.scalars(select(JobListing).where(
            JobListing.dedupe_key == row.dedupe_key, JobListing.id != row.id)
            .order_by(JobListing.fetched_at.desc(), JobListing.id).limit(4))).all())
    result = SourceReview(entry_id=entry.id, version="", status=status,
        source_label=source.label if source else "Manually added" if manual else "Unknown source",
        direct=bool(source and source.direct), saved_at=aware(entry.created_at),
        last_seen_at=last_seen, first_seen_at=aware(row.created_at) if row else None,
        freshness_window_hours=window, changed_count=sum(item.changed is True for item in fields) if row else None,
        fields=fields, duplicates=[DuplicatePost(id=item.id, title=item.title, company=item.company,
            source_label=provider.label if (provider := source_named(item.source)) else "Unknown source",
            last_seen_at=aware(item.fetched_at), attribution=credit_for(item.source))
            for item in duplicates[:3]], more_duplicates=len(duplicates) > 3,
        attribution=credit_for(entry.source))
    # Exclude the wall clock. Bind every displayed record plus current description/salary content without
    # exposing bodies to the coach; refresh timestamps, row removal and age-window transitions invalidate advice.
    result.version = digest({"review": result.model_dump(mode="json", exclude={"version"}),
        "content": digest({"description": row.description, "salary": row.salary}) if row else None})
    return result


def coach_fact(item: SourceReview) -> str:
    states: dict[Status, str] = {
        "manual": "This job was added manually; there is no feed observation to compare.",
        "missing": "This listing is absent from the current cache; closure or removal by the employer is unknown.",
        "unknown": "The cache does not establish a usable recent observation for this source.",
        "stale": "The last cached listing observation is older than the review window.",
        "recent": "The listing has a recent cached observation; availability is not independently verified.",
    }
    text = states[item.status]
    if item.changed_count is not None:
        text += f" {item.changed_count} saved job fields differ from the cached record."
    if item.duplicates:
        text += " Other cached posts have a matching normalized duplicate key; review them before applying twice."
    return text + " Review the original source before applying. No historical description comparison is available."
