"""What's working: how applications did by the resume sent, and tailored versus general, from the tracker alone.

Each applied job's resume (`JobApplication.resume_id`) is traced to the resume it was made from: a job copy names its
source (`prep_context.source_resume_id`, resume_binding.py) or carries its title ("<source> · <job>", the tailoring
queue's copies). A copy with a job post attached counts as tailored. Outcomes are what the candidate recorded: heard
back includes recorded interviewing, offer, hired or rejected stages; interviews include recorded progression
or completed employer rounds, even if the current status is rejected. Earlier unrecorded history remains unknown.
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
from orbit_api.models import ApplicationStageEvent, GmailAttempt, JobApplication, JobInterviewRound, Resume, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/resume-performance", tags=["jobs"],
                   dependencies=[Depends(limit_user("resume-performance", rate_per_s=1, burst=10))])
MIN_SAMPLE = 5
HEARD = ("interviewing", "offer", "hired", "rejected")
INTERVIEWS = ("interviewing", "offer", "hired")


def _stats(rows: list[JobApplication], history: dict[str, set[str]] | None = None) -> dict[str, Any]:
    applied = len(rows)
    history = history or {}
    heard = sum(bool(({r.status} | history.get(r.id, set())) & set(HEARD)) for r in rows)
    interviews = sum(bool(({r.status} | history.get(r.id, set())) & set(INTERVIEWS)) for r in rows)
    enough = applied >= MIN_SAMPLE
    return {"applied": applied, "heard_back": heard, "interviews": interviews, "enough": enough,
            "response_rate": round(100 * heard / applied) if enough else None,
            "interview_rate": round(100 * interviews / applied) if enough else None}


@router.get("")
async def resume_performance(user: Annotated[User, Depends(current_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    applied = list(await db.scalars(select(JobApplication).where(
        JobApplication.user_id == user.id, JobApplication.applied_at.is_not(None)).limit(2000)))
    history: dict[str, set[str]] = defaultdict(set)
    ids = [r.id for r in applied]
    for offset in range(0, len(ids), 400):
        subset = ids[offset:offset + 400]
        for event_row in await db.scalars(select(ApplicationStageEvent).where(
                ApplicationStageEvent.user_id == user.id, ApplicationStageEvent.application_id.in_(subset))):
            history[event_row.application_id].add(event_row.to_status)
        for completed in await db.scalars(select(JobInterviewRound).where(
                JobInterviewRound.user_id == user.id, JobInterviewRound.application_id.in_(subset),
                JobInterviewRound.status == "completed")):
            history[completed.application_id].add("interviewing")
    resumes = {r.id: r for r in await db.scalars(select(Resume).where(Resume.user_id == user.id))}
    submitted = {r.application_id: r.data["tailoring"] for r in await db.scalars(select(GmailAttempt).where(
        GmailAttempt.user_id == user.id, GmailAttempt.status == "sent")) if r.data.get("tailoring")}
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
        actual = submitted.get(job.id)
        resume = resumes.get(actual.get("resume_id", "") if actual else (job.resume_id or ""))
        if resume is None:
            unknown.append(job)
            continue
        base = source(resume)
        groups[base.id].append(job)
        names[base.id] = base.title
        (tailored if (actual or resume.job_text or base.id != resume.id) else general).append(job)
    by_resume = sorted(({"resume_id": rid, "title": names[rid], **_stats(rows, history)}
                        for rid, rows in groups.items()),
                       key=lambda g: -g["applied"])
    return {"applied": len(applied), "min_sample": MIN_SAMPLE, "by_resume": by_resume[:8],
            "tailored": _stats(tailored, history), "general": _stats(general, history),
            "no_resume_recorded": len(unknown)}
