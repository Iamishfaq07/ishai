"""Lever job boards: `GET api.lever.co/v0/postings/{site}?mode=json`, one call per company, every open post with
its text. Public, no key. https://github.com/lever/postings-api"""

import asyncio
from datetime import timedelta
from typing import Any, cast
from urllib.parse import quote

from orbit_api.job_portal.companies import Board, boards
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.pace import paced_map
from orbit_api.job_portal.postings import (
    Posting,
    Workplace,
    employment_type_of,
    obj,
    parse_time,
    salary_text,
    text_of,
    worth_reading,
)
from orbit_api.job_portal.sources.base import Source


def parse_job(j: Any, board: Board) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("text"):
        return None
    cats = obj(j.get("categories"))
    places = [str(x) for x in (cats.get("allLocations") or []) if x] or [str(cats.get("location") or "")]
    place = str(j.get("workplaceType") or "").lower()
    if not worth_reading(" / ".join(places) + " " + str(j["text"]), remote=place == "remote",
                         country=str(j.get("country") or "")):
        return None
    parts = [str(j.get("descriptionPlain") or "").strip()]
    for item in j.get("lists") or []:
        if isinstance(item, dict):
            parts.append("\n".join(x for x in (str(item.get("text") or "").strip(), text_of(item.get("content"))) if x))
    parts.append(str(j.get("additionalPlain") or "").strip())
    pay = obj(j.get("salaryRange"))
    url = str(j.get("hostedUrl") or "")
    return Posting(
        source="lever", external_id=str(j["id"]), board=board.token, company=board.company, title=str(j["text"]),
        url=url, apply_url=str(j.get("applyUrl") or url), posted_at=parse_time(j.get("createdAt")),
        locations=[p for p in places if p], description="\n\n".join(p for p in parts if p),
        workplace=cast(Workplace, place) if place in ("remote", "hybrid", "onsite") else None,
        employment_type=employment_type_of(str(cats.get("commitment") or "")),
        salary=salary_text(pay.get("min"), pay.get("max"), pay.get("currency"),
                           pay.get("interval")),
        country=str(j.get("country") or "") or None, remote_unstated_ok=board.india_first)


class Lever(Source):
    id = "lever"
    label = "Lever"
    kind = "board"
    direct = True
    hosts = frozenset({"api.lever.co"})
    ttl = timedelta(hours=6)

    def keys(self) -> list[str]:
        return [b.token for b in boards("lever")]

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        board = next(b for b in boards("lever") if b.token == key)
        data = await http.get_json(f"https://api.lever.co/v0/postings/{quote(key, safe='')}", params={"mode": "json"})
        if not isinstance(data, list):
            raise SourceError("Lever sent an unexpected shape")
        return await asyncio.to_thread(paced_map, lambda j: parse_job(j, board), data)
