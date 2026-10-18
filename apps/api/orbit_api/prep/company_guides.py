"""GET /v1/interview-styles: the company interview guides (live/company_styles.py, from the question bank), for the
Practice page's "What to expect at …". Small and static, so the client fetches it once and matches what the user
types against the aliases. Each guide is the one for the country the user applies in (company_styles.for_country).
The full guides, with every question and what a good answer covers, are the public /companies pages."""

import gzip
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, TypeAdapter

from orbit_api.auth.security import current_user
from orbit_api.live.company_styles import STYLES, for_country
from orbit_api.models import User
from orbit_api.question_bank.schema import Market
from orbit_api.region import market_country

router = APIRouter(prefix="/v1/interview-styles", tags=["prep"])


class CompanyStyleOut(BaseModel):
    slug: str
    name: str
    aliases: list[str]
    rounds: list[str]
    looks_for: list[str]
    questions: list[str]
    tips: list[str]
    # Where it's suggested: only in India ("india"), India first ("india-first"), or everywhere.
    market: Market


_LIST = TypeAdapter(list[CompanyStyleOut])
# The list per market country, serialized and gzipped once: it's static (the question bank ships with the code) and
# ~250 kB, and building and compressing it took ~15 ms of the event loop on every Practice page.
_bodies: dict[str, tuple[bytes, bytes]] = {}
MAX_BODIES = 300


def _body(country: str) -> tuple[bytes, bytes]:
    hit = _bodies.get(country)
    if hit is None:
        styles = [CompanyStyleOut(slug=s.slug, name=s.name, aliases=list(s.aliases), rounds=list(s.rounds),
                                  looks_for=list(s.looks_for), questions=list(s.questions), tips=list(s.tips),
                                  market=s.market)
                  for s in (for_country(style, country) for style in STYLES)]
        raw = _LIST.dump_json(styles)
        hit = (raw, gzip.compress(raw, compresslevel=6))
        if len(_bodies) < MAX_BODIES:
            _bodies[country] = hit
    return hit


@router.get("", response_model=list[CompanyStyleOut])
async def list_styles(request: Request, user: Annotated[User, Depends(current_user)]) -> Response:
    raw, packed = _body(market_country(user.country, request))
    if "gzip" in request.headers.get("accept-encoding", ""):  # as the API's gzip middleware decides
        return Response(packed, media_type="application/json",
                        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(raw, media_type="application/json")
