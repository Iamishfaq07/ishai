"""Answer bank: questions the user has worked out how to answer, in their own words, reused in every interview.

An answer is usually saved from a session review (its "Try saying", edited) and loaded into each live session's
retrieval index as a verified candidate fact (`index_chunk`), as the stories are. When the interviewer asks the same
question again, the copilot's answer starts from the user's prepared one (live/context_builder.retrieve) instead of
starting over. Saving a question that's already in the bank replaces its answer rather than adding a second copy.
"""

import re
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.answers.match import DOC_KIND, LABEL, same_question
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.live.mock_interviewer import bare_question
from orbit_api.models import LiveSessionRow, SavedAnswer, User
from orbit_api.ratelimit import limit_user
from orbit_api.retrieval.index import IndexedChunk

router = APIRouter(prefix="/v1/answers", tags=["answers"])
answers_limit = limit_user("answers", rate_per_s=3, burst=60)

MAX_ANSWERS = 200
MAX_QUESTION = 500
MAX_ANSWER = 3_000
MAX_INDEXED_CHARS = 1_500


class AnswerIn(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION)
    answer: str = Field(min_length=1, max_length=MAX_ANSWER)
    # The session whose review it's saved from, when it is.
    session_id: str | None = Field(None, max_length=36)

    @field_validator("question")
    @classmethod
    def _one_line(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", bare_question(v)).strip()
        if not v:
            raise ValueError("A saved answer needs its question.")
        return v

    @field_validator("answer")
    @classmethod
    def _trimmed(cls, v: str) -> str:
        v = re.sub(r"[ \t]+", " ", v).strip()
        if not v:
            raise ValueError("Write the answer first.")
        return v


class AnswerOut(BaseModel):
    id: str
    question: str
    answer: str
    session_id: str | None
    created_at: datetime
    updated_at: datetime


def answer_text(a: SavedAnswer) -> str:
    return f"Question: {a.question} The user's prepared answer: {a.answer}"


def index_chunk(a: SavedAnswer, embedding: list[float]) -> IndexedChunk:
    # Capped so one long answer can't take the whole answer context (MAX_CONTEXT_CHARS) from the resume and JD.
    return IndexedChunk(a.id, DOC_KIND, "answer", f"{LABEL}{a.question}"[:300], answer_text(a)[:MAX_INDEXED_CHARS],
                        True, embedding, doc_title="My answers")


def _out(a: SavedAnswer) -> AnswerOut:
    return AnswerOut(id=a.id, question=a.question, answer=a.answer, session_id=a.session_id, created_at=a.created_at,
                     updated_at=a.updated_at)


async def _owned(db: AsyncSession, answer_id: str, user: User) -> SavedAnswer:
    a = await db.get(SavedAnswer, answer_id)
    if a is None or a.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your answers")
    return a


async def _session_id(db: AsyncSession, user: User, session_id: str | None) -> str | None:
    """The session it was saved from, kept only when it's the user's own."""
    if not session_id:
        return None
    row = await db.get(LiveSessionRow, session_id)
    return session_id if row is not None and row.user_id == user.id else None


@router.get("", response_model=list[AnswerOut], dependencies=[Depends(answers_limit)])
async def list_answers(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> list[AnswerOut]:
    """Most recently edited first."""
    rows = (await db.scalars(select(SavedAnswer).where(SavedAnswer.user_id == user.id)
                             .order_by(SavedAnswer.updated_at.desc(), SavedAnswer.created_at.desc()))).all()
    return [_out(a) for a in rows]


@router.post("", response_model=AnswerOut, status_code=201, dependencies=[Depends(answers_limit)])
async def save_answer(body: AnswerIn, response: Response, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> AnswerOut:
    """Save an answer; a question already in the bank (in near enough the same words) gets this answer instead."""
    rows = (await db.scalars(select(SavedAnswer).where(SavedAnswer.user_id == user.id))).all()
    existing = next((a for a in rows if same_question(a.question, body.question)), None)
    session_id = await _session_id(db, user, body.session_id)
    if existing is not None:
        existing.question, existing.answer = body.question, body.answer
        existing.session_id = session_id or existing.session_id
        existing.embedding, existing.embedding_model = None, None  # re-embed on the next session load
        response.status_code = status.HTTP_200_OK
        a = existing
    else:
        if len(rows) >= MAX_ANSWERS:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"You can keep up to {MAX_ANSWERS} answers. Delete one to save another.")
        a = SavedAnswer(user_id=user.id, question=body.question, answer=body.answer, session_id=session_id)
        db.add(a)
    await db.commit()
    await db.refresh(a)
    return _out(a)


@router.put("/{answer_id}", response_model=AnswerOut, dependencies=[Depends(answers_limit)])
async def update_answer(answer_id: str, body: AnswerIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> AnswerOut:
    a = await _owned(db, answer_id, user)
    a.question, a.answer = body.question, body.answer
    if body.session_id is not None:
        a.session_id = await _session_id(db, user, body.session_id)
    a.embedding, a.embedding_model = None, None
    await db.commit()
    await db.refresh(a)
    return _out(a)


@router.delete("/{answer_id}", status_code=204, dependencies=[Depends(answers_limit)])
async def delete_answer(answer_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await db.delete(await _owned(db, answer_id, user))
    await db.commit()

