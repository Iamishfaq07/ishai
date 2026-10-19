"""Versioned offer summaries and candidate responses; a human still marks the application hired."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import conversations, emails, hiring
from orbit_api.business.access import CompanyCtx, application_for, audit, lock_company, timeline
from orbit_api.business.apply import _by_token
from orbit_api.business.hiring_schema import Contract, RequestId
from orbit_api.business.screening import _writes
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizEvent
from orbit_api.ratelimit import check

router = APIRouter(prefix="/v1/business/companies/{company_id}/applications/{application_id}/offer",
    tags=["business offers"])
public_router = APIRouter(prefix="/v1/public/business/applications/{token}/offer", tags=["business candidate offer"])


class OfferIn(Contract):
    role: str = Field(min_length=2, max_length=160)
    compensation: str = Field(min_length=3, max_length=300)
    start_date: str = Field(min_length=3, max_length=120)
    terms: str = Field(min_length=30, max_length=5000)
    expires_days: int = Field(7, ge=1, le=30)
    base_offer_id: str | None = Field(None, max_length=36)
    request_id: RequestId


class Respond(Contract):
    offer_id: str = Field(max_length=36)
    response: Literal["accepted", "declined"]
    acknowledge: bool
    request_id: RequestId


class Withdraw(Contract):
    offer_id: str = Field(max_length=36)
    request_id: RequestId


async def records(db: AsyncSession, app: BizApplication) -> list[BizEvent]:
    return list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind.in_(("offer_published", "offer_response", "offer_withdrawn")))
        .order_by(BizEvent.created_at, BizEvent.id)))


def summary(latest: BizEvent, rows: list[BizEvent], *, superseded: bool = False) -> dict[str, Any]:
    updates = [e for e in rows if e.data.get("offer_id") == latest.id]
    response = next((e for e in updates if e.kind == "offer_response"), None)
    withdrawn = any(e.kind == "offer_withdrawn" for e in updates)
    status = "withdrawn" if withdrawn else response.data["response"] if response else "superseded" if superseded else (
        "expired" if datetime.fromisoformat(latest.data["expires_at"]) < datetime.now(UTC) else "pending")
    return {"id": latest.id, **{k: latest.data[k] for k in
        ("role", "compensation", "start_date", "terms", "expires_at", "revision")}, "status": status,
        "created_at": conversations.iso(latest.created_at),
        "responded_at": conversations.iso(response.created_at) if response else None}


async def state(db: AsyncSession, app: BizApplication) -> dict[str, Any]:
    rows = await records(db, app)
    offered = [e for e in rows if e.kind == "offer_published"]
    if not offered:
        return {"offer": None}
    latest = max(offered, key=lambda e: int(e.data["revision"]))
    return {"offer": summary(latest, rows)}


async def history(db: AsyncSession, app: BizApplication, before_revision: int | None) -> dict[str, Any]:
    rows = await records(db, app)
    published = sorted((e for e in rows if e.kind == "offer_published"), key=lambda e: -int(e.data["revision"]))
    current = published[0].id if published else None
    page = [e for e in published if before_revision is None or e.data["revision"] < before_revision][:21]
    return {"versions": [summary(e, rows, superseded=e.id != current) for e in page[:20]],
        "next_before_revision": page[19].data["revision"] if len(page) > 20 else None}


def active(app: BizApplication) -> None:
    if app.status != "active" or app.deletion_requested_at is not None or app.email_confirmed_at is None:
        raise HTTPException(409, "This application is not collecting offer updates.")


@router.get("")
async def staff_get(application_id: str, ctx: CompanyCtx,
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    app, _ = await application_for(db, ctx, application_id)
    result = await state(db, app)
    if result["offer"]:
        for key in ("role", "compensation", "start_date", "terms"):
            result["offer"][key] = hiring.blind_text(ctx, app, result["offer"][key])
    return result


@router.post("")
async def publish(application_id: str, body: OfferIn, ctx: CompanyCtx,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    active(app)
    current = (await state(db, app))["offer"]
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "offer_published", BizEvent.data["request_id"].as_string() == body.request_id))
    content = body.model_dump(exclude={"base_offer_id", "request_id"})
    if previous:
        if previous.actor_id == ctx.user.id and all(previous.data.get(k) == v for k, v in content.items()):
            return await staff_get(application_id, ctx, db)
        raise HTTPException(409, "This offer request already saved different terms.")
    if (current["id"] if current else None) != body.base_offer_id or (current and current["status"] == "accepted"):
        raise HTTPException(409, "The offer changed or was accepted. Review its current record.")
    check(_writes, f"offer:{app.id}")
    timeline(db, app, "offer_published", ctx.user, **content, request_id=body.request_id,
        revision=current["revision"] + 1 if current else 1,
        expires_at=(datetime.now(UTC) + timedelta(days=body.expires_days)).isoformat())
    audit(db, ctx.company.id, ctx.user, "offer.published", app.reference)
    await db.commit()
    token = emails.status_token_for(app)
    if token:
        await emails.send_to_applicant(ctx.company, app, f"An offer update for {job.title}",
            f"Review the offer summary and respond on your private application page:\n{emails.status_link(token)}",
            ctx.user.email)
    return await staff_get(application_id, ctx, db)


@router.get("/history")
async def staff_history(application_id: str, ctx: CompanyCtx,
                        db: Annotated[AsyncSession, Depends(get_db)],
                        before_revision: Annotated[int | None, Query(ge=1)] = None) -> dict[str, Any]:
    ctx.require("move_applicants")
    app, _ = await application_for(db, ctx, application_id)
    result = await history(db, app, before_revision)
    for version in result["versions"]:
        for key in ("role", "compensation", "start_date", "terms"):
            version[key] = hiring.blind_text(ctx, app, version[key])
    return result


@router.post("/withdraw")
async def withdraw(application_id: str, body: Withdraw, ctx: CompanyCtx,
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.require("move_applicants")
    ctx.writable()
    app, _ = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    active(app)
    current = (await state(db, app))["offer"]
    if not current or current["id"] != body.offer_id or current["status"] in ("accepted", "declined"):
        raise HTTPException(409, "This offer cannot be withdrawn here. Review the saved response.")
    if current["status"] != "withdrawn":
        timeline(db, app, "offer_withdrawn", ctx.user, offer_id=body.offer_id, request_id=body.request_id)
        audit(db, ctx.company.id, ctx.user, "offer.withdrawn", app.reference)
        await db.commit()
    return await staff_get(application_id, ctx, db)


@public_router.get("")
async def candidate_get(token: str, request: Request,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, _, _ = await _by_token(db, token, request)
    return await state(db, app)


@public_router.post("/respond")
async def respond(token: str, body: Respond, request: Request,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    app, _, company = await _by_token(db, token, request)
    if company.status != "active":
        raise HTTPException(409, "This company is not collecting offer responses.")
    await lock_company(db, company.id)
    await db.refresh(app)
    active(app)
    current = (await state(db, app))["offer"]
    previous = await db.scalar(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "offer_response", BizEvent.data["request_id"].as_string() == body.request_id))
    if previous and previous.data.get("response") == body.response and previous.data.get("offer_id") == body.offer_id:
        return await state(db, app)
    if previous or not current or current["id"] != body.offer_id or current["status"] != "pending":
        raise HTTPException(409, "This offer changed, expired or already has a response. Refresh to review it.")
    if not body.acknowledge:
        raise HTTPException(422, "Read and acknowledge the displayed offer terms before responding.")
    check(_writes, f"offer-response:{app.id}")
    timeline(db, app, "offer_response", offer_id=body.offer_id, response=body.response, request_id=body.request_id)
    await db.commit()
    return await state(db, app)


@public_router.get("/history")
async def candidate_history(token: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)],
                            before_revision: Annotated[int | None, Query(ge=1)] = None) -> dict[str, Any]:
    app, _, _ = await _by_token(db, token, request)
    return await history(db, app, before_revision)
