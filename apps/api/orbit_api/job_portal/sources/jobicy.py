"""Jobicy: remote jobs by region (`GET jobicy.com/api/v2/remote-jobs?count=100&geo=…`), refreshed daily (its terms
allow at most hourly). Each post's own region ("USA", "Europe", "APAC", "Anywhere") says who it's open to.

Terms: credit Jobicy with a link, and every Apply goes to the job's canonical Jobicy URL.
https://jobicy.com/jobs-rss-feed
"""

import asyncio
from datetime import timedelta
from typing import Any

from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Level, Posting, employment_type_of, parse_time, salary_text, text_of
from orbit_api.job_portal.sources.base import Attribution, Source

REGIONS = ("apac", "anywhere", "usa", "canada", "uk", "europe", "emea", "latam")
_LEVEL: dict[str, Level] = {"entry": "junior", "junior": "junior", "midweight": "mid", "mid": "mid",
                            "senior": "senior", "lead": "senior", "manager": "senior"}


def parse_job(j: Any, region: str) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("jobTitle") or not j.get("url"):
        return None
    kinds = " ".join(str(k) for k in (j.get("jobType") or []))
    geo = str(j.get("jobGeo") or "Anywhere")
    return Posting(
        source="jobicy", external_id=str(j["id"]), board=region, company=str(j.get("companyName") or ""),
        title=str(j["jobTitle"]), url=str(j["url"]), apply_url=str(j["url"]), posted_at=parse_time(j.get("pubDate")),
        locations=[f"Remote ({geo})"], description=text_of(j.get("jobDescription")) or str(j.get("jobExcerpt") or ""),
        workplace="remote", employment_type=employment_type_of(kinds),
        salary=salary_text(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod")),
        level=_LEVEL.get(str(j.get("jobLevel") or "").lower()))


class Jobicy(Source):
    id = "jobicy"
    label = "Jobicy"
    kind = "feed"
    hosts = frozenset({"jobicy.com"})
    ttl = timedelta(hours=24)
    attribution = Attribution("Jobicy", "https://jobicy.com")

    def keys(self) -> list[str]:
        return list(REGIONS)

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        data = await http.get_json("https://jobicy.com/api/v2/remote-jobs", params={"count": 100, "geo": key})
        jobs = data.get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            raise SourceError("Jobicy sent an unexpected shape")
        return await asyncio.to_thread(lambda: [p for j in jobs if (p := parse_job(j, key)) is not None])
