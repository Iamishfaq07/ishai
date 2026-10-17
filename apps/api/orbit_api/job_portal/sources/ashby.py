"""Ashby job boards: `GET api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`, one call per
company, every listed post with its text and pay when published. Public, no key.
https://developers.ashbyhq.com/docs/public-job-posting-api"""

import asyncio
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from orbit_api.job_portal.companies import Board, boards
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.pace import paced_map
from orbit_api.job_portal.postings import (
    EmploymentType,
    Posting,
    Workplace,
    clean_line,
    obj,
    parse_time,
    text_of,
    worth_reading,
)
from orbit_api.job_portal.sources.base import Source

_KIND: dict[str, EmploymentType] = {"fulltime": "full_time", "parttime": "part_time", "intern": "internship",
                                     "contract": "contract", "temporary": "contract"}
_PLACE: dict[str, Workplace] = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite"}


def _country(address: Any) -> str:
    postal = address.get("postalAddress") if isinstance(address, dict) else None
    return str(postal.get("addressCountry") or "") if isinstance(postal, dict) else ""


def parse_job(j: Any, board: Board) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("title") or j.get("isListed") is False:
        return None
    places = [", ".join(x for x in (str(j.get("location") or ""), _country(j.get("address"))) if x)]
    for extra in j.get("secondaryLocations") or []:
        if isinstance(extra, dict):
            places.append(", ".join(x for x in (str(extra.get("location") or ""), _country(extra.get("address")))
                                    if x))
    remote = j.get("isRemote") is True or str(j.get("workplaceType") or "").lower() == "remote"
    if not worth_reading(" / ".join(places) + " " + str(j["title"]), remote=remote):
        return None
    pay = obj(j.get("compensation"))
    summary = pay.get("scrapeableCompensationSalarySummary") or pay.get("compensationTierSummary")
    workplace = _PLACE.get(str(j.get("workplaceType") or "").lower().replace(" ", ""))
    if workplace is None and j.get("isRemote") is True:
        workplace = "remote"
    url = str(j.get("jobUrl") or "")
    return Posting(
        source="ashby", external_id=str(j["id"]), board=board.token, company=board.company, title=str(j["title"]),
        url=url, apply_url=str(j.get("applyUrl") or url), posted_at=parse_time(j.get("publishedAt")),
        locations=[p for p in places if p],
        description=str(j.get("descriptionPlain") or "").strip() or text_of(j.get("descriptionHtml")),
        workplace=workplace, employment_type=_KIND.get(str(j.get("employmentType") or "").lower()),
        salary=clean_line(summary, 120) if summary else None, remote_unstated_ok=board.india_first)


class Ashby(Source):
    id = "ashby"
    label = "Ashby"
    kind = "board"
    direct = True
    hosts = frozenset({"api.ashbyhq.com"})
    ttl = timedelta(hours=6)

    def keys(self) -> list[str]:
        return [b.token for b in boards("ashby")]

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        board = next(b for b in boards("ashby") if b.token == key)
        data = await http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{quote(key, safe='')}",
                                   params={"includeCompensation": "true"})
        jobs = data.get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            raise SourceError("Ashby sent an unexpected shape")
        return await asyncio.to_thread(paced_map, lambda j: parse_job(j, board), jobs)
