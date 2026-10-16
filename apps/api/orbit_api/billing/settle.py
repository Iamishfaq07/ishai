"""Settling Razorpay payments and refunds (V3-07, V3-08, V3-09), whichever way the news arrives: the checkout's signed
answer, Razorpay's webhook, or the reconciler asking Razorpay about an order still open.

- `credit`: a captured payment for an order of ours adds the pack's credits, exactly once (a conditional update on
  the order, unique payment ids, and the credit ledger's unique payment link).
- `record_refund`: a refund is one `PaymentRefund` row per refund id. A refund for a payment not known here yet is
  kept unlinked and linked when the payment lands. The payment's `refunded_paise` is the sum of its refunds that went
  through. Credits are not taken back (docs/BILLING.md, refund policy): they may already be spent.
- `reconcile`: orders opened in the last RECONCILE_WINDOW that aren't paid yet are checked with Razorpay on a bounded
  backoff (1, 2, 4 … 60 minutes), so a lost webhook or a closed page can't leave a captured payment uncredited.
  Orders nobody paid by the end of the window become `expired`; one with a payment still not captured by then stays
  `processing` and is logged for the admin (it shows in Payments).
- PayPal (billing/paypal.py) settles the same way: `paypal_complete` captures an approved order (or reads a capture
  already taken) and credits a COMPLETED capture of exactly the order's amount; the reconciler asks PayPal about
  open PayPal orders too, and PayPal refunds are recorded like Razorpay's.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.billing import monthly, paypal, pricing, razorpay
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import AuditLog, Payment, PaymentRefund, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.transactions import lock_account

log = logging.getLogger(__name__)

RECONCILE_WINDOW = timedelta(hours=72)
RECONCILE_MIN_AGE = timedelta(minutes=1)  # a checkout still open is the browser's to finish first
MAX_BACKOFF = timedelta(minutes=60)
OPEN = ("awaiting_payment", "processing")
# A capture still counts on an order the reconciler marked expired (a checkout left open for days, then paid).
CREDITABLE = (*OPEN, "expired")


def what(p: Payment) -> str:
    if p.days:  # a monthly plan (billing/monthly.py)
        return monthly.what(p)
    parts = [f"{p.resume_credits} resume AI credits" if p.resume_credits else "",
             f"{p.interview_minutes} interview minutes" if p.interview_minutes else ""]
    return " and ".join(x for x in parts if x)


def captured_for(p: Payment, payment: dict[str, Any]) -> bool:
    """Razorpay's payment is a capture of exactly this order's price, in rupees."""
    return (str(payment.get("status")) == "captured" and str(payment.get("order_id")) == p.gateway_order_id
            and str(payment.get("currency")) == pricing.payment_currency(p)
            and payment.get("amount") == pricing.payment_minor(p))


def paypal_captured_for(p: Payment, capture: dict[str, Any]) -> bool:
    """PayPal's capture took exactly this order's price, in its currency (and names our reference, when it says)."""
    amount = capture.get("amount")
    return (str(capture.get("status")) == "COMPLETED" and isinstance(amount, dict)
            and str(amount.get("currency_code")) == pricing.payment_currency(p)
            and paypal.cents(amount) == pricing.payment_minor(p)
            and capture.get("custom_id") in (None, p.reference))


async def paypal_settle(db: AsyncSession, p: Payment, order: dict[str, Any]) -> OutgoingEmail | None:
    """What a PayPal order (as PayPal sent it back) means for ours: a completed capture of the right amount credits
    it; a pending one marks it processing. Returns the receipt to send, if this credited it."""
    caps = paypal.captures(order)
    done = next((c for c in caps if paypal_captured_for(p, c)), None)
    if done is not None:
        return await credit(db, p, str(done["id"])[:40])
    for c in caps:
        if str(c.get("status")) == "COMPLETED":  # taken, but not what this order costs: never credited
            log.warning("paypal: order %s captured %s, expected %s %s", p.gateway_order_id, c.get("amount"),
                        pricing.payment_currency(p), pricing.payment_minor(p))
    pending = next((c for c in caps if str(c.get("status")) == "PENDING"), None)
    if pending is not None and p.status == "awaiting_payment":
        await hold(db, p, str(pending["id"])[:40])
    return None


async def paypal_complete(db: AsyncSession, p: Payment, *, look_first: bool = False) -> OutgoingEmail | None:
    """Takes the money for an approved PayPal order and credits it, or credits a capture already taken. An order
    the buyer hasn't approved is left as it is. `look_first`: read the order before capturing (the reconciler,
    where most open orders were never approved). Raises PayPalError ("INSTRUMENT_DECLINED": try another way)."""
    order_id = str(p.gateway_order_id)
    if look_first:
        order = await paypal.get_order(order_id)
        if order.get("status") != "APPROVED":
            return await paypal_settle(db, p, order)
    try:
        order = await paypal.capture_order(order_id, request_id=f"capture-{p.id}")
    except paypal.PayPalError as e:
        if e.issue == "ORDER_ALREADY_CAPTURED":
            order = await paypal.get_order(order_id)
        elif e.issue == "ORDER_NOT_APPROVED":
            return None
        else:
            raise
    return await paypal_settle(db, p, order)


def aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=UTC) if d is not None and d.tzinfo is None else d


async def credit(db: AsyncSession, p: Payment, gateway_payment_id: str) -> OutgoingEmail | None:
    """Razorpay says this order is paid: approve it and add the pack's credits, once. Returns the receipt to send, or
    None if it was already credited (or the account is gone). Commits."""
    now = datetime.now(UTC)
    done = await db.execute(
        update(Payment).where(Payment.id == p.id, Payment.status.in_(CREDITABLE))
        .values(status="approved", submitted_at=now, decided_at=now, gateway_payment_id=gateway_payment_id))
    if done.rowcount != 1:  # type: ignore[attr-defined]
        await db.rollback()
        return None
    u = await db.get(User, p.user_id) if p.user_id else None
    if u is None:
        await db.commit()  # paid, but the account was deleted: kept for the records
        return None
    await grant(db, u, p)
    db.add(AuditLog(user_id=u.id, action=f"payment.{p.method}",
                    target=f"{p.id} {p.plan} {pricing.payment_text(p)} {gateway_payment_id}"))
    try:
        await db.commit()
    except IntegrityError:  # credited a moment ago by another confirmation (checkout, webhook or reconciler)
        await db.rollback()
        return None
    await db.refresh(p)
    await link_refunds(db, p)
    via = "PayPal" if p.method == "paypal" else "Razorpay"
    return receipt(u, p, f"{via} {gateway_payment_id}, reference {p.reference}")


async def grant(db: AsyncSession, u: User, p: Payment) -> None:
    """What an approved payment gives: a pack's credits (never expire), or a monthly plan's 30 days. Staged; the
    caller commits."""
    if p.days:
        # Two months paid at the same moment must both add their days: read the plan's end under the account lock.
        await lock_account(db, u.id)
        await db.refresh(u, ["grant_plan", "grant_until"])
        monthly.apply(u, p)
        return
    if p.resume_credits:
        credits.add(db, u.id, "resume", p.resume_credits, "purchase", payment_id=p.id)
    if p.interview_minutes:
        credits.add(db, u.id, "interview_seconds", p.interview_minutes * 60, "purchase", payment_id=p.id)
    u.approved = True


def receipt(u: User, p: Payment, paid_by: str) -> OutgoingEmail:
    web = get_settings().web_url.rstrip("/")
    if p.days:
        until = aware(u.grant_until)
        ends = f" It runs until {until:%d %b %Y}." if until else ""
        return OutgoingEmail(
            to=u.email, subject=f"Payment received: {what(p)} on Orbit",
            text=(f"Thanks! We received your {pricing.payment_text(p)} payment ({paid_by}).\n\nYour account now has "
                  f"{what(p)}.{ends} Nothing renews or is charged automatically: buy another month from Plan & "
                  f"billing whenever you want more. Sign in to use it: {web}/login"))
    return OutgoingEmail(
        to=u.email, subject=f"Payment received: {what(p)} added to Orbit",
        text=(f"Thanks! We received your {pricing.payment_text(p)} payment ({paid_by}).\n\n"
              f"Your account now has {what(p)} more. They don't expire. Sign in to use them: {web}/login"))


async def hold(db: AsyncSession, p: Payment, gateway_payment_id: str) -> None:
    """Razorpay has a payment for this order that isn't captured yet: remember it, so the order shows as processing
    and the reconciler asks about that payment. Commits."""
    try:
        await db.execute(
            update(Payment).where(Payment.id == p.id, Payment.status == "awaiting_payment")
            .values(status="processing", gateway_payment_id=gateway_payment_id))
        await db.commit()
    except IntegrityError:  # that payment id is already on another order: nothing to remember here
        await db.rollback()
    await db.refresh(p)


async def _refresh_refunded(db: AsyncSession, p: Payment) -> None:
    done = (await db.scalars(select(PaymentRefund).where(
        PaymentRefund.payment_id == p.id, PaymentRefund.status == "processed")
        .order_by(PaymentRefund.created_at))).all()
    p.refunded_paise = sum(r.amount_paise for r in done)
    if p.refunded_paise:
        whole = p.refunded_paise >= pricing.payment_minor(p)
        ids = ", ".join(r.refund_id for r in done)
        cur = pricing.payment_currency(p)
        refunded = pricing.money(cur, p.refunded_paise)
        via = "PayPal" if p.method == "paypal" else "Razorpay"
        p.note = (f"{via} refunded {refunded}{'' if whole else f' of {pricing.payment_text(p)}'} "
                  f"({ids}). Credits were not removed.")[:300]


async def link_refunds(db: AsyncSession, p: Payment) -> int:
    """Refunds that arrived before this payment was known here, now linked to it. Commits; returns how many."""
    if not p.gateway_payment_id:
        return 0
    rows = (await db.scalars(select(PaymentRefund).where(
        PaymentRefund.gateway_payment_id == p.gateway_payment_id, PaymentRefund.payment_id.is_(None)))).all()
    if not rows:
        return 0
    now = datetime.now(UTC)
    for r in rows:
        r.payment_id, r.linked_at = p.id, now
    await db.flush()
    await _refresh_refunded(db, p)
    db.add(AuditLog(user_id=p.user_id, action="payment.refund_linked",
                    target=f"{p.id} {' '.join(r.refund_id for r in rows)}"))
    await db.commit()
    return len(rows)


async def record_refund(db: AsyncSession, refund: dict[str, Any]) -> str:
    """One refund event: "processed" (recorded, or already recorded), "unmatched" (its payment isn't known here yet;
    kept, and linked when it is) or "ignored" (not a refund). Commits."""
    try:
        refund_id = str(refund["id"])
        gateway_payment_id = str(refund.get("payment_id") or "")
        amount = int(refund.get("amount") or 0)
        state = str(refund.get("status") or "processed")
    except (KeyError, TypeError, ValueError):
        return "ignored"
    if not refund_id.startswith("rfnd_") or not gateway_payment_id.startswith("pay_") or amount <= 0:
        return "ignored"
    return await save_refund(db, refund_id, gateway_payment_id, amount, state)


# PayPal's refund states, in Razorpay's words (which `_refresh_refunded` and the admin page read).
PAYPAL_REFUND_STATE = {"COMPLETED": "processed", "PENDING": "created", "FAILED": "failed", "CANCELLED": "failed"}


async def record_paypal_refund(db: AsyncSession, refund: dict[str, Any]) -> str:
    """A PayPal refund (or a reversal: a chargeback), recorded like a Razorpay one. Commits."""
    capture_id = paypal.refund_capture_id(refund)
    amount = paypal.cents(refund.get("amount"))
    refund_id = str(refund.get("id") or "")[:40]
    if not (refund_id and capture_id and amount):
        return "ignored"
    state = PAYPAL_REFUND_STATE.get(str(refund.get("status") or "COMPLETED"), "created")
    return await save_refund(db, refund_id, capture_id, amount, state)


async def save_refund(db: AsyncSession, refund_id: str, gateway_payment_id: str, amount: int, state: str) -> str:
    """One refund of `amount` minor units against the gateway payment (Razorpay "pay_…", or a PayPal capture)."""
    p = await db.scalar(select(Payment).where(Payment.gateway_payment_id == gateway_payment_id))
    row = await db.scalar(select(PaymentRefund).where(PaymentRefund.refund_id == refund_id))
    first = row is None
    if row is None:
        row = PaymentRefund(refund_id=refund_id, gateway_payment_id=gateway_payment_id, amount_paise=amount,
                            status=state)
        db.add(row)
    else:
        row.amount_paise, row.status = amount, state
    if p is not None and row.payment_id is None:
        row.payment_id, row.linked_at = p.id, datetime.now(UTC)
    try:
        await db.flush()
    except IntegrityError:  # the same refund recorded a moment ago by a concurrent delivery
        await db.rollback()
        return await save_refund(db, refund_id, gateway_payment_id, amount, state)
    if p is None:
        await db.commit()
        log.warning("refund %s for payment %s not known here yet: kept to link later", refund_id,
                    gateway_payment_id)
        return "unmatched"
    await _refresh_refunded(db, p)
    if first:
        refunded = pricing.money(pricing.payment_currency(p), amount)
        db.add(AuditLog(user_id=p.user_id, action="payment.refunded",
                        target=f"{p.id} {refund_id} {refunded} {state} credits kept"))
    await db.commit()
    return "processed"


def _due(p: Payment, now: datetime) -> bool:
    checked = aware(p.checked_at)
    if checked is None:
        return True
    wait = min(MAX_BACKOFF, timedelta(minutes=2 ** min(p.reconcile_attempts, 6)))
    return now - checked >= wait


async def _reconcile_razorpay(db: AsyncSession, p: Payment) -> OutgoingEmail | None:
    """One open Razorpay order: credits a capture of it, or holds an authorized payment. Raises RazorpayError."""
    if p.gateway_payment_id:
        payments = [await razorpay.fetch_payment(p.gateway_payment_id)]
    else:
        payments = await razorpay.order_payments(str(p.gateway_order_id))
    paid = next((x for x in payments if captured_for(p, x)), None)
    if paid is not None:
        return await credit(db, p, str(paid["id"]))
    pending = next((x for x in payments if str(x.get("status")) == "authorized"), None)
    if pending is not None and p.status == "awaiting_payment":
        await hold(db, p, str(pending["id"]))
    return None


async def reconcile(db: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """Asks Razorpay and PayPal about orders still open (see the module docstring). Returns counts; sends the
    receipts of any it credits. Commits per order, so one failure doesn't undo the others."""
    counts = {"checked": 0, "credited": 0, "expired": 0, "errors": 0, "refunds_linked": 0}
    gateways = [name for name, on in (("razorpay", razorpay.configured()), ("paypal", paypal.configured())) if on]
    if not gateways:
        return counts
    now = now or datetime.now(UTC)
    cutoff = now - RECONCILE_WINDOW
    # Orders nobody paid within the window: no payment exists for them at the gateway (or we'd have found it).
    gone = await db.execute(update(Payment).where(
        Payment.method.in_(gateways), Payment.status == "awaiting_payment", Payment.created_at < cutoff)
        .values(status="expired", decided_at=now))
    counts["expired"] = int(getattr(gone, "rowcount", 0) or 0)
    await db.commit()
    stuck = (await db.scalars(select(Payment.gateway_payment_id).where(
        Payment.method.in_(gateways), Payment.status == "processing", Payment.created_at < cutoff))).all()
    if stuck:
        log.warning("payments still not captured after %s, need review: %s", RECONCILE_WINDOW,
                    ", ".join(str(x) for x in stuck[:20]))
    rows = (await db.scalars(select(Payment).where(
        Payment.method.in_(gateways), Payment.status.in_(OPEN), Payment.gateway_order_id.is_not(None),
        Payment.created_at >= cutoff, Payment.created_at <= now - RECONCILE_MIN_AGE)
        .order_by(Payment.created_at).limit(50))).all()
    for p in rows:
        if not _due(p, now):
            continue
        counts["checked"] += 1
        p.reconcile_attempts, p.checked_at = p.reconcile_attempts + 1, now
        await db.commit()
        try:
            if p.method == "paypal":
                mail = await paypal_complete(db, p, look_first=True)
            else:
                mail = await _reconcile_razorpay(db, p)
        except (razorpay.RazorpayError, paypal.PayPalError) as e:
            counts["errors"] += 1
            log.warning("reconcile: couldn't ask %s about order %s (%s)", p.method, p.gateway_order_id, e)
            continue
        if mail is not None:
            counts["credited"] += 1
            log.info("reconcile: credited %s order %s (%s)", p.method, p.gateway_order_id, p.gateway_payment_id)
            await send_safely(mail)
    unlinked = (await db.scalars(select(PaymentRefund.gateway_payment_id).where(
        PaymentRefund.payment_id.is_(None)).distinct())).all()
    for gateway_payment_id in unlinked:
        known = await db.scalar(select(Payment).where(Payment.gateway_payment_id == gateway_payment_id))
        if known is not None:
            counts["refunds_linked"] += await link_refunds(db, known)
    return counts


async def reconcile_now() -> dict[str, int]:
    """`reconcile` in its own database session (the session sweeper calls it each pass)."""
    async with sessionmaker()() as db:
        counts = await reconcile(db)
    if counts["credited"] or counts["expired"] or counts["refunds_linked"]:
        log.info("payment reconcile: %s", counts)
    return counts
