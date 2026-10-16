"""Greenhouse job boards: `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true&pay_transparency=true`,
one call per company, every open post with its text and the pay range it publishes (most US and Canadian posts
must). Public, no key. https://developers.greenhouse.io/job-board.html"""

import asyncio
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from orbit_api.job_portal.companies import Board, boards
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import (
    Posting,
    employment_type_of,
    find_cities,
    mentions_india,
    obj,
    parse_time,
    salary_text,
    text_of,
    worth_reading,
)
from orbit_api.job_portal.sources.base import Source


def pay_of(ranges: Any, only: str | None = None) -> str | None:
    """The first of a post's pay ranges (in cents; several are zones or levels of the same job) as one line: a year's
    pay unless its title says hourly or monthly, or the figures could only be an hour's. `only`: a range in this
    currency or none (a dollar range on a post that's also open in India is the US pay, not India's)."""
    for r in ranges if isinstance(ranges, list) else []:
        if not isinstance(r, dict) or (only and str(r.get("currency_type") or "").upper() != only):
            continue
        try:
            lo, hi = float(r.get("min_cents") or 0) / 100, float(r.get("max_cents") or 0) / 100
        except (TypeError, ValueError):
            continue
        title = str(r.get("title") or "").lower()
        period = "hour" if "hour" in title or 0 < max(lo, hi) < 1_000 else "month" if "month" in title else "year"
        return salary_text(lo, hi, r.get("currency_type"), period)
    return None


def parse_job(j: Any, board: Board) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("title"):
        return None
    url = str(j.get("absolute_url") or "")
    location = obj(j.get("location"))
    places = [str(location.get("name") or "")]
    for office in j.get("offices") or []:
        if isinstance(office, dict):
            place = str(office.get("location") or office.get("name") or "")
            if place and place not in places:
                places.append(place)
    if not worth_reading(" / ".join(places) + " " + str(j["title"])):
        return None
    india = mentions_india(" / ".join(places)) or bool(find_cities(str(j["title"])))  # as normalize places it
    kind = None
    for meta in j.get("metadata") or []:
        if isinstance(meta, dict) and "type" in str(meta.get("name") or "").lower():
            kind = employment_type_of(str(meta.get("value") or ""))
    return Posting(
        source="greenhouse", external_id=str(j["id"]), board=board.token,
        company=board.company, title=str(j["title"]), url=url, apply_url=url,
        posted_at=parse_time(j.get("first_published") or j.get("updated_at")), locations=[p for p in places if p],
        description=text_of(j.get("content")), employment_type=kind,
        salary=pay_of(j.get("pay_input_ranges"), "INR" if india else None),
        remote_unstated_ok=board.india_first)


class Greenhouse(Source):
    id = "greenhouse"
    label = "Greenhouse"
    kind = "board"
    direct = True
    hosts = frozenset({"boards-api.greenhouse.io"})
    ttl = timedelta(hours=6)

    def keys(self) -> list[str]:
        return [b.token for b in boards("greenhouse")]

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        board = next(b for b in boards("greenhouse") if b.token == key)
        data = await http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{quote(key, safe='')}/jobs",
                                   params={"content": "true", "pay_transparency": "true"})
        jobs = data.get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            raise SourceError("Greenhouse sent an unexpected shape")
        # Reading hundreds of posts' HTML is CPU work: off the event loop.
        return await asyncio.to_thread(lambda: [p for j in jobs if (p := parse_job(j, board)) is not None])
