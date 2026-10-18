"""Hiring Studio: structured interviews, private drafts, evidence debriefs and two-part work samples."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from orbit_api import ratelimit
from orbit_api.business import emails, hiring, rules
from orbit_api.business.access import CompanyCtx, application_for, audit, job_for, lock_company, timeline
from orbit_api.business.apply import _by_token
from orbit_api.business.hiring_schema import (
    ClarificationIn,
    DecisionIn,
    FeedbackIn,
    HiringPlan,
    PlanIn,
    SampleAnswer,
)
from orbit_api.db import get_db
from orbit_api.documents.uploads import sanitize_text
from orbit_api.models import (
    BizApplication,
    BizEvent,
    BizHiringPlan,
    BizInterview,
    BizInterviewFeedback,
    BizJob,
    BizWorkSample,
)

router = APIRouter(prefix="/v1/business/companies/{company_id}", tags=["business hiring"])
public_router = APIRouter(prefix="/v1/public/business/applications/{token}", tags=["business candidate"])
_writes = ratelimit.SlidingWindow(rate_per_s=30 / 3600, burst=30)


def _conflict() -> HTTPException:
    return HTTPException(409, "This changed in another tab. Reload before saving your edits.")


def _active(app: BizApplication) -> None:
    if app.status != "active" or app.deletion_requested_at is not None:
        raise HTTPException(409, "This application is no longer collecting new interview evidence.")


@router.get("/jobs/{job_id}/hiring-plan")
async def get_plan(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    job = await job_for(db, ctx, job_id, for_interviewer=True)
    return hiring.plan_payload(await db.get(BizHiringPlan, job.id), job)


@router.put("/jobs/{job_id}/hiring-plan")
async def save_plan(job_id: str, body: PlanIn, ctx: CompanyCtx,
                     db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    if not ctx.can("manage_jobs") and ctx.role != "hiring_manager":
        ctx.require("manage_jobs")
    valid_stages = {s["id"] for s in job.stages if s["kind"] not in ("hired", "rejected")}
    if any(c.stage_id not in valid_stages for c in body.plan.criteria):
        raise HTTPException(422, "Each criterion must use an active stage in this job.")
    await lock_company(db, ctx.company.id)
    row = await db.get(BizHiringPlan, job.id, populate_existing=True)
    if (row.revision if row else 0) != body.base_revision:
        raise _conflict()
    if row is None:
        row = BizHiringPlan(job_id=job.id, company_id=ctx.company.id, revision=0, content={})
        db.add(row)
    row.content, row.revision, row.updated_by = body.plan.model_dump(), row.revision + 1, ctx.user.id
    audit(db, ctx.company.id, ctx.user, "hiring.plan_saved", job.title, job_id=job.id, revision=row.revision)
    await db.commit()
    return hiring.plan_payload(row, job)


@router.get("/applications/{application_id}/hiring-room")
async def get_room(application_id: str, ctx: CompanyCtx,
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, job = await application_for(db, ctx, application_id)
    return await hiring.room_payload(db, ctx, app, job)


@router.put("/applications/{application_id}/interview-feedback")
async def save_feedback(application_id: str, body: FeedbackIn, ctx: CompanyCtx,
                          db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    _active(app)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    _active(app)
    row = await db.scalar(select(BizInterviewFeedback).where(
        BizInterviewFeedback.application_id == app.id, BizInterviewFeedback.stage_id == body.stage_id,
        BizInterviewFeedback.author_id == ctx.user.id).execution_options(populate_existing=True))
    content = body.model_dump(exclude={"base_revision", "plan_revision", "stage_id", "submit"})
    if row and row.submitted_at:
        if row.content == content and body.submit:
            return await hiring.room_payload(db, ctx, app, job)
        raise HTTPException(409, "Submitted feedback is sealed. Record further context in the debrief.")
    if (row.revision if row else 0) != body.base_revision:
        raise _conflict()
    plan_row = await db.get(BizHiringPlan, job.id, populate_existing=True)
    if plan_row is None:
        raise HTTPException(409, "The hiring team needs to save an interview plan first.")
    if row is None and body.plan_revision != plan_row.revision:
        raise _conflict()
    if row and row.plan_revision != body.plan_revision:
        raise _conflict()
    plan = HiringPlan.model_validate(row.plan_snapshot if row else plan_row.content)
    criteria = {c.id: c for c in plan.criteria if c.stage_id == body.stage_id}
    if not criteria or len({r.criterion_id for r in body.ratings}) != len(body.ratings):
        raise HTTPException(422, "Use a planned interview stage and different criteria.")
    sample = await db.get(BizWorkSample, app.id)
    for rating in body.ratings:
        if rating.criterion_id not in criteria:
            raise HTTPException(422, "A rating does not belong to this stage's plan.")
        if rating.score is not None and body.submit and len(rating.observation.strip()) < 20:
            raise HTTPException(422, "Support every score with what you actually observed (at least 20 characters).")
        if rating.quote:
            source = app.resume_text if rating.source == "resume" else (
                "\n".join(str(v) for d in ((sample.answer if sample else None), (sample.follow_up if sample else None))
                          if d for v in (d.get("response", ""), d.get("explanation", "")))
                if rating.source == "work_sample" else rating.observation)
            if rating.quote not in source and rating.quote not in hiring.blind_text(ctx, app, source):
                raise HTTPException(422, "An evidence quote must occur verbatim in its stated source.")
    if body.submit and not any(r.score is not None for r in body.ratings):
        raise HTTPException(422, "Assess at least one criterion; leave unobserved criteria unscored.")
    if row is None:
        row = BizInterviewFeedback(company_id=ctx.company.id, application_id=app.id, stage_id=body.stage_id,
            author_id=ctx.user.id, author_name=ctx.actor_name, revision=0,
            plan_revision=plan_row.revision, plan_snapshot=plan_row.content, content={})
        db.add(row)
    row.content, row.revision = content, row.revision + 1
    if body.submit:
        row.submitted_at = datetime.now(UTC)
        timeline(db, app, "feedback_submitted", ctx.user, stage=body.stage_id)
        audit(db, ctx.company.id, ctx.user, "hiring.feedback_submitted", app.reference,
              job_id=job.id, stage=body.stage_id, plan_revision=row.plan_revision)
    await db.commit()
    return await hiring.room_payload(db, ctx, app, job)


@router.post("/applications/{application_id}/hiring-decision")
async def record_decision(application_id: str, body: DecisionIn, ctx: CompanyCtx,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    _active(app)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    _active(app)
    room = await hiring.room_payload(db, ctx, app, job)
    if room["feedback_locked"]:
        raise HTTPException(403, "Submit your independent feedback before opening the panel's decision room.")
    if body.base_evidence_version != room["evidence_version"]:
        raise HTTPException(409, "New interview evidence arrived. Review it before recording a decision.")
    if room["gaps"] and body.outcome in ("hire", "no_hire") and not body.acknowledge_gaps:
        raise HTTPException(422, "Review and acknowledge the evidence gaps before recording a final recommendation.")
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "hiring_decision", BizEvent.actor_id == ctx.user.id).order_by(BizEvent.created_at.desc()))
    if previous and all(previous.data.get(key) == value for key, value in {
            "outcome": body.outcome, "rationale": sanitize_text(body.rationale),
            "evidence_version": room["evidence_version"]}.items()):
        return room
    timeline(db, app, "hiring_decision", ctx.user, outcome=body.outcome, rationale=sanitize_text(body.rationale),
        evidence_version=room["evidence_version"], acknowledged_gaps=room["gaps"] if body.acknowledge_gaps else [])
    audit(db, ctx.company.id, ctx.user, "hiring.decision_recorded", app.reference,
          job_id=job.id, outcome=body.outcome, evidence_version=room["evidence_version"])
    await db.commit()
    return await hiring.room_payload(db, ctx, app, job)


@router.post("/applications/{application_id}/work-sample")
async def assign_sample(application_id: str, ctx: CompanyCtx,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    _active(app)
    if app.email_confirmed_at is None:
        raise HTTPException(409, "Wait for the candidate to confirm their email before assigning a task.")
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    _active(app)
    sample = await db.get(BizWorkSample, app.id)
    if sample is None:
        plan = await db.get(BizHiringPlan, job.id)
        spec = HiringPlan.model_validate(plan.content).work_sample if plan else None
        if plan is None or spec is None:
            raise HTTPException(409, "Add and save a practical challenge in the job's interview plan first.")
        sample = BizWorkSample(application_id=app.id, company_id=ctx.company.id, plan_revision=plan.revision,
                               revision=1, brief=spec.model_dump())
        db.add(sample)
        timeline(db, app, "work_sample_invited", ctx.user)
        audit(db, ctx.company.id, ctx.user, "hiring.sample_assigned", app.reference, job_id=job.id)
        await db.commit()
        token = emails.status_token_for(app)
        link = emails.status_link(token) if token else "Use the application link in your first email from us."
        await emails.send_to_applicant(ctx.company, app, f"Practical challenge: {job.title}",
            f"The hiring team has assigned a practical challenge for {job.title}.\n"
            f"Read the brief, time guidance and submission steps on your application page:\n{link}",
            ctx.user.email)
    return await hiring.room_payload(db, ctx, app, job)


@router.get("/jobs/{job_id}/compare")
async def compare(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)],
                    ids: Annotated[list[str], Query(min_length=2, max_length=4)]) -> dict[str, Any]:
    if ctx.role == "interviewer":
        ctx.require("move_applicants")
    job = await job_for(db, ctx, job_id)
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Choose different applicants.")
    people = []
    for aid in ids:
        app, _ = await application_for(db, ctx, aid)
        if app.job_id != job.id:
            raise HTTPException(404, "Not found.")
        room = await hiring.room_payload(db, ctx, app, job)
        if room["feedback_locked"]:
            raise HTTPException(403, "Submit your feedback before comparing the panel's evidence.")
        people.append({k: room[k] for k in ("application_id", "name", "reference", "coverage", "gaps", "evidence")})
    return {"job_id": job.id, "job_title": job.title, "people": people}


@router.get("/hiring-desk")
async def hiring_desk(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    from orbit_api.business.access import sees_application, sees_job

    jobs = list(await db.scalars(select(BizJob).where(BizJob.company_id == ctx.company.id)))
    allowed = {j.id: j for j in jobs if sees_job(ctx, j) or ctx.role == "interviewer"}
    apps = list(await db.scalars(select(BizApplication).where(BizApplication.job_id.in_(allowed),
        BizApplication.status == "active").order_by(BizApplication.stage_changed_at).limit(2000))) if allowed else []
    limited = len(apps) == 2000
    apps = [a for a in apps if sees_application(ctx, a, allowed[a.job_id])]
    ids = [a.id for a in apps]
    current = datetime.now(UTC)
    newer = aliased(BizInterview)
    superseded = exists(select(newer.id).where(newer.application_id == BizInterview.application_id,
        or_(newer.created_at > BizInterview.created_at,
            and_(newer.created_at == BizInterview.created_at, newer.id > BizInterview.id))))
    interviews = list(await db.scalars(select(BizInterview).where(BizInterview.application_id.in_(ids),
        BizInterview.chosen >= current - timedelta(days=7), ~superseded).order_by(BizInterview.chosen))) if ids else []
    rows = {a.id: a for a in apps}
    feedback = list(await db.scalars(select(BizInterviewFeedback).where(
        BizInterviewFeedback.application_id.in_(ids), BizInterviewFeedback.submitted_at.is_not(None)))) if ids else []
    plans = {p.job_id: p for p in await db.scalars(select(BizHiringPlan).where(BizHiringPlan.job_id.in_(allowed)))}
    attention = []
    questions = list(await db.scalars(select(BizEvent).where(BizEvent.application_id.in_(ids),
        BizEvent.kind.in_(("candidate_question", "email"))).order_by(BizEvent.created_at.desc()))) if ids else []
    last_contact: dict[str, str] = {}
    for event in questions:
        last_contact.setdefault(event.application_id, event.kind)
    for a in apps:
        plan = plans.get(a.job_id)
        target = int((plan.content if plan else {}).get("response_target_days", 3))
        age = max(0, int((current - hiring.aware(a.stage_changed_at)).total_seconds() / 3600))
        if a.deletion_requested_at:
            reason, priority = "Candidate requested data deletion", "urgent"
        elif last_contact.get(a.id) == "candidate_question":
            reason, priority = "Candidate asked a question; reply from their application", "waiting"
        elif age >= target * 24:
            reason, priority = f"No stage change for {age // 24} days", "waiting"
        else:
            continue
        if ctx.role != "interviewer":
            attention.append({"application_id": a.id, "reference": a.reference,
                "name": rules.candidate_label(a.reference) if ctx.company.blind_review else a.name,
                "job_title": allowed[a.job_id].title, "reason": reason, "priority": priority, "hours": age})
    upcoming, due = [], []
    submitted = {(f.application_id, f.stage_id, f.author_id) for f in feedback}
    for iv in interviews:
        a = rows[iv.application_id]
        panel = iv.panel_user_ids if iv.panel_user_ids is not None else a.interviewers or (
            [iv.created_by] if iv.created_by else [])
        if ctx.role == "interviewer" and ctx.user.id not in panel:
            continue
        item = {"application_id": a.id, "reference": a.reference,
            "name": rules.candidate_label(a.reference) if ctx.company.blind_review else a.name,
            "job_title": allowed[a.job_id].title, "when": hiring.aware(iv.chosen).isoformat() if iv.chosen else None,
            "duration_min": iv.duration_min, "location": iv.location}
        criteria = plans[a.job_id].content["criteria"] if a.job_id in plans else []
        stage = a.stage_id if any(c["stage_id"] == a.stage_id for c in criteria) else (
            criteria[0]["stage_id"] if criteria else a.stage_id)
        awaiting = any((a.id, stage, member) not in submitted for member in panel)
        if iv.chosen and hiring.aware(iv.chosen) >= current:
            upcoming.append(item)
        elif (criteria and iv.chosen and hiring.aware(iv.chosen) + timedelta(minutes=iv.duration_min) < current
              and awaiting):
            due.append(item)
    return {"as_of": current.isoformat(), "attention": attention[:30], "upcoming": upcoming[:20],
            "feedback_due": due[:20], "limited": limited}


@public_router.get("/work-sample")
async def candidate_sample(token: str, request: Request,
                            db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, job, company = await _by_token(db, token, request)
    sample = await db.get(BizWorkSample, app.id)
    plan = await db.get(BizHiringPlan, job.id)
    brief = None
    if plan:
        parsed = HiringPlan.model_validate(plan.content)
        brief = {"intro": parsed.candidate_intro, "areas": [c.name for c in parsed.criteria],
            "stages": [{"name": stage["name"], "minutes": sum(c.minutes for c in parsed.criteria
                if c.stage_id == stage["id"])} for stage in job.stages
                if any(c.stage_id == stage["id"] for c in parsed.criteria)]}
    return {"sample": hiring.sample_payload(sample), "accepting": app.status == "active"
            and app.deletion_requested_at is None and company.status == "active", "interview_brief": brief}


@public_router.post("/work-sample")
async def submit_sample(token: str, body: SampleAnswer, request: Request,
                          db: Annotated[AsyncSession, Depends(get_db)], follow_up: bool = False) -> dict[str, Any]:
    app, _job, company = await _by_token(db, token, request)
    ratelimit.check(_writes, f"biz-sample:{app.status_token_hash}")
    if company.status == "suspended":
        raise HTTPException(403, "This company is not accepting submissions.")
    _active(app)
    if app.email_confirmed_at is None:
        raise HTTPException(403, "Confirm your application email first.")
    await lock_company(db, app.company_id)
    await db.refresh(app)
    _active(app)
    sample = await db.get(BizWorkSample, app.id, populate_existing=True)
    if sample is None:
        raise HTTPException(404, "No practical challenge has been assigned.")
    content = {k: sanitize_text(v) for k, v in body.model_dump(exclude={"base_revision"}).items()}
    existing = sample.follow_up if follow_up else sample.answer
    if existing is not None:
        if existing == content:
            return await candidate_sample(token, request, db)
        raise HTTPException(409, "This submission is already saved and cannot be overwritten.")
    if sample.revision != body.base_revision:
        raise _conflict()
    if follow_up:
        if sample.answer is None:
            raise HTTPException(409, "Submit the initial solution before the change request.")
        sample.follow_up, sample.completed_at = content, datetime.now(UTC)
    else:
        sample.answer, sample.submitted_at = content, datetime.now(UTC)
    sample.revision += 1
    timeline(db, app, "work_sample_completed" if follow_up else "work_sample_submitted")
    await db.commit()
    return await candidate_sample(token, request, db)


@public_router.post("/clarification", status_code=201)
async def ask_question(token: str, body: ClarificationIn, request: Request,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    app, _job, company = await _by_token(db, token, request)
    _active(app)
    if company.status == "suspended" or app.email_confirmed_at is None:
        raise HTTPException(403, "Confirm your email before contacting an active hiring team.")
    ratelimit.check(_writes, f"biz-question:{app.status_token_hash}")
    timeline(db, app, "candidate_question", message=sanitize_text(body.message))
    await db.commit()
    return {"status": "saved", "message": "Your question is saved on the application for the hiring team."}


@public_router.get("/calendar.ics")
async def candidate_calendar(token: str, request: Request,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    from orbit_api.business.apply import latest_interview

    app, job, company = await _by_token(db, token, request)
    iv = await latest_interview(db, app.id)
    if iv is None or iv.chosen is None or app.status != "active":
        raise HTTPException(404, "No active interview is booked.")
    data = emails.ics(uid=iv.id, start=hiring.aware(iv.chosen), minutes=iv.duration_min,
        summary=f"Interview: {job.title} at {company.name}", description="Your confirmed interview.",
        location=iv.location, organizer=iv.reply_to, sequence=iv.revision)
    return Response(data, media_type="text/calendar", headers={
        "Content-Disposition": 'attachment; filename="orbit-interview.ics"', "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"})
