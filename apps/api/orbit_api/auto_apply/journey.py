"""Account-scoped progress from resume to application outcomes."""
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.auto_apply import handoff, hosted, planner, rules
from orbit_api.auto_apply.pacing import aware
from orbit_api.db import get_db
from orbit_api.job_portal.action_priority import attention_packets
from orbit_api.models import ApplicationPacket, AutoApplySetup, JobApplication, JobSearchProfile, Resume, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/apply", tags=["career journey"])


@router.get("/journey", dependencies=[Depends(limit_user("apply-journey", rate_per_s=1, burst=20))])
async def journey(user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    if await handoff.hand_off_unsendable(db, datetime.now(UTC), user.id):
        await db.commit()
    resumes = int(await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id)) or 0)
    setup = await db.get(AutoApplySetup, user.id)
    approved = (await planner.master_resume(db, setup))[2] if setup else False
    consented = bool(setup and setup.consent_at and setup.consent_version == rules.CONSENT_VERSION)
    hosted_online = await hosted.online(db)
    browser_seen = aware(setup.executor_seen_at) if setup else None
    executor_ready = bool(setup and ((setup.execution == "hosted" and setup.hosted_consent_at and hosted_online)
        or (setup.execution != "hosted" and browser_seen and browser_seen > datetime.now(UTC) - timedelta(minutes=10))))
    profile = await db.get(JobSearchProfile, user.id)
    packets = Counter({s: n for s, n in await db.execute(select(ApplicationPacket.status, func.count())
        .where(ApplicationPacket.user_id == user.id).group_by(ApplicationPacket.status))})
    tracker = Counter({s: n for s, n in await db.execute(select(JobApplication.status, func.count())
        .where(JobApplication.user_id == user.id).group_by(JobApplication.status))})
    definitions = [
        ("resume", "Add or build your resume", resumes > 0, "/resume-ai",
         "Upload a resume or build one from your real experience. Review its facts before using it."),
        ("search", "Confirm your job search", profile is not None, "/jobs/profile",
         "Jobs matches your resume to roles, locations and work arrangements you choose."),
        ("approve", "Approve your resume and answers", approved, "/jobs/auto-apply",
         "Confirm the resume, contact facts and reusable answers Orbit may share."),
        ("activate", "Turn on automatic applications", consented and not bool(setup and setup.paused),
         "/jobs/auto-apply",
         "Choose automatic or review mode, set your limits and quiet hours, and authorise applications."),
        ("execution", "Choose how applications are sent", consented and (executor_ready or not hosted.enabled()),
         "/jobs/auto-apply",
         "Where Orbit's hosted applying is on, it sends supported employer forms for you, even with Orbit closed. "
         "Otherwise each approved application waits in Needs you with its answers and tailored resume ready to send."),
        ("applications", "Follow applications and resolve blockers", any(n for s, n in tracker.items() if s != "saved"),
         "/jobs/applications",
         "See receipts, answer missing questions once, and monitor employer updates."),
        ("interview", "Prepare for real interviews", any(tracker[s] for s in ("interviewing", "offer", "hired")),
         "/jobs/tracker", "Open employer updates and prepare for that role with personal Saba practice."),
        ("hired", "Review offers and confirm your next role", bool(tracker["hired"]), "/jobs/tracker",
         "Review terms with the employer. Hiring outcomes come from their process, not an Orbit prediction."),
    ]
    steps = [{"id": i, "title": title, "done": done, "href": href, "detail": detail}
             for i, title, done, href, detail in definitions]
    return {"steps": steps, "next_step": "hired" if tracker["hired"] else next(
            (s["id"] for s in steps if not s["done"]), "hired"),
        "packets": dict(packets), "tracker": dict(tracker), "paused": bool(setup and setup.paused),
        "needs_attention": int(await db.scalar(
            select(func.count()).select_from(attention_packets(user.id).subquery())) or 0),
        "email_verified": user.email_verified, "execution": setup.execution if setup else "browser",
        "hosted_online": hosted_online, "executor_ready": executor_ready}
