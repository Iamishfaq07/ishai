"""Private worker protocol for personal Orbit Apply. No candidate session is handed to a browser.

The API owns consent, quotas, leases and the pre-submit fence. Workers get one packet and an unguessable attempt
token, use a fresh browser context, then return a receipt. A crash after the fence needs human reconciliation.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import pacing, packets, planner, rules
from orbit_api.auto_apply.pacing import aware
from orbit_api.auto_apply.resolve import from_url
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import PENDING, awaiting_approval, plan_for
from orbit_api.models import ApplicationPacket, ApplyWorkerHeartbeat, AuditLog, AutoApplySetup, User
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/internal/apply", tags=["apply worker"])
ONLINE_FOR = timedelta(seconds=90)


def enabled() -> bool:
    s = get_settings()
    return bool(s.hosted_apply and s.apply_worker_secret)


async def online(db: AsyncSession) -> bool:
    if not enabled():
        return False
    last = aware(await db.scalar(select(func.max(ApplyWorkerHeartbeat.seen_at))))
    return bool(last and last > datetime.now(UTC) - ONLINE_FOR)


def worker_auth(x_orbit_worker_secret: Annotated[str, Header()] = "") -> None:
    secret = get_settings().apply_worker_secret
    if not x_orbit_worker_secret:
        raise HTTPException(401, "Worker authentication required.")
    if secret is None or not secrets.compare_digest(x_orbit_worker_secret.encode(), secret.get_secret_value().encode()):
        raise HTTPException(403, "Worker authentication required.")
    if not enabled():
        raise HTTPException(503, "Hosted applications are not enabled on this deployment.")


WorkerAuth = Depends(worker_auth)


class WorkerIn(BaseModel):
    worker_id: str = Field(min_length=16, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class AttemptIn(BaseModel):
    token: str = Field(min_length=32, max_length=64)


class ReceiptIn(AttemptIn):
    result: packets.ResultIn


class QuestionsIn(AttemptIn):
    questions: list[packets.UnknownQuestion] = Field(max_length=50)


async def heartbeat(db: AsyncSession, worker_id: str) -> None:
    now = datetime.now(UTC)
    row = await db.get(ApplyWorkerHeartbeat, worker_id)
    if row is None:
        db.add(ApplyWorkerHeartbeat(worker_id=worker_id, seen_at=now))
    else:
        row.seen_at = now
    await db.execute(delete(ApplyWorkerHeartbeat).where(ApplyWorkerHeartbeat.seen_at < now - timedelta(days=1)))


async def authorised(db: AsyncSession, user: User, setup: AutoApplySetup | None) -> bool:
    if setup is not None:
        await pacing.pause_if_hired(db, setup)
    if (setup is None or setup.execution != "hosted" or not setup.hosted_consent_at or not setup.consent_at
            or setup.consent_version != rules.CONSENT_VERSION or setup.paused or not user.email_verified
            or user.suspended_at is not None or not get_settings().email_allowed(user.email)):
        return False
    if awaiting_approval(user) and await plan_for(db, user.id) is PENDING:
        return False
    return (await planner.master_resume(db, setup))[2]


async def attempt(db: AsyncSession, packet_id: str, token: str) -> tuple[ApplicationPacket, User]:
    p = await db.get(ApplicationPacket, packet_id)
    if p is None:
        raise HTTPException(404, "Application not found.")
    await lock_account(db, p.user_id)
    await db.refresh(p)
    if not p.hosted_token or not secrets.compare_digest(p.hosted_token.encode(), token.encode()):
        raise HTTPException(409, "That hosted attempt no longer owns this application.")
    user = await db.get(User, p.user_id, populate_existing=True)
    if user is None:
        raise HTTPException(404, "Account no longer exists.")
    return p, user


@router.post("/heartbeat", dependencies=[WorkerAuth])
async def worker_heartbeat(body: WorkerIn, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    await heartbeat(db, body.worker_id)
    await db.commit()
    return {"ok": True}


@router.post("/next", dependencies=[WorkerAuth])
async def next_hosted(body: WorkerIn, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    from orbit_api.auto_apply.routes import executor_packet

    await heartbeat(db, body.worker_id)
    await db.commit()
    # Rotate candidates by their last poll, including expired leases for crash recovery. Per-account locking and
    # next_due's single lease prevent both another worker and the extension from racing this one.
    ids = list((await db.scalars(select(AutoApplySetup.user_id).join(User).where(
        AutoApplySetup.execution == "hosted", AutoApplySetup.consent_at.is_not(None),
        AutoApplySetup.hosted_consent_at.is_not(None), AutoApplySetup.paused.is_(False),
        User.email_verified.is_(True), User.suspended_at.is_(None),
        select(ApplicationPacket.id).where(ApplicationPacket.user_id == AutoApplySetup.user_id,
            or_(ApplicationPacket.status.in_(("ready", "leased")),
                (ApplicationPacket.status == "review") & (AutoApplySetup.mode == "automatic")),
            ApplicationPacket.ats.in_(rules.ATS_SUPPORTED)).exists()
    ).order_by(AutoApplySetup.hosted_seen_at.asc().nullsfirst()).limit(40))).all())
    for uid in ids:
        await lock_account(db, uid)
        user = await db.get(User, uid, populate_existing=True)
        setup = await db.get(AutoApplySetup, uid, populate_existing=True)
        if user is None or setup is None:
            await db.commit()
            continue
        setup.hosted_seen_at = datetime.now(UTC)
        if not await authorised(db, user, setup):
            await db.commit()
            continue
        if setup.mode == "automatic":
            await db.execute(update(ApplicationPacket).where(ApplicationPacket.user_id == uid,
                ApplicationPacket.status == "review").values(status="ready", reason=""))
        token = secrets.token_urlsafe(32)
        due = await pacing.next_due(db, user, holder=f"hosted:{token}")
        p = due.packet
        if p is None:
            await db.commit()
            continue
        target = from_url(p.apply_url)
        if target is None or target.ats != p.ats or not target.automatic:
            await packets.record_result(db, user, p, packets.ResultIn(status="needs_you", reason="form_changed"))
            await db.commit()
            continue
        if p.approval_fingerprint != planner.approval_fingerprint(setup, await planner.load_bank(db, user.id)):
            # Updates to the bank must not strand every other prepared job. Rebuild from the latest approvals,
            # re-check the new filters and respect Review first before making another lease available.
            await planner.rebuild_packet(db, user, setup, p)
            db.add(AuditLog(user_id=user.id, action="apply.hosted_rebuilt", target=p.id))
            await db.commit()
            return Response(status_code=204, headers={"Retry-After": "15"})
        p.hosted_token = token
        payload = executor_packet(request, p).model_dump(mode="json")
        payload["resume"]["download_url"] = f"/v1/internal/apply/{p.id}/resume.pdf"
        await db.commit()
        return {"token": token, "packet": payload}
    return Response(status_code=204, headers={"Retry-After": "15"})


@router.get("/{packet_id}/resume.pdf", dependencies=[WorkerAuth])
async def worker_resume(packet_id: str, x_orbit_attempt: Annotated[str, Header()],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    from orbit_api.auto_apply.routes import _pdf_response

    p, _ = await attempt(db, packet_id, x_orbit_attempt)
    if p.status != "leased" or (aware(p.lease_until) or datetime.min.replace(tzinfo=UTC)) <= datetime.now(UTC):
        raise HTTPException(409, "The lease expired.")
    return _pdf_response(p)


@router.post("/{packet_id}/check", dependencies=[WorkerAuth])
async def check_attempt(packet_id: str, body: AttemptIn,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    p, user = await attempt(db, packet_id, body.token)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    allowed = (p.status == "leased" and (aware(p.lease_until) or datetime.min.replace(tzinfo=UTC)) > datetime.now(UTC)
               and await authorised(db, user, setup) and setup is not None
               and p.approval_fingerprint == planner.approval_fingerprint(setup, await planner.load_bank(db, user.id))
               and p.ats not in await pacing.paused_sites(db, datetime.now(UTC)))
    await db.commit()
    return {"allowed": bool(allowed)}


@router.post("/{packet_id}/submit", dependencies=[WorkerAuth])
async def arm_submission(packet_id: str, body: AttemptIn,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    # This commits BEFORE the browser click. Repeating it is deliberately refused: a lost response is ambiguous.
    p, user = await attempt(db, packet_id, body.token)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    now = datetime.now(UTC)
    if (p.status != "leased" or (aware(p.lease_until) or now) <= now or p.submission_started_at is not None
            or not await authorised(db, user, setup) or setup is None
            or p.approval_fingerprint != planner.approval_fingerprint(setup, await planner.load_bank(db, user.id))
            or p.ats in await pacing.paused_sites(db, now) or pacing.quiet_until(setup, now) is not None):
        raise HTTPException(409, "The application is paused, expired, changed or already started submission.")
    if await pacing.today_count(db, user.id, setup, now) > pacing.daily_limit(setup):
        raise HTTPException(409, "Your updated daily limit has been reached.")
    p.submission_started_at = now
    db.add(AuditLog(user_id=user.id, action="apply.hosted_submit_started", target=p.id))
    await db.commit()
    return {"allowed": True}


@router.post("/{packet_id}/questions", dependencies=[WorkerAuth])
async def answer_live_questions(packet_id: str, body: QuestionsIn,
                                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    from orbit_api.auto_apply.forms import FormQuestion, Option

    p, user = await attempt(db, packet_id, body.token)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    now = datetime.now(UTC)
    if (p.status != "leased" or p.submission_started_at or (aware(p.lease_until) or now) <= now
            or not await authorised(db, user, setup)):
        raise HTTPException(409, "This attempt is no longer allowed to prepare answers.")
    questions = [FormQuestion(id="live:" + hashlib.sha256(q.label.encode()).hexdigest()[:32], label=q.label,
        kind=q.kind, required=True, options=[Option(label=o, value=o) for o in q.options or []])
        for q in body.questions]
    answers, missing = await planner.answer_form(questions, await packets.context(db, user, p))
    if not missing:
        labels = {q.label for q in questions}
        p.answers = [a for a in p.answers or [] if a.get("label") not in labels] + [a.model_dump() for a in answers]
        await db.commit()
    return {"answers": [a.model_dump() for a in answers], "missing": [m.model_dump() for m in missing]}


@router.post("/{packet_id}/result", dependencies=[WorkerAuth], response_model=packets.ResultOut)
async def worker_result(packet_id: str, body: ReceiptIn,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> packets.ResultOut:
    from orbit_api.auto_apply.notify import notify

    p, user = await attempt(db, packet_id, body.token)
    # A retried receipt is idempotent, including its quota charge and tracker snapshot.
    if p.result_at is not None:
        return packets.ResultOut(id=p.id, status=p.status, charged=p.status == "submitted" and p.charge is not None,
                                 tracker_id=p.application_id)
    until = aware(p.leased_at)
    if until is None or until + rules.LEASE + rules.RESULT_GRACE < datetime.now(UTC):
        raise HTTPException(409, "The receipt window ended. Reconcile this application manually.")
    if body.result.status == "submitted" and (
            not p.submission_started_at or not (body.result.confirmation_text or "").strip()):
        raise HTTPException(422, "A submission checkpoint and employer confirmation are required.")
    if p.status == "needs_you" and p.submission_started_at is not None:
        # Recovery may have already released the hold after a crash. Accept only this fenced attempt's late proof.
        if (aware(p.submission_started_at) or datetime.now(UTC)) < datetime.now(UTC) - rules.RESULT_GRACE:
            raise HTTPException(409, "The receipt window ended. Reconcile this application manually.")
        p.status = "leased"
    out = await packets.record_result(db, user, p, body.result)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    if (out.status == "needs_you" and p.submission_started_at is None and setup is not None
            and await authorised(db, user, setup)
            and p.approval_fingerprint != planner.approval_fingerprint(setup, await planner.load_bank(db, user.id))):
        await planner.rebuild_packet(db, user, setup, p)
        out = packets.ResultOut(id=p.id, status=p.status, charged=False, tracker_id=p.application_id)
    db.add(AuditLog(user_id=user.id, action="apply.hosted_result", target=f"{p.id}:{out.status}"))
    await db.commit()
    if out.status == "needs_you" and await notify(db, user):
        await db.commit()
    return out
