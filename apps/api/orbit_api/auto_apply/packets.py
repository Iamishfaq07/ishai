"""What happens to a packet after it's prepared: the candidate answers what only they can (saved to the bank, so the
next form asking the same is filled in for them), approves it in Review-first mode, or says "don't apply". Then the
executor's result is recorded: the proof is kept, the tracker updated, and the hold charged or given back.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import bank, pacing, quota, rules
from orbit_api.auto_apply.forms import FormQuestion, Kind
from orbit_api.auto_apply.pacing import aware
from orbit_api.auto_apply.planner import answer_form, load_bank
from orbit_api.auto_apply.setup import Facts
from orbit_api.models import (
    AnswerBankEntry,
    ApplicationPacket,
    ApplyProof,
    AutoApplySetup,
    JobApplication,
    JobListing,
    ResumeSnapshot,
    User,
)
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)

Group = Literal["prepared", "applied", "needs_you", "skipped"]
GROUPS: dict[str, tuple[str, ...]] = {
    "prepared": ("review", "ready", "leased"),
    "applied": ("submitted", "applied"),
    "needs_you": ("needs_answer", "needs_you", "handoff"),
    "skipped": ("skipped", "failed", "cancelled", "expired"),
}
GROUP_OF = {s: g for g, statuses in GROUPS.items() for s in statuses}
REASON_TEXT = {
    "captcha": "The site showed a captcha. Orbit never solves those for you: finish it in one click.",
    "login": "The site asked you to sign in. Orbit never stores job-site passwords: finish it in one click.",
    "email_verification": "The site sent you an email to confirm. Finish it in one click.",
    "unknown_question": "The form asked something your answers don't cover yet. Answer it once and Orbit tries again.",
    "form_changed": "The form changed since Orbit read it.",
    "blocked": "The site blocked the application.",
    "error": "Something went wrong in the browser while applying.",
}


async def owned(db: AsyncSession, user: User, packet_id: str) -> ApplicationPacket:
    p = await db.get(ApplicationPacket, packet_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That application isn't here.")
    return p


def _bank_kind(kind: str) -> str:
    return {"textarea": "textarea", "select": "select", "multiselect": "select", "boolean": "yes_no",
            "checkbox": "yes_no", "number": "number", "date": "date"}.get(kind, "text")


async def save_answer(db: AsyncSession, user_id: str, *, norm: str, label: str, kind: str, value: str,
                      legal: bool) -> None:
    """Into the bank (the caller commits). An empty value removes the answer."""
    row = await db.scalar(select(AnswerBankEntry).where(AnswerBankEntry.user_id == user_id,
                                                        AnswerBankEntry.norm == norm))
    seed = bank.SEED_BY_KEY.get(norm.split("@", 1)[0])
    if row is None:
        if not value.strip():
            return
        row = AnswerBankEntry(user_id=user_id, norm=norm[:200], key=seed.key if seed else "custom",
                              label=label[:500], kind=_bank_kind(kind), legal=legal or bool(seed and seed.legal))
        db.add(row)
    if not value.strip():
        await db.delete(row)
        return
    row.value = value.strip()[:bank.MAX_ANSWER]
    row.label = label[:500] or row.label


async def context(db: AsyncSession, user: User, packet: ApplicationPacket) -> bank.Context:
    setup = await db.get(AutoApplySetup, user.id)
    facts = Facts.model_validate((setup.profile if setup else None) or {})
    listing = await db.get(JobListing, packet.listing_id)
    return bank.Context(facts=facts, resume=ResumeData.model_validate(packet.resume_data or {}),
                        bank=await load_bank(db, user.id), company=packet.company, company_key=packet.company_key,
                        title=packet.title, job_country=listing.country if listing else None,
                        job_cities=list(listing.cities or []) if listing else [], direct=True,
                        generated={**(packet.generated or {}), "cover_letter": packet.cover_letter or ""})


async def reanswer(db: AsyncSession, user: User, packet: ApplicationPacket) -> None:
    """Answer the packet's form again from the bank as it is now: unblocks a needs_answer packet once every required
    question has an answer. The caller commits."""
    if packet.status not in ("needs_answer", "needs_you"):
        return
    questions = [FormQuestion.model_validate(q) for q in packet.questions or []]
    answers, missing = await answer_form(questions, await context(db, user, packet))
    packet.answers = [a.model_dump() for a in answers]
    packet.missing = [m.model_dump() for m in missing]
    if packet.status == "needs_answer":
        if missing:
            packet.reason = f"{len(missing)} question{'' if len(missing) == 1 else 's'} only you can answer"
            return
        setup = await db.get(AutoApplySetup, user.id)
        packet.status = "review" if setup is not None and setup.mode == "review" else "ready"
        packet.reason = "Ready for your review" if packet.status == "review" else ""
        packet.not_before = datetime.now(UTC)
        packet.expires_at = max(aware(packet.expires_at) or datetime.now(UTC), datetime.now(UTC) + rules.PACKET_TTL)


async def refresh_waiting(db: AsyncSession, user: User) -> None:
    """After the bank changes: every packet waiting on an answer is answered again. The caller commits."""
    waiting = (await db.scalars(select(ApplicationPacket).where(ApplicationPacket.user_id == user.id,
                                                                ApplicationPacket.status == "needs_answer"))).all()
    for p in waiting:
        await reanswer(db, user, p)


class GivenAnswer(BaseModel):
    question_id: str | None = Field(None, max_length=200)
    label: str = Field("", max_length=2000)
    value: str = Field(max_length=bank.MAX_ANSWER)


async def answer_missing(db: AsyncSession, user: User, packet: ApplicationPacket, given: list[GivenAnswer]) -> None:
    """The candidate's answers to a packet's open questions: saved to the bank, then every waiting packet is
    answered again (this one included). The caller commits."""
    missing = [bank.Missing.model_validate(m) for m in packet.missing or []]
    for g in given:
        m = next((x for x in missing if (g.question_id and x.question_id == g.question_id) or (
            not g.question_id and bank.norm_label(x.label) == bank.norm_label(g.label))), None)
        if m is None:
            continue
        label = f"{m.label} ({packet.company})" if "@" in m.bank_key else m.label
        await save_answer(db, user.id, norm=m.bank_key or bank.norm_label(m.label), label=label, kind=m.kind,
                          value=g.value, legal=m.legal)
    await db.flush()
    if packet.status == "needs_you" and packet.result_reason == "unknown_question":
        await reanswer(db, user, packet)
    await refresh_waiting(db, user)


# ---- the executor's result ---------------------------------------------------------------------------------------

ResultStatus = Literal["submitted", "needs_you", "failed", "skipped"]
ResultReason = Literal["captcha", "login", "email_verification", "unknown_question", "form_changed", "blocked",
                       "error"]


class UnknownQuestion(BaseModel):
    label: str = Field(max_length=2000)
    kind: Kind = "text"
    options: list[str] | None = Field(None, max_length=200)


class Submitted(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    answers: list[dict[str, Any]] = Field(default_factory=list, max_length=300)


class ResultIn(BaseModel):
    status: ResultStatus
    reason: ResultReason | None = None
    unknown_questions: list[UnknownQuestion] = Field(default_factory=list, max_length=50)
    confirmation_text: str | None = Field(None, max_length=8000)
    final_url: str | None = Field(None, max_length=2000)
    screenshot_png_b64: str | None = Field(None, max_length=2_100_000)
    submitted: Submitted | None = None


class ResultOut(BaseModel):
    id: str
    status: str  # the packet's status now
    charged: bool
    tracker_id: str | None = None


def _png(b64: str) -> bytes:
    try:
        raw = base64.b64decode(b64.split(",", 1)[-1], validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "screenshot_png_b64 isn't base64.") from e
    if len(raw) > rules.MAX_SCREENSHOT_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The screenshot is over 1.5 MB.")
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The screenshot must be a PNG.")
    return raw


async def track_applied(db: AsyncSession, user: User, packet: ApplicationPacket, *, by_orbit: bool) -> str | None:
    """The tracker entry for this job, moved to applied ("Applied (Orbit Apply)" when Orbit sent it), with the
    prepared resume kept with the result source (not independently verified delivery). None when the tracker is full."""
    from orbit_api.job_portal import routes as portal

    if packet.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    now = datetime.now(UTC)
    entry = await db.scalar(select(JobApplication).where(JobApplication.user_id == user.id,
                                                         JobApplication.listing_id == packet.listing_id))
    if entry is None:
        listing = await db.get(JobListing, packet.listing_id)
        try:
            if listing is not None:
                entry = await portal._track(db, user, listing, "applied")
            else:
                await portal._room(db, user)
                entry = JobApplication(user_id=user.id, listing_id=packet.listing_id, source=packet.ats,
                                       company=packet.company, title=packet.title, url=packet.url,
                                       apply_url=packet.apply_url, status="applied", status_at=now)
                db.add(entry)
                await db.flush()
        except HTTPException:
            log.info("orbit apply: tracker full; %s not added", packet.id)
            return None
    if entry.status == "saved":
        entry.status, entry.status_at = "applied", now
    entry.applied_at = entry.applied_at or now
    if by_orbit:
        entry.applied_via = "orbit_apply"
    note = "Applied (Orbit Apply)" if by_orbit else "Applied by you, from Orbit Apply"
    if note not in (entry.notes or ""):
        entry.notes = f"{entry.notes}\n{note}".strip() if entry.notes else note
    data = ResumeData.model_validate(packet.resume_data or {})
    from orbit_api.job_portal.resume_lineage import capture_origin, packet_materials

    # Keep the description captured with these materials, never today's mutable listing.
    job_text = (packet.posting_text or "")[:20_000]
    saved = ResumeSnapshot(user_id=user.id, application_id=entry.id, title=packet.resume_title or "Resume",
        data=dict(packet.resume_data or {}), design={}, job_text=job_text[:20_000],
        score=score_resume(data, job_text=job_text).score,
        note="Executor reported submission" if by_orbit else "Candidate recorded applying from Orbit Apply")
    saved.origin = capture_origin(saved, kind="packet", source_id=packet.id,
        observation="executor_reported" if by_orbit else "candidate_recorded",
        packet_status=packet.status, packet_result=packet.result_status, design_captured=False)
    saved.origin = {**saved.origin, "packet_materials": packet_materials(
        packet.answers or [], packet.fields or {}, packet.cover_letter)}
    db.add(saved)
    packet.application_id = entry.id
    return entry.id


async def record_result(db: AsyncSession, user: User, packet: ApplicationPacket, body: ResultIn) -> ResultOut:
    """The executor's report on a leased packet. The caller commits."""
    now = datetime.now(UTC)
    late = packet.status in ("ready", "expired") and packet.result_status is None and packet.leased_at is not None \
        and (aware(packet.leased_at) or now) >= now - rules.RESULT_GRACE
    if packet.status != "leased" and not late:
        raise HTTPException(status.HTTP_409_CONFLICT, "That application isn't leased to this device.")
    shot = _png(body.screenshot_png_b64) if body.screenshot_png_b64 else None
    payload = body.submitted.model_dump() if body.submitted else None
    if payload is not None and len(json.dumps(payload)) > rules.MAX_PAYLOAD_CHARS:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The submitted payload is too big.")
    packet.result_status, packet.result_reason, packet.result_at = body.status, body.reason, now
    packet.lease_until = packet.lease_holder = None
    packet.confirmation_text = (body.confirmation_text or "")[:8000] or None
    packet.final_url = (body.final_url or "")[:2000] or None
    if shot is not None:
        proof = await db.get(ApplyProof, packet.id)
        if proof is None:
            db.add(ApplyProof(packet_id=packet.id, user_id=user.id, png=shot, size_bytes=len(shot)))
        else:
            proof.png, proof.size_bytes = shot, len(shot)
    tracker_id = None
    if body.status == "submitted":
        if packet.charge is None and not await quota.hold(db, user, packet):
            log.info("orbit apply: %s submitted with nothing left to charge; not charged", packet.id)
        packet.status, packet.submitted_at, packet.reason = "submitted", now, ""
        packet.submitted_payload = payload
        tracker_id = await track_applied(db, user, packet, by_orbit=True)
    else:
        quota.release(db, packet)
        if body.status == "needs_you":
            packet.status = "needs_you"
            packet.reason = REASON_TEXT.get(body.reason or "", "The browser stopped and needs you to finish.")
            unknown = [q.model_dump() for q in body.unknown_questions]
            packet.unknown_questions = unknown
            if unknown:
                ids = {q.get("id") for q in packet.questions or []}
                extra = [FormQuestion(id=f"unknown:{i}:{bank.norm_label(q.label)[:60]}", label=q.label, kind=q.kind,
                                      required=True, options=[{"label": o, "value": o} for o in q.options or []])
                         .model_dump() for i, q in enumerate(body.unknown_questions)]
                packet.questions = [*(packet.questions or []), *(q for q in extra if q["id"] not in ids)]
                await reanswer(db, user, packet)
        elif body.status == "failed":
            packet.status = "failed"
            packet.reason = REASON_TEXT.get(body.reason or "error", REASON_TEXT["error"])
        else:
            packet.status = "skipped"
            packet.reason = REASON_TEXT.get(body.reason or "", "The browser skipped it.")
    await pacing.evaluate_site(db, packet.ats, now)
    return ResultOut(id=packet.id, status=packet.status, charged=packet.status == "submitted" and packet.charge
                     is not None, tracker_id=tracker_id)
