"""Panel slot suggestions and candidate-led time-change requests. Bookings change only on candidate selection."""
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import ratelimit
from orbit_api.business import automation, emails, hiring, rules, scheduling
from orbit_api.business.access import CompanyCtx, application_for, audit, lock_company, timeline
from orbit_api.business.apply import _by_token, latest_interview
from orbit_api.business.automation_routes import current_application, lock_writes
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizCompany, BizEvent, BizInterview, BizNotification

router = APIRouter(prefix="/v1/business/companies/{company_id}/applications/{application_id}",
    tags=["business interview coordination"])
public_router = APIRouter(prefix="/v1/public/business/applications/{token}", tags=["candidate interview coordination"])
Db = Annotated[AsyncSession, Depends(get_db)]
KINDS = ("interview_change_requested", "interview_change_replied",
    "interview_change_withdrawn", "interview_change_closed")
_writes = ratelimit.SlidingWindow(rate_per_s=30 / 3600, burst=30)


class Window(Contract):
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def valid(self) -> "Window":
        if not timedelta(minutes=15) <= self.end - self.start <= timedelta(hours=12):
            raise ValueError("Availability windows must last between 15 minutes and 12 hours.")
        return self


class Windows(Contract):
    windows: list[Window] = Field(min_length=1, max_length=3)


class Options(Windows):
    duration_min: int = Field(30, ge=15, le=240)
    interview_id: str | None = Field(None, max_length=36)


class ChangeIn(Windows):
    request_id: RequestId
    interview_id: str = Field(min_length=1, max_length=36)
    interview_revision: int = Field(ge=0)
    timezone: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=10, max_length=800)

    @field_validator("timezone")
    @classmethod
    def zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use a recognised IANA time zone.") from exc
        return value


class CancelIn(Contract):
    request_id: RequestId
    base_revision: int = Field(ge=0)


class ReplyIn(CancelIn):
    interview_revision: int = Field(ge=0)
    message: str = Field(min_length=10, max_length=2000)
    slots: list[AwareDatetime] = Field(default_factory=list, max_length=5)
    notify: bool = False


def iso(value: datetime) -> str:
    return hiring.aware(value).astimezone(UTC).isoformat().replace("+00:00", "Z")


def validate_windows(windows: list[Window]) -> None:
    now = datetime.now(UTC)
    if any(w.start <= now + timedelta(minutes=30) or w.end > now + timedelta(days=60) for w in windows):
        raise HTTPException(422, "Choose windows at least 30 minutes ahead and within the next 60 days.")


def accepting(app: BizApplication, company: BizCompany, iv: BizInterview | None) -> bool:
    return bool(app.status == "active" and app.email_confirmed_at and not app.deletion_requested_at
        and company.status != "suspended" and iv and iv.slots
        and (iv.chosen is None or hiring.aware(iv.chosen) > datetime.now(UTC)))


async def public_lock(db: AsyncSession, app: BizApplication, company: BizCompany) -> None:
    await lock_company(db, company.id)
    if await db.get(BizApplication, app.id, populate_existing=True) is None or await db.get(
            BizCompany, company.id, populate_existing=True) is None:
        raise HTTPException(404, "Application no longer available.")


async def records(db: AsyncSession, app_id: str) -> list[BizEvent]:
    recent = select(BizEvent.id).where(BizEvent.application_id == app_id,
        BizEvent.kind == "interview_change_requested").order_by(
            BizEvent.created_at.desc(), BizEvent.id.desc()).limit(20)
    ids = list(await db.scalars(recent))
    return list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app_id,
        BizEvent.kind.in_(KINDS), (BizEvent.id.in_(ids) | BizEvent.data["change_id"].as_string().in_(ids)))
        .order_by(BizEvent.created_at, BizEvent.id)))


def render(rows: list[BizEvent], iv: BizInterview | None, active: bool) -> list[dict[str, Any]]:
    items = []
    grouped: dict[str, list[BizEvent]] = defaultdict(list)
    for event in rows:
        if event.data.get("change_id"):
            grouped[event.data["change_id"]].append(event)
    for source in (e for e in rows if e.kind == "interview_change_requested"):
        actions = grouped[source.id]
        replies = [e for e in actions if e.kind == "interview_change_replied"]
        reply = max(replies, key=lambda e: e.data["revision"]) if replies else None
        closed = any(e.kind in ("interview_change_withdrawn", "interview_change_closed") for e in actions)
        if closed:
            status = "withdrawn" if any(e.kind == "interview_change_withdrawn" for e in actions) else "resolved"
        elif iv is None or iv.id != source.data["interview_id"]:
            status = "superseded"
        elif not active:
            status = "closed"
        else:
            status = "answered" if reply and not reply.data.get("slots") else (
                "awaiting_candidate" if reply else "waiting")
        items.append({"id": source.id, "revision": max((int(e.data["revision"]) for e in actions), default=0),
            "interview_id": source.data["interview_id"], "timezone": source.data["timezone"],
            "windows": source.data["windows"], "reason": source.data["reason"], "status": status,
            "created_at": iso(source.created_at), "reply": {"message": reply.data["message"],
                "slots": reply.data.get("slots", []), "created_at": iso(reply.created_at)} if reply else None})
    return items


async def payload(db: AsyncSession, app: BizApplication, company: BizCompany, *, blind: bool = False) -> dict[str, Any]:
    iv = await latest_interview(db, app.id)
    active = accepting(app, company, iv)
    items = render(await records(db, app.id), iv, active)
    if blind:
        for item in items:
            item["reason"] = rules.blind_text(item["reason"], app.name, app.email, app.phone)
            if item["reply"]:
                item["reply"]["message"] = rules.blind_text(item["reply"]["message"], app.name, app.email, app.phone)
    return {"requests": items[-20:][::-1], "accepting": active, "interview": {"id": iv.id,
        "revision": iv.revision, "chosen": iso(iv.chosen) if iv.chosen else None,
        "duration_min": iv.duration_min} if iv and iv.slots else None}


async def retry(db: AsyncSession, app_id: str, key: str, command: dict[str, Any], actor_id: str | None) -> bool:
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app_id,
        BizEvent.kind.in_(KINDS), BizEvent.data["request_id"].as_string() == key).limit(1))
    if previous:
        if previous.data.get("command") != command or previous.actor_id != actor_id:
            raise HTTPException(409, "This request key was already used. Refresh before trying again.")
        return True
    return False


async def options(db: AsyncSession, app: BizApplication, body: Options, actor_id: str) -> list[str]:
    validate_windows(body.windows)
    starts = set()
    for window in body.windows:
        start = window.start.astimezone(UTC)
        while start + timedelta(minutes=body.duration_min) <= window.end:
            starts.add(iso(start))
            start += timedelta(minutes=15)
    current = await latest_interview(db, app.id) if body.interview_id else None
    if body.interview_id and (current is None or current.id != body.interview_id):
        raise HTTPException(409, "The interview changed. Refresh before finding panel times.")
    preview = BizInterview(company_id=app.company_id, application_id=app.id, slots=sorted(starts),
        duration_min=body.duration_min, panel_user_ids=current.panel_user_ids if current else list(
            app.interviewers or [actor_id]), created_by=current.created_by if current else actor_id)
    return (await scheduling.available_slots(db, preview, app.interviewers or []))[:24]


@router.post("/interview-options")
async def suggest(application_id: str, body: Options, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, _job = await application_for(db, ctx, application_id)
    if app.status != "active" or app.deletion_requested_at:
        raise HTTPException(409, "This application is no longer scheduling interviews.")
    ratelimit.check(_writes, f"biz-options:{ctx.user.id}")
    return {"slots": await options(db, app, body, ctx.user.id), "as_of": iso(datetime.now(UTC)),
        "scope": "Booked interviews in this Orbit company only. Suggestions do not reserve a time."}


@router.get("/scheduling-requests")
async def staff_get(application_id: str, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    app, _job = await application_for(db, ctx, application_id)
    return await payload(db, app, ctx.company, blind=ctx.company.blind_review)


@public_router.get("/scheduling-requests")
async def candidate_get(token: str, request: Request, db: Db) -> dict[str, Any]:
    app, _job, company = await _by_token(db, token, request)
    return await payload(db, app, company)


@public_router.post("/scheduling-requests")
async def create(token: str, body: ChangeIn, request: Request, db: Db) -> dict[str, Any]:
    app, job, company = await _by_token(db, token, request)
    await public_lock(db, app, company)
    rows = await records(db, app.id)
    if await retry(db, app.id, body.request_id, body.model_dump(mode="json"), None):
        return await payload(db, app, company)
    iv = await latest_interview(db, app.id)
    if not accepting(app, company, iv):
        raise HTTPException(409, "This application is not accepting interview time requests.")
    assert iv is not None
    if iv.id != body.interview_id or iv.revision != body.interview_revision:
        raise HTTPException(409, "Your interview changed. Refresh before requesting new times.")
    if any(r["status"] in ("waiting", "awaiting_candidate") for r in render(rows, iv, True)):
        raise HTTPException(409, "You already have a pending request. Withdraw it before sharing new availability.")
    validate_windows(body.windows)
    ratelimit.check(_writes, f"biz-time-change:{app.id}")
    timeline(db, app, "interview_change_requested", request_id=body.request_id, command=body.model_dump(mode="json"),
        interview_id=iv.id, interview_revision=iv.revision, timezone=body.timezone, reason=body.reason,
        windows=[{"start": iso(w.start), "end": iso(w.end)} for w in body.windows])
    owners = await automation.coordinators(db, job)
    recipients = [iv.created_by] if iv.created_by in owners else [job.created_by] if job.created_by in owners \
        else sorted(owners)[:3]
    for user_id in recipients:
        if user_id:
            db.add(BizNotification(company_id=company.id, application_id=app.id, user_id=user_id,
                kind="scheduling", text="A candidate requested different interview times. Review their availability."))
    await db.commit()
    return await payload(db, app, company)


@public_router.post("/scheduling-requests/{change_id}/withdraw")
async def withdraw(token: str, change_id: str, body: CancelIn, request: Request, db: Db) -> dict[str, Any]:
    app, _job, company = await _by_token(db, token, request)
    await public_lock(db, app, company)
    rows = await records(db, app.id)
    command = {**body.model_dump(mode="json"), "change_id": change_id}
    if await retry(db, app.id, body.request_id, command, None):
        return await payload(db, app, company)
    iv = await latest_interview(db, app.id)
    item = next((r for r in render(rows, iv, accepting(app, company, iv)) if r["id"] == change_id), None)
    if item is None:
        raise HTTPException(404, "Time request not found.")
    if item["status"] not in ("waiting", "awaiting_candidate") or item["revision"] != body.base_revision:
        raise HTTPException(409, "This request changed. Refresh before withdrawing it.")
    ratelimit.check(_writes, f"biz-time-change:{app.id}")
    timeline(db, app, "interview_change_withdrawn", change_id=change_id, revision=item["revision"] + 1,
        request_id=body.request_id, command=command)
    await db.commit()
    return await payload(db, app, company)


@router.post("/scheduling-requests/{change_id}/reply")
async def reply(application_id: str, change_id: str, body: ReplyIn, ctx: CompanyCtx, db: Db) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    await application_for(db, ctx, application_id)
    await lock_writes(db, ctx)
    app, job = await current_application(db, ctx, application_id)
    rows = await records(db, app.id)
    command = {**body.model_dump(mode="json"), "change_id": change_id}
    if await retry(db, app.id, body.request_id, command, ctx.user.id):
        return await payload(db, app, ctx.company, blind=ctx.company.blind_review)
    iv = await latest_interview(db, app.id)
    item = next((r for r in render(rows, iv, accepting(app, ctx.company, iv)) if r["id"] == change_id), None)
    if item is None:
        raise HTTPException(404, "Time request not found.")
    if iv is None or item["status"] not in ("waiting", "awaiting_candidate") or (
            item["revision"] != body.base_revision or iv.revision != body.interview_revision):
        raise HTTPException(409, "This request or interview changed. Refresh before replying.")
    slots = sorted({iso(s) for s in body.slots})
    if slots:
        windows = [Window.model_validate(w) for w in item["windows"]]
        if any(s <= datetime.now(UTC) + timedelta(minutes=30) or not any(w.start <= s and
                s + timedelta(minutes=iv.duration_min) <= w.end for w in windows) for s in body.slots):
            raise HTTPException(422, "Offer future times that fit inside the candidate's shared availability.")
        proposed = BizInterview(company_id=app.company_id, application_id=app.id, slots=slots,
            duration_min=iv.duration_min, panel_user_ids=iv.panel_user_ids, created_by=iv.created_by)
        if set(await scheduling.available_slots(db, proposed, app.interviewers or [])) != set(slots):
            raise HTTPException(409, "The panel has a booked interview in one of these times. Choose another option.")
        iv.slots = sorted(set(slots + ([iso(iv.chosen)] if iv.chosen else [])))
        iv.revision += 1
    ratelimit.check(_writes, f"biz-time-reply:{ctx.user.id}")
    timeline(db, app, "interview_change_replied", ctx.user, change_id=change_id, revision=item["revision"] + 1,
        slots=slots, message=body.message, request_id=body.request_id, command=command)
    audit(db, ctx.company.id, ctx.user, "interview.time_request_replied", app.reference, job_id=job.id,
        change_id=change_id, offered_count=len(slots), notify=body.notify)
    await db.commit()
    if body.notify:
        token = emails.status_token_for(app)
        link = emails.status_link(token) if token else "Use the private application link from your first email."
        await emails.send_to_applicant(ctx.company, app, f"Interview scheduling update: {job.title}",
            body.message + "\n\nReview your interview and offered times:\n" + link + "\n\n"
            "Your current booking remains until you select another offered time.", ctx.user.email)
    return await payload(db, app, ctx.company, blind=ctx.company.blind_review)


async def close_on_booking(db: AsyncSession, app: BizApplication, iv: BizInterview) -> None:
    for item in render(await records(db, app.id), iv, True):
        if item["interview_id"] == iv.id and item["status"] in ("waiting", "awaiting_candidate"):
            timeline(db, app, "interview_change_closed", change_id=item["id"], revision=item["revision"] + 1,
                reason="Candidate selected an offered time")
