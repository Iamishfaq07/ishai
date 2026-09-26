"""The account data export (GET /v1/auth/me/export). One JSON document with every row the account owns.

Left out on purpose: the password hash and token version (secrets), document chunks and embeddings (search data
derived from the documents, which are included in full), provider request internals, and dead-letter/job plumbing.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import (
    Answer,
    AnswerFeedback,
    AuditLog,
    Document,
    LiveSessionRow,
    Question,
    SessionSummary,
    SessionTurn,
    Story,
    UsageEvent,
    User,
    Workspace,
)

_NEVER = {"password_hash", "token_version", "embedding"}


def _row(obj: Any) -> dict[str, Any]:
    return {c.key: getattr(obj, c.key) for c in inspect(obj).mapper.column_attrs if c.key not in _NEVER}


async def build_export(db: AsyncSession, user_id: str) -> dict[str, Any]:
    user = await db.get(User, user_id)
    assert user is not None
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
        "answer_ratings": [_row(f) for f in (await db.scalars(
            select(AnswerFeedback).where(AnswerFeedback.user_id == user_id)
            .order_by(AnswerFeedback.created_at))).all()],
        "sessions": [{**_row(s), "transcript": turns[s.id], "questions": questions[s.id], "answers": answers[s.id],
                      "report": (summaries[s.id][0]["content"] if summaries[s.id] else None)} for s in sessions],
        "usage": [_row(u) for u in (await db.scalars(select(UsageEvent).where(UsageEvent.user_id == user_id)
                                                      .order_by(UsageEvent.created_at))).all()],
        "security_log": [{"action": a.action, "ip": a.ip, "at": a.created_at}
                         for a in (await db.scalars(select(AuditLog).where(AuditLog.user_id == user_id)
                                                    .order_by(AuditLog.created_at))).all()],
    }
