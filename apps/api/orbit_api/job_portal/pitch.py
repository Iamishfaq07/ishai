"""Your pitch: the answer to "Tell me about yourself" for one job, in 30, 60 and 90 second versions.

Built from the resume and the job post: present (what you do now), past (the experience that led here), future (why
this role), pointing at what the job asks for most that the resume backs. Facts come only from the resume; any number
the resume doesn't contain becomes a [number] prompt (first_look.ungrounded_numbers). Spoken-word pacing: about 130
words a minute. Nothing is saved; the page offers practice with Saba.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.job_portal.first_look import ungrounded_numbers
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import Document, JobListing, Resume, User
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.schema import ResumeData

router = APIRouter(prefix="/v1/jobs/tracker", tags=["pitch"])
_ip = limit("pitch", rate_per_s=30 / 3600, burst=8)
_user = limit_user("pitch-user", rate_per_s=30 / 3600, burst=6)

SYSTEM = """You help a candidate answer "Tell me about yourself" for one specific job, out loud.

Return ONLY a JSON object:
{"short": string, "standard": string, "long": string, "hooks": [string]}

Rules:
- short: about 30 seconds spoken (60-75 words). standard: about 60 seconds (120-140 words). long: about 90 seconds
  (180-200 words). First person, conversational, contractions, no bullet points.
- Shape each one: present (what I do now), past (the experience that led here, one or two concrete examples),
  future (why this role, tied to what the job asks for).
- Use ONLY facts from the resume. Never invent employers, titles, skills, numbers or outcomes. Where a detail would
  help but isn't there, write a bracketed prompt such as [the result].
- hooks: 2-3 short phrases naming the resume facts each version leans on, so the candidate can check them.
- No buzzwords (passionate, results-driven, leverage, synergy), no em dashes, no "I am a highly motivated".
"""


class PitchAI(BaseModel):
    short: str = Field(min_length=20, max_length=900)
    standard: str = Field(min_length=40, max_length=1600)
    long: str = Field(min_length=60, max_length=2400)
    hooks: list[Annotated[str, Field(max_length=160)]] = Field(default_factory=list)


class PitchOut(PitchAI):
    resume_title: str
    words: dict[str, int]


@router.post("/{entry_id}/pitch", response_model=PitchOut, dependencies=[Depends(_ip), Depends(_user)])
async def pitch(entry_id: str, user: Annotated[User, Depends(require_verified_user)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> PitchOut:
    from orbit_api.job_portal.routes import _profile

    job = await owned(db, user, entry_id)
    resume = await db.get(Resume, job.resume_id) if job.resume_id else None
    if resume is None or resume.user_id != user.id:
        resume = (await _profile(db, user))[2]
    if resume is None:
        raise HTTPException(409, "Add a resume first: your pitch is built from it.")
    source = resume_text(ResumeData.model_validate(resume.data or {}))
    if len(source.strip()) < 80:
        raise HTTPException(409, "Your resume is nearly empty. Add your experience first.")
    listing = await db.get(JobListing, job.listing_id)
    document = await db.get(Document, job.document_id) if job.document_id else None
    post = ((document.source_text if document and document.user_id == user.id else "")
            or (listing.description or listing.snippet if listing else "") or "")
    evidence = (f"Role: {job.title} at {job.company}\nJob post:\n{post[:4000] or '(not saved)'}\n\n"
                f"Candidate's resume:\n{source[:7000]}")
    ai = await generate_json(db, user, "pitch", SYSTEM, evidence, PitchAI)
    versions = {k: ungrounded_numbers(getattr(ai, k), source) for k in ("short", "standard", "long")}
    return PitchOut(**versions, hooks=ai.hooks[:3], resume_title=resume.title,
                    words={k: len(v.split()) for k, v in versions.items()})
