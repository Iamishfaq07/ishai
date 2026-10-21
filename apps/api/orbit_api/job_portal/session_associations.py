"""Candidate-reviewed session attribution; no transcript or source-context rewriting."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import AuditLog

LINK = "career.session.link"
UNLINK = "career.session.unlink"
ACTIONS = (LINK, UNLINK)


def target(application_id: str, session_id: str) -> str:
    return f"{application_id}:{session_id}"


async def history(db: AsyncSession, user_id: str, application_id: str | None = None,
                  limit: int | None = None) -> list[AuditLog]:
    query = select(AuditLog).where(AuditLog.user_id == user_id, AuditLog.action.in_(ACTIONS))
    if application_id is not None:
        query = query.where(AuditLog.target.startswith(f"{application_id}:", autoescape=True))
    query = query.order_by(AuditLog.created_at.desc(), AuditLog.id)
    if limit is not None:
        query = query.limit(limit)
    return list((await db.scalars(query)).all())
