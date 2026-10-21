"""Candidate-reviewed role exploration and search setup, using existing owned resumes and preferences."""

import hashlib
import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import JobSearchProfile, Resume, User
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.schema import ResumeData
from orbit_api.transactions import lock_account
from orbit_api.workflow_ai import preview

from .candidate_identity import CandidateIdentity, IdentityIn, change_identity, identity
from .profile import JobPrefs
from .routes import _profile_out

router = APIRouter(prefix="/v1/jobs/launchpad", tags=["career planning"],
    dependencies=[Depends(limit_user("career-launchpad", rate_per_s=1, burst=20))])
Stage = Literal["fresher", "change", "experienced"]


def resume_facts(raw: dict[str, Any]) -> list[dict[str, str]]:
    """Use visible career evidence only. Omit names, contact fields, links and hidden sections."""
    data = ResumeData.model_validate(raw).visible()
    sections = [
        ("Skill", [item for group in data.skills for item in group.items], 10),
        ("Project", [text for p in data.projects for text in [p.name, p.description, *p.bullets]], 10),
        ("Education", [text for e in data.education for text in [e.degree, e.field, e.details]], 6),
        ("Experience", [text for e in data.experience for text in [e.title, *e.bullets]], 10),
        ("Certification", [c.name for c in data.certifications], 4),
    ]
    # A long skills list must not crowd projects, education and real experience out of the AI context.
    lines = [(label, text.strip()[:600]) for label, texts, cap in sections
             for text in [t for t in texts if t.strip()][:cap]]
    return [{"id": str(i), "label": label, "text": text} for i, (label, text) in enumerate(lines)]


async def snapshot(db: AsyncSession, user: User, resume_id: str | None) -> dict[str, Any]:
    row = await db.get(JobSearchProfile, user.id, populate_existing=True)
    resumes = list(await db.scalars(select(Resume).where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id).execution_options(populate_existing=True)))
    wanted = resume_id or (row.resume_id if row else None)
    selected = next((r for r in resumes if r.id == wanted), None) if wanted else next(iter(resumes), None)
    if wanted and selected is None:
        raise HTTPException(404, "Resume not found. Choose one of your resumes.")
    prefs = JobPrefs.model_validate(row.prefs or {}) if row else JobPrefs()
    material = {"prefs": prefs.model_dump(mode="json"), "saved": row is not None,
                "profile_resume": row.resume_id if row else None,
                "resume_id": selected.id if selected else None, "data": selected.data if selected else None}
    return {"version": hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest(),
            "prefs": material["prefs"], "resume_id": material["resume_id"],
            "profile_resume_id": material["profile_resume"],
            "resumes": [{"id": r.id, "title": r.title} for r in resumes],
            "facts": resume_facts(selected.data or {}) if selected else []}


class ContextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(min_length=64, max_length=64)
    resume_id: str | None = Field(None, max_length=36)
    stage: Stage


class IdeasIn(ContextIn):
    target: str = Field("", max_length=80)


class Idea(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=2, max_length=80)
    fact_id: str = Field(min_length=1, max_length=8)
    source_quote: str = Field(min_length=1, max_length=600)
    reason: str = Field(min_length=10, max_length=400)
    experiment: str = Field(min_length=10, max_length=400)
    check: str = Field(min_length=10, max_length=300)


class Ideas(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roles: list[Idea] = Field(min_length=1, max_length=3)


class SearchIn(ContextIn):
    title: str = Field(min_length=2, max_length=80)
    location: str = Field("", max_length=120)
    include_internships: bool = False

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError("Enter a job title of at least two characters, on one line.")
        return value


async def checked(db: AsyncSession, user: User, body: ContextIn) -> dict[str, Any]:
    source = await snapshot(db, user, body.resume_id)
    if source["version"] != body.version:
        raise HTTPException(409, "Your resume or search settings changed. Refresh the launchpad before continuing.")
    return source


@router.get("")
async def context(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                  resume_id: Annotated[str | None, Query(max_length=36)] = None) -> dict[str, Any]:
    return await snapshot(db, user, resume_id)


@router.get("/identity", response_model=CandidateIdentity)
async def get_identity(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> CandidateIdentity:
    return await identity(db, user)


@router.put("/identity", response_model=CandidateIdentity)
async def save_identity(body: IdentityIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> CandidateIdentity:
    return await change_identity(db, user, body)


@router.post("/ideas")
async def ideas(body: IdeasIn, user: Annotated[User, Depends(require_verified_email)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    source = await checked(db, user, body)
    facts = {f["id"]: f["text"] for f in source["facts"]}
    if not facts:
        raise HTTPException(422, "Add real education, skills or project details to your resume first, "
                            "or choose a role yourself.")

    def validate(raw: Any) -> Ideas:
        result = Ideas.model_validate(raw)
        seen: set[str] = set()
        for role in result.roles:
            if role.fact_id not in facts or role.source_quote != facts[role.fact_id]:
                raise ValueError("Role idea must quote a supplied resume fact exactly.")
            key = role.title.strip().casefold()
            if not key or key in seen:
                raise ValueError("Role ideas must have distinct titles.")
            seen.add(key)
        return result

    result, provider = await preview(db, user, "career_launchpad",
        'Suggest 1 to 3 realistic job titles to EXPLORE using only supplied resume facts and the chosen career stage. '
        'Do not treat projects or education as paid experience. For freshers prefer graduate, trainee or internship '
        'roles. For career changes distinguish transferable evidence from experience still needed. No readiness '
        'scores, hiring guarantees, invented qualifications, live vacancies or claims about market demand. '
        'A target is a preference, not evidence. Each role needs the complete exact source_quote from its fact_id, '
        'a cautious reason, a small future learning/project experiment and an observable check of that experiment. '
        'Experiments are proposed future work, never claims for a resume. Return JSON only: '
        '{"roles":[{"title":"...","fact_id":"...","source_quote":"...","reason":"...",'
        '"experiment":"...","check":"..."}]}.',
        json.dumps({"facts": source["facts"], "stage": body.stage, "target": body.target}), validate)
    await checked(db, user, body)
    return {**result.model_dump(), "source": provider, "version": source["version"]}


def search_prefs(current: JobPrefs, body: SearchIn) -> JobPrefs:
    patch: dict[str, Any] = {"titles": [body.title]}
    if body.location.strip():
        patch["locations"] = [body.location.strip()]
    if body.stage == "fresher":
        patch.update(level="fresher", years=0, job_types=["full_time", "internship"]
                     if body.include_internships else ["full_time"])
    else:
        # Empty means the standard types; toggling internships must not narrow it to internships only.
        standard = ["full_time", "part_time", "contract"]
        types = [kind for kind in (current.job_types or standard) if kind != "internship"] or standard
        patch["job_types"] = list(dict.fromkeys([*types, *(["internship"] if body.include_internships else [])]))
    return JobPrefs.model_validate({**current.model_dump(), **patch})


@router.post("/search")
async def save_search(request: Request, body: SearchIn, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    await lock_account(db, user.id)
    if body.resume_id:
        await db.execute(select(Resume.id).where(Resume.id == body.resume_id, Resume.user_id == user.id)
                         .with_for_update())
    source = await checked(db, user, body)
    prefs = search_prefs(JobPrefs.model_validate(source["prefs"]), body)
    row = await db.get(JobSearchProfile, user.id, populate_existing=True)
    if row is None:
        row = JobSearchProfile(user_id=user.id)
        db.add(row)
    row.prefs, row.resume_id = prefs.model_dump(mode="json"), source["resume_id"]
    await db.flush()
    resume = await db.get(Resume, row.resume_id) if row.resume_id else None
    profile = await _profile_out(db, user, row, prefs, resume, request=request)
    context = await snapshot(db, user, source["resume_id"])
    await db.commit()
    return {"profile": profile, "context": context}
