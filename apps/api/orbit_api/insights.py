"""Candidate insights for the admin: where each account came from, what it did in the app, and where it stopped.

- **Where they came from.** The web app keeps the first visit's referring site (its host only), the link's campaign
  tags (utm_*), an invite code and the landing page (its path only) on the device, and sends them once after sign-up
  (`POST /v1/activity`, `source`). Saved on the account (`User.signup_source`) only in its first week, and only once.
- **What they did.** Pages opened, a few steps (a button that matters) and errors shown to them, with the device size
  (phone, tablet, desktop). Never what they typed, uploaded or were answered. Ids in addresses are kept as ":id".
  Kept 180 days (`KEEP`), then deleted.
- **Where they stopped.** The journey's steps come from what the account has in Orbit, not from the log: signed up,
  verified, a resume, a saved job, a practice session, applied, an interview, paid. The first step not done yet is
  where they're stuck.

The admin sees one account's journey (`GET /v1/admin/users/{id}/journey`) and everyone's (`GET /v1/admin/insights`).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import (
    ActivityEvent,
    AuditLog,
    Document,
    JobApplication,
    LiveSessionRow,
    Payment,
    Resume,
    User,
)
from orbit_api.ratelimit import limit_user

KEEP = timedelta(days=180)
SOURCE_WINDOW = timedelta(days=7)  # a source arriving later than this after sign-up isn't the sign-up's
TIMELINE = 200
MAX_EVENTS = 50

router = APIRouter(prefix="/v1/activity", tags=["insights"],
                   dependencies=[Depends(limit_user("activity", rate_per_s=1, burst=30))])
admin_router = APIRouter(prefix="/v1/admin", tags=["admin"])

_NOT_NAME = re.compile(r"[^\w .:/&'()-]")
_ID = re.compile(r"^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|\d+|[A-Za-z0-9_-]{20,})$", re.IGNORECASE)
_SOURCE_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref")


def clean_path(raw: str | None) -> str:
    """The address's path only (no query or fragment), each id as ":id", at most 200 characters."""
    if not raw:
        return ""
    path = urlsplit(raw.strip()).path or "/"
    if not path.startswith("/"):
        return ""
    return "/".join(":id" if _ID.match(part) else part for part in path.split("/"))[:200]


def clean_host(raw: str | None) -> str:
    """A referring address's host, without "www.": "google.com", "linkedin.com"."""
    if not raw:
        return ""
    host = (urlsplit(raw.strip()).hostname or "").lower()
    return host.removeprefix("www.")[:120]


def source_label(src: dict[str, Any] | None) -> str:
    """One word for grouping: the campaign's source, a referral, the referring site, or "direct"."""
    if not src:
        return "unknown"
    if src.get("utm_source"):
        return str(src["utm_source"]).lower()[:60]
    if src.get("ref"):
        return "referral"
    host = str(src.get("referrer") or "")
    for known, label in (("google.", "google"), ("bing.", "bing"), ("duckduckgo.", "duckduckgo"),
                         ("linkedin.", "linkedin"), ("lnkd.in", "linkedin"), ("youtube.", "youtube"),
                         ("instagram.", "instagram"), ("facebook.", "facebook"), ("t.co", "x"), ("x.com", "x"),
                         ("twitter.", "x"), ("reddit.", "reddit"), ("whatsapp.", "whatsapp"),
                         ("chatgpt.", "chatgpt"), ("openai.", "chatgpt"), ("perplexity.", "perplexity")):
        if host == known.rstrip(".") or host.startswith(known) or f".{known}" in f".{host}":
            return label
    return host or "direct"


# ---- recording ------------------------------------------------------------------------------------------------


class SourceIn(BaseModel):
    referrer: str | None = Field(None, max_length=500)
    landing: str | None = Field(None, max_length=500)
    utm_source: str | None = Field(None, max_length=120)
    utm_medium: str | None = Field(None, max_length=120)
    utm_campaign: str | None = Field(None, max_length=120)
    utm_content: str | None = Field(None, max_length=120)
    utm_term: str | None = Field(None, max_length=120)
    ref: str | None = Field(None, max_length=64)
    first_seen: datetime | None = None


class EventIn(BaseModel):
    kind: Literal["page", "action", "error"]
    name: str = Field(min_length=1, max_length=80)
    path: str | None = Field(None, max_length=500)
    detail: str | None = Field(None, max_length=200)
    device: Literal["phone", "tablet", "desktop"] | None = None
    at: datetime | None = None


class ActivityIn(BaseModel):
    source: SourceIn | None = None
    events: list[EventIn] = Field(default_factory=list, max_length=MAX_EVENTS)


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _source(body: SourceIn) -> dict[str, Any] | None:
    out: dict[str, Any] = {k: " ".join(v.split())[:120] for k in _SOURCE_KEYS if (v := getattr(body, k))}
    if host := clean_host(body.referrer):
        out["referrer"] = host
    if landing := clean_path(body.landing):
        out["landing"] = landing
    if body.first_seen is not None:
        out["first_seen"] = _aware(body.first_seen).isoformat()
    return out or None


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def record(body: ActivityIn, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    now = datetime.now(UTC)
    uid = user.id
    if body.source is not None and user.signup_source is None and now - _aware(user.created_at) <= SOURCE_WINDOW:
        user.signup_source = _source(body.source)
    for e in body.events:
        name = " ".join(_NOT_NAME.sub("", e.name).split())[:80]
        if not name:
            continue
        at = _aware(e.at) if e.at else now
        if not now - timedelta(hours=1) <= at <= now:  # a batch held on a device for long, or a wrong clock
            at = now
        db.add(ActivityEvent(user_id=uid, kind=e.kind, name=name, path=clean_path(e.path),
                             device=e.device or "", detail=" ".join((e.detail or "").split())[:200],
                             created_at=at))
    await db.execute(delete(ActivityEvent).where(ActivityEvent.user_id == uid, ActivityEvent.created_at < now - KEEP))
    await db.commit()


# ---- the journey ---------------------------------------------------------------------------------------------

STEPS: tuple[tuple[str, str], ...] = (
    ("signed_up", "Signed up"),
    ("verified", "Verified email"),
    ("resume", "Added a resume"),
    ("job_saved", "Saved a job"),
    ("practiced", "Practised an interview"),
    ("applied", "Applied"),
    ("interview", "Got an interview"),
    ("paid", "Paid"),
)
LABEL = dict(STEPS)


async def _firsts(db: AsyncSession, ids: list[str]) -> dict[str, dict[str, datetime]]:
    """For each account in `ids`, when it first did each step ({} for steps not done)."""
    out: dict[str, dict[str, datetime]] = {i: {} for i in ids}
    if not ids:
        return out

    async def take(step: str, q: Any) -> None:
        for uid, at in (await db.execute(q)).all():
            if uid in out and at is not None:
                prev = out[uid].get(step)
                at = _aware(at)
                out[uid][step] = at if prev is None or at < prev else prev

    for chunk in (ids[i:i + 500] for i in range(0, len(ids), 500)):
        await take("signed_up", select(User.id, User.created_at).where(User.id.in_(chunk)))
        await take("verified", select(AuditLog.user_id, func.min(AuditLog.created_at))
                   .where(AuditLog.user_id.in_(chunk), AuditLog.action == "auth.verify_email")
                   .group_by(AuditLog.user_id))
        await take("verified", select(User.id, User.created_at)
                   .where(User.id.in_(chunk), User.email_verified, User.google_sub.is_not(None)))
        await take("resume", select(Resume.user_id, func.min(Resume.created_at))
                   .where(Resume.user_id.in_(chunk)).group_by(Resume.user_id))
        await take("resume", select(Document.user_id, func.min(Document.created_at))
                   .where(Document.user_id.in_(chunk), Document.kind == "resume").group_by(Document.user_id))
        await take("job_saved", select(JobApplication.user_id, func.min(JobApplication.created_at))
                   .where(JobApplication.user_id.in_(chunk)).group_by(JobApplication.user_id))
        await take("practiced", select(LiveSessionRow.user_id, func.min(LiveSessionRow.created_at))
                   .where(LiveSessionRow.user_id.in_(chunk)).group_by(LiveSessionRow.user_id))
        await take("applied", select(JobApplication.user_id,
                                     func.min(func.coalesce(JobApplication.applied_at, JobApplication.status_at)))
                   .where(JobApplication.user_id.in_(chunk),
                          JobApplication.status.in_(("applied", "interviewing", "offer")))
                   .group_by(JobApplication.user_id))
        await take("interview", select(JobApplication.user_id, func.min(JobApplication.status_at))
                   .where(JobApplication.user_id.in_(chunk), JobApplication.status.in_(("interviewing", "offer")))
                   .group_by(JobApplication.user_id))
        await take("paid", select(Payment.user_id, func.min(func.coalesce(Payment.decided_at, Payment.created_at)))
                   .where(Payment.user_id.in_(chunk), Payment.status == "approved").group_by(Payment.user_id))
    return out


def stuck_at(done: dict[str, datetime]) -> str | None:
    """The first step not done yet (the journey's order), or None when every step is."""
    return next((key for key, _ in STEPS if key not in done), None)


class StepOut(BaseModel):
    key: str
    label: str
    done_at: datetime | None


class EventOut(BaseModel):
    at: datetime
    kind: str
    name: str
    path: str
    device: str
    detail: str


class CountOut(BaseModel):
    name: str
    count: int


class JourneyOut(BaseModel):
    source: dict[str, Any] | None
    source_label: str
    steps: list[StepOut]
    stuck_at: str | None  # the label of the first step not done
    last_seen: datetime | None
    active_days_30: int  # days with any activity in the last 30
    devices: list[CountOut]  # page views by device size, last 30 days
    top_pages: list[CountOut]  # most opened pages, last 30 days
    errors_30: int
    timeline: list[EventOut]  # newest first


@admin_router.get("/users/{user_id}/journey", response_model=JourneyOut)
async def journey(user_id: str, _: Annotated[User, Depends(require_admin)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> JourneyOut:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    done = (await _firsts(db, [u.id]))[u.id]
    since = datetime.now(UTC) - timedelta(days=30)
    mine = ActivityEvent.user_id == u.id
    recent = (mine, ActivityEvent.created_at >= since)
    rows = (await db.scalars(select(ActivityEvent).where(mine).order_by(ActivityEvent.created_at.desc())
                             .limit(TIMELINE))).all()
    last = await db.scalar(select(func.max(ActivityEvent.created_at)).where(mine))
    days = {str(d)[:10] for d in (await db.scalars(select(ActivityEvent.created_at).where(*recent))).all()}
    devices = (await db.execute(select(ActivityEvent.device, func.count()).where(*recent, ActivityEvent.kind == "page")
                                .group_by(ActivityEvent.device))).all()
    pages = (await db.execute(select(ActivityEvent.path, func.count()).where(*recent, ActivityEvent.kind == "page")
                              .group_by(ActivityEvent.path).order_by(func.count().desc()).limit(10))).all()
    errors = await db.scalar(select(func.count()).select_from(ActivityEvent)
                             .where(*recent, ActivityEvent.kind == "error"))
    key = stuck_at(done)
    return JourneyOut(
        source=u.signup_source, source_label=source_label(u.signup_source),
        steps=[StepOut(key=k, label=label, done_at=done.get(k)) for k, label in STEPS],
        stuck_at=LABEL[key] if key else None, last_seen=_aware(last) if last else None,
        active_days_30=len(days), devices=[CountOut(name=d or "unknown", count=n) for d, n in devices],
        top_pages=[CountOut(name=p or "/", count=n) for p, n in pages], errors_30=int(errors or 0),
        timeline=[EventOut(at=_aware(e.created_at), kind=e.kind, name=e.name, path=e.path, device=e.device,
                           detail=e.detail) for e in rows])


# ---- everyone -------------------------------------------------------------------------------------------------


class SourceRow(BaseModel):
    source: str
    signups: int
    resume: int  # of them, added a resume
    paid: int


class FunnelRow(BaseModel):
    key: str
    label: str
    count: int  # signed up in the window and did this step (by now)
    stuck: int  # this is the first step they haven't done


class ErrorRow(BaseModel):
    name: str
    path: str
    count: int
    people: int


class InsightsOut(BaseModel):
    days: int
    signups: int
    active_1: int  # people with any activity in the last day
    active_7: int
    sources: list[SourceRow]
    funnel: list[FunnelRow]
    devices: list[CountOut]
    top_pages: list[CountOut]  # by people who opened them
    errors: list[ErrorRow]


@dataclass
class _Tally:
    signups: int = 0
    resume: int = 0
    paid: int = 0


@admin_router.get("/insights", response_model=InsightsOut)
async def insights(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                   days: Annotated[int, Query(ge=1, le=180)] = 30) -> InsightsOut:
    """Everyone who signed up in the last `days`: where they came from, how far they got and where they stopped;
    and, for everyone active in that time, which pages they use and which errors they hit."""
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    joined = (await db.execute(select(User.id, User.signup_source).where(User.created_at >= since))).all()
    firsts = await _firsts(db, [uid for uid, _ in joined])
    tally: dict[str, _Tally] = {}
    reached: Counter[str] = Counter()
    stuck: Counter[str] = Counter()
    for uid, src in joined:
        done = firsts[uid]
        t = tally.setdefault(source_label(src), _Tally())
        t.signups += 1
        t.resume += "resume" in done
        t.paid += "paid" in done
        reached.update(done.keys())
        if (key := stuck_at(done)) is not None:
            stuck[key] += 1
    window = ActivityEvent.created_at >= since

    async def people_since(at: datetime) -> int:
        return int(await db.scalar(select(func.count(func.distinct(ActivityEvent.user_id)))
                                   .where(ActivityEvent.created_at >= at)) or 0)

    devices = (await db.execute(select(ActivityEvent.device, func.count(func.distinct(ActivityEvent.user_id)))
                                .where(window, ActivityEvent.kind == "page").group_by(ActivityEvent.device))).all()
    people = func.count(func.distinct(ActivityEvent.user_id))
    pages = (await db.execute(select(ActivityEvent.path, people).where(window, ActivityEvent.kind == "page")
                              .group_by(ActivityEvent.path).order_by(people.desc()).limit(15))).all()
    errors = (await db.execute(select(ActivityEvent.name, ActivityEvent.path, func.count(), people)
                               .where(window, ActivityEvent.kind == "error")
                               .group_by(ActivityEvent.name, ActivityEvent.path)
                               .order_by(func.count().desc()).limit(15))).all()
    return InsightsOut(
        days=days, signups=len(joined), active_1=await people_since(now - timedelta(days=1)),
        active_7=await people_since(now - timedelta(days=7)),
        sources=sorted((SourceRow(source=k, signups=t.signups, resume=t.resume, paid=t.paid)
                        for k, t in tally.items()), key=lambda r: (-r.signups, r.source)),
        funnel=[FunnelRow(key=k, label=label, count=reached[k], stuck=stuck[k]) for k, label in STEPS],
        devices=[CountOut(name=d or "unknown", count=n) for d, n in devices],
        top_pages=[CountOut(name=p or "/", count=n) for p, n in pages],
        errors=[ErrorRow(name=n, path=p, count=c, people=k) for n, p, c, k in errors])
