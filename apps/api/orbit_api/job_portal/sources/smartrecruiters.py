"""SmartRecruiters job boards: `GET api.smartrecruiters.com/v1/companies/{id}/postings?country=in`, India posts only.

The list has no text, so each post's text comes from a second call (`/postings/{id}`), at most DETAILS_PER_RUN new
posts per company per refresh, newest first; posts already cached keep their text. Public and keyless today, but
SmartRecruiters may tighten that: a refusal is just a failed fetch (the feed carries on without it).
https://developers.smartrecruiters.com/docs/posting-api
"""

import asyncio
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from orbit_api.job_portal.companies import Board, boards
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Level, Posting, Workplace, employment_type_of, obj, parse_time, text_of
from orbit_api.job_portal.sources.base import Source

API = "https://api.smartrecruiters.com/v1/companies"
PAGE = 100
MAX_PAGES = 3
DETAILS_PER_RUN = 40
DETAIL_CONCURRENCY = 3
# Their experience levels, where they say something reliable. "executive" isn't: in India it's a junior title.
_LEVEL: dict[str, Level] = {"internship": "fresher", "entry_level": "fresher", "associate": "junior",
                            "director": "senior"}


def parse_job(j: Any, board: Board, detail: Any = None) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("name"):
        return None
    loc, company = obj(j.get("location")), obj(j.get("company"))
    ident = str(company.get("identifier") or board.token)
    url = f"https://jobs.smartrecruiters.com/{quote(ident, safe='')}/{quote(str(j['id']), safe='')}"
    apply_url, text = url, ""
    if isinstance(detail, dict):
        url = str(detail.get("postingUrl") or url)
        apply_url = str(detail.get("applyUrl") or url)
        sections = obj(obj(detail.get("jobAd")).get("sections"))
        parts = []
        for name in ("jobDescription", "qualifications", "additionalInformation", "companyDescription"):
            sec = obj(sections.get(name))
            if sec.get("text"):
                parts.append("\n".join(x for x in (str(sec.get("title") or ""), text_of(sec.get("text"))) if x))
        text = "\n\n".join(parts)
    workplace: Workplace | None = "remote" if loc.get("remote") else "hybrid" if loc.get("hybrid") else None
    country = str(loc.get("country") or "")
    place = ", ".join(x for x in (str(loc.get("city") or ""), str(loc.get("region") or ""),
                                  "India" if country.lower() == "in" else country) if x)
    return Posting(
        source="smartrecruiters", external_id=str(j["id"]), board=board.token,
        company=board.company, title=str(j["name"]), url=url, apply_url=apply_url,
        posted_at=parse_time(j.get("releasedDate")), locations=[place] if place else [], description=text,
        workplace=workplace, employment_type=employment_type_of(str(obj(j.get("typeOfEmployment")).get("label") or "")),
        country=country.upper() or None, level=_LEVEL.get(str(obj(j.get("experienceLevel")).get("id") or "")),
        remote_unstated_ok=board.india_first, partial=not text)


class SmartRecruiters(Source):
    id = "smartrecruiters"
    label = "SmartRecruiters"
    kind = "board"
    direct = True
    hosts = frozenset({"api.smartrecruiters.com"})
    ttl = timedelta(hours=6)

    def keys(self) -> list[str]:
        return [b.token for b in boards("smartrecruiters")]

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        board = next(b for b in boards("smartrecruiters") if b.token == key)
        base = f"{API}/{quote(key, safe='')}/postings"
        items: list[dict[str, Any]] = []
        for page in range(MAX_PAGES):
            data = await http.get_json(base, params={"country": "in", "limit": PAGE, "offset": page * PAGE})
            content = data.get("content") if isinstance(data, dict) else None
            if not isinstance(content, list):
                raise SourceError("SmartRecruiters sent an unexpected shape")
            items += [x for x in content if isinstance(x, dict) and x.get("id")]
            if len(content) < PAGE or len(items) >= int(data.get("totalFound") or 0):
                break
        # Text for the newest posts not cached yet, a few at a time.
        todo = sorted((x for x in items if str(x["id"]) not in known),
                      key=lambda x: str(x.get("releasedDate") or ""), reverse=True)[:DETAILS_PER_RUN]
        details: dict[str, Any] = {}
        gate = asyncio.Semaphore(DETAIL_CONCURRENCY)

        async def detail(posting_id: str) -> None:
            async with gate:
                try:
                    details[posting_id] = await http.get_json(f"{base}/{quote(posting_id, safe='')}")
                except SourceError:
                    pass  # listed without its text this time; the next refresh tries again

        await asyncio.gather(*(detail(str(x["id"])) for x in todo))
        return await asyncio.to_thread(
            lambda: [p for x in items if (p := parse_job(x, board, details.get(str(x["id"])))) is not None])
