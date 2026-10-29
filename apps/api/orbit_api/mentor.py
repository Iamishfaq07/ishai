"""Ask a mentor: share a mock interview's report with someone you trust and get their feedback on each answer.

- `POST   /v1/sessions/{id}/mentor-shares`: share one finished mock interview ({label, days, answers}); returns the link
  once (only its hash is kept).
- `GET    /v1/sessions/{id}/mentor-shares`: its links, how often each was opened, and the mentors' comments.
- `DELETE /v1/mentor-shares/{share_id}`: turn a link off now.
- `POST   /v1/mentor-shares/read`: mark the comments seen.
- `GET    /v1/public/mentor-review/{token}`: what the mentor sees (no account): the snapshot and the comments so far.
- `POST   /v1/public/mentor-review/{token}/comments`: a mentor's comment, on one answer or the whole interview.

What's shared is a snapshot taken when the link is made: the role, the score, each question with the AI's feedback,
and the candidate's own answers only if they choose to include them. Never the resume, documents, recording, email or
the rest of the account. Links expire (1 to 30 days), can be turned off any time, and go with the session if it's
deleted. Each new comment leaves the candidate a notice.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import LiveSessionRow, MentorComment, MentorShare, SessionSummary, User
from orbit_api.notices import notify
from orbit_api.ratelimit import limit, limit_user

router = APIRouter(tags=["mentor review"], dependencies=[Depends(limit_user("mentor-shares", rate_per_s=1, burst=20))])
public_router = APIRouter(prefix="/v1/public/mentor-review", tags=["mentor review"])
_view_limit = Depends(limit("mentor-review-view", 1, 30))
_comment_limit = Depends(limit("mentor-review-comment", 0.2, 10))

MAX_SHARES_PER_SESSION = 10
MAX_COMMENTS = 200
GONE = "This link has expired or was turned off. Ask for a new one."


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def snapshot(session: LiveSessionRow, summary: dict[str, Any], owner: User, answers: bool) -> dict[str, Any]:
    """The report as the mentor sees it, frozen now. The candidate's words only if they chose to include them."""
    review = summary.get("review") or {}
    delivery = summary.get("delivery") or {}
    items = []
    for item in review.get("items") or []:
        out = {"question": item.get("question", ""), "score": item.get("score"), "feedback": item.get("feedback", "")}
        if answers:
            out["you_said"] = item.get("you_said", "")
            out["better"] = item.get("better", "")
        items.append(out)
    ended = session.ended_at or session.created_at
    return {
        "first_name": (owner.name or "").split(" ")[0][:40],
        "role": session.role or "",
        "company": session.company or "",
        "title": session.title,
        "date": _aware(ended).date().isoformat(),
        "overall_score": review.get("overall_score"),
        "strengths": review.get("strengths") or [],
        "improvements": review.get("improvements") or [],
        "items": items,
        "answers_included": answers,
        "delivery": {k: delivery.get(k) for k in ("words_per_minute", "fillers_per_minute", "average_answer_words")}
        if delivery else None,
    }


class ShareIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    label: str = Field("", max_length=80)
    days: int = Field(7, ge=1, le=30)
    # Include the candidate's own answers (and the AI's stronger version of each), not only questions and scores.
    answers: bool = True


class CommentOut(BaseModel):
    id: str
    item: int | None
    author: str
    body: str
    created_at: datetime
    read: bool


class ShareOut(BaseModel):
    id: str
    label: str
    expires_at: datetime
    active: bool
    views: int
    last_viewed_at: datetime | None
    answers_included: bool
    comments: list[CommentOut]
    # Only when the link was just made: the address to send (the token isn't kept).
    url: str | None = None


def _comment_out(c: MentorComment) -> CommentOut:
    return CommentOut(id=c.id, item=c.item, author=c.author, body=c.body, created_at=_aware(c.created_at),
                      read=c.read_at is not None)


def _active(row: MentorShare, now: datetime) -> bool:
    return row.revoked_at is None and _aware(row.expires_at) > now


async def _share_out(db: AsyncSession, row: MentorShare, url: str | None = None) -> ShareOut:
    comments = (await db.scalars(select(MentorComment).where(MentorComment.share_id == row.id)
                                 .order_by(MentorComment.created_at))).all()
    return ShareOut(id=row.id, label=row.label, expires_at=_aware(row.expires_at),
                    active=_active(row, datetime.now(UTC)),
                    views=row.views, last_viewed_at=_aware(row.last_viewed_at) if row.last_viewed_at else None,
                    answers_included=bool(row.snapshot.get("answers_included")),
                    comments=[_comment_out(c) for c in comments], url=url)


async def _owned_session(db: AsyncSession, session_id: str, user: User) -> LiveSessionRow:
    row = await db.get(LiveSessionRow, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return row


@router.post("/v1/sessions/{session_id}/mentor-shares", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
async def create_share(session_id: str, body: ShareIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> ShareOut:
    session = await _owned_session(db, session_id, user)
    summary = await db.scalar(select(SessionSummary).where(SessionSummary.session_id == session.id))
    if session.type != "mock" or summary is None or not (summary.content or {}).get("review"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a finished mock interview with its report can be shared.")
    count = int(await db.scalar(select(func.count()).select_from(MentorShare).where(
        MentorShare.session_id == session.id)) or 0)
    if count >= MAX_SHARES_PER_SESSION:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Turn off an older link for this interview before making another.")
    token = secrets.token_urlsafe(24)
    row = MentorShare(user_id=user.id, session_id=session.id, token_hash=_hash(token), label=body.label,
                      snapshot=snapshot(session, summary.content, user, body.answers),
                      expires_at=datetime.now(UTC) + timedelta(days=body.days), views=0)
    db.add(row)
    await db.commit()
    url = f"{get_settings().web_url.rstrip('/')}/review/{token}"
    return await _share_out(db, row, url)


@router.get("/v1/sessions/{session_id}/mentor-shares", response_model=list[ShareOut])
async def list_shares(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> list[ShareOut]:
    session = await _owned_session(db, session_id, user)
    rows = (await db.scalars(select(MentorShare).where(MentorShare.session_id == session.id)
                             .order_by(MentorShare.created_at.desc()))).all()
    return [await _share_out(db, r) for r in rows]


@router.delete("/v1/mentor-shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(share_id: str, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    row = await db.get(MentorShare, share_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    row.revoked_at = row.revoked_at or datetime.now(UTC)
    await db.commit()


class ReadIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=36)


@router.post("/v1/mentor-shares/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(body: ReadIn, user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    shares = select(MentorShare.id).where(MentorShare.user_id == user.id, MentorShare.session_id == body.session_id)
    await db.execute(update(MentorComment).where(MentorComment.user_id == user.id, MentorComment.share_id.in_(shares),
                                                 MentorComment.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    await db.commit()


# ---- the mentor's side (no account) --------------------------------------------------------------------------------

class PublicComment(BaseModel):
    item: int | None
    author: str
    body: str
    created_at: datetime


class ReviewOut(BaseModel):
    report: dict[str, Any]
    expires_at: datetime
    comments: list[PublicComment]


async def _live_share(db: AsyncSession, token: str) -> MentorShare:
    if not (16 <= len(token) <= 64):
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE)
    row = await db.scalar(select(MentorShare).where(MentorShare.token_hash == _hash(token)))
    if row is None or not _active(row, datetime.now(UTC)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE)
    return row


async def _review_out(db: AsyncSession, row: MentorShare) -> ReviewOut:
    comments = (await db.scalars(select(MentorComment).where(MentorComment.share_id == row.id)
                                 .order_by(MentorComment.created_at))).all()
    return ReviewOut(report=row.snapshot, expires_at=_aware(row.expires_at),
                     comments=[PublicComment(item=c.item, author=c.author, body=c.body,
                                             created_at=_aware(c.created_at)) for c in comments])


@public_router.get("/{token}", response_model=ReviewOut, dependencies=[_view_limit])
async def view(token: str, db: Annotated[AsyncSession, Depends(get_db)]) -> ReviewOut:
    row = await _live_share(db, token)
    row.views += 1
    row.last_viewed_at = datetime.now(UTC)
    await db.commit()
    return await _review_out(db, row)


class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    author: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=2, max_length=2000)
    # The answer it's about (its place in the report), or None for the whole interview.
    item: int | None = Field(None, ge=0, le=200)


@public_router.post("/{token}/comments", response_model=ReviewOut, status_code=status.HTTP_201_CREATED,
                    dependencies=[_comment_limit])
async def comment(token: str, body: CommentIn, db: Annotated[AsyncSession, Depends(get_db)]) -> ReviewOut:
    row = await _live_share(db, token)
    if body.item is not None and body.item >= len(row.snapshot.get("items") or []):
        raise HTTPException(422, "That answer isn't in this report.")
    count = int(await db.scalar(select(func.count()).select_from(MentorComment).where(
        MentorComment.share_id == row.id)) or 0)
    if count >= MAX_COMMENTS:
        raise HTTPException(status.HTTP_409_CONFLICT, "This report has as many comments as it can take.")
    first = await db.scalar(select(func.count()).select_from(MentorComment).where(
        MentorComment.share_id == row.id, MentorComment.read_at.is_(None))) == 0
    db.add(MentorComment(share_id=row.id, user_id=row.user_id, item=body.item, author=body.author, body=body.body))
    if first:  # one notice per batch of unread comments, not one per comment
        notify(db, row.user_id, "mentor", f"{body.author} left feedback on your mock interview",
               body.body[:200], link=f"/sessions/{row.session_id}#mentor")
    await db.commit()
    return await _review_out(db, row)
