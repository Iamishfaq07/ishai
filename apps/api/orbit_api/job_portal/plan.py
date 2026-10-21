"""Interview prep plan: day by day from today to a tracked job's interview date (its `next_at`, while it's
interviewing or applied). Built from what the account already has (the fit check's unmet requirements, practice
questions due again, the story bank), with no AI call: free, instant, and rebuilt whenever the date moves.

Keys bind day, task content and schedule. Completion snapshots remain in owned history when the schedule changes;
matching one-time preparation may be reused only after candidate review. Nothing here scores hiring readiness.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import JobApplication, JobFitCheck, JobPlanCheck, Story, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/jobs/tracker", tags=["jobs"])
read_limit = Depends(limit_user("jobs-plan", rate_per_s=3, burst=60))

MAX_DAYS = 14  # a plan covers the last two weeks; further out, it starts 14 days before
PER_DAY = 3

Kind = Literal["research", "gap", "mock", "queue", "story", "warmup", "logistics", "review"]


class PlanItem(BaseModel):
    key: str
    kind: Kind
    title: str
    detail: str = ""
    done: bool = False
    prior_completion: Completion | None = None


class Completion(BaseModel):
    id: str
    title: str
    kind: str
    completed_at: datetime
    scheduled_on: str | None = None
    interview_at: str | None = None
    legacy: bool = False
    reused: bool = False


class PlanDay(BaseModel):
    date: date
    days_before: int | None  # None = date-free rehearsal; 0 = interview day
    items: list[PlanItem]


class PlanOut(BaseModel):
    mode: Literal["scheduled", "rehearsal", "closed"] = "scheduled"
    interview_at: datetime | None
    days_left: int | None
    starts_on: date | None  # later than today when the interview is more than two weeks away
    days: list[PlanDay]
    done: int
    total: int
    completed: list[Completion] = Field(default_factory=list)
    completed_total: int = 0


def build_plan(today: date, interview: date, gaps: list[str], queue_due: int, stories: int) -> list[PlanDay]:
    """The days from today (or 14 days before) to the interview, each with up to three tasks. The day of and the day
    before are light; earlier days take one unmet requirement each, a mock round every other day, the practice
    questions due again, and stories until there are three."""
    if interview < today:
        return []
    start = max(today, interview - timedelta(days=MAX_DAYS - 1))
    gap_queue = list(gaps)
    stories_to_write = max(0, 3 - stories)
    out: list[PlanDay] = []
    d = start
    first = True
    while d <= interview:
        before = (interview - d).days
        items: list[tuple[Kind, str, str]] = []
        if before == 0:
            items = [("warmup", "A 5-minute warm-up round", "Say two answers out loud before the call."),
                     ("logistics", "Check the time, the link and your setup", "Mic, camera, charger, a quiet room."),
                     ("review", "Read your three strongest stories once", "")]
        elif before == 1:
            items.append(("review", "Run through your stories and the job post", "Out loud, not word for word."))
            if queue_due:
                items.append(("queue", "Redo the practice questions due again", f"{queue_due} waiting."))
            items.append(("logistics", "Test your audio and video", "Join a test call the way you'll join theirs."))
        else:
            if first:
                items.append(("research", "Read the job post and the company again",
                              "Note three things they care about."))
            if stories_to_write:
                items.append(("story", "Write one STAR story", "A real example: situation, task, action, result."))
                stories_to_write -= 1
            if gap_queue:
                gap = gap_queue.pop(0)
                items.append(("gap", f"Prepare an example for: {gap}", "Only from what you've really done."))
            if before % 2 == 0:
                items.append(("mock", "A mock interview on this job post", "Then read the review."))
            elif queue_due:
                items.append(("queue", "Redo the practice questions due again", f"{queue_due} waiting."))
            if not items:
                items.append(("mock", "A mock interview on this job post", "Then read the review."))
        seen: dict[str, int] = {}
        day_items: list[PlanItem] = []
        for kind, title, detail in items[:PER_DAY]:
            n = seen.get(kind, 0)
            seen[kind] = n + 1
            day_items.append(PlanItem(key=f"{d.isoformat()}:{kind}:{n}", kind=kind, title=title, detail=detail))
        out.append(PlanDay(date=d, days_before=before, items=day_items))
        first = False
        d += timedelta(days=1)
    return out


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def _entry(db: AsyncSession, entry_id: str, user: User) -> JobApplication:
    entry = await db.scalar(select(JobApplication).where(JobApplication.id == entry_id,
        JobApplication.user_id == user.id).execution_options(populate_existing=True))
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your tracker")
    return entry


def signature(kind: str, title: str, detail: str) -> str:
    return hashlib.sha256(json.dumps([kind, title, detail], ensure_ascii=True).encode()).hexdigest()[:24]


def completion(row: JobPlanCheck) -> Completion:
    data = row.task_data or {}
    return Completion(id=row.id, title=str(data.get("title", "Earlier task — details were not saved")),
        kind=str(data.get("kind", "legacy")), completed_at=_aware(row.created_at),
        scheduled_on=data.get("scheduled_on"), interview_at=data.get("interview_at"),
        legacy=not bool(data), reused=bool(data.get("reused_from")))


async def plan_for(db: AsyncSession, user: User, entry: JobApplication, now: datetime | None = None,
                   tz_offset: int = 0, include_rehearsal: bool = True) -> PlanOut:
    """`tz_offset`: minutes east of UTC, so "today" and the interview day are the person's own days."""
    now = now or datetime.now(UTC)
    shift = timedelta(minutes=tz_offset)
    checks = list((await db.scalars(select(JobPlanCheck).where(JobPlanCheck.user_id == user.id,
        JobPlanCheck.application_id == entry.id).order_by(JobPlanCheck.created_at.desc(), JobPlanCheck.id))).all())
    history = [completion(row) for row in checks[:50]]
    if entry.status not in ("saved", "applied", "interviewing"):
        return PlanOut(mode="closed", interview_at=None, days_left=None, starts_on=None,
                       days=[], done=0, total=0, completed=history, completed_total=len(checks))
    from .round_journal import context_round

    round_context = await context_round(db, entry)
    at = _aware(entry.next_at) if entry.next_at and (
        entry.status in ("applied", "interviewing") or round_context is not None) else None
    today = (now + shift).date()
    day = (at + shift).date() if at else None
    scheduled = day is not None and day >= today
    if not scheduled and not include_rehearsal:
        return PlanOut(mode="rehearsal", interview_at=at, days_left=None, starts_on=None,
                       days=[], done=0, total=0, completed=history, completed_total=len(checks))

    fit = (await db.scalars(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
                                                      JobFitCheck.listing_id == entry.listing_id)
                            .order_by(JobFitCheck.created_at.desc()).limit(1))).first()
    gaps: list[str] = []
    if fit is not None and isinstance(fit.result, dict):
        for r in fit.result.get("requirements", []) or []:
            if isinstance(r, dict) and r.get("status") in ("missing", "partial") and r.get("requirement"):
                gaps.append(str(r["requirement"])[:120])
        if not gaps:
            gaps = [str(g)[:120] for g in fit.result.get("gaps", []) or []]
    stories = int(await db.scalar(select(func.count()).select_from(Story).where(Story.user_id == user.id)) or 0)
    from orbit_api.sessions import practice_queue
    from orbit_api.sessions.routes import _cards

    due, _, _ = practice_queue.queue(await _cards(db, user), now)
    days = build_plan(today, day if scheduled and day else today + timedelta(days=4), gaps, len(due), stories)
    if not scheduled:
        days = days[:3]
        for rehearsal_day in days:
            rehearsal_day.days_before = None
    schedule_source = at.isoformat() if scheduled and at else "rehearsal"
    if round_context is not None:
        schedule_source += f":round:{entry.preparation_round_id}:{entry.preparation_round_revision}"
    schedule = hashlib.sha256(schedule_source.encode()).hexdigest()[:16]
    ticked = {row.item_key for row in checks}
    for d in days:
        for item in d.items:
            content = signature(item.kind, item.title, item.detail)
            item.key += f":{content}:{schedule}"
            item.done = item.key in ticked
            if not item.done and item.kind in ("research", "gap"):
                prior = next((row for row in checks if row.item_key != item.key and row.task_data
                    and signature(str(row.task_data.get("kind")), str(row.task_data.get("title")),
                                  str(row.task_data.get("detail", ""))) == content), None)
                if prior:
                    item.prior_completion = completion(prior)
    total = sum(len(d.items) for d in days)
    return PlanOut(mode="scheduled" if scheduled else "rehearsal", interview_at=at,
        days_left=(day - today).days if scheduled and day else None, starts_on=days[0].date if days else None,
        days=days, done=sum(1 for d in days for i in d.items if i.done), total=total,
        completed=history, completed_total=len(checks))


@router.get("/{entry_id}/plan", response_model=PlanOut, dependencies=[read_limit])
async def get_plan(entry_id: str, user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)], tz_offset: int = 0,
                   rehearsal: bool = False) -> PlanOut:
    return await plan_for(db, user, await _entry(db, entry_id, user),
                          tz_offset=max(-720, min(840, tz_offset)), include_rehearsal=rehearsal)


class CheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    done: bool = Field(strict=True)
    reuse_from: str | None = Field(None, min_length=1, max_length=36)

    @model_validator(mode="after")
    def reuse_requires_completion(self) -> CheckIn:
        if self.reuse_from and not self.done:
            raise ValueError("Reuse records a reviewed completion")
        return self


@router.put("/{entry_id}/plan/checks/{item_key}", response_model=PlanOut, dependencies=[read_limit])
async def tick(entry_id: str, item_key: str, body: CheckIn, user: Annotated[User, Depends(current_user)],
               db: Annotated[AsyncSession, Depends(get_db)], tz_offset: int = 0,
               rehearsal: bool = False) -> PlanOut:
    """Tick a task off (or untick it). Only a key from this job's current plan is accepted; ticking twice is fine."""
    entry = await _entry(db, entry_id, user)
    tz = max(-720, min(840, tz_offset))
    current = await plan_for(db, user, entry, tz_offset=tz, include_rehearsal=rehearsal)
    selected = next(((d, i) for d in current.days for i in d.items if i.key == item_key), None)
    if selected is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That task isn't in this plan")
    day, item = selected
    if body.reuse_from:
        prior = await db.scalar(select(JobPlanCheck).where(JobPlanCheck.id == body.reuse_from,
            JobPlanCheck.user_id == user.id, JobPlanCheck.application_id == entry.id))
        data = prior.task_data if prior else None
        if not data or item.kind not in ("research", "gap") or signature(item.kind, item.title, item.detail) != \
                signature(str(data.get("kind")), str(data.get("title")), str(data.get("detail", ""))):
            raise HTTPException(409, "That completion no longer matches this task. Refresh and review again.")
    if body.done:
        exists = await db.scalar(select(JobPlanCheck.id).where(JobPlanCheck.application_id == entry.id,
                                                               JobPlanCheck.item_key == item_key))
        if exists is None:
            db.add(JobPlanCheck(user_id=user.id, application_id=entry.id, item_key=item_key, task_data={
                "kind": item.kind, "title": item.title, "detail": item.detail, "scheduled_on": day.date.isoformat(),
                "interview_at": current.interview_at.isoformat() if current.interview_at else None,
                "reused_from": body.reuse_from}))
            try:
                await db.commit()
            except IntegrityError:  # ticked at the same moment elsewhere: already done
                await db.rollback()
                entry = await _entry(db, entry_id, user)
    else:
        await db.execute(delete(JobPlanCheck).where(JobPlanCheck.application_id == entry.id,
                                                    JobPlanCheck.user_id == user.id,
                                                    JobPlanCheck.item_key == item_key))
        await db.commit()
    return await plan_for(db, user, await _entry(db, entry_id, user), tz_offset=tz, include_rehearsal=rehearsal)
