"""Himalayas: remote jobs open to people in the searcher's country, searched by job title
(`GET himalayas.app/jobs/api/search?q=…&country=<CC>&sort=recent`, 20 a page, PAGES pages a query).

Terms: every post links back to its Himalayas page and credits Himalayas, and the posts must not be resubmitted to
Google for Jobs (Orbit's feed is behind sign-in and publishes no job markup). https://himalayas.app/api
"""

import asyncio
from datetime import timedelta
from typing import Any

from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Level, Posting, employment_type_of, parse_time, salary_text, text_of
from orbit_api.job_portal.sources.base import Attribution, SearchQuery, Source

API = "https://himalayas.app/jobs/api/search"
PAGES = 2
_LEVEL: dict[str, Level] = {"entry-level": "junior", "mid-level": "mid", "senior": "senior", "manager": "senior",
                            "director": "senior", "executive": "senior"}


def parse_job(j: Any, query_key: str, country: str = "IN") -> Posting | None:
    if not isinstance(j, dict) or not j.get("title") or not (j.get("guid") or j.get("applicationLink")):
        return None
    url = str(j.get("applicationLink") or j.get("guid"))
    allowed = [str(c) for c in (j.get("locationRestrictions") or []) if c]
    seniority = [str(s).lower() for s in (j.get("seniority") or []) if s]
    return Posting(
        source="himalayas", external_id=str(j.get("guid") or url), board=query_key,
        company=str(j.get("companyName") or ""), title=str(j["title"]), url=url, apply_url=url,
        posted_at=parse_time(j.get("pubDate")),
        locations=[f"Remote ({', '.join(allowed[:4])})" if allowed else "Remote (worldwide)"],
        description=text_of(j.get("description")) or str(j.get("excerpt") or ""), workplace="remote",
        employment_type=employment_type_of(str(j.get("employmentType") or "")),
        salary=salary_text(j.get("minSalary"), j.get("maxSalary"), j.get("currency"), j.get("salaryPeriod")),
        open_to=[country], level=_LEVEL.get(seniority[0]) if seniority else None)


def _parse_all(jobs: list[Any], key: str, country: str = "IN") -> list[Posting]:
    return [p for j in jobs if (p := parse_job(j, key, country)) is not None]


class Himalayas(Source):
    id = "himalayas"
    label = "Himalayas"
    kind = "search"
    hosts = frozenset({"himalayas.app"})
    ttl = timedelta(hours=24)
    attribution = Attribution("Himalayas", "https://himalayas.app")

    def calls_for(self, key: str) -> int:
        return PAGES

    async def search(self, http: FeedClient, query: SearchQuery) -> list[Posting]:
        out: list[Posting] = []
        for page in range(1, PAGES + 1):
            data = await http.get_json(API, params={"q": query.what, "country": query.country, "sort": "recent",
                                                    "page": page})
            jobs = data.get("jobs") if isinstance(data, dict) else None
            if not isinstance(jobs, list):
                raise SourceError("Himalayas sent an unexpected shape")
            out += await asyncio.to_thread(_parse_all, jobs, query.key(), query.country)
            if len(jobs) < 20:
                break
        return out
