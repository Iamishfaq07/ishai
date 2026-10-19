"""Candidate-safe questions, explicit replies and an allowlisted application activity feed."""
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from orbit_api.business import rules
from orbit_api.models import BizApplication, BizEvent, BizJob


def iso(value: datetime) -> str:
    return (value.replace(tzinfo=UTC) if value.tzinfo is None else value).isoformat()


def unanswered_question() -> Any:
    question, reply = aliased(BizEvent), aliased(BizEvent)
    answered = exists(select(reply.id).where(reply.application_id == question.application_id,
        reply.kind == "candidate_reply", reply.data["question_id"].as_string() == question.id)).correlate(question)
    return exists(select(question.id).where(question.application_id == BizApplication.id,
        question.kind == "candidate_question", ~answered)).correlate(BizApplication)


def reply_payload(row: BizEvent, *, mask: Callable[[str], str] = str, staff: bool = False) -> dict[str, Any]:
    return {"id": row.id, "message": mask(str(row.data.get("message", ""))), "created_at": iso(row.created_at),
        "author": row.actor_name if staff else "Hiring team"}


async def question_page(db: AsyncSession, app: BizApplication, *, before: str | None = None,
                        mask: Callable[[str], str] = str, staff: bool = False) -> dict[str, Any]:
    query = select(BizEvent).where(BizEvent.application_id == app.id, BizEvent.kind == "candidate_question")
    if before:
        cursor = await db.get(BizEvent, before)
        if cursor is None or cursor.application_id != app.id or cursor.kind != "candidate_question":
            raise HTTPException(404, "Question page not found.")
        query = query.where(or_(BizEvent.created_at < cursor.created_at,
            and_(BizEvent.created_at == cursor.created_at, BizEvent.id < cursor.id)))
    rows = list(await db.scalars(query.order_by(BizEvent.created_at.desc(), BizEvent.id.desc()).limit(21)))
    more, questions = len(rows) > 20, rows[:20]
    ids = [q.id for q in questions]
    replies = list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "candidate_reply", BizEvent.data["question_id"].as_string().in_(ids))
        .order_by(BizEvent.created_at, BizEvent.id))) if ids else []
    by_question = {r.data["question_id"]: r for r in replies}
    threads = []
    for question in questions:
        answer = by_question.get(question.id)
        threads.append({"id": question.id, "message": mask(str(question.data.get("message", ""))),
            "created_at": iso(question.created_at),
            "reply": reply_payload(answer, mask=mask, staff=staff) if answer else None})
    return {"threads": threads, "next_before": questions[-1].id if more else None}


_ACTIVITY = {
    "applied": "Application received", "email_confirmed": "Email confirmed",
    "rejected": "Application review completed", "unrejected": "Application reopened",
    "hired": "Hiring team updated your application", "interview_slots": "Interview times offered",
    "interview_booked": "Interview time booked", "interview_cancelled": "Interview invitation cancelled",
    "work_sample_invited": "Practical challenge assigned", "work_sample_submitted": "Initial solution saved",
    "work_sample_completed": "Adaptation saved", "candidate_question": "Your question was saved",
    "candidate_reply": "Hiring team replied to your question", "deletion_requested": "Data deletion requested",
    "stage": "Application status updated",
    "saba_invited": "Saba interview invitation available", "saba_started": "Saba interview started",
    "saba_completed": "Saba interview answers saved",
    "saba_alternative": "Alternative interview requested", "saba_integrity_review": "Interview review update available",
    "offer_published": "Offer summary available", "offer_response": "Your offer response was saved",
    "offer_withdrawn": "Offer summary withdrawn",
    "handoff_published": "Joining plan available", "handoff_task_added": "Joining task added",
    "handoff_progress": "Joining task progress updated",
}


async def activity(db: AsyncSession, app: BizApplication, job: BizJob) -> list[dict[str, str]]:
    rows = await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind.in_(_ACTIVITY)).order_by(BizEvent.created_at.desc(), BizEvent.id.desc()).limit(20))
    items = []
    for row in rows:
        label = _ACTIVITY[row.kind]
        if row.kind == "stage":
            kind = rules.stage_kind(job.stages, str(row.data.get("to", "")))
            label = "Application status: " + rules.CANDIDATE_STAGE.get(
                kind, rules.CANDIDATE_STAGE["applied"])[0]
        # Never include raw event data, private stage names, staff identity, scores or email subjects.
        items.append({"id": row.id, "label": label, "created_at": iso(row.created_at)})
    return items
