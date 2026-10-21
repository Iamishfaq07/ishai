"""Owned employer-round history and explicit preparation selection; never infer employer outcomes."""
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import JobApplication, JobInterviewRound, LiveSessionRow, User
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account

from .calendar_intake import events_from, plain, start_time
from .message_updates import Contract, owned, state
from .rounds import MAX_ROUND, RoundType

router = APIRouter(prefix="/v1/jobs/tracker", tags=["candidate interview rounds"],
    dependencies=[Depends(limit_user("candidate-rounds", rate_per_s=2, burst=30))])
MAX_ROUNDS_PER_JOB = 60
MAX_HISTORY = 100
RoundStatus = Literal["planned", "completed", "cancelled"]
Outcome = Literal["awaiting_reply", "next_round", "offer", "not_selected", "other"]


def aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def enabled() -> None:
    if not get_settings().personal_interview_rounds:
        raise HTTPException(404, "Interview round history is not enabled on this server.")


def selected(entry: JobApplication, row: JobInterviewRound) -> bool:
    return bool(entry.preparation_round_id == row.id and entry.preparation_round_revision == row.revision
        and row.status == "planned" and row.scheduled_at and entry.next_at
        and aware(entry.next_at) == aware(row.scheduled_at)
        and entry.round_type == row.round_type and entry.round_number == row.number)


async def context_round(db: AsyncSession, entry: JobApplication) -> JobInterviewRound | None:
    if not get_settings().personal_interview_rounds or not entry.preparation_round_id:
        return None
    row = await db.scalar(select(JobInterviewRound).where(JobInterviewRound.id == entry.preparation_round_id,
        JobInterviewRound.user_id == entry.user_id, JobInterviewRound.application_id == entry.id))
    if row is None or not selected(entry, row):
        raise HTTPException(409, "The selected interview round changed. Review this job's round history before practice.")
    return row


async def view(db: AsyncSession, entry: JobApplication) -> dict[str, Any]:
    current = state(entry)
    if not get_settings().personal_interview_rounds:
        return {"enabled": False, "tracker_version": current["version"], "rounds": []}
    rows = (await db.scalars(select(JobInterviewRound).where(JobInterviewRound.user_id == entry.user_id,
        JobInterviewRound.application_id == entry.id).order_by(JobInterviewRound.created_at, JobInterviewRound.id)
        .limit(MAX_ROUNDS_PER_JOB))).all()
    sessions = (await db.execute(select(LiveSessionRow.interview_round_id, LiveSessionRow.interview_round_revision,
        LiveSessionRow.type, func.count()).where(LiveSessionRow.user_id == entry.user_id,
        LiveSessionRow.application_id == entry.id, LiveSessionRow.interview_round_id.in_([row.id for row in rows]),
        LiveSessionRow.status == "ended").group_by(LiveSessionRow.interview_round_id,
            LiveSessionRow.interview_round_revision, LiveSessionRow.type))).all() if rows else []
    return {"enabled": True, "tracker_version": current["version"], "editable": current["editable"],
        "preparation_round_id": entry.preparation_round_id, "rounds": [{"id": row.id,
        "revision": row.revision, "label": row.label, "round_type": row.round_type, "number": row.number,
        "scheduled_at": row.scheduled_at, "time_zone": row.time_zone, "status": row.status,
        "notes": row.notes, "outcome": row.outcome, "completed_at": row.completed_at,
        "source": row.source, "history": row.history, "selected_for_preparation": selected(entry, row),
        "selection_stale": entry.preparation_round_id == row.id and not selected(entry, row),
        "practice_sessions": sum(count for rid, rev, kind, count in sessions
                                 if rid == row.id and rev == row.revision and kind == "mock"),
        "earlier_practice_sessions": sum(count for rid, rev, kind, count in sessions
                                         if rid == row.id and rev != row.revision and kind == "mock")}
        for row in rows]}


class Choice(Contract):
    tracker_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed: bool = Field(strict=True)
    mark_interviewing: bool = Field(False, strict=True)

    @field_validator("confirmed")
    @classmethod
    def explicit_confirmation(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Confirm the reviewed round changes")
        return value


class RoundFields(Choice):
    label: str = Field(min_length=1, max_length=160)
    round_type: RoundType | None = None
    number: int | None = Field(None, ge=1, le=MAX_ROUND)
    local_time: str | None = Field(None, max_length=19,
        pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$")
    time_zone: str = Field("UTC", pattern=r"^[A-Za-z0-9_+/-]{1,100}$")
    notes: str = Field("", max_length=4000)
    use_for_preparation: bool = Field(False, strict=True)

    @field_validator("label", "notes")
    @classmethod
    def text_only(cls, value: str) -> str:
        return plain(value)

    def instant(self) -> datetime | None:
        try:
            ZoneInfo(self.time_zone)
            if not self.local_time:
                return None
            wall = datetime.fromisoformat(self.local_time)
            if wall.tzinfo is not None:
                raise ValueError("Use a local time and its IANA zone, not a second offset")
            at, _ = start_time(f"DTSTART;TZID={self.time_zone}", wall.strftime("%Y%m%dT%H%M%S"))
            return datetime.fromisoformat(at)
        except (ValueError, ZoneInfoNotFoundError, OverflowError) as exc:
            raise HTTPException(422, str(exc)) from exc


class NewRound(RoundFields):
    request_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")


class EditRound(RoundFields):
    revision: int = Field(ge=1)
    status: RoundStatus = "planned"
    outcome: Outcome | None = None

    @model_validator(mode="after")
    def completion(self) -> "EditRound":
        if self.status != "completed" and self.outcome is not None:
            raise ValueError("Record an outcome only after confirming the round happened")
        return self


class SelectRound(Choice):
    revision: int = Field(ge=1)


class CalendarRound(Choice):
    calendar: str = Field(min_length=30, max_length=131072)
    event_id: str = Field(pattern=r"^[0-9a-f]{24}$")
    round_type: RoundType | None = None
    number: int | None = Field(None, ge=1, le=MAX_ROUND)
    use_for_preparation: bool = Field(False, strict=True)


async def writable(db: AsyncSession, user: User, entry_id: str, version: str) -> JobApplication:
    enabled()
    await lock_account(db, user.id)
    entry = await owned(db, user, entry_id)
    current = state(entry)
    if current["version"] != version or not current["editable"]:
        raise HTTPException(409, "This job changed or is closed. Refresh before recording an interview round.")
    return entry


async def save_projection(db: AsyncSession, entry: JobApplication, row: JobInterviewRound,
                          choose: bool, mark_interviewing: bool, was_selected: bool = False) -> None:
    now = datetime.now(UTC)
    values: dict[str, Any] = {"updated_at": now}
    if (choose or was_selected) and row.status == "planned":
        if row.scheduled_at is None:
            raise HTTPException(422, "Add a verified time before selecting this round for dated preparation.")
        values.update(next_at=row.scheduled_at, round_type=row.round_type, round_number=row.number,
                      preparation_round_id=row.id, preparation_round_revision=row.revision)
    elif entry.preparation_round_id == row.id and row.status != "planned":
        values.update(preparation_round_id=None, preparation_round_revision=None)
        if was_selected:
            values.update(next_at=None, round_type=None, round_number=None)
    if mark_interviewing:
        if row.status != "planned" or row.scheduled_at is None:
            raise HTTPException(422, "Only a planned, dated employer interview can update this job's stage.")
        values.update(status="interviewing", status_at=now)
    changed = await db.execute(update(JobApplication).where(JobApplication.id == entry.id,
        JobApplication.user_id == entry.user_id, JobApplication.updated_at == entry.updated_at)
        .values(**values).returning(JobApplication.id))
    if changed.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(409, "This job changed during saving. Refresh and review again.")


def event(row: JobInterviewRound, action: str) -> dict[str, Any]:
    return {"revision": row.revision, "action": action, "at": datetime.now(UTC).isoformat(),
        "scheduled_at": aware(row.scheduled_at).isoformat() if row.scheduled_at else None,
        "time_zone": row.time_zone, "status": row.status, "label": row.label,
        "round_type": row.round_type, "number": row.number, "outcome": row.outcome}


async def finish(db: AsyncSession, entry: JobApplication) -> dict[str, Any]:
    await db.commit()
    await db.refresh(entry)
    return await view(db, entry)


async def insert(db: AsyncSession, user: User, entry: JobApplication, row: JobInterviewRound,
                 choose: bool, mark: bool) -> dict[str, Any]:
    duplicate = await db.scalar(select(JobInterviewRound.id).where(JobInterviewRound.user_id == user.id,
        JobInterviewRound.application_id == entry.id, JobInterviewRound.source_key == row.source_key))
    if duplicate:
        raise HTTPException(409, "This invitation or request is already recorded. Review the existing round instead.")
    count = await db.scalar(select(func.count()).select_from(JobInterviewRound).where(
        JobInterviewRound.application_id == entry.id, JobInterviewRound.user_id == user.id))
    if (count or 0) >= MAX_ROUNDS_PER_JOB:
        raise HTTPException(409, "This opportunity has reached its round-history limit; existing history is preserved.")
    db.add(row)
    await db.flush()
    row.history = [event(row, "recorded")]
    await save_projection(db, entry, row, choose, mark)
    return await finish(db, entry)


@router.get("/{entry_id}/rounds")
async def get_rounds(entry_id: str, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await view(db, await owned(db, user, entry_id))


@router.post("/{entry_id}/rounds", status_code=201)
async def create_round(entry_id: str, body: NewRound, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await writable(db, user, entry_id, body.tracker_version)
    row = JobInterviewRound(user_id=user.id, application_id=entry.id, label=body.label,
        round_type=body.round_type, number=body.number, scheduled_at=body.instant(), time_zone=body.time_zone,
        notes=body.notes, status="planned", source="candidate", source_key=f"manual:{body.request_id}", revision=1)
    return await insert(db, user, entry, row, body.use_for_preparation, body.mark_interviewing)


@router.post("/{entry_id}/rounds/calendar", status_code=201)
async def import_round(entry_id: str, body: CalendarRound, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await writable(db, user, entry_id, body.tracker_version)
    try:
        picked = next((item for item in events_from(body.calendar) if item["id"] == body.event_id), None)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc
    if picked is None:
        raise HTTPException(422, "Choose an event from the reviewed invitation.")
    row = JobInterviewRound(user_id=user.id, application_id=entry.id, label=picked["title"][:160],
        round_type=body.round_type, number=body.number, scheduled_at=datetime.fromisoformat(picked["start_at"]),
        time_zone=picked["time_zone"], status="planned", source="calendar_review", revision=1,
        source_key=f"calendar:{body.event_id}", notes="")
    return await insert(db, user, entry, row, body.use_for_preparation, body.mark_interviewing)


async def owned_round(db: AsyncSession, user: User, entry: JobApplication, rid: str,
                      revision: int) -> JobInterviewRound:
    row = await db.scalar(select(JobInterviewRound).where(JobInterviewRound.id == rid,
        JobInterviewRound.user_id == user.id, JobInterviewRound.application_id == entry.id)
        .with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "Interview round not found")
    if row.revision != revision:
        raise HTTPException(409, "This round changed. Refresh before saving another version.")
    return row


@router.put("/{entry_id}/rounds/{round_id}")
async def edit_round(entry_id: str, round_id: str, body: EditRound, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await writable(db, user, entry_id, body.tracker_version)
    row = await owned_round(db, user, entry, round_id, body.revision)
    if len(row.history or []) >= MAX_HISTORY:
        raise HTTPException(409, "History limit reached. Export the existing history; no earlier changes were removed.")
    was_selected = selected(entry, row)
    before = event(row, "before_change")
    row.label, row.round_type, row.number = body.label, body.round_type, body.number
    row.scheduled_at, row.time_zone, row.notes = body.instant(), body.time_zone, body.notes
    row.status, row.outcome = body.status, body.outcome
    row.completed_at = (row.completed_at or datetime.now(UTC)) if body.status == "completed" else None
    row.revision += 1
    row.history = [*(row.history or []), {**event(row, "candidate_update"), "previous": before}]
    await save_projection(db, entry, row, body.use_for_preparation, body.mark_interviewing, was_selected)
    return await finish(db, entry)


@router.post("/{entry_id}/rounds/{round_id}/prepare")
async def prepare_round(entry_id: str, round_id: str, body: SelectRound,
                        user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await writable(db, user, entry_id, body.tracker_version)
    row = await owned_round(db, user, entry, round_id, body.revision)
    if row.status != "planned":
        raise HTTPException(409, "Completed or cancelled rounds cannot become the upcoming preparation round.")
    await save_projection(db, entry, row, True, body.mark_interviewing)
    return await finish(db, entry)


@router.post("/{entry_id}/rounds/preparation/clear")
async def clear_preparation(entry_id: str, body: Choice, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    entry = await writable(db, user, entry_id, body.tracker_version)
    if body.mark_interviewing:
        raise HTTPException(422, "Clearing preparation does not mark an interview stage.")
    values: dict[str, Any] = {"updated_at": datetime.now(UTC), "preparation_round_id": None,
                              "preparation_round_revision": None}
    if entry.preparation_round_id:
        row = await db.scalar(select(JobInterviewRound).where(JobInterviewRound.id == entry.preparation_round_id,
            JobInterviewRound.user_id == user.id, JobInterviewRound.application_id == entry.id))
        if row is not None and selected(entry, row):
            values.update(next_at=None, round_type=None, round_number=None)
    changed = await db.execute(update(JobApplication).where(JobApplication.id == entry.id,
        JobApplication.user_id == user.id, JobApplication.updated_at == entry.updated_at)
        .values(**values).returning(JobApplication.id))
    if changed.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(409, "This opportunity changed. Refresh before clearing preparation.")
    return await finish(db, entry)
