"""Plans and entitlements over HTTP, and buying credit packs (billing/packs.py): through Razorpay's checkout when it's
set up (billing/razorpay.py, confirmed by Razorpay's signature), else over UPI (billing/upi.py, approved by the
admin). Limits and features never come from clients; a payment changes nothing until it's confirmed."""

import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits, entitlements
from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.billing import razorpay, upi
from orbit_api.billing.packs import packs, public_packs
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import active_grant, plan_named
from orbit_api.models import AuditLog, Payment, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["billing"])

order_limit = limit_user("upi-order", rate_per_s=1 / 60, burst=10)
utr_limit = limit_user("upi-utr", rate_per_s=1 / 60, burst=8)


@router.get("/plans")
async def list_plans() -> list[dict[str, Any]]:
    """Public: what each plan includes (the pricing page renders this, not a hard-coded copy)."""
    return entitlements.public_plans()


@router.get("/billing/packs")
async def list_packs() -> list[dict[str, Any]]:
    """Public: the credit packs for sale, and whether they can be bought right now (a UPI ID is set)."""
    return public_packs()


@router.get("/entitlements")
async def my_entitlements(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """The signed-in user's plan, its limits, this month's usage, which features are on, and credits left."""
    return await entitlements.for_user(db, user)


# ---- UPI ---------------------------------------------------------------------------------------------------------

PaymentStatus = Literal["awaiting_payment", "submitted", "approved", "rejected"]


class UpiOrderOut(BaseModel):
    id: str
    pack: str
    label: str
    amount_inr: int
    resume_credits: int
    interview_minutes: int
    reference: str
    status: PaymentStatus
    utr: str | None
    note: str | None
    created_at: datetime
    submitted_at: datetime | None
    decided_at: datetime | None
    method: str = "upi"  # "upi" (a UTR the admin checks) or "razorpay" (confirmed by Razorpay)
    # How to pay; only while there's still something to pay (not once it's submitted or approved). The app shows
    # `upi_uri` as a QR, and as a tap-through link on phones.
    upi_id: str | None = None
    payee_name: str | None = None
    upi_uri: str | None = None


def _label(p: Payment) -> str:
    pack = packs().get(p.plan)
    if pack is not None:
        return f"{pack.label} pack"
    return plan_named(p.plan).label if p.days else p.plan  # an order from before credit packs


def _order_out(p: Payment) -> UpiOrderOut:
    label = _label(p)
    out = UpiOrderOut(id=p.id, pack=p.plan, label=label, amount_inr=p.amount_inr, resume_credits=p.resume_credits,
                      interview_minutes=p.interview_minutes, reference=p.reference, status=p.status, utr=p.utr,
                      note=p.note, created_at=upi.aware(p.created_at),
                      submitted_at=upi.aware(p.submitted_at) if p.submitted_at else None,
                      decided_at=upi.aware(p.decided_at) if p.decided_at else None, method=p.method or "upi")
    s = get_settings()
    if p.status in ("awaiting_payment", "rejected") and s.upi_id and out.method == "upi":
        out.upi_id, out.payee_name, out.upi_uri = s.upi_id, s.upi_name, upi.upi_uri(p, label)
    return out


class OrderIn(BaseModel):
    pack: str = Field(min_length=1, max_length=32)


@router.post("/billing/upi/orders", response_model=UpiOrderOut, status_code=201, dependencies=[Depends(order_limit)])
async def create_order(body: OrderIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """Start paying for a credit pack: the amount, reference and UPI link. An open order for the same pack from the
    last day is handed back instead of making another."""
    pack = packs().get(body.pack)
    if pack is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That pack can't be bought.")
    if not get_settings().upi_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "UPI payments aren't set up yet.")
    since = datetime.now(UTC) - upi.OPEN_ORDER_REUSE
    open_order = await db.scalar(
        select(Payment).where(Payment.user_id == user.id, Payment.plan == pack.id,
                              Payment.status == "awaiting_payment", Payment.amount_inr == pack.price_inr,
                              Payment.created_at >= since)
        .order_by(Payment.created_at.desc()).limit(1))
    if open_order is not None:
        return _order_out(open_order)
    p = Payment(user_id=user.id, plan=pack.id, amount_inr=pack.price_inr, days=0, resume_credits=pack.resume_credits,
                interview_minutes=pack.interview_minutes, reference=upi.new_reference(), status="awaiting_payment")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _order_out(p)


@router.get("/billing/upi/orders", response_model=list[UpiOrderOut])
async def my_orders(user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> list[UpiOrderOut]:
    """Newest first: what's waiting to be paid, waiting for the admin, approved or rejected."""
    rows = (await db.scalars(select(Payment).where(Payment.user_id == user.id)
                             .order_by(Payment.created_at.desc()).limit(20))).all()
    # A Razorpay checkout that was opened and closed unpaid is nothing to show.
    return [_order_out(p) for p in rows if not (p.method == "razorpay" and p.status == "awaiting_payment")]


class UtrIn(BaseModel):
    utr: str = Field(min_length=1, max_length=40)


@router.post("/billing/upi/orders/{order_id}/utr", response_model=UpiOrderOut, dependencies=[Depends(utr_limit)])
async def submit_utr(order_id: str, body: UtrIn, background: BackgroundTasks,
                     user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """"I've paid": the UTR goes to the admin to check. It can be corrected until the admin decides."""
    p = await db.get(Payment, order_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status == "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment is already approved.")
    utr = upi.normalize_utr(body.utr)
    if utr is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "That isn't a UTR. It's the 12-digit number your UPI app shows for the payment "
                            "(called UTR, UPI Ref No. or Transaction ID).")
    first_time = p.status != "submitted"
    # Conditional: an approval landing meanwhile mustn't be followed by a different UTR on the approved order.
    try:
        done = await db.execute(
            update(Payment).where(Payment.id == p.id, Payment.user_id == user.id, Payment.status != "approved")
            .values(utr=utr, status="submitted", submitted_at=datetime.now(UTC), note=None))
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "That UTR was already used for a payment. Check the number in your UPI app.") from e
    if done.rowcount != 1:  # type: ignore[attr-defined]
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment is already approved.")
    await db.refresh(p)
    s = get_settings()
    if first_time and s.admin_email and not s.is_admin_email(user.email):
        background.add_task(send_safely, OutgoingEmail(
            to=s.admin_email, subject=f"UPI payment to check: ₹{p.amount_inr} from {user.email}",
            text=(f"{user.email} says they paid ₹{p.amount_inr} for the {_label(p)}.\n\n"
                  f"UTR: {utr}\nReference (in the UPI note): {p.reference}\n\n"
                  f"Check your bank statement, then approve or reject it: {s.web_url.rstrip('/')}/admin/payments")))
    return _order_out(p)


# ---- Razorpay -------------------------------------------------------------------------------------------------------


class CheckoutOut(BaseModel):
    """What the page opens Razorpay's checkout with."""

    payment_id: str  # Orbit's
    order_id: str  # Razorpay's ("order_…")
    key_id: str
    amount_paise: int
    currency: str
    label: str
    email: str
    name: str | None


class VerifyIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=40)
    payment_id: str = Field(min_length=1, max_length=40)
    signature: str = Field(min_length=1, max_length=128)


@router.post("/billing/razorpay/orders", response_model=CheckoutOut, status_code=201,
             dependencies=[Depends(order_limit)])
async def razorpay_order(body: OrderIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> CheckoutOut:
    """Start buying a pack through Razorpay: an order there for the pack's price, kept here until it's paid."""
    pack = packs().get(body.pack)
    if pack is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That pack can't be bought.")
    key_id = get_settings().razorpay_key_id
    if not razorpay.configured() or not key_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Card payments aren't set up yet.")
    reference = upi.new_reference()
    try:
        order_id = await razorpay.create_order(pack.price_inr, reference, {"pack": pack.id, "orbit_ref": reference})
    except razorpay.RazorpayError as e:
        log.warning("razorpay order failed: %s", e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Payments aren't reachable right now. Try again in a minute.") from e
    p = Payment(user_id=user.id, plan=pack.id, amount_inr=pack.price_inr, days=0, resume_credits=pack.resume_credits,
                interview_minutes=pack.interview_minutes, reference=reference, status="awaiting_payment",
                method="razorpay", gateway_order_id=order_id)
    db.add(p)
    await db.commit()
    return CheckoutOut(payment_id=p.id, order_id=order_id, key_id=key_id, amount_paise=pack.price_inr * 100,
                       currency="INR", label=f"{pack.label} pack", email=user.email, name=user.name)


async def _paid(db: AsyncSession, p: Payment, gateway_payment_id: str, background: BackgroundTasks) -> bool:
    """Razorpay says this order is paid: approve it and add the pack's credits, once. False if it already was (or
    the account is gone)."""
    now = datetime.now(UTC)
    done = await db.execute(
        update(Payment).where(Payment.id == p.id, Payment.status == "awaiting_payment")
        .values(status="approved", submitted_at=now, decided_at=now, gateway_payment_id=gateway_payment_id))
    if done.rowcount != 1:  # type: ignore[attr-defined]
        await db.rollback()
        return False
    u = await db.get(User, p.user_id) if p.user_id else None
    if u is None:
        await db.commit()  # paid, but the account was deleted: kept for the records
        return False
    if p.resume_credits:
        credits.add(db, u.id, "resume", p.resume_credits, "purchase", payment_id=p.id)
    if p.interview_minutes:
        credits.add(db, u.id, "interview_seconds", p.interview_minutes * 60, "purchase", payment_id=p.id)
    u.approved = True
    db.add(AuditLog(user_id=u.id, action="payment.razorpay",
                    target=f"{p.id} {p.plan} ₹{p.amount_inr} {gateway_payment_id}"))
    try:
        await db.commit()
    except IntegrityError:  # credited a moment ago by the other confirmation (checkout vs webhook)
        await db.rollback()
        return False
    web = get_settings().web_url.rstrip("/")
    background.add_task(send_safely, OutgoingEmail(
        to=u.email, subject=f"Payment received: {_what(p)} added to Orbit",
        text=(f"Thanks! We received your ₹{p.amount_inr} payment (Razorpay {gateway_payment_id}).\n\n"
              f"Your account now has {_what(p)} more. They don't expire. Sign in to use them: {web}/login")))
    return True


@router.post("/billing/razorpay/verify", response_model=UpiOrderOut, dependencies=[Depends(utr_limit)])
async def razorpay_verify(body: VerifyIn, background: BackgroundTasks, user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """The checkout's "paid": checked against Razorpay's signature, then the pack's credits land."""
    if not razorpay.checkout_signature_ok(body.order_id, body.payment_id, body.signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "We couldn't confirm that payment. If money left your account, contact us with the "
                            "Razorpay payment id.")
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == body.order_id))
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status == "awaiting_payment":
        try:
            payment = await razorpay.fetch_payment(body.payment_id)
        except razorpay.RazorpayError as e:
            log.warning("razorpay verify: couldn't read %s (%s)", body.payment_id, e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "We couldn't confirm that payment with Razorpay yet. If money left your account, "
                                "it will be added once the payment is captured.") from e
        captured = (str(payment.get("status")) == "captured" and str(payment.get("order_id")) == body.order_id
                    and str(payment.get("currency")) == "INR" and payment.get("amount") == p.amount_inr * 100)
        if not captured:
            # A valid checkout signature only means Razorpay created the payment. "authorized" is not captured:
            # the bank can still fail it, so credits wait for capture (the webhook, or a later verify).
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "The payment isn't captured yet, so nothing was added. If money left your account, "
                                "it will show here once Razorpay captures it.")
        await _paid(db, p, body.payment_id, background)
    await db.refresh(p)
    return _order_out(p)


async def _refund_noted(db: AsyncSession, event: dict[str, Any]) -> None:
    """A refund went out. Credits stay: they may already be spent. The note and the audit row are the record, once."""
    try:
        refund = event["payload"]["refund"]["entity"]
        refund_id = str(refund["id"])
        payment_id = str(refund.get("payment_id") or "")
        amount = int(refund.get("amount") or 0)
    except (KeyError, TypeError, ValueError):
        return
    if not refund_id.startswith("rfnd_") or not payment_id:
        return
    p = await db.scalar(select(Payment).where(Payment.gateway_payment_id == payment_id))
    if p is None:
        log.warning("razorpay refund %s for an unknown payment %s", refund_id, payment_id)
        return
    seen = await db.scalar(select(AuditLog.id).where(
        AuditLog.action == "payment.refunded", AuditLog.target.contains(refund_id)))
    if seen is not None:
        return
    rupees = amount // 100 if amount else p.amount_inr
    if not p.note:
        p.note = f"Razorpay refunded ₹{rupees} ({refund_id}). Credits were not removed."[:300]
    db.add(AuditLog(user_id=p.user_id, action="payment.refunded",
                    target=f"{p.id} {refund_id} ₹{rupees} credits kept"))
    await db.commit()


@router.post("/billing/webhook", include_in_schema=False)
async def razorpay_webhook(request: Request, background: BackgroundTasks,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    """Razorpay's webhook (`payment.captured`, `order.paid`): confirms a payment whose page closed before the
    checkout could. Signed with the webhook secret; anything else is refused."""
    raw = await request.body()
    if not razorpay.webhook_signature_ok(raw, request.headers.get("X-Razorpay-Signature")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad signature.")
    try:
        event = json.loads(raw)
    except ValueError:
        return {"ok": True}
    if event.get("event") == "refund.processed":
        await _refund_noted(db, event)
        return {"ok": True}
    try:
        entity = event["payload"]["payment"]["entity"]
        order_id, payment_id, amount = str(entity["order_id"]), str(entity["id"]), int(entity["amount"])
        currency, pay_status = str(entity.get("currency") or ""), str(entity.get("status") or "")
    except (ValueError, KeyError, TypeError):
        return {"ok": True}  # an event without a payment in it: nothing to do
    if event.get("event") not in ("payment.captured", "order.paid"):
        return {"ok": True}
    if pay_status != "captured" or currency != "INR":
        return {"ok": True}
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == order_id))
    if p is None or p.status != "awaiting_payment":
        return {"ok": True}
    if amount != p.amount_inr * 100:
        log.warning("razorpay webhook: %s paid %s paise, expected %s", order_id, amount, p.amount_inr * 100)
        return {"ok": True}
    await _paid(db, p, payment_id, background)
    return {"ok": True}


# ---- admin: check and approve payments --------------------------------------------------------------------------


class AdminPayment(UpiOrderOut):
    user_id: str | None  # None: the account was deleted (the payment is kept, so its UTR can't be reused)
    email: str
    name: str | None
    # What the account has right now: a plan granted for a while, if any.
    current_plan: str | None
    current_until: datetime | None


class AdminPaymentsOut(BaseModel):
    upi_configured: bool
    waiting: int
    payments: list[AdminPayment]


async def _admin_payment(db: AsyncSession, p: Payment) -> AdminPayment:
    u = await db.get(User, p.user_id) if p.user_id else None
    out = _order_out(p)
    if u is None:
        return AdminPayment(**out.model_dump(exclude={"upi_id", "payee_name", "upi_uri"}), user_id=None,
                            email="(deleted account)", name=None, current_plan=None, current_until=None)
    granted = active_grant(u)
    return AdminPayment(**out.model_dump(exclude={"upi_id", "payee_name", "upi_uri"}), user_id=u.id,
                        email=u.email, name=u.name, current_plan=plan_named(granted).label if granted else None,
                        current_until=upi.aware(u.grant_until) if granted and u.grant_until else None)


@router.get("/admin/payments", response_model=AdminPaymentsOut)
async def admin_payments(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                         only: Literal["submitted", "all"] = "submitted",
                         limit: Annotated[int, Query(ge=1, le=500)] = 100) -> AdminPaymentsOut:
    """UPI payments, newest first. "submitted" = waiting for you to check the UTR."""
    q = select(Payment).order_by(Payment.submitted_at.desc().nulls_last(), Payment.created_at.desc()).limit(limit)
    if only == "submitted":
        q = q.where(Payment.status == "submitted")
    else:
        q = q.where(Payment.status != "awaiting_payment")  # orders nobody paid for are just noise
    rows = (await db.scalars(q)).all()
    waiting = len(rows) if only == "submitted" else len([p for p in rows if p.status == "submitted"])
    return AdminPaymentsOut(upi_configured=bool(get_settings().upi_id), waiting=waiting,
                            payments=[await _admin_payment(db, p) for p in rows])


class DecisionIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(None, max_length=300)
    # The UTR the admin checked against the bank statement: if the payer changed it meanwhile, nothing is decided.
    utr: str | None = Field(None, max_length=32)


def _what(p: Payment) -> str:
    parts = [f"{p.resume_credits} resume AI credits" if p.resume_credits else "",
             f"{p.interview_minutes} interview minutes" if p.interview_minutes else ""]
    return " and ".join(x for x in parts if x)


@router.post("/admin/payments/{payment_id}", response_model=AdminPayment)
async def decide_payment(payment_id: str, body: DecisionIn, background: BackgroundTasks,
                         admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> AdminPayment:
    """Approve: the money is in your account, so the pack's credits land (they never expire) and the account no
    longer waits for sign-up approval. Reject: the payer sees your note."""
    p = await db.get(Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a payment with a UTR waiting to be checked can be decided.")
    if body.utr is not None and upi.normalize_utr(body.utr) != p.utr:
        raise HTTPException(status.HTTP_409_CONFLICT, "The UTR changed since you opened this. Check the new one.")
    u = await db.get(User, p.user_id) if p.user_id else None
    if u is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That account was deleted, so there's nothing to credit.")
    now = datetime.now(UTC)
    web = get_settings().web_url.rstrip("/")
    note = (body.note or "").strip() or None
    # Decide it once: two approvals at the same moment (a double-click, two tabs) must not both add the credits.
    decided = await db.execute(
        update(Payment).where(Payment.id == p.id, Payment.status == "submitted", Payment.utr == p.utr)
        .values(status="approved" if body.action == "approve" else "rejected", decided_at=now, note=note))
    if decided.rowcount != 1:  # type: ignore[attr-defined]
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment was just decided. Reload the list.")
    if body.action == "approve":
        if p.resume_credits:
            credits.add(db, u.id, "resume", p.resume_credits, "purchase", payment_id=p.id)
        if p.interview_minutes:
            credits.add(db, u.id, "interview_seconds", p.interview_minutes * 60, "purchase", payment_id=p.id)
        u.approved = True
        mail = OutgoingEmail(to=u.email, subject=f"Payment received: {_what(p)} added to Orbit",
                             text=(f"Thanks! We received your ₹{p.amount_inr} payment (UTR {p.utr}).\n\n"
                                   f"Your account now has {_what(p)} more. They don't expire. "
                                   f"Sign in to use them: {web}/login"))
    else:
        reason = f"\n\nWhy: {note}" if note else ""
        mail = OutgoingEmail(to=u.email, subject="We couldn't confirm your Orbit payment",
                             text=(f"We couldn't find your ₹{p.amount_inr} payment with UTR {p.utr} in our account."
                                   f"{reason}\n\nIf you did pay, check the UTR in your UPI app and send it again: "
                                   f"{web}/billing"))
    db.add(AuditLog(user_id=admin.id, action=f"admin.payment.{body.action}",
                    target=f"{p.id} {p.plan} ₹{p.amount_inr} {p.utr}"))
    try:
        await db.commit()
    except IntegrityError as e:  # the credits for this payment were already added (uq_credit_entries_payment_kind)
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment was already credited.") from e
    await db.refresh(p)
    await db.refresh(u)
    background.add_task(send_safely, mail)
    return await _admin_payment(db, p)
