"""What's working: how applications did by the resume sent, and tailored versus general, from the tracker alone.

Each applied job's resume (`JobApplication.resume_id`) is traced to the resume it was made from: a job copy names its
source (`prep_context.source_resume_id`, resume_binding.py) or carries its title ("<source> · <job>", the tailoring
queue's copies). A copy with a job post attached counts as tailored. Outcomes are what the candidate recorded: heard
back is any move past applied (interviewing, offer, hired, rejected); interviews are interviewing, offer or hired.
Pattern from career-ops' and Huntr's funnel stats, split by resume as A/B-minded job seekers do. Groups under
`MIN_SAMPLE` applications are shown as too few to compare; nothing here is a prediction.
"""

from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import JobApplication, Resume, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/resume-performance", tags=["jobs"],
                   dependencies=[Depends(limit_user("resume-performance", rate_per_s=1, burst=10))])
MIN_SAMPLE = 5
HEARD = ("interviewing", "offer", "hired", "rejected")
INTERVIEWS = ("interviewing", "offer", "hired")


def _stats(rows: list[JobApplication]) -> dict[str, Any]:
    applied = len(rows)
    heard = sum(r.status in HEARD for r in rows)
    interviews = sum(r.status in INTERVIEWS for r in rows)
    enough = applied >= MIN_SAMPLE
    return {"applied": applied, "heard_back": heard, "interviews": interviews, "enough": enough,
            "response_rate": round(100 * heard / applied) if enough else None,
            "interview_rate": round(100 * interviews / applied) if enough else None}


@router.get("")
async def resume_performance(user: Annotated[User, Depends(current_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    applied = list(await db.scalars(select(JobApplication).where(
        JobApplication.user_id == user.id, JobApplication.applied_at.is_not(None)).limit(2000)))
    resumes = {r.id: r for r in await db.scalars(select(Resume).where(Resume.user_id == user.id))}
    by_title = {r.title: r for r in resumes.values()}

    def source(r: Resume) -> Resume:
        named = (r.prep_context or {}).get("source_resume_id")
        if named in resumes:
            return resumes[named]
        head = r.title.split(" · ")[0]
        return by_title.get(head, r) if " · " in r.title else r

    groups: dict[str, list[JobApplication]] = defaultdict(list)
    names: dict[str, str] = {}
    tailored: list[JobApplication] = []
    general: list[JobApplication] = []
    unknown: list[JobApplication] = []
    for job in applied:
        resume = resumes.get(job.resume_id or "")
        if resume is None:
            unknown.append(job)
            continue
        base = source(resume)
        groups[base.id].append(job)
        names[base.id] = base.title
        (tailored if (resume.job_text or base.id != resume.id) else general).append(job)
    by_resume = sorted(({"resume_id": rid, "title": names[rid], **_stats(rows)} for rid, rows in groups.items()),
                       key=lambda g: -g["applied"])
    return {"applied": len(applied), "min_sample": MIN_SAMPLE, "by_resume": by_resume[:8],
            "tailored": _stats(tailored), "general": _stats(general), "no_resume_recorded": len(unknown)}
