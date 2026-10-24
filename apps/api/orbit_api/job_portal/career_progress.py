"""Owned, recorded career signals and an optional grounded next-step plan. Never changes candidate facts."""
import hashlib
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import JobApplication, Resume, User
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.schema import ResumeData
from orbit_api.workflow_advice import INSTRUCTION, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

from .action_priority import attention_packets
from .actions import queue
from .candidate_identity import identity
from .launchpad import snapshot

router = APIRouter(prefix="/v1/jobs/launchpad", tags=["career planning"],
    dependencies=[Depends(limit_user("career-progress", rate_per_s=1, burst=20))])


def resume_checks(raw: dict[str, Any], resume_id: str) -> list[dict[str, Any]]:
    data = ResumeData.model_validate(raw).visible()
    base = f"/resume-ai/{resume_id}?guide=1&section="
    checks = [
        ("basics", "Contact details", bool(data.basics.name.strip() and data.basics.email.strip()),
         "Name and email fields contain text. Check that the address is correct."),
        ("education", "Education", any(e.degree.strip() or e.field.strip() for e in data.education),
         "Education details are present. Use your actual course and dates."),
        ("projects", "Projects", any(p.name.strip() and (p.description.strip() or any(b.strip() for b in p.bullets))
                                     for p in data.projects), "A named project has a description or bullet."),
        ("experience", "Work experience", any(e.title.strip() and any(b.strip() for b in e.bullets)
                                             for e in data.experience), "A work role has a title and description."),
        ("skills", "Skills", any(i.strip() for g in data.skills for i in g.items), "Skill fields contain text."),
        ("summary", "Summary", bool(data.basics.summary.strip()),
         "A summary is present; check that every claim is true."),
    ]
    return [{"id": key, "label": label, "present": present, "path": base + key,
             "text": detail if present else f"No visible {label.lower()} details recorded in this resume."}
            for key, label, present, detail in checks]


async def progress(db: AsyncSession, user: User, resume_id: str | None) -> dict[str, Any]:
    candidate = await identity(db, user)
    source = await snapshot(db, user, resume_id or (candidate.master.id if candidate.master else None))
    resume = await db.get(Resume, source["resume_id"], populate_existing=True) if source["resume_id"] else None
    checks = resume_checks(resume.data or {}, resume.id) if resume else []
    stages = {state: count for state, count in await db.execute(select(JobApplication.status, func.count())
        .where(JobApplication.user_id == user.id).group_by(JobApplication.status))}
    attention = int(await db.scalar(select(func.count()).select_from(attention_packets(user.id).subquery())) or 0)
    interview_id = await db.scalar(select(JobApplication.id).where(
        JobApplication.user_id == user.id, JobApplication.status == "interviewing")
        .order_by(JobApplication.status_at.desc(), JobApplication.id).limit(1))
    has_search = bool(source["prefs"]["titles"]) and source["profile_resume_id"] == source["resume_id"]
    search_path = "/jobs?start=1" + (f"&resume_id={resume.id}" if resume else "")
    selected_reviewed = bool(candidate.review == "reviewed" and candidate.master
                             and resume and candidate.master.id == resume.id)
    resume_fact = ("The candidate reviewed the current master resume version." if selected_reviewed else
                   "A saved resume is available. Its facts still need candidate review.")
    facts = [{"id": "resume", "label": "Selected resume", "path": "/career",
              "text": resume_fact if resume else "No resume is selected. You can build or import one."}]
    facts.extend({"id": c["id"], "label": c["label"], "text": c["text"], "path": c["path"]} for c in checks)
    facts.extend([
        {"id": "search", "label": "Search direction", "path": search_path,
         "text": "Target roles are recorded in search preferences." if has_search else
                 "Review target roles and which resume your search should use."},
        {"id": "attention", "label": "Application review", "path": "/jobs/applications",
         "text": f"{attention} prepared applications currently require candidate review or input."},
        {"id": "interviews", "label": "Interviews",
         "path": f"/jobs/mission/{interview_id}?tab=plan" if interview_id else "/jobs/tracker",
         "text": f"{stages.get('interviewing', 0)} jobs are marked interviewing in your own tracker."},
        {"id": "outcomes", "label": "Recorded outcomes", "path": "/jobs/tracker",
         "text": f"Your tracker records {stages.get('offer', 0)} offer and {stages.get('hired', 0)} hired stages. "
                 "These are recorded stages, not independently verified employer confirmations."},
    ])
    by_id = {f["id"]: f for f in facts}
    actions = await queue(db, user)
    # A suggestion (the contact finder for a fresh application) is offered on Today but isn't a saved action, so it
    # never becomes the plan's next step ahead of the candidate's own setup.
    saved = [item for item in actions["items"] if item.get("rule") != "find_contacts"]
    focus = next((item for item in saved if item["id"] == actions["focus_id"]), saved[0] if saved else None)
    if focus:
        # Reuse the action desk's priority and owned links, but only send static explanations to the model.
        # Job/contact names, company details and notes are deliberately excluded from plan facts.
        scheduled = {"id": "scheduled", "label": "Next saved action", "path": focus["path"],
                     "text": focus["priority_reason"]}
        facts.insert(0, scheduled)
        by_id["scheduled"] = scheduled
        next_id, action = "scheduled", focus["action_label"]
    elif attention:
        next_id, action = "attention", "Review applications needing input"
    elif stages.get("interviewing"):
        next_id, action = "interviews", "Prepare for recorded interviews"
    elif stages.get("offer") or stages.get("hired"):
        next_id, action = "outcomes", "Review your recorded outcomes"
    elif not resume:
        next_id, action = "resume", "Add or import a resume"
    elif candidate.review != "reviewed" and (not resume_id or
                                            (candidate.master and candidate.master.id == resume_id)):
        next_id, action = "resume", ("Choose your master resume" if not candidate.master
                                    else "Review your master resume")
    elif not checks[0]["present"]:
        next_id, action = "basics", "Review your contact details"
    elif not has_search:
        next_id, action = "search", "Choose your search direction"
    else:
        next_id, action = "search", "Explore matching jobs"
    next_step = {**by_id[next_id], "action": action}
    if action == "Explore matching jobs":
        next_step["path"] = "/jobs/matches"
    material = {"source": source["version"], "identity": candidate.version,
                "facts": facts, "next_step": next_step, "stages": stages, "attention": attention,
                "actions": actions["version"]}
    return {"version": hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest(),
        "resume_id": source["resume_id"], "resumes": source["resumes"], "checks": checks, "facts": facts,
        "next_step": next_step, "tracker": stages, "identity": candidate.model_dump(mode="json"),
        "activity": {"count": len(actions["items"]), "truncated": actions["truncated"],
                     "next_at": focus["due_at"] if focus else None,
                     "items": [{key: item[key] for key in ("id", "title", "path", "due_at", "action_label",
                                                            "priority_reason")} for item in actions["items"][:5]]}}


@router.get("/progress")
async def get_progress(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                       resume_id: Annotated[str | None, Query(max_length=36)] = None) -> dict[str, Any]:
    return await progress(db, user, resume_id)


class PlanIn(AdviceIn):
    resume_id: str | None = Field(None, max_length=36)


@router.post("/plan")
async def plan(body: PlanIn, user: Annotated[User, Depends(require_verified_email)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    source = await progress(db, user, body.resume_id)
    if body.version != source["version"]:
        raise HTTPException(409, "Your resume or career activity changed. Refresh before planning.")
    result, provider = await preview(db, user, "career_next_step_plan", INSTRUCTION +
        'Help a candidate choose a small next step from recorded resume fields and career activity. '
        'A populated field is not proof of quality, eligibility or employability. Work experience is optional for '
        'freshers; education and real projects are valid starting evidence. Never suggest fabricated experience, '
        'skills or achievements. Do not instruct the user to enable mass applying or bypass employer checks. '
        'Prioritize applications needing review and recorded interviews when present. Respect candidate review. '
        'When a next saved action is supplied, explain that action first using its recorded priority. '
        'Hired/offer tracker stages are self-reports. Never promise hiring or claim an action was completed.',
        json.dumps({"facts": source["facts"]}), lambda raw: validate_advice(raw, source["facts"]))
    if (await progress(db, user, body.resume_id))["version"] != body.version:
        raise HTTPException(409, "Your career activity changed while planning. Refresh to use the latest records.")
    facts = {f["id"]: f for f in source["facts"]}
    return {"source": provider, "version": body.version, "tips": [
        {**tip.model_dump(), "path": facts[tip.fact_id]["path"], "label": facts[tip.fact_id]["label"]}
        for tip in result.tips]}
