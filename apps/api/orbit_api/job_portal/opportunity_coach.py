"""Read-only, grounded guidance for one owned opportunity. No application actions are executed."""
import hashlib
import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import ApplicationPacket, JobApplication, JobFitCheck, JobOffer, Resume, ResumeSnapshot, User
from orbit_api.ratelimit import limit_user
from orbit_api.workflow_advice import INSTRUCTION, Advice, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

from .action_priority import attention_packets
from .plan import plan_for
from .resume_lineage import digest, parts, summary as lineage_summary

router = APIRouter(prefix="/v1/jobs/tracker", tags=["opportunity coach"],
    dependencies=[Depends(limit_user("opportunity-coach", rate_per_s=1, burst=20))])
Focus = Literal["resume", "fit", "timeline", "interview", "offer"]


async def source(db: AsyncSession, user: User, entry_id: str, tz_offset: int = 0) -> dict[str, Any]:
    entry = await db.scalar(select(JobApplication).where(JobApplication.id == entry_id,
        JobApplication.user_id == user.id).execution_options(populate_existing=True))
    if entry is None:
        raise HTTPException(404, "Not in your tracker")
    resume = await db.scalar(select(Resume).where(Resume.id == entry.resume_id, Resume.user_id == user.id)
        .execution_options(populate_existing=True)) if entry.resume_id else None
    fit = (await db.execute(select(JobFitCheck.id, JobFitCheck.created_at, JobFitCheck.result).where(
        JobFitCheck.user_id == user.id, JobFitCheck.listing_id == entry.listing_id)
        .order_by(JobFitCheck.created_at.desc(), JobFitCheck.id).limit(1))).first()
    snapshots = (await db.execute(select(func.count(), func.max(ResumeSnapshot.created_at)).where(
        ResumeSnapshot.user_id == user.id, ResumeSnapshot.application_id == entry.id))).one()
    latest_snapshot = await db.scalar(select(ResumeSnapshot).where(ResumeSnapshot.user_id == user.id,
        ResumeSnapshot.application_id == entry.id).order_by(ResumeSnapshot.created_at.desc(), ResumeSnapshot.id)
        .limit(1).execution_options(populate_existing=True))
    lineage = lineage_summary(latest_snapshot, resume) if latest_snapshot else None
    offer = (await db.execute(select(JobOffer.id, JobOffer.updated_at).where(
        JobOffer.user_id == user.id, JobOffer.application_id == entry.id).order_by(JobOffer.id).limit(1))).first()
    packet = await db.scalar(attention_packets(user.id).where(
        (ApplicationPacket.application_id == entry.id) | (ApplicationPacket.listing_id == entry.listing_id))
        .order_by(ApplicationPacket.updated_at, ApplicationPacket.id).limit(1)
        .execution_options(populate_existing=True))
    base = f"/jobs/mission/{entry.id}?guide=1&tab="
    facts = [
        {"id": "resume", "label": "Resume", "path": base + "resume", "text":
         "A resume is linked to this job. Review its current facts before sharing it." if resume else
         "No current owned resume is linked to this job. Choose a resume or build one from your real experience."},
        {"id": "fit", "label": "Fit", "path": base + "fit", "text":
         ("A prior fit check is recorded for this listing. It may have used a different resume; "
          "review its source evidence.") if fit else
         "No fit check is recorded for this listing. Compare the actual requirements with your truthful evidence."},
        {"id": "timeline", "label": "Application",
         "path": f"/jobs/applications?packet={packet.id}" if packet else base + "timeline",
         "text": f"The tracker stage is {entry.status}, as recorded by the candidate or Orbit activity. "
                 f"There are {snapshots[0]} frozen resume versions recorded for this job. " +
                 (f"A prepared application has status {packet.status} and needs candidate review or input."
                  if packet else
                  "No prepared application currently requires candidate review for this job.")},
        {"id": "interview", "label": "Interview", "path": base + "interview", "text":
         "An interview or follow-up date is saved. Check the actual round and time in the interview tool."
         if entry.next_at else
         ("No next interview or follow-up date is saved. Add a real date when the employer confirms it; "
          "practice is available without one.")},
        {"id": "offer", "label": "Outcome", "path": base + "offer", "text":
         ("An offer is linked to this job. Review its recorded terms."
          if offer else "No offer is linked to this job.") +
         f" The recorded tracker stage is {entry.status}. Offer and hired stages are records, "
         "not independently verified employer confirmations."},
    ]
    if lineage is not None and latest_snapshot is not None:
        fact = next(f for f in facts if f["id"] == "resume")
        fact["path"] = base + f"resume&snapshot={latest_snapshot.id}"
        if lineage["content_matches"] is None:
            fact["text"] += " A saved copy exists, but no current owned linked resume is available for comparison."
        elif lineage["content_matches"]:
            fact["text"] += " The latest saved copy matches the linked resume's stored content, design and target text."
        else:
            fact["text"] += (f" The latest saved copy differs from the linked resume in "
                             f"{len(lineage['changed_sections'])} stored sections. Review the comparison before sharing.")
        fact["text"] += " A saved copy is not proof of submission, delivery, verified skills or employer receipt."
    # Requirements are explicitly labelled as prior check material, never as verified candidate skills.
    requirements = fit.result.get("requirements", []) if fit and isinstance(fit.result, dict) else []
    for index, row in enumerate(requirements[:3] if isinstance(requirements, list) else []):
        requirement = " ".join(str(row.get("requirement", "")).split())[:220] if isinstance(row, dict) else ""
        if requirement:
            facts.insert(2 + index, {"id": f"requirement_{index}", "label": "Requirement to explore",
                "path": base + "fit", "text": f"A prior fit check lists this requirement: {requirement}. "
                "Check the original job and current resume; this does not verify a candidate skill."})
    prep = None
    if entry.status in ("saved", "applied", "interviewing"):
        prep = await plan_for(db, user, entry, tz_offset=tz_offset)
        at = prep.interview_at.isoformat() if prep.interview_at else "not available"
        interview = next(fact for fact in facts if fact["id"] == "interview")
        interview["text"] = (
            f"The candidate records a next date at {at}. Verify the original invitation. "
            if prep.mode == "scheduled" else
            "No upcoming interview is assumed. This is a three-day rehearsal plan, not an employer appointment. ")
        interview["text"] += (f"The current browser-day plan (UTC offset {tz_offset} minutes) has "
            f"{prep.done} of {prep.total} tasks checked. {prep.completed_total} completion records remain in this "
            "job's history; earlier preparation is not automatically completed for a new date.")
        for index, task in enumerate([item for day in prep.days for item in day.items if not item.done][:3]):
            facts.append({"id": f"prep_{index}", "label": "Preparation task", "path": base + "plan",
                "text": f"An unchecked task in this job's browser-day preparation plan is: {task.title[:220]}. "
                        "Use truthful evidence. This is suggested practice, not verified employer interview content."})
    material = {"prep": prep.model_dump(mode="json") if prep else None, "tz_offset": tz_offset, "lineage": lineage,
        "entry": [entry.id, str(entry.updated_at), entry.status, str(entry.next_at), entry.resume_id],
        "resume": [resume.id, str(resume.updated_at), digest(parts(resume))] if resume else None,
        "fit": [fit.id, str(fit.created_at), fit.result] if fit else None,
        "snapshots": list(map(str, snapshots)), "offer": list(map(str, offer)) if offer else None,
        "packet": [packet.id, str(packet.updated_at), packet.status] if packet else None, "facts": facts}
    return {"version": hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest(), "facts": facts}


@router.get("/{entry_id}/coach")
async def get_source(entry_id: str, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)], tz_offset: int = 0) -> dict[str, Any]:
    return await source(db, user, entry_id, max(-720, min(840, tz_offset)))


class PlanIn(AdviceIn):
    focus: Focus
    tz_offset: int = Field(0, ge=-720, le=840)


@router.post("/{entry_id}/coach/plan")
async def plan(entry_id: str, body: PlanIn, user: Annotated[User, Depends(require_verified_email)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    current = await source(db, user, entry_id, body.tz_offset)
    if current["version"] != body.version:
        raise HTTPException(409, "This opportunity changed. Refresh before requesting guidance.")
    facts = sorted(current["facts"], key=lambda fact: (fact["id"] != body.focus,
        body.focus == "interview" and not fact["id"].startswith("prep_")))

    def validate(raw: object) -> Advice:
        advice = validate_advice(raw, facts)
        if advice.tips[0].fact_id != body.focus:
            raise ValueError("Explain the selected step first")
        return advice

    result, provider = await preview(db, user, "opportunity_coach", INSTRUCTION +
        "Help a candidate with the selected opportunity step, explaining that fact first. "
        "When saved and current resume versions differ, suggest reviewing the comparison. "
        "You do not have their changed text and must not invent edits or attest to delivery or factual accuracy. "
        "Preparation tasks are suggested practice from the supplied browser-day plan, not employer questions. "
        "A rehearsal plan does not imply an interview date. Completion history is candidate-recorded, not proof "
        "of competence. Suggest reviewing matching earlier work; never mark it complete or claim employer approval. "
        "Do not propose tasks already checked or claim a task has been completed. "
        "Use only the recorded indicators supplied. Do not infer readiness, eligibility, interviews or hiring. "
        "Prior fit checks may use a different resume. Suggest checking source evidence, "
        "not claiming a skill is proved. For supplied requirements, propose truthful evidence to review "
        "or a practice project to build; never tell someone to claim work they have not done. "
        "Work experience is optional for freshers; real projects and education are valid evidence. "
        "Only the candidate can confirm answers, actual submissions, interview dates and offers. "
        "For hired, rejected or withdrawn records, suggest reflection or recording the outcome, not further applying. "
        "Never instruct bypassing employer checks or automatically enabling applications.",
        json.dumps({"focus": body.focus, "facts": facts}), validate)
    if (await source(db, user, entry_id, body.tz_offset))["version"] != body.version:
        raise HTTPException(409, "This opportunity changed while guidance was prepared. Refresh to continue.")
    by_id = {fact["id"]: fact for fact in facts}
    return {"version": body.version, "source": provider, "tips": [
        {**tip.model_dump(), "path": by_id[tip.fact_id]["path"], "label": by_id[tip.fact_id]["label"]}
        for tip in result.tips]}
