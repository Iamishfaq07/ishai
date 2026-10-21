"""Automatic action queue derived from saved records, with an optional grounded AI briefing."""
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.business.hiring_schema import Contract
from orbit_api.db import get_db
from orbit_api.job_portal import commitments, playbooks
from orbit_api.job_portal.action_priority import PACKET_ACTIONS, TERMINAL_JOBS, attention_packets, priority
from orbit_api.models import ApplicationPacket, JobApplication, JobContact, User
from orbit_api.ratelimit import limit_user
from orbit_api.workflow_ai import preview

router = APIRouter(prefix="/v1/jobs/actions", tags=["career actions"],
                   dependencies=[Depends(limit_user("career-actions", rate_per_s=1, burst=20))])


def aware(t: datetime) -> datetime:
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


async def queue(db: AsyncSession, user: User) -> dict[str, Any]:
    now = datetime.now(UTC)
    horizon = now + timedelta(days=7)
    items: list[dict[str, Any]] = []
    playbook = await playbooks.settings(db, user.id)
    reminders, truncated = await playbooks.followups(db, user.id, playbook["follow_up_days"], now)
    quiet = await playbooks.quiet(db, user.id, playbook["stale_days"], now)
    # A quiet application's decision replaces its routine follow-up reminder.
    gone_quiet = {item["id"].removeprefix("quiet:") for item in quiet}
    items.extend(item for item in reminders if item["id"].removeprefix("playbook:") not in gone_quiet)
    items.extend(quiet)
    items.extend(await playbooks.thank_yous(db, user.id, playbook["thank_you_hours"], now))
    items.extend(await playbooks.saved(db, user.id, playbook["saved_days"], now))
    items.extend(await commitments.due_items(db, user.id, now))
    items.extend(await playbooks.after_rejection(db, user.id, playbook["rejection_days"], now))
    items.extend(await playbooks.offer_deadlines(db, user.id, now))
    items.extend(await playbooks.gone_postings(db, user.id))
    items.extend(await playbooks.wrap_up(db, user.id, now))
    for job in await db.scalars(select(JobApplication).where(JobApplication.user_id == user.id,
            JobApplication.status.not_in(TERMINAL_JOBS), JobApplication.next_at <= horizon)
            .order_by(JobApplication.next_at, JobApplication.id).limit(101)):
        assert job.next_at is not None
        past = aware(job.next_at) < now
        prep = bool(job.status == "interviewing" and not past and playbook["prep_hours"] is not None
            and aware(job.next_at) <= now + timedelta(hours=playbook["prep_hours"]))
        items.append({"id": f"job:{job.id}", "kind": "interview" if job.status == "interviewing" else "follow_up",
            "title": f"{job.title} · {job.company}", "detail": (
                "Record the outcome or update the next round." if past and job.status == "interviewing" else
                "Open your interview preparation plan." if job.status == "interviewing" else
                "Review your saved next step and update its date."),
            "due_at": aware(job.next_at).isoformat(), "overdue": past,
            "path": f"/jobs/mission/{job.id}?tab={'plan' if job.status == 'interviewing' and not past else 'timeline'}",
            "action_label": ("Prepare for interview" if job.status == "interviewing" and not past
                             else "Update next step")})
        if prep:
            items[-1].update(rule="interview_preparation", detail=(
                f"Your {playbook['prep_hours']}-hour preparation window is open. "
                "Review the role, the resume you sent and your interview practice plan."))
    for contact in await db.scalars(select(JobContact).where(JobContact.user_id == user.id,
            JobContact.follow_up_at <= horizon).order_by(JobContact.follow_up_at, JobContact.id).limit(101)):
        assert contact.follow_up_at is not None
        items.append({"id": f"contact:{contact.id}", "kind": "contact", "title": contact.name,
            "detail": (f"Follow up with your contact at {contact.company}." if contact.company
                       else "Follow up with your contact."),
            "due_at": aware(contact.follow_up_at).isoformat(), "overdue": aware(contact.follow_up_at) < now,
            "path": "/jobs/outreach#people", "action_label": "Open saved contacts"})
    for packet in await db.scalars(attention_packets(user.id).order_by(
            case((ApplicationPacket.status == "needs_answer", 0), (ApplicationPacket.status == "review", 1), else_=2),
            ApplicationPacket.updated_at, ApplicationPacket.id).limit(101)):
        items.append({"id": f"packet:{packet.id}", "kind": "application", "title": f"{packet.title} · {packet.company}",
            "detail": PACKET_ACTIONS[packet.status][0], "action_label": PACKET_ACTIONS[packet.status][1],
            "source_status": packet.status, "source_updated_at": aware(packet.updated_at).isoformat(),
            "due_at": None, "overdue": False, "path": f"/jobs/applications?packet={packet.id}"})
    for item in items:
        item.setdefault("action_label", "Review follow-up")
    items.sort(key=lambda item: priority(item, now))
    # Include text and source dates in the revision; no stale briefing after any relevant source changes.
    version = hashlib.sha256(json.dumps({"items": items, "playbook": playbook}, sort_keys=True).encode()).hexdigest()
    return {"version": version, "items": items[:100], "focus_id": items[0]["id"] if items else None,
            "truncated": truncated or len(items) > 100,
            "as_of": now.isoformat(), "horizon_days": 7}


class BriefIn(Contract):
    version: str = Field(min_length=64, max_length=64)


class BriefStep(Contract):
    action_id: str = Field(min_length=1, max_length=80)
    source_quote: str = Field(min_length=4, max_length=500)
    suggestion: str = Field(min_length=10, max_length=600)


class Brief(Contract):
    steps: list[BriefStep] = Field(min_length=1, max_length=5)


@router.get("")
async def actions(user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await queue(db, user)


@router.post("/brief")
async def briefing(body: BriefIn, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    source = await queue(db, user)
    if body.version != source["version"]:
        raise HTTPException(409, "Your action queue changed. Refresh before requesting a brief.")
    if not source["items"]:
        raise HTTPException(409, "Add a next-step date, contact follow-up or application to build a brief.")
    by_id = {item["id"]: item for item in source["items"][:30]}

    def validate(raw: object) -> Brief:
        result = Brief.model_validate(raw)
        if len({s.action_id for s in result.steps}) != len(result.steps):
            raise ValueError("Duplicate action")
        for step in result.steps:
            item = by_id[step.action_id]
            if step.source_quote not in item["title"] and step.source_quote not in item["detail"]:
                raise ValueError("Unsupported source quote")
        return result

    result, provider = await preview(db, user, "career_action_brief",
        'Return JSON {"steps":[{"action_id":"...","source_quote":"exact substring of title or detail",'
        '"suggestion":"a practical next step"}]}. Choose up to five supplied actions, prioritizing overdue '
        'interviews and dates. Do not invent qualifications, outcomes, urgency, contacts or applications. '
        'Suggest only actions the candidate can review. Never claim anything was sent or completed. '
        'No links, markdown, or instructions to bypass employer checks.',
        json.dumps({"as_of": source["as_of"], "actions": list(by_id.values())}), validate)
    latest = await queue(db, user)
    if latest["version"] != source["version"]:
        raise HTTPException(409, "Your action queue changed while the brief was prepared. Refresh to continue.")
    return {"version": source["version"], "steps": [s.model_dump() for s in result.steps],
            "source": "mock" if provider == "mock" else "ai"}
