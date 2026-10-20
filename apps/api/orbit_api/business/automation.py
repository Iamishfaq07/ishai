"""Durable, opt-in hiring operations. Recipes create internal work, never hiring decisions or emails."""
import asyncio
import contextlib
import hashlib
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from orbit_api.business.access import audit, lock_company
from orbit_api.business.hiring import aware
from orbit_api.business.scheduling import panel as scheduled_panel
from orbit_api.db import sessionmaker
from orbit_api.models import (
    BizApplication,
    BizAutomation,
    BizCompany,
    BizEvent,
    BizHiringPlan,
    BizHiringTask,
    BizInterview,
    BizInterviewFeedback,
    BizJob,
    BizMember,
    BizNotification,
    User,
)

log = logging.getLogger(__name__)
TITLES = {"stalled": "Review the stalled pipeline stage", "question": "Reply to the candidate's question",
    "feedback": "Collect outstanding interview feedback",
    "assessment": "Review assessment or alternative interview request",
    "scheduling": "Reply to a candidate's interview time request", "prep": "Prepare the interview kit",
    "offer": "Review the offer response deadline", "handoff": "Prepare the accepted offer joining plan"}


class Recipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    stalled_days: int | None = Field(3, ge=1, le=90)
    question_hours: int | None = Field(24, ge=1, le=168)
    feedback_hours: int | None = Field(24, ge=1, le=168)
    assessment_hours: int | None = Field(24, ge=1, le=168)
    scheduling_hours: int | None = Field(None, ge=1, le=168)
    prep_hours: int | None = Field(None, ge=1, le=168)
    offer_hours: int | None = Field(None, ge=1, le=168)
    handoff_hours: int | None = Field(None, ge=1, le=168)
    default_assignee_id: str | None = Field(None, max_length=36)


async def coordinators(db: AsyncSession, job: BizJob) -> dict[str, str]:
    rows = (await db.execute(select(BizMember, User).join(User, User.id == BizMember.user_id)
        .where(BizMember.company_id == job.company_id, User.suspended_at.is_(None)))).all()
    return {u.id: (u.name or u.email) for m, u in rows if m.role in ("owner", "admin", "recruiter")
        or (m.role == "hiring_manager" and u.id in (job.hiring_team or []))}


def recipe_payload(row: BizAutomation | None) -> dict[str, Any]:
    return {"revision": row.revision if row else 0, "recipe": Recipe.model_validate(row.content if row else {})
        .model_dump(), "last_run_at": aware(row.last_run_at).isoformat() if row and row.last_run_at else None}


async def signals(db: AsyncSession, job: BizJob, apps: list[BizApplication], recipe: Recipe,
                  now: datetime) -> dict[str, dict[str, tuple[str, datetime]]]:
    """One key per source episode; no resume, private feedback contents or candidate scoring is read."""
    ids = [a.id for a in apps]
    result: dict[str, dict[str, tuple[str, datetime]]] = {a.id: {} for a in apps}
    events: dict[str, list[BizEvent]] = {a.id: [] for a in apps}
    for event in await db.scalars(select(BizEvent).where(BizEvent.application_id.in_(ids), BizEvent.kind.in_(
            ("candidate_question", "candidate_reply", "work_sample_completed", "saba_completed",
             "saba_alternative", "hiring_decision", "interview_change_requested", "interview_change_replied",
             "interview_change_withdrawn", "interview_change_closed", "offer_published", "offer_response",
             "offer_withdrawn", "handoff_published")))
            .order_by(BizEvent.created_at.desc(), BizEvent.id.desc())):
        events[event.application_id].append(event)
    interviews: dict[str, BizInterview] = {}
    for interview in await db.scalars(select(BizInterview).where(BizInterview.application_id.in_(ids))
            .order_by(BizInterview.created_at.desc(), BizInterview.id.desc())):
        interviews.setdefault(interview.application_id, interview)
    feedback = {(f.application_id, f.stage_id, f.author_id) for f in await db.scalars(
        select(BizInterviewFeedback).where(BizInterviewFeedback.application_id.in_(ids),
            BizInterviewFeedback.submitted_at.is_not(None)).options(load_only(BizInterviewFeedback.application_id,
                BizInterviewFeedback.stage_id, BizInterviewFeedback.author_id)))}
    plan = await db.get(BizHiringPlan, job.id)
    criteria = (plan.content if plan else {}).get("criteria", [])
    active_panel = set(await db.scalars(select(BizMember.user_id).join(User, User.id == BizMember.user_id).where(
        BizMember.company_id == job.company_id, User.suspended_at.is_(None)))) if (
            recipe.prep_hours is not None) else set()
    for app in apps:
        if app.status != "active" or app.deletion_requested_at or job.status != "open" or not recipe.enabled:
            continue
        pending = result[app.id]

        def add(kind: str, source: str, deadline: datetime,
                target: dict[str, tuple[str, datetime]] = pending) -> None:
            if deadline <= now:
                key = hashlib.sha256(f"{kind}:{source}".encode()).hexdigest()
                target[key] = (kind, deadline)

        if recipe.stalled_days is not None:
            add("stalled", f"{app.stage_id}:{aware(app.stage_changed_at).isoformat()}",
                aware(app.stage_changed_at) + timedelta(days=recipe.stalled_days))
        history = events[app.id]
        for kind, source, deadline in offer_signals(history, recipe):
            add(kind, source, deadline)
        answered = {e.data.get("question_id") for e in history if e.kind == "candidate_reply"}
        decisions = [aware(e.created_at) for e in history if e.kind == "hiring_decision"]
        for event in history:
            stamp = aware(event.created_at)
            if recipe.question_hours is not None and event.kind == "candidate_question" and event.id not in answered:
                add("question", event.id, stamp + timedelta(hours=recipe.question_hours))
            if recipe.assessment_hours is not None and event.kind in (
                    "work_sample_completed", "saba_completed", "saba_alternative") and not any(
                        d >= stamp for d in decisions):
                add("assessment", event.id, stamp + timedelta(hours=recipe.assessment_hours))
        iv = interviews.get(app.id)
        if recipe.prep_hours is not None and iv and iv.chosen and now < aware(iv.chosen):
            prep_panel = scheduled_panel(iv, app.interviewers or [])
            current_is_interview = any(s["id"] == app.stage_id and s["kind"] == "interview" for s in job.stages)
            planned_stage = app.stage_id if current_is_interview else next(
                (s["id"] for s in job.stages if s["kind"] == "interview"), app.stage_id)
            if not any(member in active_panel for member in prep_panel) or not any(
                    c["stage_id"] == planned_stage for c in criteria):
                add("prep", f"{iv.id}:{aware(iv.chosen).isoformat()}",
                    aware(iv.chosen) - timedelta(hours=recipe.prep_hours))
        if recipe.scheduling_hours is not None and iv:
            from orbit_api.business.coordination import render

            for change in render(history, iv, iv.chosen is None or aware(iv.chosen) > now):
                if change["status"] == "waiting":
                    stamp = datetime.fromisoformat(change["created_at"].replace("Z", "+00:00"))
                    add("scheduling", change["id"], stamp + timedelta(hours=recipe.scheduling_hours))
        if recipe.feedback_hours is not None and iv and iv.chosen and criteria:
            stage = app.stage_id if any(c["stage_id"] == app.stage_id for c in criteria) else criteria[0]["stage_id"]
            panel = iv.panel_user_ids if iv.panel_user_ids is not None else app.interviewers or (
                [iv.created_by] if iv.created_by else [])
            if any((app.id, stage, member) not in feedback for member in panel):
                add("feedback", iv.id, aware(iv.chosen) + timedelta(minutes=iv.duration_min,
                    hours=recipe.feedback_hours))
    return result


def offer_signals(history: list[BizEvent], recipe: Recipe) -> list[tuple[str, str, datetime]]:
    """Inspect only the latest published offer. Expiry creates work, never an automatic withdrawal."""
    published = [e for e in history if e.kind == "offer_published"]
    if not published:
        return []
    latest = max(published, key=lambda e: (int(e.data.get("revision", 0)), aware(e.created_at), e.id))
    updates = [e for e in history if e.data.get("offer_id") == latest.id]
    if any(e.kind == "offer_withdrawn" for e in updates):
        return []
    response = next((e for e in updates if e.kind == "offer_response"), None)
    if response:
        if (response.data.get("response") == "accepted" and recipe.handoff_hours is not None
                and not any(e.kind == "handoff_published" for e in history)):
            return [("handoff", latest.id, aware(response.created_at) + timedelta(hours=recipe.handoff_hours))]
        return []
    if recipe.offer_hours is None:
        return []
    try:
        deadline = aware(datetime.fromisoformat(latest.data["expires_at"]))
    except (KeyError, ValueError, TypeError):
        return []  # no invented deadline for malformed legacy records
    return [("offer", latest.id, deadline - timedelta(hours=recipe.offer_hours))]


async def reconcile(db: AsyncSession, company: BizCompany, job: BizJob, row: BizAutomation | None,
                    now: datetime) -> dict[str, int]:
    """Caller holds company lock. Keyset pages cover every application, including terminal ones to close tasks."""
    recipe = Recipe.model_validate(row.content if row else {})
    eligible = await coordinators(db, job)
    default = recipe.default_assignee_id if recipe.default_assignee_id in eligible else None
    counts = {"created": 0, "resolved": 0, "reopened": 0}
    cursor = ""
    while True:
        apps = list(await db.scalars(select(BizApplication).where(BizApplication.job_id == job.id,
            BizApplication.id > cursor).order_by(BizApplication.id).limit(200).options(load_only(
                BizApplication.id, BizApplication.status, BizApplication.stage_id, BizApplication.stage_changed_at,
                BizApplication.deletion_requested_at, BizApplication.interviewers))))
        if not apps:
            break
        ids = [a.id for a in apps]
        pending = await signals(db, job, apps, recipe, now)
        tasks = list(await db.scalars(select(BizHiringTask).where(BizHiringTask.application_id.in_(ids))))
        existing = {(t.application_id, t.source_key): t for t in tasks}
        by_app = {a.id: a for a in apps}
        for task in tasks:
            app = by_app[task.application_id]
            live = app.status == "active" and not app.deletion_requested_at and job.status == "open"
            changed = False
            if task.assignee_id and task.assignee_id not in eligible:
                task.assignee_id, changed = None, True
                audit(db, company.id, None, "automation.owner_unassigned", task.id, job_id=job.id,
                    reason="Previous owner no longer eligible for this job")
            if task.status in ("open", "snoozed") and (not live or (
                    task.kind != "manual" and task.source_key not in pending[app.id])):
                task.status, task.snoozed_until = "resolved", None
                task.resolution = "Source cleared, automation paused, or application no longer active"
                counts["resolved"] += 1
                audit(db, company.id, None, "automation.task_resolved", task.id, job_id=job.id)
                changed = True
            elif task.status == "snoozed" and task.snoozed_until and aware(task.snoozed_until) <= now:
                task.status, task.snoozed_until, changed = "open", None, True
                audit(db, company.id, None, "automation.snooze_finished", task.id, job_id=job.id)
            if changed:
                task.revision += 1
        for aid, sources in pending.items():
            for key, (kind, deadline) in sources.items():
                source_task = existing.get((aid, key))
                if source_task is None:
                    source_task = BizHiringTask(company_id=company.id, job_id=job.id, application_id=aid,
                        source_key=key, kind=kind, title=TITLES[kind], due_at=deadline,
                        assignee_id=default, revision=1, status="open")
                    db.add(source_task)
                    await db.flush()
                    counts["created"] += 1
                    audit(db, company.id, None, "automation.task_created", source_task.id, job_id=job.id, kind=kind)
                    if default:
                        db.add(BizNotification(company_id=company.id, application_id=aid, user_id=default,
                            kind="automation", text=f"Assigned hiring follow-up: {TITLES[kind]}"))
                elif source_task.status == "resolved":
                    source_task.status, source_task.resolution, source_task.due_at = "open", None, deadline
                    source_task.revision += 1
                    counts["reopened"] += 1
                    audit(db, company.id, None, "automation.task_reopened", source_task.id, job_id=job.id)
                elif source_task.status in ("open", "snoozed") and aware(source_task.due_at) != deadline:
                    source_task.due_at, source_task.revision = deadline, source_task.revision + 1
        await db.flush()
        cursor = apps[-1].id
    if row:
        row.last_run_at = now
    return counts


async def sweep(now: datetime | None = None) -> int:
    """Process all due playbooks in short per-job transactions; failed jobs don't block others."""
    current = now or datetime.now(UTC)
    async with sessionmaker()() as db:
        jobs = list(await db.scalars(select(BizAutomation.job_id).where(or_(
            BizAutomation.last_run_at.is_(None), BizAutomation.last_run_at <= current - timedelta(minutes=4)))
            .order_by(BizAutomation.job_id)))
    completed = 0
    for job_id in jobs:
        try:
            async with sessionmaker()() as db:
                row = await db.get(BizAutomation, job_id)
                if row is None:
                    continue
                await lock_company(db, row.company_id)
                await db.refresh(row)
                if row.last_run_at and aware(row.last_run_at) > current - timedelta(minutes=4):
                    continue
                company = await db.get(BizCompany, row.company_id)
                job = await db.get(BizJob, row.job_id)
                if company and job and company.status != "suspended":
                    await reconcile(db, company, job, row, current)
                    await db.commit()
                    completed += 1
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("hiring automation failed for job %s", job_id)
    return completed


@contextlib.asynccontextmanager
async def running_sweeper() -> AsyncIterator[None]:
    async def loop() -> None:
        await asyncio.sleep(30)
        while True:
            try:
                await sweep()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("hiring automation sweep failed")
            await asyncio.sleep(300)
    task = asyncio.create_task(loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
