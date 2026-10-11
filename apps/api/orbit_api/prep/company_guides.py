"""GET /v1/interview-styles: the company interview guides (live/company_styles.py), for the Practice page's "What to
expect at …". Small and static, so the client fetches it once and matches what the user types against the aliases."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from orbit_api.auth.security import current_user
from orbit_api.live.company_styles import STYLES
from orbit_api.models import User

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
async def list_styles(_: Annotated[User, Depends(current_user)]) -> list[CompanyStyleOut]:
    return [CompanyStyleOut(slug=s.slug, name=s.name, aliases=list(s.aliases), rounds=list(s.rounds),
                            looks_for=list(s.looks_for), questions=list(s.questions), tips=list(s.tips))
            for s in STYLES]
