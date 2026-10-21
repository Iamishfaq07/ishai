"""Protect an explicitly selected master and independent opportunity copies when linking materials."""
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import Document, JobApplication, JobListing, JobSearchProfile, Resume, User


async def needs_copy(db: AsyncSession, user: User, entry: JobApplication, resume: Resume) -> bool:
    profile = await db.get(JobSearchProfile, user.id, populate_existing=True)
    master_id = (profile.career_identity or {}).get("resume_id") if profile else None
    shared = await db.scalar(select(JobApplication.id).where(JobApplication.user_id == user.id,
        JobApplication.resume_id == resume.id, JobApplication.id != entry.id).limit(1))
    return master_id == resume.id or bool(shared)


async def for_job(db: AsyncSession, user: User, entry: JobApplication, resume: Resume) -> Resume:
    if not await needs_copy(db, user, entry, resume):
        return resume
    from orbit_api.resumes.routes import MAX_RESUMES

    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(409, "A separate job resume is needed. Delete an unused resume to make room.")
    # A selected CV can come from another role; never carry its old JD into this opportunity's editor.
    document = await db.get(Document, entry.document_id) if entry.document_id else None
    listing = await db.get(JobListing, entry.listing_id)
    job_text = (document.source_text if document and document.user_id == user.id else
                (listing.description or listing.snippet) if listing else "") or ""
    copy = Resume(user_id=user.id, title=f"{resume.title} · {entry.company}"[:160],
        data=dict(resume.data or {}), design=dict(resume.design or {}), job_text=job_text[:20000],
        cover_letter="", prep_context={"source_resume_id": resume.id,
            "source_revision": resume.revision, "application_id": entry.id})
    db.add(copy)
    await db.flush()
    return copy
