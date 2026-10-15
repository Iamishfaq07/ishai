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

from orbit_api.models import Document, JobApplication, JobContact, JobFitCheck, LiveSessionRow, Resume
from orbit_api.sessions.loop_memory import same_company

Kind = Literal["saved", "fit", "resume", "prep_doc", "contact", "outreach", "applied", "round", "stage", "next"]
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
        events.append(TimelineEvent(kind="applied", at=entry.applied_at, title="Applied"))

    # Rounds with this company: practice and live sessions since the job was saved (a session names its company).
    sessions = (await db.scalars(select(LiveSessionRow).where(
        LiveSessionRow.user_id == entry.user_id, LiveSessionRow.created_at >= entry.created_at,
        LiveSessionRow.status != "created").order_by(LiveSessionRow.created_at.desc()).limit(80))).all()
    rounds = [s for s in sessions if same_company(s.company, entry.company)][:MAX_ROUNDS]
    for s in rounds:
        events.append(TimelineEvent(kind="round", at=s.started_at or s.created_at,
                                    title=ROUND_LABEL.get(s.type, "Session"), detail=s.title,
                                    link=f"/sessions/{s.id}" if s.status == "ended" else None))

    if entry.status in STAGE_LABEL:
        events.append(TimelineEvent(kind="stage", at=entry.status_at, title=STAGE_LABEL[entry.status]))
    if entry.next_at and _aware(entry.next_at) > now:
        events.append(TimelineEvent(kind="next", at=entry.next_at, upcoming=True,
                                    title="Next interview" if entry.status == "interviewing" else "Next follow-up"))
    return sorted(events, key=lambda e: _aware(e.at))
