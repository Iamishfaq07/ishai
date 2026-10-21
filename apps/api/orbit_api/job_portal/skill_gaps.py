"""Skills your shortlist keeps asking for: one view across every job you are tracking, not one job at a time.

Read from the skills each tracked job's post asks for (`JobListing.keywords`, read once at fetch time) and checked
against the resume the job search uses plus the skills listed in the profile, with the same matcher the feed uses
(skills.py). Pattern from open-source job-search agents that compare a CV against many postings at once
(docs/PERSONAL_WORKFLOW_RESEARCH_2026_10.md). No AI request and nothing stored: a missing skill means the resume
doesn't show it, not that the candidate lacks it, so the page offers both "add evidence" and "learn it".
"""

from collections import Counter
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.action_priority import TERMINAL_JOBS
from orbit_api.job_portal.skills import display, resume_matcher, same_skill
from orbit_api.models import JobApplication, JobListing, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/skill-gaps", tags=["jobs"],
                   dependencies=[Depends(limit_user("skill-gaps", rate_per_s=1, burst=10))])
MAX_JOBS = 200
TOP = 12


@router.get("")
async def skill_gaps(user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    from orbit_api.job_portal.routes import _data, _profile

    _, prefs, resume = await _profile(db, user)
    matcher = resume_matcher(_data(resume), list(prefs.skills))
    rows = (await db.execute(select(JobApplication, JobListing.keywords)
        .join(JobListing, JobListing.id == JobApplication.listing_id)
        .where(JobApplication.user_id == user.id, JobApplication.status.not_in(TERMINAL_JOBS))
        .order_by(JobApplication.status_at.desc()).limit(MAX_JOBS))).all()
    asked: Counter[str] = Counter()
    names: dict[str, str] = {}
    examples: dict[str, list[dict[str, str]]] = {}
    jobs = 0
    for job, keywords in rows:
        if not keywords:
            continue
        jobs += 1
        for term in {same_skill(k): k for k in keywords}.values():
            key = same_skill(term)
            asked[key] += 1
            names.setdefault(key, display(term))
            if len(examples.setdefault(key, [])) < 3:
                examples[key].append({"id": job.id, "title": job.title, "company": job.company})
    shown = {key for key in asked if matcher.has(names[key])}
    ranked = sorted(asked, key=lambda k: (-asked[k], names[k].lower()))
    def item(key: str) -> dict[str, Any]:
        return {"skill": names[key], "jobs": asked[key], "examples": examples[key]}
    total = sum(asked.values())
    return {
        "jobs": jobs, "resume": resume.title if resume else None, "has_resume": bool(resume and not matcher.empty),
        "coverage": round(100 * sum(asked[k] for k in shown) / total) if total else None,
        "missing": [item(k) for k in ranked if k not in shown][:TOP],
        "shown": [item(k) for k in ranked if k in shown][:TOP],
    }
