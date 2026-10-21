"""Your first 90 days: once an offer or a hire is recorded, a plan for starting the role well, from the job post and
the resume.

The career journey doesn't end at "hired" (the next-chapter step in the product's journey). The plan has phases
(first two weeks, 30, 60, 90 days) with concrete goals taken from the post's responsibilities, the people to meet by
role (never invented names), questions for the manager, and an early win the candidate's own experience supports.
Nothing is saved; the page offers it to copy or download. Facts about the candidate come only from the resume.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import Document, JobListing, Resume, User
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.schema import ResumeData

router = APIRouter(prefix="/v1/jobs/tracker", tags=["first 90 days"])
_ip = limit("first-ninety", rate_per_s=10 / 3600, burst=4)
_user = limit_user("first-ninety-user", rate_per_s=10 / 3600, burst=3)

SYSTEM = """You help someone who just got a job offer plan their first 90 days in the role.

Return ONLY a JSON object:
{"phases": [{"name": "First two weeks"|"By day 30"|"By day 60"|"By day 90", "goals": [string]}],
 "people": [string], "questions": [string], "early_win": string}

Rules:
- phases: exactly those four, in order, 2-4 concrete goals each, tied to the responsibilities in the job post. First
  two weeks are about learning the systems, team and expectations, not delivering.
- people: 3-6 roles to meet early (e.g. "your manager", "the on-call lead"), never invented names.
- questions: 4-6 questions to ask the manager in the first week about expectations and how success is measured.
- early_win: one modest, realistic first contribution the candidate's own resume experience supports. Say which
  experience. Never invent skills or achievements.
- Plain words, no buzzwords, no em dashes. Don't promise outcomes.
"""

PHASES = ("First two weeks", "By day 30", "By day 60", "By day 90")


class Phase(BaseModel):
    name: str = Field(max_length=40)
    goals: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)

    @field_validator("goals", mode="before")
    @classmethod
    def _four(cls, v: Any) -> Any:
        return v[:4] if isinstance(v, list) else v


class Plan(BaseModel):
    phases: list[Phase]
    people: list[Annotated[str, Field(max_length=160)]] = Field(default_factory=list)
    questions: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)
    early_win: str = Field("", max_length=600)

    @field_validator("phases", mode="after")
    @classmethod
    def _ordered(cls, v: list[Phase]) -> list[Phase]:
        by_name = {p.name: p for p in v}
        out = [by_name[n] for n in PHASES if n in by_name and by_name[n].goals]
        if len(out) < 3:
            raise ValueError("the plan needs its phases")
        return out

    @field_validator("people", "questions", mode="before")
    @classmethod
    def _six(cls, v: Any) -> Any:
        return v[:6] if isinstance(v, list) else v


@router.post("/{entry_id}/first-90", response_model=Plan, dependencies=[Depends(_ip), Depends(_user)])
async def first_ninety(entry_id: str, user: Annotated[User, Depends(require_verified_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> Plan:
    from orbit_api.job_portal.routes import _profile

    job = await owned(db, user, entry_id)
    if job.status not in ("offer", "hired"):
        raise HTTPException(409, "Record an offer or a hire for this job first.")
    resume = await db.get(Resume, job.resume_id) if job.resume_id else None
    if resume is None or resume.user_id != user.id:
        resume = (await _profile(db, user))[2]
    listing = await db.get(JobListing, job.listing_id)
    document = await db.get(Document, job.document_id) if job.document_id else None
    post = ((document.source_text if document and document.user_id == user.id else "")
            or (listing.description or listing.snippet if listing else "") or "")
    if len(post.strip()) < 80:
        raise HTTPException(409, "Add the job description to this job first: the plan is built from it.")
    experience = resume_text(ResumeData.model_validate(resume.data or {})) if resume else ""
    evidence = (f"Role: {job.title} at {job.company}\nJob post:\n{post[:6000]}\n\n"
                f"Candidate's resume:\n{experience[:6000] or '(no resume saved)'}")
    return await generate_json(db, user, "first_ninety", SYSTEM, evidence, Plan)
