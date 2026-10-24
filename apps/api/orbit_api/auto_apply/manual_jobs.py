"""Jobs the candidate added by hand ("ext:" tracker entries), made appliable.

A job added from its link (a Greenhouse, Lever, Ashby, Workday… form, or a board post Jobs AI also has from the
employer) has no row in the shared feed, so Orbit Apply had nothing to prepare from and said "add the application
link" even when the link was right there. Here such an entry gets a listing of its own, `source="manual"`, built only
from what the candidate saved (company, title, location, links, the date they saved it). Manual listings never
appear in anyone's feed, counts or "also listed" (job_portal/routes.py), and the listing endpoints answer 404 for
them as before: the job's own page is the tracker entry's.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal import geo
from orbit_api.job_portal.postings import dedupe_key
from orbit_api.models import JobApplication, JobListing

MANUAL_SOURCE = "manual"


def is_manual(listing_id: str) -> bool:
    return listing_id.startswith("ext:")


def _link(entry: JobApplication) -> str:
    for url in (entry.apply_url, entry.url):
        if (url or "").startswith(("https://", "http://")):
            return url
    return ""


def listing_from(entry: JobApplication) -> JobListing | None:
    """The listing a hand-added entry stands for (not added to the session), or None without a usable link."""
    if not is_manual(entry.listing_id) or not _link(entry) or not entry.company or not entry.title:
        return None
    return _listing(entry)


def post_listing(entry: JobApplication, text: str) -> JobListing:
    """A hand-added entry with the post the candidate pasted, to check fit against (never added to the session; a
    link isn't needed to read a post)."""
    row = _listing(entry)
    row.description = text
    return row


def _listing(entry: JobApplication) -> JobListing:
    location = entry.location or ""
    cities = geo.world_cities(location)
    countries = geo.countries_in(location)
    workplace = "remote" if "remote" in location.lower() else None
    saved = entry.created_at or datetime.now(UTC)
    return JobListing(
        id=entry.listing_id, source=MANUAL_SOURCE, external_id=entry.listing_id, board=MANUAL_SOURCE,
        company=entry.company, title=entry.title, locations=[location] if location else [], cities=cities,
        country=countries[0] if countries else None, remote_scope=None, workplace=workplace,
        employment_type=None, level=None, exp_min=None, exp_max=None, posted_at=saved,
        url=entry.url or _link(entry), apply_url=entry.apply_url or entry.url or "",
        snippet="", description="", salary=None, visa=None, relocation=False, keywords=[], text_hash=None,
        dedupe_key=dedupe_key(entry.company, entry.title, cities, workplace), fetched_at=saved, created_at=saved)


async def ensure_listings(db: AsyncSession, user_id: str, listing_ids: set[str]) -> dict[str, JobListing]:
    """The manual listings for these of the candidate's tracked entries, made where missing (flushed, not
    committed). Entries without a usable link are left out."""
    wanted = {i for i in listing_ids if is_manual(i)}
    if not wanted:
        return {}
    entries = (await db.scalars(select(JobApplication).where(
        JobApplication.user_id == user_id, JobApplication.listing_id.in_(wanted)))).all()
    out: dict[str, JobListing] = {}
    for entry in entries:
        row = await db.get(JobListing, entry.listing_id)
        if row is None:
            row = listing_from(entry)
            if row is None:
                continue
            db.add(row)
        out[row.id] = row
    if out:
        await db.flush()
    return out
