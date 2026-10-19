"""Atomic, paced submissions to Orbit Business under approved agency rules."""
import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import pacing, quota, rules
from orbit_api.auto_apply.forms import FormQuestion
from orbit_api.business import apply
from orbit_api.business.access import lock_company
from orbit_api.config import get_settings
from orbit_api.models import ApplicationPacket, AutoApplySetup, BizJob, User
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.schema import ResumeData
from orbit_api.transactions import lock_account

log = logging.getLogger(__name__)
# Rotate the bounded sweep even when accounts are in quiet hours or have exhausted quota.
_dispatch_after = ""


def questions(job: BizJob) -> list[FormQuestion]:
    return [FormQuestion.model_validate({"id": q["id"], "label": q["text"],
        "kind": {"short_text": "text", "choice": "select", "yes_no": "select"}.get(q["kind"], q["kind"]),
        "required": q.get("required", True),
        "options": ([{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]
            if q["kind"] == "yes_no" else [{"label": s, "value": s} for s in (q.get("choices") or [])])})
        for q in job.questions or []]


async def run_ready(db: AsyncSession, user: User) -> bool:
    """Submit at most one due packet. Quota, application and receipt commit together."""
    from orbit_api.auto_apply.planner import master_resume

    await lock_account(db, user.id)
    await db.refresh(user)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    if setup is None or setup.consent_at is None or setup.consent_version != rules.CONSENT_VERSION or setup.paused:
        await db.commit()
        return False
    _, _, approved = await master_resume(db, setup)
    if (not approved or not user.email_verified or user.suspended_at is not None
            or not get_settings().email_allowed(user.email)):
        await db.commit()
        return False
    due = await pacing.next_due(db, user, holder="orbit-direct", allowed_ats=("orbit",))
    packet = due.packet
    if packet is None:
        await db.commit()
        return False
    try:
        job, company = await apply._open_job(db, packet.job_ref or "")
        await lock_company(db, company.id)
        await db.refresh(job)
        await db.refresh(company)
        await apply._open_job(db, job.id)
        if company.verified_at is None:
            raise HTTPException(409, "This employer's company verification needs review before automatic applying.")
        if not (await master_resume(db, setup))[2]:
            quota.release(db, packet)
            packet.status, packet.reason = "needs_you", "Your resume changed. Approve it again before applying."
            packet.lease_until = packet.lease_holder = None
            await db.commit()
            return False
        if job.valid_through and (pacing.aware(job.valid_through) or datetime.now(UTC)) <= datetime.now(UTC):
            raise HTTPException(409, "This job's application deadline has passed.")
        current_questions = [q.model_dump() for q in questions(job)]
        if current_questions != packet.questions:
            from orbit_api.auto_apply.packets import reanswer
            quota.release(db, packet)
            packet.lease_until = packet.lease_holder = None
            packet.questions, packet.status = current_questions, "needs_answer"
            await reanswer(db, user, packet)
            if packet.status == "ready":
                packet.status = "review"
            packet.reason = "The employer changed its screening questions. Review the updated questions before sending."
            await db.commit()
            return False
        data = ResumeData.model_validate(packet.resume_data or {})
        answers = [apply.AnswerIn(question_id=a["question_id"], answer=a["value"])
                   for a in packet.answers or [] if a.get("question_id")]
        app, raw = await apply._create(db, job=job, company=company,
            name=packet.fields.get("full_name") or user.name or user.email.split("@")[0], email=user.email,
            phone=packet.fields.get("phone"), resume_text=resume_text(data), filename=packet.resume_title,
            resume_source="orbit_resume", answers=answers, source="orbit", user=user)
        if app is None:
            quota.release(db, packet)
            packet.status, packet.reason = "skipped", "This verified email already applied to this job."
        else:
            app.consent = {**app.consent, "delegated_by": "orbit_apply",
                "agency_consent_version": setup.consent_version}
            app.tracker_id = await apply._sync_new_tracker(db, user, company, job)
            from orbit_api.auto_apply.packets import track_applied
            await track_applied(db, user, packet, by_orbit=True)
            packet.status, packet.result_status = "submitted", "submitted"
            packet.submitted_at = packet.result_at = datetime.now(UTC)
            packet.confirmation_text = f"Application {app.reference} received by {company.name}."
            packet.submitted_payload = {"business_application_id": app.id, "reference": app.reference}
            packet.reason = ""
        packet.lease_until = packet.lease_holder = None
        await db.commit()
        if app is not None:
            await apply._confirmation(company, job, app, raw)
        return app is not None
    except HTTPException as e:
        quota.release(db, packet)
        packet.status, packet.reason = "needs_you", str(e.detail)[:500]
        packet.lease_until = packet.lease_holder = None
        await db.commit()
        return False


async def dispatch_due() -> int:
    from orbit_api.db import sessionmaker

    global _dispatch_after
    async with sessionmaker()() as db:
        query = (select(ApplicationPacket.user_id).join(User, User.id == ApplicationPacket.user_id)
            .join(AutoApplySetup, AutoApplySetup.user_id == User.id)
            .where(ApplicationPacket.ats == "orbit", ApplicationPacket.status == "ready",
                User.email_verified.is_(True), User.suspended_at.is_(None), AutoApplySetup.paused.is_(False),
                AutoApplySetup.consent_at.is_not(None), AutoApplySetup.consent_version == rules.CONSENT_VERSION)
            .distinct().order_by(ApplicationPacket.user_id).limit(20))
        ids = list(await db.scalars(query.where(ApplicationPacket.user_id > _dispatch_after)))
        if not ids and _dispatch_after:
            ids = list(await db.scalars(query))
        _dispatch_after = ids[-1] if ids else ""
    sent = 0
    for uid in ids:
        async with sessionmaker()() as db:
            user = await db.get(User, uid)
            if user is not None:
                try:
                    sent += int(await run_ready(db, user))
                except Exception:
                    await db.rollback()
                    log.exception("Orbit Direct failed for one account; the next sweep can retry it")
    return sent
