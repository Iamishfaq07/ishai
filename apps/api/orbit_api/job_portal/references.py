"""Reference brief: when an employer asks for references, help the candidate ask well and brief each person.

The candidate names up to three people and, in their own words, what they worked on together. For each one Orbit
drafts a short request ("would you be a reference for this role?") and a brief the reference can glance at before the
call: what the role cares about and which shared work speaks to it. Facts come only from the resume and the
candidate's own notes; numbers neither contains become [number] prompts (first_look.ungrounded_numbers). Nothing is
saved and nothing is sent: the page offers copy buttons, the candidate sends from their own email or phone.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
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

router = APIRouter(prefix="/v1/jobs/tracker", tags=["references"])
_ip = limit("reference-brief", rate_per_s=20 / 3600, burst=6)
_user = limit_user("reference-brief-user", rate_per_s=20 / 3600, burst=4)

SYSTEM = """You help a job candidate prepare their references for one specific role.

Return ONLY a JSON object:
{"references": [{"name": string, "ask": string, "brief": [string]}], "tips": [string]}

Rules:
- One entry per person given, same names, same order.
- ask: a short, warm message (60-110 words) asking the person to be a reference for this role, naming the company
  and role, saying roughly when a call might come, and offering to send the job post. First person, plain words,
  no em dashes. It must be easy to say no to.
- brief: 3-5 short points the reference could mention, each tying something they actually saw (from the candidate's
  note about them, or the resume) to what the job asks for. Never invent projects, titles, results or numbers. If
  the note is thin, write a bracketed prompt such as [a project you both worked on].
- tips: 2-4 short practical tips for this candidate (e.g. thank them after, tell them the outcome).
"""

MAX_PEOPLE = 3


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    relationship: str = Field("", max_length=120)
    worked_on: str = Field("", max_length=1200)


class BriefIn(BaseModel):
    people: list[PersonIn] = Field(min_length=1, max_length=MAX_PEOPLE)


class PersonBrief(BaseModel):
    name: str = Field(max_length=80)
    ask: str = Field(min_length=20, max_length=1200)
    brief: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)

    @field_validator("brief", mode="before")
    @classmethod
    def _five(cls, v: Any) -> Any:
        return v[:5] if isinstance(v, list) else v


class BriefAI(BaseModel):
    references: list[PersonBrief]
    tips: list[Annotated[str, Field(max_length=240)]] = Field(default_factory=list)


@router.post("/{entry_id}/reference-brief", response_model=BriefAI, dependencies=[Depends(_ip), Depends(_user)])
async def reference_brief(entry_id: str, body: BriefIn, user: Annotated[User, Depends(require_verified_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> BriefAI:
    from orbit_api.job_portal.routes import _profile

    job = await owned(db, user, entry_id)
    resume = await db.get(Resume, job.resume_id) if job.resume_id else None
    if resume is None or resume.user_id != user.id:
        resume = (await _profile(db, user))[2]
    experience = resume_text(ResumeData.model_validate(resume.data or {})) if resume else ""
    listing = await db.get(JobListing, job.listing_id)
    document = await db.get(Document, job.document_id) if job.document_id else None
    post = ((document.source_text if document and document.user_id == user.id else "")
            or (listing.description or listing.snippet if listing else "") or "")
    people = "\n".join(f"- {p.name.strip()} ({p.relationship.strip() or 'relationship not given'}): "
                       f"{p.worked_on.strip() or '(no note)'}" for p in body.people)
    evidence = (f"Role: {job.title} at {job.company}\nJob post:\n{post[:4000] or '(not saved)'}\n\n"
                f"References, with the candidate's own note about each:\n{people}\n\n"
                f"Candidate's resume:\n{experience[:5000] or '(no resume saved)'}")
    ai = await generate_json(db, user, "reference_brief", SYSTEM, evidence, BriefAI)
    source = "\n".join([experience, *(p.worked_on for p in body.people)])
    by_name = {r.name.strip().casefold(): r for r in ai.references}
    out: list[PersonBrief] = []
    for person in body.people:
        r = by_name.get(person.name.strip().casefold())
        if r is None:
            continue
        out.append(PersonBrief(name=person.name.strip(), ask=ungrounded_numbers(r.ask, source),
                               brief=[ungrounded_numbers(b, source) for b in r.brief]))
    if not out:
        raise HTTPException(503, "The AI didn't return a brief for these people. Please try again.")
    return BriefAI(references=out, tips=ai.tips[:4])
