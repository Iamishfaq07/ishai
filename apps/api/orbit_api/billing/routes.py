"""Plans and entitlements over HTTP, and buying credit packs (billing/packs.py): through Razorpay's checkout when it's
set up (billing/razorpay.py, confirmed by Razorpay's signature), else over UPI (billing/upi.py, approved by the
admin). Limits and features never come from clients; a payment changes nothing until it's confirmed."""

import hashlib
import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import entitlements
from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.billing import razorpay, settle, upi
from orbit_api.billing.monthly import monthly_plans, public_monthly
from orbit_api.billing.packs import packs, public_packs
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import active_grant, plan_named
from orbit_api.models import AuditLog, ContactMessage, LaunchAccessClaim, Payment, PaymentEvent, PaymentRefund, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit, limit_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["billing"])

order_limit = limit_user("upi-order", rate_per_s=1 / 60, burst=10)
utr_limit = limit_user("upi-utr", rate_per_s=1 / 60, burst=8)
claim_ip_limit = limit("launch-access", rate_per_s=3 / 3600, burst=3)


class LaunchAccessIn(BaseModel):
    pack: str = Field(min_length=1, max_length=32)
    country: str = Field(min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")


class LaunchAccessOut(BaseModel):
    reference: str
    status: Literal["requested"] = "requested"
    message: str = ("Your launch access request is in Orbit's Inbox. "
                    "No payment was taken; credits are added after approval.")


@router.post("/billing/launch-access", response_model=LaunchAccessOut,
             dependencies=[Depends(order_limit), Depends(claim_ip_limit)])
async def request_launch_access(body: LaunchAccessIn, user: Annotated[User, Depends(current_user)],
                                db: Annotated[AsyncSession, Depends(get_db)]) -> LaunchAccessOut:
    from orbit_api.contact.routes import reference

    if body.pack not in packs():
        raise HTTPException(422, "Unknown credit pack")
    if body.country == "IN":
        raise HTTPException(422, "Use the INR checkout for India")
    uid = user.id  # rollback expires ORM objects; never read `user.id` synchronously after a race.
    claim = await db.scalar(select(LaunchAccessClaim).where(LaunchAccessClaim.user_id == uid))
    if claim is None:
        message = ContactMessage(user_id=user.id, name=(user.name or "")[:120], email=user.email,
                                 topic="payment",
                                 message=f"International launch access request: {body.pack}, {body.country}. "
                                 "Please review and grant launch credits if eligible.", context={"page": "/billing"})
        db.add(message)
        await db.flush()
        claim = LaunchAccessClaim(user_id=user.id, contact_id=message.id, country=body.country, pack=body.pack)
        db.add(claim)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()  # Also rolls back the duplicate Inbox row from a concurrent request.
            claim = await db.scalar(select(LaunchAccessClaim).where(LaunchAccessClaim.user_id == uid))
            if claim is None:
                raise
    return LaunchAccessOut(reference=reference(claim.contact_id))


@router.get("/plans")
async def list_plans() -> list[dict[str, Any]]:
    """Public: what each plan includes (the pricing page renders this, not a hard-coded copy)."""
    return entitlements.public_plans()


@router.get("/billing/monthly")
async def list_monthly() -> list[dict[str, Any]]:
    """The monthly plans for sale (public): a plan for 30 days, paid once; nothing renews."""
    return public_monthly()


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

PaymentStatus = Literal["awaiting_payment", "submitted", "approved", "rejected", "processing", "expired"]


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
    refunded_inr: int = 0  # refunds that went through (credits are kept: docs/BILLING.md, refund policy)
    # How to pay; only while there's still something to pay (not once it's submitted or approved). The app shows
    # `upi_uri` as a QR, and as a tap-through link on phones.
    upi_id: str | None = None
    payee_name: str | None = None
    upi_uri: str | None = None


def _label(p: Payment) -> str:
    pack = packs().get(p.plan)
    if pack is not None:
        return f"{pack.label} pack"
    month = monthly_plans().get(p.plan)
    if month is not None:
        return f"{month.label} plan · {p.days} days"
    return plan_named(p.plan).label if p.days else p.plan  # an order from before credit packs


def _order_out(p: Payment) -> UpiOrderOut:
    label = _label(p)
    out = UpiOrderOut(id=p.id, pack=p.plan, label=label, amount_inr=p.amount_inr, resume_credits=p.resume_credits,
                      interview_minutes=p.interview_minutes, reference=p.reference, status=p.status, utr=p.utr,
                      note=p.note, created_at=upi.aware(p.created_at),
                      submitted_at=upi.aware(p.submitted_at) if p.submitted_at else None,
                      decided_at=upi.aware(p.decided_at) if p.decided_at else None, method=p.method or "upi",
                      refunded_inr=(p.refunded_paise or 0) // 100)
    s = get_settings()
    if p.status in ("awaiting_payment", "rejected") and s.upi_id and out.method == "upi":
        out.upi_id, out.payee_name, out.upi_uri = s.upi_id, s.upi_name, upi.upi_uri(p, label)
    return out


class OrderIn(BaseModel):
    pack: str = Field(min_length=1, max_length=32)  # a credit pack's id, or a monthly plan's


def _product(product_id: str) -> tuple[str, str, int, int, int, int]:
    """What an order is for: (id, label, price, days, resume credits, interview minutes). A credit pack has no
    days; a monthly plan has its days and no credits."""
    pack = packs().get(product_id)
    if pack is not None:
        return pack.id, f"{pack.label} pack", pack.price_inr, 0, pack.resume_credits, pack.interview_minutes
    month = monthly_plans().get(product_id)
    if month is not None:
        return month.id, f"{month.label} plan · {month.days} days", month.price_inr, month.days, 0, 0
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That pack can't be bought.")


@router.post("/billing/upi/orders", response_model=UpiOrderOut, status_code=201, dependencies=[Depends(order_limit)])
async def create_order(body: OrderIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """Start paying for a credit pack: the amount, reference and UPI link. An open order for the same pack from the
    last day is handed back instead of making another."""
    pid, _, price, days, resume_credits, minutes = _product(body.pack)
    if not get_settings().upi_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "UPI payments aren't set up yet.")
    since = datetime.now(UTC) - upi.OPEN_ORDER_REUSE
    open_order = await db.scalar(
        select(Payment).where(Payment.user_id == user.id, Payment.plan == pid,
                              Payment.status == "awaiting_payment", Payment.amount_inr == price,
                              Payment.created_at >= since)
        .order_by(Payment.created_at.desc()).limit(1))
    if open_order is not None:
        return _order_out(open_order)
    p = Payment(user_id=user.id, plan=pid, amount_inr=price, days=days, resume_credits=resume_credits,
                interview_minutes=minutes, reference=upi.new_reference(), status="awaiting_payment")
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
    # A Razorpay checkout that was opened and closed unpaid is nothing to show; one being confirmed is.
    return [_order_out(p) for p in rows
            if not (p.method == "razorpay" and p.status in ("awaiting_payment", "expired"))]


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
    pid, label, price, days, resume_credits, minutes = _product(body.pack)
    key_id = get_settings().razorpay_key_id
    if not razorpay.configured() or not key_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Card payments aren't set up yet.")
    reference = upi.new_reference()
    try:
        order_id = await razorpay.create_order(price, reference, {"pack": pid, "orbit_ref": reference})
    except razorpay.RazorpayError as e:
        log.warning("razorpay order failed: %s", e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Payments aren't reachable right now. Try again in a minute.") from e
    p = Payment(user_id=user.id, plan=pid, amount_inr=price, days=days, resume_credits=resume_credits,
                interview_minutes=minutes, reference=reference, status="awaiting_payment",
                method="razorpay", gateway_order_id=order_id)
    db.add(p)
    await db.commit()
    return CheckoutOut(payment_id=p.id, order_id=order_id, key_id=key_id, amount_paise=price * 100,
                       currency="INR", label=label, email=user.email, name=user.name)


@router.post("/billing/razorpay/verify", response_model=UpiOrderOut, dependencies=[Depends(utr_limit)])
async def razorpay_verify(body: VerifyIn, background: BackgroundTasks, user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """The checkout's "paid": checked against Razorpay's signature, then against the payment as Razorpay has it. A
    capture adds the pack. A payment not captured yet (or Razorpay not answering) leaves the order `processing`:
    the webhook or the reconciler (billing/settle.py) adds the pack once it's captured, never the browser's word."""
    if not razorpay.checkout_signature_ok(body.order_id, body.payment_id, body.signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "We couldn't confirm that payment. If money left your account, contact us with the "
                            "Razorpay payment id.")
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == body.order_id))
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status in settle.CREDITABLE:
        try:
            payment = await razorpay.fetch_payment(body.payment_id)
        except razorpay.RazorpayError as e:
            log.warning("razorpay verify: couldn't read %s (%s); left processing", body.payment_id, e)
            await settle.hold(db, p, body.payment_id)
            return _order_out(p)
        if settle.captured_for(p, payment):
            mail = await settle.credit(db, p, body.payment_id)
            if mail is not None:
                background.add_task(send_safely, mail)
        elif str(payment.get("status")) == "failed":
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "That payment failed at the bank, so nothing was added and nothing was charged.")
        else:
            # "authorized" isn't captured: the bank can still fail it, so credits wait for the capture.
            await settle.hold(db, p, body.payment_id)
    await db.refresh(p)
    return _order_out(p)


def _event_id(request: Request, raw: bytes) -> str:
    """Razorpay's id for the event (the same on every redelivery), or a hash of the signed body without one."""
    given = (request.headers.get("X-Razorpay-Event-Id") or "").strip()
    if given and len(given) <= 80:
        return given
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _event_data(event: dict[str, Any]) -> tuple[str, str | None, dict[str, Any]]:
    """The event's type, its entity id, and the ids, amounts and statuses worth keeping (no payer details)."""
    kind = str(event.get("event") or "")[:40]
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    kept: dict[str, Any] = {}
    entity_id: str | None = None
    for name in ("refund", "payment", "order"):
        part = payload.get(name) if isinstance(payload, dict) else None
        entity = part.get("entity") if isinstance(part, dict) else None
        if isinstance(entity, dict):
            kept[name] = {k: entity.get(k) for k in ("id", "order_id", "payment_id", "amount", "currency", "status")
                          if entity.get(k) is not None}
            entity_id = entity_id or (str(entity.get("id"))[:40] if entity.get("id") else None)
    return kind, entity_id, kept


async def _apply(db: AsyncSession, event: dict[str, Any], background: BackgroundTasks) -> str:
    """What one webhook event does: "processed", "ignored" or "unmatched"."""
    kind = event.get("event")
    payload = event.get("payload") or {}
    if isinstance(kind, str) and kind.startswith("refund."):
        try:
            refund = payload["refund"]["entity"]
        except (KeyError, TypeError):
            return "ignored"
        return await settle.record_refund(db, refund)
    if kind not in ("payment.captured", "order.paid"):
        return "ignored"
    try:
        entity = payload["payment"]["entity"]
        order_id, payment_id = str(entity["order_id"]), str(entity["id"])
    except (KeyError, TypeError):
        return "ignored"  # an event without a payment in it: nothing to do
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == order_id))
    if p is None:
        return "unmatched"
    if p.status not in settle.CREDITABLE:
        return "processed"  # credited already (or by the checkout a moment ago)
    if not settle.captured_for(p, entity):
        if entity.get("amount") != p.amount_inr * 100 or str(entity.get("currency")) != "INR":
            log.warning("razorpay webhook: %s paid %s %s, expected %s paise INR", order_id, entity.get("amount"),
                        entity.get("currency"), p.amount_inr * 100)
        return "ignored"
    mail = await settle.credit(db, p, payment_id)
    if mail is not None:
        background.add_task(send_safely, mail)
    return "processed"


@router.post("/billing/webhook", include_in_schema=False)
async def razorpay_webhook(request: Request, background: BackgroundTasks,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    """Razorpay's webhook (`payment.captured`, `order.paid`, `refund.*`), checked against the signature of the raw
    body. Each event is recorded once by its id (PaymentEvent): a redelivery of one already applied changes nothing;
    one that couldn't be applied (its payment unknown, or an error) is tried again. An error answers 500 so Razorpay
    redelivers it."""
    raw = await request.body()
    if not razorpay.webhook_signature_ok(raw, request.headers.get("X-Razorpay-Signature")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad signature.")
    try:
        event = json.loads(raw)
    except ValueError:
        return {"ok": True}
    if not isinstance(event, dict):
        return {"ok": True}
    event_id = _event_id(request, raw)
    kind, entity_id, kept = _event_data(event)
    row = await db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == event_id))
    if row is not None and row.status in ("processed", "ignored"):
        return {"ok": True}  # a redelivery of an event already applied
    if row is None:
        row = PaymentEvent(event_id=event_id, event=kind, entity_id=entity_id, data=kept, status="received")
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:  # the same event arriving twice at once: the other delivery applies it
            await db.rollback()
            return {"ok": True}
    row_id = row.id
    try:
        outcome = await _apply(db, event, background)
    except Exception as e:
        await db.rollback()
        await db.execute(update(PaymentEvent).where(PaymentEvent.id == row_id).values(
            status="error", attempts=PaymentEvent.attempts + 1, error=f"{type(e).__name__}: {e}"[:300]))
        await db.commit()
        log.exception("razorpay webhook %s (%s) failed", event_id, kind)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Couldn't apply the event; send it again.") from e
    await db.execute(update(PaymentEvent).where(PaymentEvent.id == row_id).values(
        status=outcome, attempts=PaymentEvent.attempts + 1, error=None, processed_at=datetime.now(UTC)))
    await db.commit()
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
    # Razorpay, for the admin to keep an eye on (billing/settle.py): orders whose payment isn't captured yet,
    # webhook events that couldn't be applied, and refunds whose payment isn't known here.
    processing: int = 0
    events_to_review: int = 0
    unlinked_refunds: int = 0


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
        q = q.where(Payment.status.not_in(("awaiting_payment", "expired")))  # orders nobody paid for are noise
    rows = (await db.scalars(q)).all()
    waiting = len(rows) if only == "submitted" else len([p for p in rows if p.status == "submitted"])
    processing = await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "processing"))
    events = await db.scalar(select(func.count()).select_from(PaymentEvent).where(
        PaymentEvent.status.in_(("unmatched", "error"))))
    unlinked = await db.scalar(select(func.count()).select_from(PaymentRefund).where(
        PaymentRefund.payment_id.is_(None)))
    return AdminPaymentsOut(upi_configured=bool(get_settings().upi_id), waiting=waiting,
                            payments=[await _admin_payment(db, p) for p in rows], processing=int(processing or 0),
                            events_to_review=int(events or 0), unlinked_refunds=int(unlinked or 0))


@router.post("/admin/payments/reconcile")
async def admin_reconcile(admin: Annotated[User, Depends(require_admin)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, int]:
    """Asks Razorpay now about every open order that's due a check (the sweeper does this on its own every few
    minutes). Credits only captures, once; safe to press any number of times."""
    counts = await settle.reconcile(db)
    db.add(AuditLog(user_id=admin.id, action="payment.reconcile", target=json.dumps(counts)[:200]))
    await db.commit()
    return counts


class DecisionIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(None, max_length=300)
    # The UTR the admin checked against the bank statement: if the payer changed it meanwhile, nothing is decided.
    utr: str | None = Field(None, max_length=32)


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
        await settle.grant(db, u, p)
        mail = settle.receipt(u, p, f"UTR {p.utr}")
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
