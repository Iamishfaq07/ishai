"""Answer feedback: 👍/👎 on a live answer, and for 👎 a reason.

`PUT /v1/sessions/{id}/answers/{answer_id}/feedback` stores (or, with `rating: null`, clears) the rating. Two uses:

- **Learning** (`learned_preferences`): a reason the user keeps giving ("too long" three times in their last 40
  ratings) becomes a fixed style hint in every later session's prompt. Only these fixed strings reach the prompt,
  never user text.
- **Quality** (`GET /v1/admin/feedback`, admin/routes.py): satisfaction and 👎 reasons by question type and
  model. Counts only, no answer content.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import Answer, AnswerFeedback, LiveSessionRow, Question, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1", tags=["feedback"])

Rating = Literal["up", "down"]
# "inappropriate": the answer was inappropriate or harmful (Microsoft Store policy 11.16: a generative-AI app lets
# people report what it generated). Counted in the admin report; never a learned style hint.
Reason = Literal["too_long", "too_generic", "inaccurate", "off_topic", "too_formal", "inappropriate"]

# Learned style hints: a reason given at least LEARN_MIN times among the user's last LEARN_WINDOW ratings.
LEARN_WINDOW = 40
LEARN_MIN = 3
MAX_RATINGS_PER_SESSION = 500  # far more answers than any session has
LEARNED_HINTS: dict[str, str] = {
    "too_long": "They often rate answers too long: keep every answer noticeably tighter than the length setting "
                "alone would.",
    "too_generic": "They often rate answers too generic: be concrete, and prefer specifics from their documents "
                   "and stories over general advice.",
    "too_formal": "They often rate answers too formal: sound relaxed and conversational, like natural speech.",
    "inaccurate": "They have flagged inaccurate answers: never state anything about them that the reference data "
                  "doesn't support.",
    "off_topic": "They have flagged answers that missed the question: answer exactly what was asked, in the first "
                 "sentence.",
}

feedback_limit = limit_user("answer-feedback", rate_per_s=2, burst=30)


class FeedbackIn(BaseModel):
    rating: Rating | None
    reason: Reason | None = None


class FeedbackOut(BaseModel):
    answer_id: str
    rating: Rating | None
    reason: Reason | None


@router.put("/sessions/{session_id}/answers/{answer_id}/feedback", response_model=FeedbackOut,
            dependencies=[Depends(feedback_limit)])
async def rate_answer(session_id: str, answer_id: str, body: FeedbackIn,
                      user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> FeedbackOut:
    session = await db.get(LiveSessionRow, session_id)
    if session is None or session.user_id != user.id or len(answer_id) > 36:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    row = await db.scalar(select(AnswerFeedback).where(AnswerFeedback.answer_id == answer_id))
    if row is not None and row.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    answer = await db.get(Answer, answer_id)
    if answer is not None and answer.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    if answer is None and row is None:
        # Answers are written in the background, so one rated the moment it finished may not be stored yet: that's
        # fine during the session, and bounded. Afterwards, only real answers of this session can be rated (made-up
        # ids would skew the feedback the admin and the style hints learn from).
        rated = await db.scalar(select(func.count()).select_from(AnswerFeedback).where(
            AnswerFeedback.session_id == session_id)) or 0
        if session.status == "ended" or rated >= MAX_RATINGS_PER_SESSION:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    if body.rating is None:
        if row is not None:
            await db.delete(row)
            await db.commit()
        return FeedbackOut(answer_id=answer_id, rating=None, reason=None)
    reason = body.reason if body.rating == "down" else None  # a reason explains a 👎 only
    if row is None:
        row = AnswerFeedback(user_id=user.id, session_id=session_id, answer_id=answer_id, rating=body.rating,
                             reason=reason)
        db.add(row)
    else:
        row.rating, row.reason = body.rating, reason
    await db.commit()
    return FeedbackOut(answer_id=answer_id, rating=body.rating, reason=reason)


async def session_feedback(db: AsyncSession, session_id: str) -> dict[str, dict[str, str | None]]:
    """answer_id → {rating, reason} for one session (the session review shows and edits them)."""
    rows = (await db.scalars(select(AnswerFeedback).where(AnswerFeedback.session_id == session_id))).all()
    return {r.answer_id: {"rating": r.rating, "reason": r.reason} for r in rows}


async def learned_preferences(db: AsyncSession, user_id: str) -> list[str]:
    """Style hints learned from the reasons this user keeps giving (fixed strings, never user text)."""
    reasons = (await db.scalars(
        select(AnswerFeedback.reason).where(AnswerFeedback.user_id == user_id)
        .order_by(AnswerFeedback.updated_at.desc()).limit(LEARN_WINDOW))).all()
    counts = Counter(r for r in reasons if r)
    return [LEARNED_HINTS[r] for r, n in counts.most_common() if n >= LEARN_MIN and r in LEARNED_HINTS]


class FeedbackGroup(BaseModel):
    key: str
    up: int
    down: int


class FeedbackReport(BaseModel):
    days: int
    up: int
    down: int
    # Share of 👍 among rated answers, 0-1; None with nothing rated.
    satisfaction: float | None
    reasons: dict[str, int]
    by_type: list[FeedbackGroup]
    by_model: list[FeedbackGroup]
    rated_share: float | None = Field(None, description="Rated answers / completed answers in the period")


async def feedback_report(db: AsyncSession, days: int) -> FeedbackReport:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (await db.execute(
        select(AnswerFeedback.rating, AnswerFeedback.reason, Question.type, Answer.model)
        .outerjoin(Answer, Answer.id == AnswerFeedback.answer_id)
        .outerjoin(Question, Question.id == Answer.question_id)
        .where(AnswerFeedback.updated_at >= since))).all()
    completed = await db.scalar(select(func.count()).select_from(Answer)
                                .where(Answer.created_at >= since, Answer.status == "completed")) or 0
    up = sum(1 for r in rows if r[0] == "up")
    down = len(rows) - up

    def group(index: int, fallback: str) -> list[FeedbackGroup]:
        tally: dict[str, list[int]] = {}
        for r in rows:
            t = tally.setdefault(r[index] or fallback, [0, 0])
            t[0 if r[0] == "up" else 1] += 1
        return sorted((FeedbackGroup(key=k, up=v[0], down=v[1]) for k, v in tally.items()),
                      key=lambda g: -(g.up + g.down))

    return FeedbackReport(
        days=days, up=up, down=down, satisfaction=round(up / len(rows), 3) if rows else None,
        reasons=dict(Counter(r[1] for r in rows if r[0] == "down" and r[1]).most_common()),
        by_type=group(2, "chat"), by_model=group(3, "unknown"),
        rated_share=round(len(rows) / completed, 3) if completed else None,
    )

