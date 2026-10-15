"""LinkedIn AI: read the user's LinkedIn profile (LinkedIn's "Save to PDF", or the text pasted), audit it against the
role they're after and what job posts for it ask for, and flag where it disagrees with their Orbit resume. Reading
is AI (free, a few a day); the audit is measured, so changing the target role re-audits at no cost. The rewrite is
Resume AI's LinkedIn writer, called from the page.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.job_portal import refresh
from orbit_api.job_portal.ranking import title_tokens
from orbit_api.job_portal.skills import WEAK, display, same_skill
from orbit_api.linkedin import audit as auditmod
from orbit_api.linkedin.read import Profile, parse_read, read_request
from orbit_api.models import JobListing, LinkedInProfileRow, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/linkedin", tags=["linkedin"])
read_limit = Depends(limit_user("linkedin-read", rate_per_s=3, burst=60))
ai_limits = [Depends(limit("linkedin-ai", rate_per_s=0.5, burst=20)),
             Depends(limit_user("linkedin-ai-user", rate_per_s=10 / 3600, burst=5))]
MIN_TEXT = 200
MAX_KEYWORDS = 15


class CheckOut(BaseModel):
    id: str
    section: str
    ok: bool
    points: int
    max: int
    title: str
    tip: str


class AuditOut(BaseModel):
    score: int
    checks: list[CheckOut]
    keywords: list[str]
    found: list[str]
    missing: list[str]
    mismatches: list[str]
    posts: int  # how many job posts the keywords came from


class LinkedInOut(BaseModel):
    profile: Profile | None
    target_role: str
    audit: AuditOut | None
    read_at: datetime | None
    reads_left: int | None  # AI reads left today; None = no cap (the admin)


_kw_cache: dict[tuple[str, str, int], tuple[list[str], int]] = {}


async def market_keywords(db: AsyncSession, role: str, country: str) -> tuple[list[str], int]:
    """The skills job posts for this role ask for most (each post counts once per skill), and how many posts."""
    want = title_tokens(role)
    if not want:
        return [], 0
    key = (" ".join(sorted(want)), country, refresh.version())
    if key in _kw_cache:
        return _kw_cache[key]
    rows = (await db.execute(select(JobListing.title, JobListing.keywords)
                             .where((JobListing.country == country) | (JobListing.workplace == "remote")))).all()
    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    posts = 0
    for title, kws in rows:
        if not want <= title_tokens(title):
            continue
        posts += 1
        for k in {same_skill(k): k for k in (kws or []) if k.lower() not in WEAK}.items():
            counts[k[0]] += 1
            names.setdefault(k[0], display(k[1]))
    top = [names[k] for k, n in counts.most_common(MAX_KEYWORDS * 2) if n >= 2][:MAX_KEYWORDS]
    out = (top, posts) if posts >= 3 else ([], posts)
    if len(_kw_cache) > 300:
        _kw_cache.clear()
    _kw_cache[key] = out
    return out


async def _default_target(db: AsyncSession, user: User, profile: Profile | None) -> str:
    from orbit_api.job_portal.routes import _profile

    _, prefs, _ = await _profile(db, user)
    if prefs.titles:
        return prefs.titles[0]
    if profile and profile.experience:
        return profile.experience[0].title
    return ""


async def _resume_roles(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    from orbit_api.job_portal.routes import _data, _profile

    _, _, resume = await _profile(db, user)
    data = _data(resume)
    return [(e.title, e.company) for e in data.experience] if data is not None else []


async def _out(db: AsyncSession, user: User, row: LinkedInProfileRow | None) -> LinkedInOut:
    from orbit_api.job_portal.routes import _ai_left

    left = await _ai_left(db, user, "linkedin_read", get_settings().linkedin_read_daily)
    if row is None:
        return LinkedInOut(profile=None, target_role=await _default_target(db, user, None), audit=None, read_at=None,
                           reads_left=left)
    profile = Profile.model_validate(row.data or {})
    target = row.target_role or await _default_target(db, user, profile)
    keywords, posts = await market_keywords(db, target, (user.country or "IN").upper())
    a = await asyncio.to_thread(auditmod.audit, profile, target, keywords, await _resume_roles(db, user))
    return LinkedInOut(profile=profile, target_role=target, read_at=row.updated_at, reads_left=left, audit=AuditOut(
        score=a.score, checks=[CheckOut(**c.__dict__) for c in a.checks], keywords=a.keywords, found=a.found,
        missing=a.missing, mismatches=a.mismatches, posts=posts))


@router.get("", response_model=LinkedInOut, dependencies=[read_limit])
async def get_linkedin(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    return await _out(db, user, await db.get(LinkedInProfileRow, user.id))


class TargetIn(BaseModel):
    target_role: str = Field(min_length=2, max_length=200)


@router.put("/target", response_model=LinkedInOut, dependencies=[read_limit])
async def set_target(body: TargetIn, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    row = await db.get(LinkedInProfileRow, user.id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Read your LinkedIn profile first.")
    row.target_role = " ".join(body.target_role.split())
    await db.commit()
    return await _out(db, user, row)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, dependencies=[read_limit])
async def delete_linkedin(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    row = await db.get(LinkedInProfileRow, user.id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


_locks: dict[str, asyncio.Lock] = {}


async def _read(db: AsyncSession, user: User, text: str) -> LinkedInOut:
    from orbit_api.job_portal.routes import _ai_left, _generate

    text = text.strip()
    if len(text) < MIN_TEXT:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "There isn't enough of a profile there. Use LinkedIn's Save to PDF, or paste the whole "
                            "profile.")
    cap = get_settings().linkedin_read_daily
    async with _locks.setdefault(user.id, asyncio.Lock()):
        if await _ai_left(db, user, "linkedin_read", cap) == 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "linkedin_read_limit",
                "message": f"You've read your profile {cap} times today. Reads are back tomorrow; the audit "
                           "below still updates."})
        try:
            resp = await _generate(db, user, read_request(text, get_llm_provider()))
            profile = await asyncio.to_thread(parse_read, resp.text, text)
        except LLMError as e:
            log.warning("linkedin read failed: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The AI isn't available right now. Try again in a moment.") from e
        except ValueError as e:
            log.warning("linkedin read unusable: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Orbit couldn't read a LinkedIn profile from that. Use LinkedIn's Save to PDF.") from e
        row = await db.get(LinkedInProfileRow, user.id)
        if row is None:
            row = LinkedInProfileRow(user_id=user.id, target_role="")
            db.add(row)
        row.data = profile.model_dump(mode="json")
        await db.commit()
        await db.refresh(row)
        return await _out(db, user, row)


class ReadIn(BaseModel):
    text: str = Field(max_length=60_000)


@router.post("/read", response_model=LinkedInOut, dependencies=ai_limits)
async def read_text(body: ReadIn, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    return await _read(db, user, body.text)


@router.post("/read-file", response_model=LinkedInOut, dependencies=ai_limits)
async def read_file(file: Annotated[UploadFile, File()], user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """LinkedIn's "Save to PDF" (profile → More → Save to PDF). The file isn't kept."""
    max_bytes = get_settings().max_upload_bytes
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Max file size is {max_bytes // 1_048_576} MB.")
    filename = (file.filename or "profile.pdf").replace("\\", "/").rsplit("/", 1)[-1][:300]
    try:
        fmt = detect_format(filename, file.content_type, raw[:8])
        text = await asyncio.to_thread(extract_text_isolated, raw, fmt)
    except ParseError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    return await _read(db, user, text)
