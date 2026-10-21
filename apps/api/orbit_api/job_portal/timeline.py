"""One tracked job's journey, oldest first: saved, fit checks, the tailored resume, the job post kept for prep, the
people at the company, applied, practice and live rounds with the company, where it stands now, and what's next.

Read from rows Orbit already keeps for the tracker and the things linked to it; nothing new is stored, and only the
owner's own rows are read. Stage history isn't kept, so the current stage appears once, at when it last moved.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.job_portal import session_associations
from orbit_api.models import (
    ApplicationPacket,
    Document,
    JobApplication,
    JobContact,
    JobFitCheck,
    JobInterviewRound,
    LiveSessionRow,
    Resume,
)
from orbit_api.sessions.loop_memory import same_company

Kind = Literal["saved", "fit", "resume", "prep_doc", "contact", "outreach", "applied", "round",
               "related_round", "association", "application", "interview_round", "stage", "next"]
STAGE_LABEL = {"interviewing": "Interviewing", "offer": "Offer", "rejected": "Not this time"}
ROUND_LABEL = {"mock": "Practice round", "interview": "Live interview", "coding": "Live coding interview",
               "system_design": "Live system design interview", "phone": "Phone interview"}
MAX_ROUNDS = 10


class TimelineEvent(BaseModel):
    kind: Kind
    at: datetime
    title: str
    detail: str = ""
    link: str | None = None  # an in-app path, when there's a page for it
    upcoming: bool = False
    completed: bool = False
    session_id: str | None = None  # Explicit review target, not proof of a job association
    provenance: Literal["saved_record", "candidate_recorded", "executor_reported", "outcome_uncertain",
                        "suggestion"] = "saved_record"


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def timeline(db: AsyncSession, entry: JobApplication, now: datetime | None = None) -> list[TimelineEvent]:
    now = now or datetime.now(UTC)
    events = [TimelineEvent(kind="saved", at=entry.created_at, title="Saved to your tracker",
                            detail=f"{entry.title} at {entry.company}")]

    fits = (await db.scalars(select(JobFitCheck).where(JobFitCheck.user_id == entry.user_id,
                                                       JobFitCheck.listing_id == entry.listing_id))).all()
    for fit in fits:
        verdict = (fit.result or {}).get("verdict")
        events.append(TimelineEvent(kind="fit", at=fit.created_at, title="Fit check",
                                    detail=f"{verdict} fit" if verdict else ""))

    if entry.resume_id and (resume := await db.get(Resume, entry.resume_id)) and resume.user_id == entry.user_id:
        events.append(TimelineEvent(kind="resume", at=resume.created_at, title="Resume for this job",
                                    detail=resume.title, link=f"/resume-ai/{resume.id}"))
    if entry.document_id and (doc := await db.get(Document, entry.document_id)) and doc.user_id == entry.user_id:
        events.append(TimelineEvent(kind="prep_doc", at=doc.created_at, title="Job post saved for interview prep",
                                    detail=doc.title, link="/documents"))

    contacts = (await db.scalars(select(JobContact).where(JobContact.user_id == entry.user_id,
                                                          JobContact.application_id == entry.id))).all()
    for c in contacts:
        who = f"{c.name} ({c.relation.replace('_', ' ')})" if c.relation and c.relation != "other" else c.name
        events.append(TimelineEvent(kind="contact", at=c.created_at, title="Added a contact", detail=who))
        if c.last_contacted_at:
            events.append(TimelineEvent(kind="outreach", at=c.last_contacted_at, title=f"Reached out to {c.name}"))

    if entry.applied_at:
        orbit = entry.applied_via == "orbit_apply"
        applied_detail = ("Orbit Apply recorded this application. This entry alone is not an employer receipt."
                          if orbit else "You recorded applying. No employer receipt is inferred.")
        events.append(TimelineEvent(kind="applied", at=entry.applied_at,
                                    title="Applied (Orbit Apply)" if orbit else "Applied", detail=applied_detail,
                                    provenance="saved_record" if orbit else "candidate_recorded",
                                    link="/jobs/applications" if orbit else None))

    # Query linked history independently so newer unrelated sessions cannot evict this job's own sessions.
    linked = list((await db.scalars(select(LiveSessionRow).where(
        LiveSessionRow.user_id == entry.user_id, LiveSessionRow.application_id == entry.id,
        LiveSessionRow.status != "created").order_by(
            LiveSessionRow.created_at.desc(), LiveSessionRow.id).limit(MAX_ROUNDS))).all())
    candidates = (await db.scalars(select(LiveSessionRow).where(
        LiveSessionRow.user_id == entry.user_id, LiveSessionRow.application_id.is_(None),
        LiveSessionRow.created_at >= entry.created_at, LiveSessionRow.status == "ended").order_by(
            LiveSessionRow.created_at.desc(), LiveSessionRow.id).limit(80))).all()
    related = [session for session in candidates if same_company(session.company, entry.company)][:3]
    for session in [*linked, *related]:
        confirmed = session.application_id == entry.id
        events.append(TimelineEvent(kind="round" if confirmed else "related_round",
            at=session.started_at or session.created_at,
            title=ROUND_LABEL.get(session.type, "Session") if confirmed else "Possibly related session — review",
            detail=session.title, session_id=session.id, completed=confirmed and session.status == "ended",
            provenance="saved_record" if confirmed else "suggestion",
            link=f"/sessions/{session.id}" if session.status == "ended" else None))

    # Attribution changes are candidate-reviewed events, not new mock/employer interview completions.
    for change in await session_associations.history(db, entry.user_id, entry.id, limit=20):
        events.append(TimelineEvent(kind="association", at=change.created_at,
            title="Session linked after review" if change.action == session_associations.LINK else "Session unlinked",
            detail="Opportunity attribution changed; the original session transcript and context are unchanged.",
            provenance="candidate_recorded"))

    # Read only an explicit owned packet/job association. Never join receipts by company or guessed resume equality.
    packet = (await db.execute(select(ApplicationPacket.id, ApplicationPacket.status,
        ApplicationPacket.submission_started_at, ApplicationPacket.updated_at).where(
        ApplicationPacket.user_id == entry.user_id,
        ApplicationPacket.application_id == entry.id).order_by(
            ApplicationPacket.updated_at.desc(), ApplicationPacket.id).limit(1))).first()
    if packet is not None:
        source: Literal["saved_record", "candidate_recorded", "executor_reported", "outcome_uncertain"]
        uncertain = packet.submission_started_at is not None and packet.status not in ("submitted", "applied")
        if uncertain:
            title, detail, source = ("Application outcome needs review",
                "An execution attempt started but no completed result is recorded. Review the evidence before "
                "any retry; do not assume this application was sent.", "outcome_uncertain")
        elif packet.status == "submitted":
            title, detail, source = ("Executor reported submission",
                "Orbit's executor recorded submission. Open the packet to review its stored evidence; "
                "this is not independent employer confirmation.", "executor_reported")
        elif packet.status == "applied":
            title, detail, source = ("Application recorded by you",
                "You marked this packet as applied. The packet and saved resume do not establish an employer receipt.",
                "candidate_recorded")
        else:
            title, detail, source = ("Application packet updated",
                "Draft, review and execution state are available in the packet. Preparation alone is not application.",
                "saved_record")
        events.append(TimelineEvent(kind="application", at=packet.updated_at, title=title, detail=detail,
            provenance=source, link=f"/jobs/applications?packet={packet.id}"))

    if get_settings().personal_interview_rounds:
        recorded_rounds = (await db.scalars(select(JobInterviewRound).where(
            JobInterviewRound.user_id == entry.user_id, JobInterviewRound.application_id == entry.id)
            .order_by(JobInterviewRound.created_at.desc()).limit(60))).all()
        for recorded in recorded_rounds:
            at = recorded.completed_at or recorded.scheduled_at or recorded.created_at
            events.append(TimelineEvent(kind="interview_round", at=at,
                title=f"{recorded.label} — {recorded.status}",
                detail=f"Candidate-recorded employer round; {recorded.time_zone}. Separate from Saba practice.",
                provenance="candidate_recorded", upcoming=recorded.status == "planned" and recorded.scheduled_at is not None and _aware(at) > now,
                link=f"/jobs/mission/{entry.id}?tab=interview"))

    if entry.status in STAGE_LABEL:
        events.append(TimelineEvent(kind="stage", at=entry.status_at, title=STAGE_LABEL[entry.status]))
    if entry.next_at and _aware(entry.next_at) > now:
        events.append(TimelineEvent(kind="next", at=entry.next_at, upcoming=True,
                                    title="Next interview" if entry.status == "interviewing" else "Next follow-up"))
    return sorted(events, key=lambda e: _aware(e.at))
