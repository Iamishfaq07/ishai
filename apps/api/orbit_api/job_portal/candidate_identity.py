"""One projection over owned resumes and existing preferences; no shadow candidate-facts store."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import CareerPreparation, JobApplication, JobSearchProfile, Resume, User
from orbit_api.resumes.schema import ResumeData
from orbit_api.transactions import lock_account

from .profile import JobPrefs
from .resume_lineage import digest, parts


class IdentityResume(BaseModel):
    id: str
    title: str
    revision: int
    job_specific: bool


class CandidateIdentity(BaseModel):
    version: str
    master: IdentityResume | None
    resumes: list[IdentityResume]
    review: Literal["not_selected", "missing", "needs_review", "reviewed", "job_copy"]
    reviewed_at: str | None
    name: str
    headline: str
    skills: list[str]
    education_count: int
    project_count: int
    experience_count: int
    target_roles: list[str]
    locations: list[str]
    workplace: list[str]
    search_uses_master: bool


async def job_resume_ids(db: AsyncSession, user_id: str) -> set[str]:
    linked = await db.scalars(select(JobApplication.resume_id).where(JobApplication.user_id == user_id,
                                                                    JobApplication.resume_id.is_not(None)))
    prepared = await db.scalars(select(CareerPreparation.resume_id).where(CareerPreparation.user_id == user_id,
                                                                         CareerPreparation.resume_id.is_not(None)))
    return {ident for ident in [*linked, *prepared] if ident is not None}


def reviewed(profile: JobSearchProfile | None, resume: Resume | None) -> bool:
    proof = profile.career_identity or {} if profile else {}
    return bool(resume and proof.get("resume_id") == resume.id
                and proof.get("revision") == resume.revision and proof.get("fingerprint") == digest(parts(resume))
                and proof.get("reviewed_at"))


async def identity(db: AsyncSession, user: User) -> CandidateIdentity:
    profile = await db.get(JobSearchProfile, user.id, populate_existing=True)
    resumes = list(await db.scalars(select(Resume).where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id).execution_options(populate_existing=True)))
    copies = await job_resume_ids(db, user.id)
    proof = profile.career_identity or {} if profile else {}
    master = next((resume for resume in resumes if resume.id == proof.get("resume_id")), None)
    prefs = JobPrefs.model_validate(profile.prefs or {}) if profile else JobPrefs()
    data = ResumeData.model_validate(master.data or {}).visible() if master else ResumeData()
    summaries = [IdentityResume(id=resume.id, title=resume.title, revision=resume.revision or 0,
                               job_specific=resume.id in copies) for resume in resumes]
    state: Literal["not_selected", "missing", "needs_review", "reviewed", "job_copy"] = "not_selected"
    if proof.get("resume_id"):
        state = "missing" if not master else "job_copy" if master.id in copies else (
            "reviewed" if reviewed(profile, master) else "needs_review")
    return CandidateIdentity(version=digest({"profile": proof, "prefs": prefs.model_dump(),
        "search_resume": profile.resume_id if profile else None,
        "resumes": [[resume.id, resume.revision, digest(parts(resume))] for resume in resumes],
        "copies": sorted(copies)}),
        master=next((resume for resume in summaries if master and resume.id == master.id), None),
        resumes=summaries, review=state, reviewed_at=proof.get("reviewed_at") if state == "reviewed" else None,
        name=data.basics.name, headline=data.basics.headline,
        skills=[skill for group in data.skills for skill in group.items if skill.strip()][:16],
        education_count=len(data.education), project_count=len(data.projects), experience_count=len(data.experience),
        target_roles=prefs.titles, locations=prefs.locations, workplace=list(prefs.workplace),
        search_uses_master=bool(profile and master and profile.resume_id == master.id))


class IdentityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(pattern=r"^[0-9a-f]{64}$")
    action: Literal["select", "approve", "revoke"]
    resume_id: str = Field(min_length=1, max_length=36)
    resume_revision: int = Field(ge=0)
    independent_copy: bool = False


async def change_identity(db: AsyncSession, user: User, body: IdentityIn) -> CandidateIdentity:
    await lock_account(db, user.id)
    resume = await db.scalar(select(Resume).where(Resume.id == body.resume_id, Resume.user_id == user.id)
                             .with_for_update().execution_options(populate_existing=True))
    if resume is None:
        raise HTTPException(404, "Resume not found")
    current = await identity(db, user)
    if current.version != body.version or resume.revision != body.resume_revision:
        raise HTTPException(409, "Your resume or career settings changed. Refresh and review the current version.")
    profile = await db.get(JobSearchProfile, user.id, populate_existing=True)
    if profile is None:
        profile = JobSearchProfile(user_id=user.id, prefs={})
        db.add(profile)
    proof = dict(profile.career_identity or {})
    if body.action == "select":
        selected = next(item for item in current.resumes if item.id == resume.id)
        if selected.job_specific:
            if not body.independent_copy:
                raise HTTPException(409, "This resume belongs to a job. Create an independent master copy first.")
            from orbit_api.resumes.routes import MAX_RESUMES

            count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
            if (count or 0) >= MAX_RESUMES:
                raise HTTPException(409, "Your resume limit is reached. Delete an unused resume before making a copy.")
            source = resume
            resume = Resume(user_id=user.id, title=f"Master — {source.title}"[:160], data=dict(source.data or {}),
                            design=dict(source.design or {}), job_text="", cover_letter="")
            db.add(resume)
            await db.flush()
            proof = {"source_resume_id": source.id, "source_revision": source.revision}
        elif proof.get("resume_id") != resume.id:
            proof = {}
        profile.resume_id = resume.id  # Explicit selection also sets the starting resume for Discover.
        profile.career_identity = {**proof, "resume_id": resume.id}
    else:
        if not current.master or current.master.id != resume.id:
            raise HTTPException(409, "Choose this resume as your master before reviewing it.")
        if body.action == "approve":
            if current.master.job_specific:
                raise HTTPException(409, "Create an independent master copy before confirming a job-specific resume.")
            profile.career_identity = {**proof, "resume_id": resume.id, "revision": resume.revision,
                "fingerprint": digest(parts(resume)), "reviewed_at": datetime.now(UTC).isoformat()}
        else:
            profile.career_identity = {key: value for key, value in proof.items()
                                       if key not in ("reviewed_at", "fingerprint", "revision")}
    await db.commit()
    return await identity(db, user)
