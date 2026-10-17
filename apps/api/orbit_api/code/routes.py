"""Code AI: the problem set by pattern with the user's progress, each problem (with its tests, which run in the
browser), and attempts: the code, the explanation and the test result, reviewed by the AI interviewer (free, a
day's allowance). Hints are part of the problem, no AI needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.code import review as reviewmod
from orbit_api.code.problems import BY_ID, PATTERNS, PROBLEMS, Problem
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.models import CodeAttempt, ProviderRequest, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/code", tags=["code"])
read_limit = Depends(limit_user("code-read", rate_per_s=3, burst=60))
ai_limits = [Depends(limit("code-ai", rate_per_s=0.5, burst=20)),
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


# Minutes east of UTC (India is 330): the day's reviews come back at the person's own midnight (UTC without).
TzOffset = Annotated[int, Query(ge=-720, le=840)]


def day_start(now: datetime, tz_offset: int) -> datetime:
    """The start of `now`'s day where the person is, as a UTC time."""
    shift = timedelta(minutes=tz_offset)
    return (now + shift).replace(hour=0, minute=0, second=0, microsecond=0) - shift


async def _left(db: AsyncSession, user: User, tz_offset: int = 0) -> int | None:
    """Reviews left today: counted from the reviews delivered (a saved attempt), so an answer that came back garbled
    doesn't use one. The AI calls behind them stay capped at twice the allowance, so a prompt that always garbles
    can't make calls without end."""
    if await is_admin(db, user):
        return None
    cap = get_settings().code_review_daily
    since = day_start(datetime.now(UTC), tz_offset)
    reviews = await db.scalar(select(func.count()).select_from(CodeAttempt).where(
        CodeAttempt.user_id == user.id, CodeAttempt.created_at >= since))
    calls = await db.scalar(select(func.count()).select_from(ProviderRequest).where(
        ProviderRequest.user_id == user.id, ProviderRequest.request_type == "code_review",
        ProviderRequest.created_at >= since))
    return max(min(cap - int(reviews or 0), 2 * cap - int(calls or 0)), 0)


@router.get("/problems", response_model=ProblemsOut, dependencies=[read_limit])
async def list_problems(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> ProblemsOut:
    solved = func.max(case((CodeAttempt.solved, 1), else_=0))  # over 1/0: Postgres has no max(boolean)
    rows = (await db.execute(select(CodeAttempt.problem_id, func.count(), solved)
                             .where(CodeAttempt.user_id == user.id).group_by(CodeAttempt.problem_id))).all()
    seen = {pid: (int(n), bool(s)) for pid, n, s in rows}
    return ProblemsOut(patterns=PATTERNS, reviews_left=await _left(db, user, tz_offset), problems=[
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
                      db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> ProblemOut:
    p = _problem(problem_id)
    rows = (await db.scalars(select(CodeAttempt).where(CodeAttempt.user_id == user.id,
                                                       CodeAttempt.problem_id == p.id)
                             .order_by(CodeAttempt.created_at.desc()).limit(10))).all()
    return ProblemOut(problem=p, attempts=[_attempt_out(a) for a in rows],
                      reviews_left=await _left(db, user, tz_offset))


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
                         db: Annotated[AsyncSession, Depends(get_db)], tz_offset: TzOffset = 0) -> AttemptOut:
    """Save an attempt and have the AI interviewer review it: free, ORBIT_CODE_REVIEW_DAILY a day."""
    from orbit_api.job_portal.routes import _generate

    p = _problem(problem_id)
    if body.passed > body.total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "More tests passed than were run.")
    # The test count is the browser's (JavaScript only): it must be this problem's.
    total = body.total if body.language == "javascript" and body.total == len(p.tests) else 0
    passed = body.passed if total else 0
    async with _locks.setdefault(user.id, asyncio.Lock()):
        if await _left(db, user, tz_offset) == 0:
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
