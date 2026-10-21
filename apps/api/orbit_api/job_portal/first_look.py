"""Recruiter first look: what a recruiter sees in the top third of the resume for one job, in the few seconds a first
pass takes.

Two parts. The check is deterministic: the job's most-asked skills (`JobListing.keywords`, or read from a pasted post)
are looked up in the resume's top third (headline, summary, the latest role's title and first three bullets, the first
skills group) and in the whole resume, with the feed's own matcher (skills.py). Then the AI writes a short first
impression and a suggested headline and summary from the resume's own facts. Any number the resume doesn't contain is
replaced with a [number] prompt, so a suggestion can't invent a metric. Nothing is saved: the candidate edits their
resume themselves.
"""

import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.job_portal.message_updates import owned
from orbit_api.job_portal.skills import SkillMatcher, listing_keywords, resume_matcher
from orbit_api.models import Document, JobListing, Resume, User
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.schema import ResumeData

router = APIRouter(prefix="/v1/jobs/tracker", tags=["recruiter first look"])
_ip = limit("first-look", rate_per_s=30 / 3600, burst=8)
_user = limit_user("first-look-user", rate_per_s=30 / 3600, burst=6)
TOP_SKILLS = 8

SYSTEM = """You are an experienced recruiter giving a candidate honest feedback on the first few seconds of reading
their resume for one job. You see only the top third: headline, summary, latest role and its first bullets,
first skills.

Return ONLY a JSON object:
{"impression": string, "headline": string, "summary": string}

Rules:
- impression: two sentences at most. What a recruiter would conclude about fit for THIS job from the top third alone,
  and the single biggest thing missing from it. Plain words, no flattery.
- headline: a resume headline under 100 characters for this job, using only titles and skills the resume shows.
- summary: two or three sentences in the first person, for this job, using ONLY facts the resume states. Lead with
  what the job asks for most that the resume can back. Never invent employers, skills, numbers or outcomes; where a
  detail would help but isn't in the resume, write a bracketed prompt such as [years of experience].
- No buzzwords (passionate, results-driven, leverage, seamless), no em dashes.
"""


class FirstLookAI(BaseModel):
    impression: str = Field(min_length=10, max_length=600)
    headline: str = Field("", max_length=160)
    summary: str = Field("", max_length=900)


class SkillPlace(BaseModel):
    skill: str
    where: Literal["top", "later", "missing"]


class FirstLookOut(FirstLookAI):
    resume_id: str
    resume_title: str
    skills: list[SkillPlace]
    top_text: str


class FirstLookIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


def top_third(data: ResumeData) -> str:
    """What a first pass reads: headline, summary, the latest role's title and first three bullets, first skills."""
    parts = [data.basics.headline, data.basics.summary]
    if data.experience:
        role = data.experience[0]
        parts += [" at ".join(x for x in (role.title, role.company) if x), *role.bullets[:3]]
    if data.skills:
        parts.append(", ".join(data.skills[0].items))
    return "\n".join(p for p in parts if p.strip())


def ungrounded_numbers(text: str, source: str) -> str:
    """Numbers in a suggestion that the resume doesn't contain become a [number] prompt."""
    known = set(re.findall(r"\d+(?:[.,]\d+)?", source))
    return re.sub(r"\d+(?:[.,]\d+)?%?", lambda m: m.group(0) if m.group(0).rstrip("%") in known else "[number]", text)


def places(skills: list[str], top: SkillMatcher, whole: SkillMatcher) -> list[SkillPlace]:
    return [SkillPlace(skill=s, where="top" if top.has(s) else "later" if whole.has(s) else "missing")
            for s in skills]


@router.post("/{entry_id}/first-look", response_model=FirstLookOut, dependencies=[Depends(_ip), Depends(_user)])
async def first_look(entry_id: str, body: FirstLookIn, user: Annotated[User, Depends(require_verified_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> FirstLookOut:
    from orbit_api.job_portal.routes import _profile

    job = await owned(db, user, entry_id)
    resume: Resume | None = None
    for candidate in (body.resume_id, job.resume_id):
        if candidate:
            row = await db.get(Resume, candidate)
            if row is None or row.user_id != user.id:
                raise HTTPException(404, "Resume not found")
            resume = row
            break
    if resume is None:
        resume = (await _profile(db, user))[2]
    if resume is None:
        raise HTTPException(409, "Add a resume first: the first look reads its top third.")
    data = ResumeData.model_validate(resume.data or {})
    listing = await db.get(JobListing, job.listing_id)
    document = await db.get(Document, job.document_id) if job.document_id else None
    post = ((document.source_text if document and document.user_id == user.id else "")
            or (listing.description or listing.snippet if listing else "") or "")
    skills: list[Any] = list(listing.keywords or []) if listing else []
    if not skills and post:
        skills = listing_keywords(job.title, post, job.company)
    top = top_third(data)
    if not top.strip():
        raise HTTPException(409, "Add a headline, summary or experience first: the top third of the resume is empty.")
    found = places([str(s) for s in skills[:TOP_SKILLS]], SkillMatcher(top, []), resume_matcher(data, []))
    evidence = (f"Job: {job.title} at {job.company}\n"
                f"Skills the job asks for most: {', '.join(p.skill for p in found) or 'not listed'}\n"
                f"Job post (excerpt):\n{post[:3000]}\n\n"
                f"Top third of the resume:\n{top}\n\nWhole resume, for facts only:\n{resume_text(data)[:6000]}")
    ai = await generate_json(db, user, "first_look", SYSTEM, evidence, FirstLookAI)
    source = resume_text(data)
    return FirstLookOut(impression=ai.impression, headline=ungrounded_numbers(ai.headline, source),
                        summary=ungrounded_numbers(ai.summary, source), resume_id=resume.id,
                        resume_title=resume.title, skills=found, top_text=top)
