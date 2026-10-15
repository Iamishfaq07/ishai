"""Code AI: the problem set by pattern with the user's progress, each problem (with its tests, which run in the
browser), and attempts: the code, the explanation and the test result, reviewed by the AI interviewer (free, a
day's allowance). Hints are part of the problem, no AI needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.code import review as reviewmod
from orbit_api.code.problems import BY_ID, PATTERNS, PROBLEMS, Problem
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import CodeAttempt, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/code", tags=["code"])
read_limit = Depends(limit_user("code-read", rate_per_s=3, burst=60))
ai_limits = [Depends(limit("code-ai", rate_per_s=0.3, burst=10)),
             Depends(limit_user("code-ai-user", rate_per_s=30 / 3600, burst=8))]
Language = Literal["javascript", "python", "java", "cpp"]


class ProblemSummary(BaseModel):
    id: str
    title: str
    pattern: str
    difficulty: str
    attempts: int
    solved: bool


class ProblemsOut(BaseModel):
    patterns: list[str]
    problems: list[ProblemSummary]
    reviews_left: int | None


class AttemptOut(BaseModel):
    id: str
    language: str
    code: str
    approach: str
    passed: int
    total: int
    solved: bool
    review: reviewmod.Review | None
    created_at: datetime


class ProblemOut(BaseModel):
    problem: Problem
    attempts: list[AttemptOut]
    reviews_left: int | None


def _attempt_out(a: CodeAttempt) -> AttemptOut:
    return AttemptOut(id=a.id, language=a.language, code=a.code, approach=a.approach, passed=a.passed, total=a.total,
                      solved=a.solved, review=reviewmod.Review.model_validate(a.review) if a.review else None,
                      created_at=a.created_at)


async def _left(db: AsyncSession, user: User) -> int | None:
    from orbit_api.job_portal.routes import _ai_left

    return await _ai_left(db, user, "code_review", get_settings().code_review_daily)


@router.get("/problems", response_model=ProblemsOut, dependencies=[read_limit])
async def list_problems(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ProblemsOut:
    rows = (await db.execute(select(CodeAttempt.problem_id, func.count(), func.max(CodeAttempt.solved))
                             .where(CodeAttempt.user_id == user.id).group_by(CodeAttempt.problem_id))).all()
    seen = {pid: (int(n), bool(s)) for pid, n, s in rows}
    return ProblemsOut(patterns=PATTERNS, reviews_left=await _left(db, user), problems=[
        ProblemSummary(id=p.id, title=p.title, pattern=p.pattern, difficulty=p.difficulty,
                       attempts=seen.get(p.id, (0, False))[0], solved=seen.get(p.id, (0, False))[1])
        for p in PROBLEMS])


def _problem(problem_id: str) -> Problem:
    p = BY_ID.get(problem_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Problem not found")
    return p


@router.get("/problems/{problem_id}", response_model=ProblemOut, dependencies=[read_limit])
async def get_problem(problem_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> ProblemOut:
    p = _problem(problem_id)
    rows = (await db.scalars(select(CodeAttempt).where(CodeAttempt.user_id == user.id,
                                                       CodeAttempt.problem_id == p.id)
                             .order_by(CodeAttempt.created_at.desc()).limit(10))).all()
    return ProblemOut(problem=p, attempts=[_attempt_out(a) for a in rows], reviews_left=await _left(db, user))


class AttemptIn(BaseModel):
    language: Language
    code: str = Field(min_length=1, max_length=reviewmod.MAX_CODE)
    approach: str = Field("", max_length=3_000)
    passed: int = Field(0, ge=0, le=100)
    total: int = Field(0, ge=0, le=100)
    failing: str = Field("", max_length=600)  # the first failing test, as the browser showed it


_locks: dict[str, asyncio.Lock] = {}


@router.post("/problems/{problem_id}/attempts", response_model=AttemptOut, status_code=status.HTTP_201_CREATED,
             dependencies=ai_limits)
async def review_attempt(problem_id: str, body: AttemptIn, user: Annotated[User, Depends(require_verified_email)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> AttemptOut:
    """Save an attempt and have the AI interviewer review it: free, ORBIT_CODE_REVIEW_DAILY a day."""
    from orbit_api.job_portal.routes import _generate

    p = _problem(problem_id)
    if body.passed > body.total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "More tests passed than were run.")
    # The test count is the browser's (JavaScript only): it must be this problem's.
    total = body.total if body.language == "javascript" and body.total == len(p.tests) else 0
    passed = body.passed if total else 0
    async with _locks.setdefault(user.id, asyncio.Lock()):
        if await _left(db, user) == 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "code_review_limit",
                "message": f"You've used today's {get_settings().code_review_daily} free reviews. They're back "
                           "tomorrow; you can still run the tests."})
        try:
            resp = await _generate(db, user, reviewmod.review_request(p, body.language, body.code, body.approach,
                                                                      passed, total, body.failing,
                                                                      get_llm_provider()))
            review = reviewmod.parse_review(resp.text, passed, total)
        except LLMError as e:
            log.warning("code review failed: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The AI isn't available right now. Try again in a moment.") from e
        except (ValueError, json.JSONDecodeError) as e:
            log.warning("code review unusable: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI's answer came back garbled. Try again.") from e
        solved = (passed == total) if total else review.verdict == "solved"
        a = CodeAttempt(user_id=user.id, problem_id=p.id, language=body.language, code=body.code,
                        approach=body.approach, passed=passed, total=total, solved=solved,
                        review=json.loads(review.model_dump_json()))
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return _attempt_out(a)
