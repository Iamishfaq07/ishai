"""GET /v1/interview-styles: the company interview guides (live/company_styles.py), for the Practice page's "What to
expect at …". Small and static, so the client fetches it once and matches what the user types against the aliases.
Each guide is the one for the country the user applies in (company_styles.for_country)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from orbit_api.auth.security import current_user
from orbit_api.live.company_styles import STYLES, for_country
from orbit_api.models import User
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


@router.get("", response_model=list[CompanyStyleOut])
async def list_styles(request: Request, user: Annotated[User, Depends(current_user)]) -> list[CompanyStyleOut]:
    country = market_country(user.country, request)
    return [CompanyStyleOut(slug=s.slug, name=s.name, aliases=list(s.aliases), rounds=list(s.rounds),
                            looks_for=list(s.looks_for), questions=list(s.questions), tips=list(s.tips))
            for s in (for_country(style, country) for style in STYLES)]
