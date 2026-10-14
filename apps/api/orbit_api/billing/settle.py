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
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.billing import razorpay
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import AuditLog, Payment, PaymentRefund, User
from orbit_api.providers.email import OutgoingEmail, send_safely

log = logging.getLogger(__name__)

RECONCILE_WINDOW = timedelta(hours=72)
RECONCILE_MIN_AGE = timedelta(minutes=1)  # a checkout still open is the browser's to finish first
MAX_BACKOFF = timedelta(minutes=60)
OPEN = ("awaiting_payment", "processing")
# A capture still counts on an order the reconciler marked expired (a checkout left open for days, then paid).
CREDITABLE = (*OPEN, "expired")


def what(p: Payment) -> str:
    parts = [f"{p.resume_credits} resume AI credits" if p.resume_credits else "",
             f"{p.interview_minutes} interview minutes" if p.interview_minutes else ""]
    return " and ".join(x for x in parts if x)


def captured_for(p: Payment, payment: dict[str, Any]) -> bool:
    """Razorpay's payment is a capture of exactly this order's price, in rupees."""
    return (str(payment.get("status")) == "captured" and str(payment.get("order_id")) == p.gateway_order_id
            and str(payment.get("currency")) == "INR" and payment.get("amount") == p.amount_inr * 100)


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
    if p.resume_credits:
        credits.add(db, u.id, "resume", p.resume_credits, "purchase", payment_id=p.id)
    if p.interview_minutes:
        credits.add(db, u.id, "interview_seconds", p.interview_minutes * 60, "purchase", payment_id=p.id)
    u.approved = True
    db.add(AuditLog(user_id=u.id, action="payment.razorpay",
                    target=f"{p.id} {p.plan} ₹{p.amount_inr} {gateway_payment_id}"))
    try:
        await db.commit()
    except IntegrityError:  # credited a moment ago by another confirmation (checkout, webhook or reconciler)
        await db.rollback()
        return None
    await db.refresh(p)
    await link_refunds(db, p)
    web = get_settings().web_url.rstrip("/")
    return OutgoingEmail(
        to=u.email, subject=f"Payment received: {what(p)} added to Orbit",
        text=(f"Thanks! We received your ₹{p.amount_inr} payment (Razorpay {gateway_payment_id}, reference "
              f"{p.reference}).\n\nYour account now has {what(p)} more. They don't expire. Sign in to use them: "
              f"{web}/login"))


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
        whole = p.refunded_paise >= p.amount_inr * 100
        ids = ", ".join(r.refund_id for r in done)
        p.note = (f"Razorpay refunded ₹{p.refunded_paise // 100}{'' if whole else f' of ₹{p.amount_inr}'} "
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
        return await record_refund(db, refund)
    if p is None:
        await db.commit()
        log.warning("razorpay refund %s for payment %s not known here yet: kept to link later", refund_id,
                    gateway_payment_id)
        return "unmatched"
    await _refresh_refunded(db, p)
    if first:
        db.add(AuditLog(user_id=p.user_id, action="payment.refunded",
                        target=f"{p.id} {refund_id} ₹{amount // 100} {state} credits kept"))
    await db.commit()
    return "processed"


def _due(p: Payment, now: datetime) -> bool:
    checked = aware(p.checked_at)
    if checked is None:
        return True
    wait = min(MAX_BACKOFF, timedelta(minutes=2 ** min(p.reconcile_attempts, 6)))
    return now - checked >= wait


async def reconcile(db: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """Asks Razorpay about orders still open (see the module docstring). Returns counts; sends the receipts of any
    it credits. Commits per order, so one failure doesn't undo the others."""
    counts = {"checked": 0, "credited": 0, "expired": 0, "errors": 0, "refunds_linked": 0}
    if not razorpay.configured():
        return counts
    now = now or datetime.now(UTC)
    cutoff = now - RECONCILE_WINDOW
    # Orders nobody paid within the window: no payment exists for them at Razorpay (or we'd have found it).
    gone = await db.execute(update(Payment).where(
        Payment.method == "razorpay", Payment.status == "awaiting_payment", Payment.created_at < cutoff)
        .values(status="expired", decided_at=now))
    counts["expired"] = int(getattr(gone, "rowcount", 0) or 0)
    await db.commit()
    stuck = (await db.scalars(select(Payment.gateway_payment_id).where(
        Payment.method == "razorpay", Payment.status == "processing", Payment.created_at < cutoff))).all()
    if stuck:
        log.warning("razorpay payments still not captured after %s, need review: %s", RECONCILE_WINDOW,
                    ", ".join(str(x) for x in stuck[:20]))
    rows = (await db.scalars(select(Payment).where(
        Payment.method == "razorpay", Payment.status.in_(OPEN), Payment.gateway_order_id.is_not(None),
        Payment.created_at >= cutoff, Payment.created_at <= now - RECONCILE_MIN_AGE)
        .order_by(Payment.created_at).limit(50))).all()
    for p in rows:
        if not _due(p, now):
            continue
        counts["checked"] += 1
        p.reconcile_attempts, p.checked_at = p.reconcile_attempts + 1, now
        await db.commit()
        try:
            if p.gateway_payment_id:
                payments = [await razorpay.fetch_payment(p.gateway_payment_id)]
            else:
                payments = await razorpay.order_payments(str(p.gateway_order_id))
        except razorpay.RazorpayError as e:
            counts["errors"] += 1
            log.warning("reconcile: couldn't ask Razorpay about order %s (%s)", p.gateway_order_id, e)
            continue
        paid = next((x for x in payments if captured_for(p, x)), None)
        if paid is not None:
            mail = await credit(db, p, str(paid["id"]))
            if mail is not None:
                counts["credited"] += 1
                log.info("reconcile: credited order %s from Razorpay's capture %s", p.gateway_order_id, paid["id"])
                await send_safely(mail)
            continue
        pending = next((x for x in payments if str(x.get("status")) == "authorized"), None)
        if pending is not None and p.status == "awaiting_payment":
            await hold(db, p, str(pending["id"]))
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
        log.info("razorpay reconcile: %s", counts)
    return counts
