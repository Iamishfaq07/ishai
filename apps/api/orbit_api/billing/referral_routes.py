"""Referrals over HTTP (billing/referrals.py): an account's Invite friends, a code entered at checkout, a link's code
looked up for the sign-up page, and the admin's creator and campus codes with their report (and its CSV).

The user endpoints answer 404 while ORBIT_REFERRALS is off; the admin's work either way, so codes can be made and the
values reviewed before it's switched on."""

import csv
import io
import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.billing import pricing, referrals
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, Payment, Referral, ReferralCode, User
from orbit_api.ratelimit import client_ip, limit, limit_user

router = APIRouter(prefix="/v1", tags=["referrals"])
redeem_limit = limit_user("referral-redeem", rate_per_s=10 / 3600, burst=10)
lookup_limit = limit("referral-lookup", rate_per_s=60 / 3600, burst=30)


def _on() -> None:
    if not referrals.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Referrals aren't switched on.")


def _ip(request: Request) -> str | None:
    ip = client_ip(request)
    return None if ip == "unknown" else ip


class OfferOut(BaseModel):
    """A first-purchase discount: the code, whose it is, and how much off."""

    code: str | None  # none: the first-purchase offer every account has
    kind: str  # invite | creator | campus | first
    label: str | None  # a creator's or campus's name; never an inviter's
    percent: int
    text: str  # "10% off your first purchase"


def _offer_out(o: referrals.Offer) -> OfferOut:
    text = f"{o.percent}% off your first purchase" if o.percent else "Code saved"
    return OfferOut(code=o.code, kind=o.kind, label=o.label if o.kind != referrals.INVITE else None, percent=o.percent,
                    text=text)


class InviteOut(BaseModel):
    code: str
    link: str
    share_text: str  # what Share and WhatsApp send
    discount_percent: int  # what a friend gets off their first purchase
    reward_minutes: int  # what you get when they pay
    monthly_cap: int
    joined: int
    paid: int
    minutes_earned: int
    rewards_this_month: int
    offer: OfferOut | None = None  # this account's own first-purchase discount, if it has one


@router.get("/referrals/me", response_model=InviteOut)
async def my_invite(user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> InviteOut:
    """Invite friends: the account's link (made the first time), what a friend gets and what you get, and how it's
    gone so far."""
    _on()
    s = get_settings()
    uid = user.id  # making the code may roll back a clash, which expires `user`
    code = await referrals.invite_code(db, user)
    stats = await referrals.invite_stats(db, uid)
    offer = await referrals.offer_for(db, await db.get(User, uid))
    url = referrals.link(code.code)
    off = s.referral_discount_percent
    share = (f"I use Orbit AI to prepare for interviews. Sign up with my link and get {off}% off your first purchase: "
             f"{url}" if off else f"I use Orbit AI to prepare for interviews. Sign up with my link: {url}")
    return InviteOut(code=code.code, link=url, share_text=share, discount_percent=off,
                     reward_minutes=s.referral_reward_minutes, monthly_cap=s.referral_monthly_cap, joined=stats.joined,
                     paid=stats.paid, minutes_earned=stats.minutes_earned,
                     rewards_this_month=stats.rewards_this_month, offer=_offer_out(offer) if offer else None)


class RedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)


@router.post("/referrals/redeem", response_model=OfferOut, dependencies=[Depends(redeem_limit)])
async def redeem(body: RedeemIn, request: Request, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> OfferOut:
    """A code entered at checkout (a creator's, a campus's or a friend's invite), before the account's first payment:
    it becomes the account's code, and its discount comes off the next order. 422 says why one can't be used."""
    _on()
    uid = user.id
    try:
        row = await referrals.attribute(db, user, body.code, _ip(request), "checkout")
        db.add(AuditLog(user_id=uid, action="referral.redeem", target=f"{uid} {row.code_id}"))
        await db.commit()
    except referrals.CodeRefused as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    except IntegrityError as e:  # the same account entering a code twice at once: one of them stands
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A code was just saved on this account. Reload the page.") from e
    offer = await referrals.offer_for(db, await db.get(User, uid) or user)
    if offer is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That code can't be used on this account.")
    return _offer_out(offer)


class CodeInfoOut(BaseModel):
    code: str
    kind: str
    label: str | None  # a creator's or campus's name; never an inviter's
    percent: int  # off the first purchase


@router.get("/referrals/codes/{code}", response_model=CodeInfoOut, dependencies=[Depends(lookup_limit)])
async def code_info(code: str, db: Annotated[AsyncSession, Depends(get_db)]) -> CodeInfoOut:
    """Public: what a link's code gives, for the sign-up page to say so. 404 when it can't be used, saying why."""
    _on()
    found = await referrals.find(db, code)
    why = await referrals.problem(db, found) if found else "We couldn't find that code."
    if found is None or why:
        raise HTTPException(status.HTTP_404_NOT_FOUND, why)
    return CodeInfoOut(code=found.code, kind=found.kind,
                       label=found.label if found.kind != referrals.INVITE else None,
                       percent=referrals.percent_of(found))


# ---- admin: creator and campus codes, and how each is doing ---------------------------------------------------------


class CodeIn(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    label: str = Field(min_length=1, max_length=120)
    kind: Literal["creator", "campus"]
    discount_percent: int = Field(10, ge=0, le=50)
    commission_percent: int = Field(0, ge=0, le=100)  # for the report only: payouts are by hand
    expires_at: datetime | None = None
    max_uses: int | None = Field(None, ge=1, le=1_000_000)  # paying accounts


class CodePatch(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=120)
    discount_percent: int | None = Field(None, ge=0, le=50)
    commission_percent: int | None = Field(None, ge=0, le=100)
    active: bool | None = None
    expires_at: datetime | None = None
    max_uses: int | None = Field(None, ge=1, le=1_000_000)
    # Sent as true to remove the expiry or the cap (null in `expires_at` / `max_uses` means "not changed").
    clear_expiry: bool = False
    clear_max_uses: bool = False


class CodeRow(BaseModel):
    id: str | None  # None: the row that adds up every account's invite link
    code: str
    kind: str
    label: str | None
    discount_percent: int
    commission_percent: int
    active: bool
    expires_at: datetime | None
    max_uses: int | None
    created_at: datetime | None
    problem: str | None  # why it can't be used right now (expired, used up, switched off), or None
    signups: int  # accounts that came with it (sign-up or checkout), not counting blocked ones
    paying: int  # of them, how many have paid
    blocked: int  # self-invites refused (an invite's own account, inbox or network)
    # Their approved payments less refunds, kept apart by currency (paise, cents), and the commission on each.
    revenue_inr: int
    revenue_usd: int
    revenue_inr_text: str
    revenue_usd_text: str
    commission_inr: int
    commission_usd: int
    commission_inr_text: str
    commission_usd_text: str
    minutes_rewarded: int  # invites: reward minutes given, less those taken back after refunds


class ReviewRow(BaseModel):
    """A referral for the admin to look at: an invite refused as the inviter's own, or a first payment refunded."""

    id: str
    created_at: datetime
    email: str  # the referred account ("(deleted account)" when it's gone)
    inviter_email: str | None
    code: str | None
    kind: str
    status: str
    reason: str | None  # own_code | same_inbox | same_network | mutual | paid_before
    flag: str | None  # what a refund did ("took back 30 of 30 reward minutes")


class ReferralsAdminOut(BaseModel):
    enabled: bool  # ORBIT_REFERRALS
    reward_minutes: int
    discount_percent: int
    monthly_cap: int
    codes: list[CodeRow]
    invites: CodeRow
    review: list[ReviewRow]


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=UTC) if d is not None and d.tzinfo is None else d


async def _rows(db: AsyncSession) -> tuple[list[CodeRow], CodeRow]:
    codes = list((await db.scalars(select(ReferralCode).where(ReferralCode.kind != referrals.INVITE)
                                   .order_by(ReferralCode.created_at.desc()))).all())

    def key(kind: str, code_id: str | None) -> str | None:
        return None if kind == referrals.INVITE else code_id

    counts: dict[str | None, dict[str, int]] = {}
    for kind, code_id, st, n, rewarded, taken in (await db.execute(
            select(Referral.kind, Referral.code_id, Referral.status, func.count(),
                   func.coalesce(func.sum(Referral.reward_seconds), 0),
                   func.coalesce(func.sum(Referral.clawback_seconds), 0))
            .group_by(Referral.kind, Referral.code_id, Referral.status))).all():
        c = counts.setdefault(key(kind, code_id), {"signups": 0, "paying": 0, "blocked": 0, "seconds": 0})
        c["blocked" if st == referrals.BLOCKED else "signups"] += int(n)
        c["paying"] += int(n) if st in referrals.PAYING else 0
        c["seconds"] += int(rewarded or 0) - int(taken or 0)
    revenue: dict[str | None, dict[str, int]] = {}
    paid = case((Payment.currency == pricing.INR, Payment.amount_inr * 100), else_=Payment.amount_minor)
    for kind, code_id, currency, total, refunded in (await db.execute(
            select(Referral.kind, Referral.code_id, Payment.currency, func.coalesce(func.sum(paid), 0),
                   func.coalesce(func.sum(Payment.refunded_paise), 0))
            .join(Payment, Payment.user_id == Referral.user_id)
            .where(Payment.status == "approved", Referral.status.in_(referrals.PAYING))
            .group_by(Referral.kind, Referral.code_id, Payment.currency))).all():
        r = revenue.setdefault(key(kind, code_id), {pricing.INR: 0, pricing.USD: 0})
        r[currency or pricing.INR] = r.get(currency or pricing.INR, 0) + max(int(total or 0) - int(refunded or 0), 0)

    def row(code: ReferralCode | None, why: str | None) -> CodeRow:
        k = code.id if code else None
        c = counts.get(k, {"signups": 0, "paying": 0, "blocked": 0, "seconds": 0})
        r = revenue.get(k, {pricing.INR: 0, pricing.USD: 0})
        pct = code.commission_percent if code else 0
        inr, usd = r.get(pricing.INR, 0), r.get(pricing.USD, 0)
        # Commission rounds down to the whole rupee or cent.
        c_inr, c_usd = inr * pct // 100 // 100 * 100, usd * pct // 100
        return CodeRow(
            id=k, code=code.code if code else "Invite links", kind=code.kind if code else referrals.INVITE,
            label=code.label if code else "Every account's own link",
            discount_percent=referrals.percent_of(code) if code else get_settings().referral_discount_percent,
            commission_percent=pct, active=code.active if code else True,
            expires_at=_aware(code.expires_at) if code else None, max_uses=code.max_uses if code else None,
            created_at=_aware(code.created_at) if code else None, problem=why, signups=c["signups"],
            paying=c["paying"], blocked=c["blocked"], revenue_inr=inr, revenue_usd=usd,
            revenue_inr_text=pricing.money(pricing.INR, inr), revenue_usd_text=pricing.money(pricing.USD, usd),
            commission_inr=c_inr, commission_usd=c_usd, commission_inr_text=pricing.money(pricing.INR, c_inr),
            commission_usd_text=pricing.money(pricing.USD, c_usd), minutes_rewarded=c["seconds"] // 60)

    return [row(code, await referrals.problem(db, code)) for code in codes], row(None, None)


async def _review(db: AsyncSession) -> list[ReviewRow]:
    rows = (await db.scalars(select(Referral).where(or_(Referral.status == referrals.BLOCKED,
                                                        Referral.flag.is_not(None)))
                             .order_by(Referral.created_at.desc()).limit(100))).all()
    ids = {r.user_id for r in rows} | {r.referrer_user_id for r in rows if r.referrer_user_id}
    emails: dict[str, str] = {uid: email for uid, email in (await db.execute(
        select(User.id, User.email).where(User.id.in_(ids)))).all()} if ids else {}
    codes = {r.code_id for r in rows if r.code_id}
    names: dict[str, str] = {cid: code for cid, code in (await db.execute(
        select(ReferralCode.id, ReferralCode.code).where(ReferralCode.id.in_(codes)))).all()} if codes else {}
    return [ReviewRow(id=r.id, created_at=_aware(r.created_at) or r.created_at,
                      email=emails.get(r.user_id, "(deleted account)"),
                      inviter_email=emails.get(r.referrer_user_id, "(deleted account)") if r.referrer_user_id else None,
                      code=names.get(r.code_id) if r.code_id else None, kind=r.kind, status=r.status,
                      reason=r.reason, flag=r.flag) for r in rows]


@router.get("/admin/referrals", response_model=ReferralsAdminOut)
async def admin_referrals(_: Annotated[User, Depends(require_admin)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> ReferralsAdminOut:
    """Each creator and campus code (and every invite link together): sign-ups → paying accounts → revenue in ₹ and
    in $ (never added together) → commission owed. Then the referrals to review."""
    s = get_settings()
    codes, invites = await _rows(db)
    return ReferralsAdminOut(enabled=s.referrals, reward_minutes=s.referral_reward_minutes,
                             discount_percent=s.referral_discount_percent, monthly_cap=s.referral_monthly_cap,
                             codes=codes, invites=invites, review=await _review(db))


@router.post("/admin/referrals/codes", response_model=CodeRow, status_code=201)
async def create_code(body: CodeIn, admin: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> CodeRow:
    code = referrals.normalize(body.code)
    if code is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "A code is 3 to 32 letters or digits (a dash or underscore is fine after the first).")
    if body.expires_at is not None and (_aware(body.expires_at) or body.expires_at) <= datetime.now(UTC):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That expiry is in the past.")
    row = ReferralCode(code=code, kind=body.kind, label=body.label.strip(), discount_percent=body.discount_percent,
                       commission_percent=body.commission_percent, expires_at=body.expires_at,
                       max_uses=body.max_uses, created_by=admin.id)
    db.add(row)
    db.add(AuditLog(user_id=admin.id, action="admin.referral_code.create",
                    target=json.dumps({"code": code, "kind": body.kind, "discount": body.discount_percent,
                                       "commission": body.commission_percent})))
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"The code {code} is taken. Pick another.") from e
    return await _row_for(db, row.id)


async def _row_for(db: AsyncSession, code_id: str) -> CodeRow:
    codes, _ = await _rows(db)
    return next(c for c in codes if c.id == code_id)


@router.patch("/admin/referrals/codes/{code_id}", response_model=CodeRow)
async def update_code(code_id: str, body: CodePatch, admin: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> CodeRow:
    """Change a code's label, discount, commission, expiry or cap, or switch it off (or on). The code itself and its
    kind stay, so its report stays one line."""
    row = await db.get(ReferralCode, code_id)
    if row is None or row.kind == referrals.INVITE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Code not found.")
    # null means "not changed" for every field; the expiry and the cap are removed with their clear_* flags.
    changes: dict[str, Any] = {k: v for k, v in body.model_dump(
        exclude_unset=True, exclude={"clear_expiry", "clear_max_uses"}).items() if v is not None}
    if body.clear_expiry:
        changes["expires_at"] = None
    if body.clear_max_uses:
        changes["max_uses"] = None
    for name, value in changes.items():
        setattr(row, name, value.strip() if isinstance(value, str) else value)
    db.add(AuditLog(user_id=admin.id, action="admin.referral_code.update",
                    target=f"{row.code} {json.dumps(changes, default=str)}"))
    await db.commit()
    return await _row_for(db, row.id)


_CSV_COLUMNS = ("code", "kind", "label", "discount_percent", "commission_percent", "active", "expires_at", "max_uses",
                "signups", "paying", "blocked", "revenue_inr", "revenue_usd", "commission_inr", "commission_usd",
                "reward_minutes", "status")


@router.get("/admin/referrals/export")
async def export_referrals(admin: Annotated[User, Depends(require_admin)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """The report as CSV (UTF-8 with a BOM): one row per code and one for every invite link together. Money in
    rupees and in dollars, in separate columns."""
    from orbit_api.admin.accounts import _cell

    codes, invites = await _rows(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for r in (*codes, invites):
        writer.writerow([_cell(v) for v in (
            r.code, r.kind, r.label, r.discount_percent, r.commission_percent, "yes" if r.active else "no",
            r.expires_at, r.max_uses, r.signups, r.paying, r.blocked, r.revenue_inr // 100,
            f"{r.revenue_usd / 100:.2f}", r.commission_inr // 100, f"{r.commission_usd / 100:.2f}",
            r.minutes_rewarded, r.problem or "usable")])
    db.add(AuditLog(user_id=admin.id, action="admin.referrals.export", target=f"{len(codes)} codes"))
    await db.commit()
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="orbit-referrals-{stamp}.csv"',
                             "Cache-Control": "no-store"})
