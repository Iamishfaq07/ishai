"""The account data export (GET /v1/auth/me/export). One JSON document with every row the account owns.

Left out on purpose: the password hash and token version (secrets), document chunks and embeddings (search data
derived from the documents, which are included in full), provider request internals, and dead-letter/job plumbing.
Messages sent from the Contact page while signed in are included as sent, with the replies the sender was emailed;
the admin's note on them and the network hash are the admin's, not the account's.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from orbit_api.models import (
    Answer,
    AnswerFeedback,
    AuditLog,
    CareerPreparation,
    ContactMessage,
    DebriefAttempt,
    Document,
    EvidenceItem,
    JobApplication,
    JobContact,
    JobFitCheck,
    JobOffer,
    JobSearchProfile,
    LaunchAccessClaim,
    LinkedInProfileRow,
    LiveSessionRow,
    Question,
    Resume,
    SavedAnswer,
    SessionSummary,
    SessionTurn,
    Story,
    SupportThread,
    UsageEvent,
    User,
    Workspace,
)

# admin_note: the admin's private notes on the account (admin/accounts.py) or on a contact message, not the account's
# own data; network_hash: a contact message's keyed network hash (rate limits).
_NEVER = {"password_hash", "token_version", "embedding", "admin_note", "network_hash"}


def _row(obj: Any) -> dict[str, Any]:
    return {c.key: getattr(obj, c.key) for c in inspect(obj).mapper.column_attrs if c.key not in _NEVER}


async def build_export(db: AsyncSession, user_id: str) -> dict[str, Any]:
    user = await db.get(User, user_id)
    if user is None:
        raise RuntimeError("account disappeared during export")
    sessions = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user_id)
                                 .order_by(LiveSessionRow.created_at))).all()
    ids = [s.id for s in sessions]

    async def per_session(model: Any) -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
        if ids:
            for r in (await db.scalars(select(model).where(model.session_id.in_(ids))
                                       .order_by(model.created_at))).all():
                out[r.session_id].append(_row(r))
        return out

    turns, questions, answers, summaries = (await per_session(SessionTurn), await per_session(Question),
                                            await per_session(Answer), await per_session(SessionSummary))
    return {
        "format": "orbit-export/1",
        "exported_at": datetime.now(UTC).isoformat(),
        "account": _row(user),
        "documents": [_row(d) for d in (await db.scalars(select(Document).where(Document.user_id == user_id)
                                                          .order_by(Document.created_at))).all()],
        "workspaces": [_row(w) for w in (await db.scalars(select(Workspace).where(Workspace.user_id == user_id)
                                                           .order_by(Workspace.created_at))).all()],
        "stories": [_row(st) for st in (await db.scalars(select(Story).where(Story.user_id == user_id)
                                                          .order_by(Story.created_at))).all()],
        "linkedin_profile": [_row(r) for r in (await db.scalars(select(LinkedInProfileRow).where(
            LinkedInProfileRow.user_id == user_id))).all()],
        "job_offers": [_row(o) for o in (await db.scalars(select(JobOffer).where(JobOffer.user_id == user_id)
                                                           .order_by(JobOffer.created_at))).all()],
        "evidence": [_row(e) for e in (await db.scalars(select(EvidenceItem).where(EvidenceItem.user_id == user_id)
                                                         .order_by(EvidenceItem.created_at))).all()],
        "saved_answers": [_row(a) for a in (await db.scalars(select(SavedAnswer).where(SavedAnswer.user_id == user_id)
                                                              .order_by(SavedAnswer.created_at))).all()],
        "resumes": [_row(r) for r in (await db.scalars(select(Resume).where(Resume.user_id == user_id)
                                                       .order_by(Resume.created_at))).all()],
        "career_preparations": [_row(r) for r in (await db.scalars(select(CareerPreparation).where(
            CareerPreparation.user_id == user_id).order_by(CareerPreparation.created_at))).all()],
        "debrief_attempts": [_row(r) for r in (await db.scalars(select(DebriefAttempt).where(
            DebriefAttempt.user_id == user_id).order_by(DebriefAttempt.created_at))).all()],
        "launch_access_requests": [_row(r) for r in (await db.scalars(select(LaunchAccessClaim).where(
            LaunchAccessClaim.user_id == user_id).order_by(LaunchAccessClaim.created_at))).all()],
        "answer_ratings": [_row(f) for f in (await db.scalars(
            select(AnswerFeedback).where(AnswerFeedback.user_id == user_id)
            .order_by(AnswerFeedback.created_at))).all()],
        "sessions": [{**_row(s), "transcript": turns[s.id], "questions": questions[s.id], "answers": answers[s.id],
                      "report": (summaries[s.id][0]["content"] if summaries[s.id] else None)} for s in sessions],
        "job_search": {
            "profile": _row(p) if (p := await db.get(JobSearchProfile, user_id)) else None,
            "tracker": [_row(t) for t in (await db.scalars(select(JobApplication).where(
                JobApplication.user_id == user_id).order_by(JobApplication.created_at))).all()],
            "fit_checks": [_row(f) for f in (await db.scalars(select(JobFitCheck).where(
                JobFitCheck.user_id == user_id).order_by(JobFitCheck.created_at))).all()],
            "contacts": [_row(c) for c in (await db.scalars(select(JobContact).where(
                JobContact.user_id == user_id).order_by(JobContact.created_at))).all()],
        },
        "usage": [_row(u) for u in (await db.scalars(select(UsageEvent).where(UsageEvent.user_id == user_id)
                                                      .order_by(UsageEvent.created_at))).all()],
        "contact_messages": [_row(m) for m in (await db.scalars(select(ContactMessage).where(
            ContactMessage.user_id == user_id).order_by(ContactMessage.created_at))).all()],
        "support_chats": [
            {"id": t.id, "status": t.status, "name": t.name, "email": t.email, "updated_at": t.updated_at,
             "messages": [_row(m) for m in t.messages]}
            for t in (await db.scalars(
                select(SupportThread).where(SupportThread.user_id == user_id)
                .options(selectinload(SupportThread.messages)).order_by(SupportThread.created_at))).all()],
        "security_log": [{"action": a.action, "ip": a.ip, "at": a.created_at}
                         for a in (await db.scalars(select(AuditLog).where(AuditLog.user_id == user_id)
                                                    .order_by(AuditLog.created_at))).all()],
    }
