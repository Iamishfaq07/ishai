"""A tracked job's interview rounds (job_portal/interview.py): the round types, how a round is named, and each job's
latest round started from it, read in two queries for a whole tracker."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import LiveSessionRow, SessionSummary

RoundType = Literal["hr", "technical", "managerial", "final"]
ROUND_TYPES: tuple[RoundType, ...] = ("hr", "technical", "managerial", "final")
ROUND_NAME: dict[str, str] = {"hr": "HR round", "technical": "Technical round", "managerial": "Managerial round",
                              "final": "Final round"}
MAX_ROUND = 20


def as_round_type(value: str | None) -> RoundType | None:
    return next((t for t in ROUND_TYPES if t == value), None)


def round_label(round_type: str | None, number: int | None) -> str:
    """"Round 2 · Technical round", "HR round", "Round 3", or "" when neither is known."""
    return " · ".join(x for x in (f"Round {number}" if number else "", ROUND_NAME.get(round_type or "", "")) if x)


def review_score(content: object) -> int | None:
    """The overall score (1-5) of a session report's review, when it has one."""
    review = content.get("review") if isinstance(content, dict) else None
    score = review.get("overall_score") if isinstance(review, dict) else None
    return score if isinstance(score, int) else None


class LastRound(BaseModel):
    """The latest ended session started from a job: its page has the summary and the scorecard."""
    id: str
    at: datetime
    practice: bool  # a mock interview for the job, not the real round
    score: int | None  # the review's overall score, 1-5


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def last_rounds(db: AsyncSession, user_id: str, entry_ids: list[str]) -> dict[str, LastRound]:
    """Tracker entry id -> its latest ended session started from it (only the account's own sessions)."""
    if not entry_ids:
        return {}
    rows = (await db.execute(
        select(LiveSessionRow.id, LiveSessionRow.application_id, LiveSessionRow.type, LiveSessionRow.ended_at,
               LiveSessionRow.created_at)
        .where(LiveSessionRow.user_id == user_id, LiveSessionRow.application_id.in_(entry_ids),
               LiveSessionRow.status == "ended"))).all()
    latest: dict[str, tuple[str, datetime, bool]] = {}
    for sid, app, kind, ended, created in rows:
        at = _aware(ended or created)
        if app and (app not in latest or at > latest[app][1]):
            latest[app] = (sid, at, kind == "mock")
    if not latest:
        return {}
    scores = {sid: review_score(content) for sid, content in (await db.execute(
        select(SessionSummary.session_id, SessionSummary.content)
        .where(SessionSummary.session_id.in_([v[0] for v in latest.values()])))).all()}
    return {app: LastRound(id=sid, at=at, practice=practice, score=scores.get(sid))
            for app, (sid, at, practice) in latest.items()}
