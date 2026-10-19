"""Candidate-controlled withdrawal: a terminal application outcome, separate from deletion or rejection."""
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import ratelimit
from orbit_api.business import emails, hiring, rules
from orbit_api.business.access import CompanyCtx, Ctx, application_for, audit, lock_company, sees_application, timeline
from orbit_api.business.apply import StatusOut, _by_token, _status, latest_interview, now, sync_tracker_status
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.scheduling import panel as interview_panel
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import BizEvent, BizInterview, BizMember, BizNotification, User
from orbit_api.providers.email import OutgoingEmail, send_safely

public_router = APIRouter(prefix="/v1/public/business/applications/{token}", tags=["candidate withdrawal"])
router = APIRouter(prefix="/v1/business/companies/{company_id}/applications/{application_id}",
    tags=["business withdrawal"])
_writes = ratelimit.SlidingWindow(rate_per_s=10 / 3600, burst=10)
REASONS = {"none": "No reason shared", "role": "Role no longer fits", "another_offer": "Accepted another opportunity",
    "timing": "Timing changed", "other": "Other reason"}


class Withdraw(Contract):
    notice_version: str = Field(max_length=40)
    application_reference: str = Field(min_length=1, max_length=12)
    acknowledge: bool
    reason: Literal["none", "role", "another_offer", "timing", "other"] = "none"
    note: str = Field("", max_length=1000)
    request_id: RequestId


@router.get("/withdrawal")
async def staff_record(application_id: str, ctx: CompanyCtx,
                       db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    app, _ = await application_for(db, ctx, application_id)
    row = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id, BizEvent.kind == "withdrawn"))
    return {"withdrawal": {"created_at": hiring.aware(row.created_at).isoformat(),
        "reason": REASONS.get(row.data.get("reason", "none"), REASONS["none"]),
        "note": hiring.blind_text(ctx, app, str(row.data.get("note", "")))} if row else None}


@public_router.post("/withdraw", response_model=StatusOut)
async def withdraw(token: str, body: Withdraw, request: Request,
                    db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    app, job, company = await _by_token(db, token, request)
    ratelimit.check(_writes, f"withdraw:{app.id}")
    await lock_company(db, company.id)
    await db.refresh(app)
    content = body.model_dump(exclude={"request_id"})
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id, BizEvent.kind == "withdrawn"))
    if previous:
        if previous.data.get("request_id") == body.request_id and previous.data.get("input") == content:
            return await _status(db, app, job, company)
        raise HTTPException(409, "This application was already withdrawn. Refresh to read its saved status.")
    if (not body.acknowledge or body.application_reference != app.reference
            or body.notice_version != rules.WITHDRAWAL_NOTICE_VERSION):
        raise HTTPException(422, "Review and confirm the displayed application before withdrawing.")
    if app.status != "active" or app.email_confirmed_at is None:
        raise HTTPException(409, "Only a confirmed application still in hiring can be withdrawn here.")
    # Candidate control remains available if the company is suspended or a deletion request is already pending.
    app.status, app.stage_changed_at = "withdrawn", now()
    timeline(db, app, "withdrawn", reason=body.reason, note=body.note, input=content, request_id=body.request_id,
        notice=rules.withdrawal_notice(app.retention_months or company.retention_months))
    audit(db, company.id, None, "application.withdrawn", app.reference, job_id=job.id)
    iv = await latest_interview(db, app.id)
    attachments: tuple[tuple[str, str, bytes], ...] = ()
    if iv and iv.slots and (iv.chosen is None or hiring.aware(iv.chosen) > now()):
        db.add(BizInterview(company_id=company.id, application_id=app.id, slots=[], duration_min=iv.duration_min,
            location=iv.location, created_by=None, reply_to=iv.reply_to, panel_user_ids=iv.panel_user_ids))
        timeline(db, app, "interview_cancelled", reason="candidate_withdrawal")
        if iv.chosen:
            calendar = emails.ics(uid=iv.id, start=hiring.aware(iv.chosen), minutes=iv.duration_min,
                summary=f"Cancelled interview: {job.title}", description="The candidate withdrew this application.",
                location=iv.location, organizer=iv.reply_to, sequence=iv.revision + 1, cancelled=True)
            attachments = (("cancelled-interview.ics", "text/calendar", calendar),)
    await sync_tracker_status(db, app, "withdrawn")
    # Notify only current members who can see this application. No note or candidate identity enters email subjects.
    people = list(await db.execute(select(User, BizMember).join(BizMember, BizMember.user_id == User.id)
        .where(BizMember.company_id == company.id)))
    recipients = []
    panel = interview_panel(iv, app.interviewers or []) if iv else set()
    for user, member in people:
        if sees_application(Ctx(user=user, company=company, member=member), app, job):
            db.add(BizNotification(user_id=user.id, company_id=company.id, application_id=app.id,
                kind="withdrawal", text=f"{rules.candidate_label(app.reference)} withdrew their application."))
            # Interviewers receive cancellation files only for the frozen panel they actually belonged to.
            if member.role != "interviewer" or user.id in panel:
                recipients.append(user.email)
    await db.commit()
    await emails.send_to_applicant(company, app, f"Application withdrawn: {job.title}",
        "Your application is withdrawn and the hiring team has been informed. Outstanding Orbit interview "
        "invitations are cancelled. If you imported a calendar event, update or remove it. Your saved history remains; "
        "you can request data deletion separately from your application page. This does not pause other applications.",
        reply_to=None, attachments=attachments)
    link = f"{get_settings().web_url.rstrip('/')}/business/app/{company.id}/applications/{app.id}"
    for to in set(recipients):
        await send_safely(OutgoingEmail(to=to,
            subject=f"{rules.candidate_label(app.reference)} withdrew their application",
            text=f"The candidate is no longer in hiring for {job.title}. Outstanding Orbit interview invitations "
                 f"are cancelled. Review the saved application record:\n{link}\n\nUpdate any imported calendar event.",
            attachments=attachments, footer="Sent by Orbit for Business."))
    return await _status(db, app, job, company)
