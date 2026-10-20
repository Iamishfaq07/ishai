"""The people in a job search (Jobs AI → Outreach → People): a small contacts tracker.

Referrers, recruiters, alumni and hiring managers the user is in touch with, each with how to reach them, notes,
when they were last contacted and when to follow up, and optionally the tracked job they're about. Following up is
the point: the list puts whoever is due first, and "I got in touch" sets the next follow-up a week out.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import JobApplication, JobContact, User
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/jobs/contacts", tags=["jobs"])
contacts_limit = limit_user("jobs-contacts", rate_per_s=3, burst=60)

MAX_CONTACTS = 500
FOLLOW_UP_DAYS = 7  # "I got in touch": when to check in again, unless they say otherwise
Relation = Literal["referral", "recruiter", "alum", "hiring_manager", "interviewer", "mentor", "other"]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean(v: str | None) -> str:
    return re.sub(r"\s+", " ", v or "").strip()


def web_link(v: str | None) -> str | None:
    """A LinkedIn (or any web) link as typed: "linkedin.com/in/asha" gets its https://."""
    v = (v or "").strip()
    if not v:
        return None
    if not re.match(r"^https?://", v, re.IGNORECASE):
        v = "https://" + v
    if not re.match(r"^https?://[^\s/]+\.[^\s/]+", v, re.IGNORECASE):
        raise ValueError("That doesn't look like a web address.")
    return v


def email(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    if not _EMAIL.match(v):
        raise ValueError("That doesn't look like an email address.")
    return v


def phone(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    if not re.fullmatch(r"\+?[0-9 ()-]{6,24}", v):
        raise ValueError("A phone number has digits, spaces and an optional +.")
    return v


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str = Field("", max_length=200)
    title: str = Field("", max_length=200)
    relation: Relation = "other"
    linkedin_url: str | None = Field(None, max_length=500)
    email: str | None = Field(None, max_length=320)
    phone: str | None = Field(None, max_length=32)
    notes: str = Field("", max_length=4000)
    application_id: str | None = Field(None, max_length=36)
    follow_up_at: datetime | None = None

    @field_validator("name", "company", "title")
    @classmethod
    def _one_line(cls, v: str) -> str:
        return _clean(v)

    @field_validator("linkedin_url")
    @classmethod
    def _link(cls, v: str | None) -> str | None:
        return web_link(v)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return phone(v)


class ContactPatch(BaseModel):
    """Any of the contact's fields; `null` clears an optional one."""

    name: str | None = Field(None, min_length=1, max_length=120)
    company: str | None = Field(None, max_length=200)
    title: str | None = Field(None, max_length=200)
    relation: Relation | None = None
    linkedin_url: str | None = Field(None, max_length=500)
    email: str | None = Field(None, max_length=320)
    phone: str | None = Field(None, max_length=32)
    notes: str | None = Field(None, max_length=4000)
    application_id: str | None = Field(None, max_length=36)
    follow_up_at: datetime | None = None
    last_contacted_at: datetime | None = None

    @field_validator("name", "company", "title")
    @classmethod
    def _one_line(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else None

    @field_validator("linkedin_url")
    @classmethod
    def _link(cls, v: str | None) -> str | None:
        return web_link(v)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return phone(v)


class ContactedIn(BaseModel):
    # When to follow up next; by default a week from now. `null` (sent explicitly): no follow-up.
    follow_up_at: datetime | None = None
    no_follow_up: bool = False


class ContactOut(BaseModel):
    id: str
    name: str
    company: str
    title: str
    relation: Relation
    linkedin_url: str | None
    email: str | None
    phone: str | None
    notes: str
    application_id: str | None
    # The tracked job it's linked to, as the list shows it ("Android Engineer at PhonePe").
    application_label: str | None
    last_contacted_at: datetime | None
    follow_up_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _aware(t: datetime | None) -> datetime | None:
    return t.replace(tzinfo=UTC) if t is not None and t.tzinfo is None else t


def _out(c: JobContact, labels: dict[str, str]) -> ContactOut:
    return ContactOut(
        id=c.id, name=c.name, company=c.company, title=c.title,
        relation=c.relation if c.relation in Relation.__args__ else "other",  # type: ignore[attr-defined]
        linkedin_url=c.linkedin_url, email=c.email, phone=c.phone, notes=c.notes, application_id=c.application_id,
        application_label=labels.get(c.application_id or ""), last_contacted_at=_aware(c.last_contacted_at),
        follow_up_at=_aware(c.follow_up_at), created_at=_aware(c.created_at) or c.created_at,
        updated_at=_aware(c.updated_at) or c.updated_at)


async def _labels(db: AsyncSession, user: User, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = await db.execute(select(JobApplication.id, JobApplication.title, JobApplication.company)
                            .where(JobApplication.user_id == user.id, JobApplication.id.in_(ids)))
    return {i: f"{t} at {c}" if c else t for i, t, c in rows.all()}


async def _owned(db: AsyncSession, contact_id: str, user: User) -> JobContact:
    c = await db.get(JobContact, contact_id)
    if c is None or c.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your contacts")
    return c


async def _check_application(db: AsyncSession, user: User, application_id: str | None) -> None:
    if application_id is None:
        return
    entry = await db.get(JobApplication, application_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job isn't in your tracker")


def sort_key(c: JobContact, now: datetime) -> tuple[int, float]:
    """Due follow-ups first (most overdue first), then upcoming ones (soonest first), then the rest (newest first)."""
    due = _aware(c.follow_up_at)
    if due is not None and due <= now:
        return (0, due.timestamp())
    if due is not None:
        return (1, due.timestamp())
    return (2, -(_aware(c.updated_at) or now).timestamp())


@router.get("", response_model=list[ContactOut], dependencies=[Depends(contacts_limit)])
async def list_contacts(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                        application_id: Annotated[str | None, Query(max_length=36)] = None) -> list[ContactOut]:
    q = select(JobContact).where(JobContact.user_id == user.id)
    if application_id:
        q = q.where(JobContact.application_id == application_id)
    rows = list((await db.scalars(q)).all())
    now = datetime.now(UTC)
    rows.sort(key=lambda c: sort_key(c, now))
    labels = await _labels(db, user, {c.application_id for c in rows if c.application_id})
    return [_out(c, labels) for c in rows]


@router.post("", response_model=ContactOut, status_code=201, dependencies=[Depends(contacts_limit)])
async def add_contact(body: ContactIn, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> ContactOut:
    await lock_account(db, user.id)
    count = await db.scalar(select(func.count()).select_from(JobContact).where(JobContact.user_id == user.id))
    if (count or 0) >= MAX_CONTACTS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_CONTACTS} contacts.")
    await _check_application(db, user, body.application_id)
    c = JobContact(user_id=user.id, **body.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _out(c, await _labels(db, user, {c.application_id} if c.application_id else set()))


@router.patch("/{contact_id}", response_model=ContactOut, dependencies=[Depends(contacts_limit)])
async def update_contact(contact_id: str, body: ContactPatch, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> ContactOut:
    c = await _owned(db, contact_id, user)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and not changes["name"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A contact needs a name.")
    if "application_id" in changes:
        await _check_application(db, user, changes["application_id"])
    for key in ("company", "title", "notes", "relation"):
        if key in changes and changes[key] is None:
            changes[key] = "other" if key == "relation" else ""
    for key, value in changes.items():
        setattr(c, key, value)
    await db.commit()
    await db.refresh(c)
    return _out(c, await _labels(db, user, {c.application_id} if c.application_id else set()))


@router.post("/{contact_id}/contacted", response_model=ContactOut, dependencies=[Depends(contacts_limit)])
async def mark_contacted(contact_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)],
                         body: ContactedIn | None = None) -> ContactOut:
    """"I got in touch": now is the last contact, and the next follow-up is a week out (or as given, or none)."""
    c = await _owned(db, contact_id, user)
    now = datetime.now(UTC)
    c.last_contacted_at = now
    if body is not None and body.no_follow_up:
        c.follow_up_at = None
    else:
        c.follow_up_at = (body.follow_up_at if body is not None and body.follow_up_at else
                          now + timedelta(days=FOLLOW_UP_DAYS))
    await db.commit()
    await db.refresh(c)
    return _out(c, await _labels(db, user, {c.application_id} if c.application_id else set()))


@router.delete("/{contact_id}", status_code=204, dependencies=[Depends(contacts_limit)])
async def delete_contact(contact_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await db.delete(await _owned(db, contact_id, user))
    await db.commit()
