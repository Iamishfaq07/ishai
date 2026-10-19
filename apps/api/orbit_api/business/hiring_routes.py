"""Hiring Studio: structured interviews, private drafts, evidence debriefs and two-part work samples."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Text, and_, case, cast, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from orbit_api import ratelimit
from orbit_api.business import conversations, emails, hiring, rules
from orbit_api.business.access import CompanyCtx, application_for, audit, job_for, lock_company, timeline
from orbit_api.business.apply import _by_token
from orbit_api.business.hiring_schema import (
    AddendumIn,
    ClarificationIn,
    DecisionIn,
    FeedbackIn,
    HiringPlan,
    PlanIn,
    ReplyIn,
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
            if rating.source == "saba":
                source = "\n".join(str(e.data.get("answer", "")) for e in await db.scalars(select(BizEvent).where(
                    BizEvent.application_id == app.id, BizEvent.kind == "saba_answer")))
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


@router.post("/applications/{application_id}/feedback/{feedback_id}/addenda")
async def add_feedback_context(application_id: str, feedback_id: str, body: AddendumIn, ctx: CompanyCtx,
                                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.deletion_requested_at is not None:
        raise HTTPException(409, "This application is awaiting data deletion.")
    row = await db.get(BizInterviewFeedback, feedback_id)
    if row is None or row.application_id != app.id:
        raise HTTPException(404, "Feedback not found.")
    if row.author_id != ctx.user.id:
        raise HTTPException(403, "Only the original interviewer can add context to their feedback.")
    if row.submitted_at is None:
        raise HTTPException(409, "Save changes in your private draft before submitting it.")
    previous = list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "feedback_addendum", BizEvent.data["feedback_id"].as_string() == row.id)))
    content = {"reason": sanitize_text(body.reason), "message": sanitize_text(body.message)}
    retried = next((e for e in previous if e.data.get("request_id") == body.request_id), None)
    if retried:
        if retried.actor_id == ctx.user.id and all(retried.data.get(k) == v for k, v in content.items()):
            return await hiring.room_payload(db, ctx, app, job)
        raise _conflict()
    if len(previous) != body.base_addendum_count:
        raise _conflict()
    ratelimit.check(_writes, f"biz-addendum:{app.id}:{ctx.user.id}")
    timeline(db, app, "feedback_addendum", ctx.user, feedback_id=row.id, stage_id=row.stage_id,
        request_id=body.request_id, **content)
    audit(db, ctx.company.id, ctx.user, "hiring.feedback_addendum", app.reference,
        feedback_id=row.id, job_id=job.id)
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
    pending = conversations.unanswered_question()
    query = select(BizApplication, pending).where(BizApplication.job_id.in_(allowed),
        BizApplication.status == "active")
    if ctx.role == "interviewer":
        query = query.where(cast(BizApplication.interviewers, Text).contains(f'"{ctx.user.id}"', autoescape=True))
    # Prioritise deletion requests and unanswered questions before applying the scan limit.
    scan_rows = list(await db.execute(query.order_by(case((BizApplication.deletion_requested_at.is_not(None), 0),
        (pending, 1), else_=2), BizApplication.stage_changed_at, BizApplication.id).limit(2001))) if allowed else []
    limited = len(scan_rows) > 2000
    waiting_questions = {a.id for a, waiting in scan_rows[:2000] if waiting}
    apps = [a for a, _waiting in scan_rows[:2000]]
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
        BizEvent.kind.in_(("work_sample_completed", "hiring_decision", "saba_completed", "saba_alternative",
                          "offer_response")))
        .order_by(BizEvent.created_at.desc()))) if ids else []
    completed: dict[str, datetime] = {}
    decided: dict[str, datetime] = {}
    operations: dict[str, tuple[str, datetime]] = {}
    for event in questions:
        if event.kind == "work_sample_completed":
            completed.setdefault(event.application_id, hiring.aware(event.created_at))
        elif event.kind == "hiring_decision":
            decided.setdefault(event.application_id, hiring.aware(event.created_at))
        elif event.kind in ("saba_completed", "saba_alternative", "offer_response"):
            operations.setdefault(event.application_id, (event.kind, hiring.aware(event.created_at)))
    for a in apps:
        plan = plans.get(a.job_id)
        target = int((plan.content if plan else {}).get("response_target_days", 3))
        age = max(0, int((current - hiring.aware(a.stage_changed_at)).total_seconds() / 3600))
        if a.deletion_requested_at:
            reason, priority = "Candidate requested data deletion", "urgent"
        elif a.id in waiting_questions:
            reason, priority = "Candidate asked a question; reply from their application", "waiting"
        elif a.id in operations and operations[a.id][0] == "offer_response":
            reason, priority = "Candidate responded to the offer; review terms and confirm next steps", "waiting"
        elif a.id in operations and operations[a.id][0] == "saba_alternative":
            reason, priority = "Candidate requested an alternative interview; arrange it with them", "waiting"
        elif a.id in operations and operations[a.id][0] == "saba_completed" and (
                a.id not in decided or operations[a.id][1] > decided[a.id]):
            reason, priority = "Saba interview complete; review the saved transcript", "waiting"
        elif a.id in completed and (a.id not in decided or completed[a.id] > decided[a.id]):
            reason, priority = "Practical challenge complete; review their adaptation", "waiting"
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


async def _staff_conversation(db: AsyncSession, ctx: CompanyCtx, app: BizApplication, job: BizJob,
                               before: str | None = None) -> dict[str, Any]:
    return {**await conversations.question_page(db, app, before=before,
        mask=lambda text: hiring.blind_text(ctx, app, text), staff=True),
        "activity": await conversations.activity(db, app, job),
        "accepting": ctx.can("move_applicants") and ctx.company.status == "active"
            and app.email_confirmed_at is not None and app.deletion_requested_at is None}


@router.get("/applications/{application_id}/conversation")
async def company_conversation(application_id: str, ctx: CompanyCtx,
                                 db: Annotated[AsyncSession, Depends(get_db)],
                                 before: Annotated[str | None, Query(max_length=36)] = None) -> dict[str, Any]:
    app, job = await application_for(db, ctx, application_id)
    return await _staff_conversation(db, ctx, app, job, before)


@router.post("/applications/{application_id}/questions/{question_id}/reply")
async def reply_to_candidate(application_id: str, question_id: str, body: ReplyIn, ctx: CompanyCtx,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.deletion_requested_at is not None or app.email_confirmed_at is None:
        raise HTTPException(409, "Replies require a confirmed application that is not awaiting deletion.")
    question = await db.get(BizEvent, question_id)
    if question is None or question.application_id != app.id or question.kind != "candidate_question":
        raise HTTPException(404, "Question not found.")
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "candidate_reply", BizEvent.data["question_id"].as_string() == question.id))
    message = sanitize_text(body.message)
    if previous:
        if (previous.data.get("request_id") == body.request_id and previous.data.get("message") == message
                and previous.actor_id == ctx.user.id and previous.data.get("notify") == body.notify):
            return {"question_id": question.id, "reply": conversations.reply_payload(previous,
                mask=lambda text: hiring.blind_text(ctx, app, text), staff=True)}
        raise HTTPException(409, "A teammate already answered this question. Reload to read the saved reply.")
    ratelimit.check(_writes, f"biz-reply:{app.id}:{ctx.user.id}")
    reply = BizEvent(company_id=ctx.company.id, job_id=job.id, application_id=app.id, kind="candidate_reply",
        actor_id=ctx.user.id, actor_name=ctx.actor_name,
        data={"question_id": question.id, "message": message, "request_id": body.request_id, "notify": body.notify})
    db.add(reply)
    audit(db, ctx.company.id, ctx.user, "hiring.candidate_reply", app.reference,
        job_id=job.id, question_id=question.id)
    await db.commit()
    if body.notify:
        token = emails.status_token_for(app)
        link = emails.status_link(token) if token else "Use the private application link from your first email."
        await emails.send_to_applicant(ctx.company, app, f"The hiring team replied: {job.title}",
            f"The hiring team has answered your question about {job.title}.\n"
            f"Read the reply on your application page:\n{link}", ctx.user.email)
    return {"question_id": question.id, "reply": conversations.reply_payload(reply,
        mask=lambda text: hiring.blind_text(ctx, app, text), staff=True)}


@public_router.get("/conversation")
async def candidate_conversation(token: str, request: Request,
                                   db: Annotated[AsyncSession, Depends(get_db)],
                                   before: Annotated[str | None, Query(max_length=36)] = None) -> dict[str, Any]:
    app, job, company = await _by_token(db, token, request)
    return {**await conversations.question_page(db, app, before=before),
        "activity": await conversations.activity(db, app, job), "accepting": app.status == "active"
            and company.status == "active" and app.email_confirmed_at is not None
            and app.deletion_requested_at is None}


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
    await lock_company(db, app.company_id)
    await db.refresh(app)
    _active(app)
    message = sanitize_text(body.message)
    if body.request_id:
        previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id,
            BizEvent.kind == "candidate_question", BizEvent.data["request_id"].as_string() == body.request_id))
        if previous:
            if previous.data.get("message") != message:
                raise _conflict()
            return {"status": "saved", "message": "Your question is saved on the application for the hiring team."}
    timeline(db, app, "candidate_question", message=message, request_id=body.request_id)
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
