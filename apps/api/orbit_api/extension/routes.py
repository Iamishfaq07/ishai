"""The Orbit browser extension (apps/extension): clip a job from the page you're on, see how your resume's keywords
cover it, and fill an application form's basic fields for you to review. It never submits anything.

Signing in: on Orbit's own site, signed in, "Connect the extension" calls `POST /v1/extension/connect`, which makes a
token scoped to the extension (auth/security.py SCOPED_PATHS) and shows up in Settings → Devices as "Browser
extension", so it can be signed out there. The site hands the token to the extension's content script on that page
only. The token can't reach anything else in the account.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import create_access_token, current_user, decode_claims, token_from_request
from orbit_api.db import get_db
from orbit_api.models import AuditLog, JobSearchProfile, User, UserSession
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/extension", tags=["extension"])
connect_limit = Depends(limit_user("extension-connect", rate_per_s=0.1, burst=5))
read_limit = Depends(limit_user("extension-read", rate_per_s=2, burst=60))
MAX_JOB_TEXT = 30_000
SCOPE = "extension"


class ConnectOut(BaseModel):
    token: str


@router.post("/connect", response_model=ConnectOut, dependencies=[connect_limit])
async def connect(request: Request, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> ConnectOut:
    """A token for the extension, from a full sign-in on Orbit's site (a scoped token can't make another one)."""
    from orbit_api.auth.routes import _ip

    claims = decode_claims(token_from_request(request) or "") or {}
    if claims.get("scope"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Connect the extension from Orbit's site.")
    session = UserSession(id=uuid.uuid4().hex, user_id=user.id, kind="extension", label="Browser extension")
    db.add(session)
    db.add(AuditLog(user_id=user.id, action="auth.extension_connected", ip=_ip(request)))
    await db.commit()
    return ConnectOut(token=create_access_token(user.id, user.token_version, sid=session.id, scope=SCOPE))


class MeOut(BaseModel):
    email: str
    name: str | None


@router.get("/me", response_model=MeOut, dependencies=[read_limit])
async def me(user: Annotated[User, Depends(current_user)]) -> MeOut:
    return MeOut(email=user.email, name=user.name)


class ProfileOut(BaseModel):
    """The basics an application form asks for, from the resume Jobs AI uses. Empty strings where it has none."""

    resume_title: str | None
    full_name: str
    first_name: str
    last_name: str
    email: str
    phone: str
    location: str
    linkedin: str
    github: str
    website: str
    headline: str


def _link(links: list[tuple[str, str]], *needles: str) -> str:
    for label, url in links:
        if any(n in label.lower() or n in url.lower() for n in needles):
            return url
    return ""


@router.get("/profile", response_model=ProfileOut, dependencies=[read_limit])
async def profile(user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> ProfileOut:
    from orbit_api.job_portal.routes import _data, _resume_for

    resume = await _resume_for(db, user, await db.get(JobSearchProfile, user.id))
    data = _data(resume)
    b = data.basics if data is not None else None
    name = (b.name if b else "") or (user.name or "")
    first, _, last = name.strip().partition(" ")
    links = [(link.label, link.url) for link in (b.links if b else [])]
    linkedin = _link(links, "linkedin")
    github = _link(links, "github")
    website = next((u for _, u in links if u and u not in (linkedin, github)), "")
    return ProfileOut(resume_title=resume.title if resume is not None else None, full_name=name.strip(),
                      first_name=first, last_name=last.strip(), email=(b.email if b else "") or user.email,
                      phone=b.phone if b else "", location=b.location if b else "", linkedin=linkedin,
                      github=github, website=website, headline=b.headline if b else "")


class FitIn(BaseModel):
    job_text: str = Field(min_length=40, max_length=MAX_JOB_TEXT)


class FitOut(BaseModel):
    resume_title: str | None
    matched: list[str]
    missing: list[str]
    coverage_pct: int | None  # matched keywords out of all found; None when the page had none to check


@router.post("/fit", response_model=FitOut, dependencies=[read_limit])
async def fit(body: FitIn, user: Annotated[User, Depends(current_user)],
              db: Annotated[AsyncSession, Depends(get_db)]) -> FitOut:
    """Which of the job post's keywords your resume already covers: the same keyword check as Resume AI's ATS
    score, no AI and no cost. It's coverage, not a prediction of getting the job."""
    from orbit_api.job_portal.routes import _data, _resume_for
    from orbit_api.resumes.ats import extract_keywords, match_keywords

    resume = await _resume_for(db, user, await db.get(JobSearchProfile, user.id))
    data = _data(resume)
    if data is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Make a resume in Resume AI first: the check compares it with the job.")
    keywords = extract_keywords(body.job_text)
    result = match_keywords(keywords, data)
    total = len(result.matched) + len(result.missing)
    return FitOut(resume_title=resume.title if resume is not None else None, matched=result.matched,
                  missing=result.missing, coverage_pct=round(100 * len(result.matched) / total) if total else None)
