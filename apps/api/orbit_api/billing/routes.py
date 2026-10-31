"""Plans and entitlements over HTTP, and buying credit packs (billing/packs.py): through Razorpay's checkout when it's
set up (billing/razorpay.py, confirmed by Razorpay's signature), else over UPI (billing/upi.py, approved by the
admin). Outside India, dollar prices are paid through PayPal when it's set up (billing/paypal.py, confirmed by
PayPal's capture). Limits and features never come from clients; a payment changes nothing until it's confirmed.
A referred account's first-purchase discount (billing/referrals.py) comes off the order's amount here, never in the
browser."""

import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import entitlements
from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user, optional_user
from orbit_api.billing import paypal, pricing, razorpay, referrals, settle, upi
from orbit_api.billing.monthly import monthly_plans, public_monthly
from orbit_api.billing.packs import pack_label as packs_label
from orbit_api.billing.packs import packs, public_packs
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import current_grant, plan_named, running_until
from orbit_api.models import AuditLog, ContactMessage, LaunchAccessClaim, Payment, PaymentEvent, PaymentRefund, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit, limit_user, proxy_signed

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


def _priced(items: list[dict[str, Any]], currency: str,
            offer: referrals.Offer | None = None) -> list[dict[str, Any]]:
    """Each item's price in the buyer's currency: `price` (major units), `price_text` and, for a long plan, the
    monthly equivalent. `price_inr` stays (the configured rupee price). With a first-purchase discount (`offer`,
    billing/referrals.py) also `offer_price`, `offer_price_text` and `offer_percent`: what an order costs now (and the
    monthly equivalent is of that)."""
    out = []
    for given in items:
        item = {k: v for k, v in given.items() if k != "price_usd_cents"}  # said as `price` in dollars instead
        cost = pricing.price(item["price_inr"], currency, given.get("price_usd_cents"))
        extra: dict[str, Any] = {"currency": cost.currency, "price": cost.major, "price_text": cost.text()}
        paid = cost
        if offer is not None and offer.percent > 0:
            paid, _ = referrals.discounted(cost, offer.percent)
            extra |= {"offer_price": paid.major, "offer_price_text": paid.text(), "offer_percent": offer.percent}
        if cost.currency != pricing.INR:
            # Dollars: PayPal (an account, or a card on PayPal's page) and, once Razorpay takes cards from abroad,
            # a card through Razorpay too. Both on: the buyer picks in the cart; PayPal stays the default.
            card = bool(item.get("buyable") and item.get("checkout") == "razorpay"
                        and get_settings().razorpay_international)
            methods = (["paypal"] if paypal.configured() else []) + (["razorpay"] if card else [])
            extra |= {"methods": methods, "buyable": bool(methods)}
            if methods:
                extra |= {"checkout": methods[0], "international": True}
        else:
            extra["methods"] = [item["checkout"]] if item.get("buyable") and item.get("checkout") else []
        if "days" in item:
            per = round(paid.minor * 30 / item["days"])
            extra |= {"per_month": per / 100, "per_month_text": pricing.money(cost.currency, per)}
        out.append({**item, **extra})
    return out


# A price list asked for in a currency (the public /pricing page shows both): for reading only.
ShownCurrency = Annotated[Literal["INR", "USD"] | None, Query()]


def _shown_in(items: list[dict[str, Any]], currency: str) -> list[dict[str, Any]]:
    """The price list in `currency`, as the pricing page shows it to anyone, anywhere: list prices (no first-purchase
    discount) and nothing buyable from it. What an order charges still follows the country the website's edge saw
    (the order endpoints and `priced_by_the_edge`), never this."""
    return [{**item, "buyable": False, "methods": []} for item in _priced(items, currency)]


@router.get("/billing/monthly")
async def list_monthly(request: Request, user: Annotated[User | None, Depends(optional_user)],
                       db: Annotated[AsyncSession, Depends(get_db)],
                       currency: ShownCurrency = None) -> list[dict[str, Any]]:
    """The monthly plans for sale (public): a plan for 30 days, paid once; nothing renews. Priced in rupees in
    India and US dollars elsewhere (billing/pricing.py); `?currency=` lists them in that one, to read only."""
    if currency is not None:
        return _shown_in(public_monthly(), currency)
    return _priced(public_monthly(), pricing.currency_for(request, user), await referrals.offer_for(db, user))


@router.get("/billing/packs")
async def list_packs(request: Request, user: Annotated[User | None, Depends(optional_user)],
                     db: Annotated[AsyncSession, Depends(get_db)],
                     currency: ShownCurrency = None) -> list[dict[str, Any]]:
    """Public: the credit packs for sale, and whether they can be bought right now (a UPI ID is set).
    `?currency=` lists them in that currency, to read only (the public pricing page)."""
    if currency is not None:
        return _shown_in(public_packs(), currency)
    return _priced(public_packs(), pricing.currency_for(request, user), await referrals.offer_for(db, user))


class QuoteOut(BaseModel):
    """The cart: one pack or plan, what it costs this account now, and how it's paid."""

    id: str
    label: str
    kind: Literal["pack", "plan"]
    includes: list[str]  # "10 AI credits", "30 interview minutes", "30 days of Pro"
    currency: str
    price_text: str  # the list price
    discount_percent: int  # 0: none
    discount_text: str  # "-₹260"
    discount_reason: str  # "First purchase offer", "Code PRIYA10", "A friend's invite"
    total: float
    total_text: str
    checkout: Literal["razorpay", "upi", "paypal"] | None  # none: can't be bought from here right now
    # Every way this buyer can pay, `checkout` first (outside India: PayPal, and a Razorpay card when both are on)
    methods: list[Literal["razorpay", "upi", "paypal"]] = []
    coupons: bool  # a code can still be entered (codes are on and nothing's been paid yet)


def _reason(offer: referrals.Offer) -> str:
    if offer.kind == referrals.FIRST:
        return "Code FIRST10 · first purchase"
    if offer.kind == referrals.INVITE:
        return "A friend's invite"
    return f"Code {offer.code}" + (f" ({offer.label})" if offer.label else "")


@router.get("/billing/promotion")
async def promotion() -> dict[str, Any]:
    return {"enabled": get_settings().first_purchase_percent > 0, "code": "FIRST10", "percent": 10}


@router.get("/billing/quote", response_model=QuoteOut)
async def quote(pack: Annotated[str, Query(min_length=1, max_length=32)], request: Request,
                user: Annotated[User, Depends(current_user)],
                db: Annotated[AsyncSession, Depends(get_db)],
                code: Annotated[str | None, Query(max_length=32)] = None) -> QuoteOut:
    """Server-priced cart totals, explicit promotion validation and available payment method.

    Order creation revalidates eligibility and price under the account lock.
    """
    pid, label, item, days, resume_credits, minutes = _product(pack)
    listed = [x for x in (public_packs() if not days else public_monthly()) if x["id"] == pid]
    if not listed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That pack can't be bought.")
    offer = await _cart_offer(db, user, code, keep=(pid, "quote"))
    shown = _priced(listed, pricing.currency_for(request, user), offer)[0]
    cost = pricing.price_of(item, shown["currency"])
    percent = offer.percent if offer is not None else 0
    total, off = referrals.discounted(cost, percent)
    if days:
        includes = [f"{days} days of {plan_named(monthly_plans()[pid].plan).label}", "Nothing renews by itself"]
    else:
        includes = [x for x in (f"{resume_credits} AI credits" if resume_credits else "",
                                f"{minutes} interview minutes" if minutes else "") if x] + ["Never expire"]
    uid = user.id
    paid = await referrals.has_paid(db, uid)
    return QuoteOut(id=pid, label=label, kind="plan" if days else "pack", includes=includes,
                    currency=cost.currency, price_text=cost.text(), discount_percent=percent if off else 0,
                    discount_text=f"-{pricing.money(cost.currency, off)}" if off else "",
                    discount_reason=_reason(offer) if offer is not None and off else "",
                    total=total.major, total_text=total.text(),
                    checkout=shown.get("checkout") if shown.get("buyable") else None,
                    methods=shown.get("methods", []) if shown.get("buyable") else [],
                    coupons=(get_settings().first_purchase_percent > 0 or referrals.enabled()) and not paid)


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
    refunded_text: str = ""  # the same, in the payment's currency: "₹500", "$10.00"
    # What was charged, in its own currency: "₹2,599" or "$53.99" (amount_inr is the rupee equivalent abroad).
    currency: str = "INR"
    amount_text: str = ""
    # How to pay; only while there's still something to pay (not once it's submitted or approved). The app shows
    # `upi_uri` as a QR, and as a tap-through link on phones.
    upi_id: str | None = None
    payee_name: str | None = None
    upi_uri: str | None = None


def _label(p: Payment) -> str:
    pack = packs().get(p.plan)
    if pack is not None:
        return packs_label(pack)
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
                      refunded_inr=(p.refunded_paise or 0) // 100, currency=pricing.payment_currency(p),
                      amount_text=pricing.payment_text(p),
                      refunded_text=pricing.money(pricing.payment_currency(p), p.refunded_paise)
                      if p.refunded_paise else "")
    s = get_settings()
    if p.status in ("awaiting_payment", "rejected") and s.upi_id and out.method == "upi":
        out.upi_id, out.payee_name, out.upi_uri = s.upi_id, s.upi_name, upi.upi_uri(p, label)
    return out


class OrderIn(BaseModel):
    pack: str = Field(min_length=1, max_length=32)  # a credit pack's id, or a monthly plan's
    code: str | None = Field(None, min_length=1, max_length=32)


def _product(product_id: str) -> tuple[str, str, pricing.Priced, int, int, int]:
    """What an order is for: (id, label, the pack or plan (its prices), days, resume credits, interview minutes). A
    credit pack has no days; a monthly plan has its days and no credits."""
    pack = packs().get(product_id)
    if pack is not None:
        return pack.id, packs_label(pack), pack, 0, pack.resume_credits, pack.total_minutes
    month = monthly_plans().get(product_id)
    if month is not None:
        return month.id, f"{month.label} plan · {month.days} days", month, month.days, 0, 0
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That pack can't be bought.")


def priced_by_the_edge(request: Request) -> None:
    """In production, orders are made only through the website, whose Worker signs its requests (ORBIT_PROXY_SECRET):
    the price's currency follows the country the edge saw, and a direct caller (the API's own address) could otherwise
    name any account country and buy in rupees from anywhere (red team). The desktop app buys on the website already
    (desktop/src/credits.ts opens /billing in the browser), and a branch preview has no secret. Checked on production
    on 18 October 2026: the site's /api/v1/region answers the visitor's country (signed), a direct call null."""
    s = get_settings()
    if s.env == "production" and s.proxy_secret is not None and not proxy_signed(request):
        web = s.web_url.rstrip("/")
        raise HTTPException(status.HTTP_409_CONFLICT, f"Buy on the website: {web}/billing. Prices there follow "
                                                      "the country you're in.")


# Why an order lost its first-purchase discount to a newer one (shown on the old order, if anyone looks).
SUPERSEDED_NOTE = "Replaced by a newer order: the first-purchase discount moved to that one."


async def _resume_offer(db: AsyncSession, user: User, code: str | None,
                        product: str, method: str, currency: str) -> Payment | None:
    from orbit_api.transactions import lock_account

    await lock_account(db, user.id)
    if code is None:
        return None
    offer = await _cart_offer(db, user, code, keep=(product, method))
    if offer is None or offer.kind != referrals.FIRST:
        return None
    existing: Payment | None = await db.scalar(select(Payment).where(
        Payment.user_id == user.id, Payment.plan == product,
        Payment.method == method, Payment.currency == currency,
        Payment.status.in_(("awaiting_payment", "rejected") if method == "upi" else ("awaiting_payment",)),
        Payment.referral_code_id == "FIRST10").limit(1))
    return existing


async def _cart_offer(db: AsyncSession, user: User, code: str | None,
                      keep: tuple[str, str] | None = None) -> referrals.Offer | None:
    try:
        offer = await referrals.offer_for(db, user, code)
    except referrals.CodeRefused as exc:
        raise HTTPException(422, str(exc)) from exc
    if offer is not None and offer.kind == referrals.FIRST:
        # Only an order still on its way holds the offer: one expired (a checkout closed unpaid) or rejected by a
        # gateway gives it back, or FIRST10 would be lost for good to an abandoned checkout.
        reserved = await db.scalar(select(Payment).where(
            Payment.user_id == user.id, Payment.discount_minor > 0,
            Payment.status.in_(("awaiting_payment", "submitted", "processing"))
            | ((Payment.status == "rejected") & (func.coalesce(Payment.method, "upi") == "upi")))
            .order_by(Payment.created_at).limit(1))
        if reserved is not None and not (keep is not None and keep[0] == reserved.plan
                                        and keep[1] in {reserved.method or "upi", "quote"}
                                        and (reserved.status == "awaiting_payment"
                                             or (reserved.status == "rejected" and reserved.method == "upi"))):
            raise HTTPException(409, "Your first-purchase offer is already reserved on an order. "
                                "Finish that payment; a second discounted order cannot be created.")
    return offer


async def _offered(db: AsyncSession, user: User, cost: pricing.Price,
                   keep: tuple[str, str] | None = None,
                   code: str | None = None) -> tuple[pricing.Price, dict[str, Any]]:
    """`cost` less the account's first-purchase discount, if it has one (billing/referrals.py), and what the order
    keeps of it: the code and how much came off.

    FIRST10 reservations are checked by _cart_offer and never move between payable orders.
    The following replacement behavior applies only to legacy referral discounts with the campaign off.
    One open order carries the discount at a time (red team): opening several discounted orders and paying them all
    would make a first-purchase discount a discount on everything. A payment already on its way (a UTR waiting for
    the admin, a gateway capture pending) keeps it, so a new order meanwhile is full price. Unpaid orders that still
    have it lose it to the new one (they're marked expired, the way the reconciler retires an abandoned checkout;
    one paid after all is still credited, never lost). `keep`: (plan, method) of an open order this one may be handed
    back as (UPI reuses a day-old order for the same pack), which is left alone."""
    from orbit_api.transactions import lock_account

    await lock_account(db, user.id)
    offer = await _cart_offer(db, user, code, keep=keep)
    if offer is None or offer.percent <= 0:
        return cost, {}
    discounted = (Payment.user_id == user.id, Payment.discount_minor > 0)
    if await db.scalar(select(func.count()).select_from(Payment)
                       .where(*discounted, Payment.status.in_(("submitted", "processing")))):
        return cost, {}
    stale = update(Payment).where(*discounted, Payment.status == "awaiting_payment")
    if keep is not None:
        stale = stale.where(~((Payment.plan == keep[0]) & (func.coalesce(Payment.method, "upi") == keep[1])))
    await db.execute(stale.values(status="expired", decided_at=datetime.now(UTC), note=SUPERSEDED_NOTE)
                     .execution_options(synchronize_session=False))
    less, off = referrals.discounted(cost, offer.percent)
    return less, {"referral_code_id": offer.code_id, "discount_minor": off}


@router.post("/billing/upi/orders", response_model=UpiOrderOut, status_code=201,
             dependencies=[Depends(order_limit), Depends(priced_by_the_edge)])
async def create_order(body: OrderIn, request: Request, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """Start paying for a credit pack: the amount, reference and UPI link. An open order for the same pack from the
    last day is handed back instead of making another."""
    pid, _, item, days, resume_credits, minutes = _product(body.pack)
    price = item.price_inr
    if pricing.currency_for(request, user) != pricing.INR:
        raise HTTPException(status.HTTP_409_CONFLICT, "UPI is for payments from India. Pay by card instead.")
    if not get_settings().manual_upi:
        raise HTTPException(status.HTTP_410_GONE, "Paying a UPI ID by hand has ended. Buy on Plan & billing: "
                                                  "Razorpay takes UPI apps, cards and netbanking.")
    if not get_settings().upi_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "UPI payments aren't set up yet.")
    existing = await _resume_offer(db, user, body.code, pid, "upi", pricing.INR)
    if existing is not None:
        return _order_out(existing)
    cost, discount = await _offered(db, user, pricing.price(price, pricing.INR), keep=(pid, "upi"), code=body.code)
    price = cost.inr
    since = datetime.now(UTC) - upi.OPEN_ORDER_REUSE
    open_order = await db.scalar(
        select(Payment).where(Payment.user_id == user.id, Payment.plan == pid,
                              Payment.status == "awaiting_payment", Payment.amount_inr == price,
                              func.coalesce(Payment.method, "upi") == "upi",
                              func.coalesce(Payment.currency, "INR") == "INR",
                              Payment.created_at >= since)
        .order_by(Payment.created_at.desc()).limit(1))
    if open_order is not None:
        return _order_out(open_order)
    p = Payment(user_id=user.id, plan=pid, amount_inr=price, days=days, resume_credits=resume_credits,
                interview_minutes=minutes, reference=upi.new_reference(), status="awaiting_payment", **discount)
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
    if (p.method or "upi") != "upi":
        # Razorpay and PayPal confirm their own payments: a UTR would make the order "submitted", and the gateway's
        # capture is then ignored (only open orders are credited) while the admin looks for a transfer that isn't there.
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This order isn't a UPI transfer, so there's no UTR to send: it's confirmed by "
                            f"{'PayPal' if p.method == 'paypal' else 'Razorpay'} on its own.")
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
            to=s.admin_email, subject=f"UPI payment to check: ₹{p.amount_inr:,} from {user.email}",
            text=(f"{user.email} says they paid ₹{p.amount_inr:,} for the {_label(p)}.\n\n"
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
             dependencies=[Depends(order_limit), Depends(priced_by_the_edge)])
async def razorpay_order(body: OrderIn, request: Request, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> CheckoutOut:
    """Start buying a pack through Razorpay: an order there for the pack's price (rupees in India, US dollars
    elsewhere: billing/pricing.py), kept here until it's paid."""
    pid, label, item, days, resume_credits, minutes = _product(body.pack)
    cost = pricing.price_of(item, pricing.currency_for(request, user))
    key_id = get_settings().razorpay_key_id
    if not razorpay.configured() or not key_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Card payments aren't set up yet.")
    if cost.currency != pricing.INR and not get_settings().razorpay_international:
        # The pages show dollar prices with Buy off until then (_priced); a direct call mustn't open a checkout
        # Razorpay would refuse.
        raise HTTPException(status.HTTP_409_CONFLICT, "Card payments from outside India aren't switched on yet.")
    existing = await _resume_offer(db, user, body.code, pid, "razorpay", cost.currency)
    if existing is not None:
        return CheckoutOut(payment_id=existing.id, order_id=str(existing.gateway_order_id), key_id=key_id,
            amount_paise=pricing.payment_minor(existing), currency=pricing.payment_currency(existing),
            label=label, email=user.email, name=user.name)
    cost, discount = await _offered(db, user, cost, code=body.code)
    reference = upi.new_reference()
    try:
        order_id = await razorpay.create_order(cost.minor, reference, {"pack": pid, "orbit_ref": reference},
                                               currency=cost.currency)
    except razorpay.RazorpayRefused as e:
        if cost.currency == pricing.INR:
            log.warning("razorpay order failed: %s", e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "Payments aren't reachable right now. Try again in a minute.") from e
        # Reached Razorpay, which won't take this currency: international payments (or USD) aren't on for the
        # account even though ORBIT_RAZORPAY_INTERNATIONAL says they are. Say so, not "try again in a minute".
        log.warning("razorpay refused a %s order: %s (are international payments and %s enabled on the Razorpay "
                    "account, in the same Test/Live mode as the keys?)", cost.currency, e, cost.currency)
        instead = ("Pay with PayPal instead (a card works there too), or write to us from Contact."
                   if paypal.configured() else "Write to us from Contact and we'll help you buy.")
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Card payments in US dollars aren't available right now. {instead}") from e
    except razorpay.RazorpayError as e:
        log.warning("razorpay order failed: %s", e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Payments aren't reachable right now. Try again in a minute.") from e
    p = Payment(user_id=user.id, plan=pid, amount_inr=cost.inr, days=days, resume_credits=resume_credits,
                interview_minutes=minutes, reference=reference, status="awaiting_payment",
                method="razorpay", gateway_order_id=order_id, currency=cost.currency,
                amount_minor=cost.minor if cost.currency != pricing.INR else None, **discount)
    db.add(p)
    await db.commit()
    return CheckoutOut(payment_id=p.id, order_id=order_id, key_id=key_id, amount_paise=cost.minor,
                       currency=cost.currency, label=label, email=user.email, name=user.name)


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
        if entity.get("amount") != pricing.payment_minor(p) or str(entity.get("currency")) != p.currency:
            log.warning("razorpay webhook: %s paid %s %s, expected %s %s", order_id, entity.get("amount"),
                        entity.get("currency"), pricing.payment_minor(p), p.currency)
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
    kind, entity_id, kept = _event_data(event)
    return await _run_event(db, "razorpay", _event_id(request, raw), kind, entity_id, kept,
                            lambda: _apply(db, event, background))


async def _run_event(db: AsyncSession, provider: str, event_id: str, kind: str, entity_id: str | None,
                     kept: dict[str, Any], apply: Callable[[], Awaitable[str]]) -> dict[str, bool]:
    """A verified webhook event, applied once: recorded by its id (PaymentEvent), so a redelivery of one already
    applied changes nothing, and one that couldn't be applied (its payment unknown, or an error) is tried again. An
    error answers 500 so the gateway redelivers it."""
    row = await db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == event_id))
    if row is not None and row.status in ("processed", "ignored"):
        return {"ok": True}  # a redelivery of an event already applied
    if row is None:
        row = PaymentEvent(provider=provider, event_id=event_id, event=kind, entity_id=entity_id, data=kept,
                           status="received")
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:  # the same event arriving twice at once: the other delivery applies it
            await db.rollback()
            return {"ok": True}
    row_id = row.id
    try:
        outcome = await apply()
    except Exception as e:
        await db.rollback()
        await db.execute(update(PaymentEvent).where(PaymentEvent.id == row_id).values(
            status="error", attempts=PaymentEvent.attempts + 1, error=f"{type(e).__name__}: {e}"[:300]))
        await db.commit()
        log.exception("%s webhook %s (%s) failed", provider, event_id, kind)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Couldn't apply the event; send it again.") from e
    await db.execute(update(PaymentEvent).where(PaymentEvent.id == row_id).values(
        status=outcome, attempts=PaymentEvent.attempts + 1, error=None, processed_at=datetime.now(UTC)))
    await db.commit()
    return {"ok": True}


# ---- PayPal (outside India) ------------------------------------------------------------------------------------------


class PaypalCheckoutOut(BaseModel):
    """Where the page sends the buyer to approve the payment at PayPal."""

    payment_id: str  # Orbit's
    order_id: str  # PayPal's
    approve_url: str


class PaypalCaptureIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9]+$")  # the return URL's `token`


@router.post("/billing/paypal/orders", response_model=PaypalCheckoutOut, status_code=201,
             dependencies=[Depends(order_limit), Depends(priced_by_the_edge)])
async def paypal_order(body: OrderIn, request: Request, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> PaypalCheckoutOut:
    """Start paying a dollar price through PayPal: an order there for it, kept here until it's captured. Buyers in
    India pay rupees through Razorpay (a PayPal India account can't take payments from India)."""
    pid, label, item, days, resume_credits, minutes = _product(body.pack)
    if not paypal.configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "PayPal payments aren't set up yet.")
    cost = pricing.price_of(item, pricing.currency_for(request, user))
    if cost.currency == pricing.INR:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "PayPal is for payments from outside India. Pay by UPI or card instead.")
    existing = await _resume_offer(db, user, body.code, pid, "paypal", cost.currency)
    if existing is not None:
        try:
            previous = await paypal.get_order(str(existing.gateway_order_id))
            approve = paypal.approval_url(previous)
        except paypal.PayPalError as exc:
            raise HTTPException(503, "PayPal could not reopen the existing order. Try again shortly.") from exc
        if approve is None:
            raise HTTPException(409, "The existing PayPal order cannot be reopened. Check its payment status.")
        return PaypalCheckoutOut(payment_id=existing.id, order_id=str(existing.gateway_order_id), approve_url=approve)
    cost, discount = await _offered(db, user, cost, code=body.code)
    reference = upi.new_reference()
    try:
        order_id, approve = await paypal.create_order(cost.minor, cost.currency, reference, label,
                                                      request_id=f"order-{reference}")
    except paypal.PayPalError as e:
        log.warning("paypal order failed: %s", e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "PayPal isn't reachable right now. Try again in a minute.") from e
    p = Payment(user_id=user.id, plan=pid, amount_inr=cost.inr, days=days, resume_credits=resume_credits,
                interview_minutes=minutes, reference=reference, status="awaiting_payment", method="paypal",
                gateway_order_id=order_id, currency=cost.currency, amount_minor=cost.minor, **discount)
    db.add(p)
    await db.commit()
    return PaypalCheckoutOut(payment_id=p.id, order_id=order_id, approve_url=approve)


@router.post("/billing/paypal/capture", response_model=UpiOrderOut, dependencies=[Depends(utr_limit)])
async def paypal_capture(body: PaypalCaptureIn, background: BackgroundTasks,
                         user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """The buyer is back from PayPal: take the money and add what they bought, only on PayPal's COMPLETED capture of
    exactly the order's amount. A capture PayPal still holds as pending leaves the order `processing` (the webhook or
    the reconciler finish it); an order not approved stays `awaiting_payment`, nothing charged."""
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == body.order_id, Payment.method == "paypal"))
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status in settle.CREDITABLE:
        try:
            mail = await settle.paypal_complete(db, p)
        except paypal.PayPalError as e:
            if e.issue == "INSTRUMENT_DECLINED":
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    "PayPal couldn't take that way of paying, so nothing was charged. Try again and "
                                    "choose another card or your PayPal balance.") from e
            log.warning("paypal capture %s failed (%s); left for the reconciler", body.order_id, e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "PayPal didn't answer. If you approved the payment it's added within minutes, and "
                                "it's never charged twice.") from e
        if mail is not None:
            background.add_task(send_safely, mail)
    await db.refresh(p)
    return _order_out(p)


async def _apply_paypal(db: AsyncSession, kind: str, resource: dict[str, Any], background: BackgroundTasks) -> str:
    """What one PayPal webhook event does: "processed", "ignored" or "unmatched"."""
    if kind in ("PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"):  # a refund, or a chargeback
        return await settle.record_paypal_refund(db, resource)
    if kind == "CHECKOUT.ORDER.APPROVED":  # approved, and maybe never brought back: capture it here
        order_id = str(resource.get("id") or "")
    elif kind in ("PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING"):
        order_id = paypal.capture_order_id(resource) or ""
    else:
        return "ignored"
    p = await db.scalar(select(Payment).where(Payment.gateway_order_id == order_id, Payment.method == "paypal")) \
        if order_id else None
    if p is None:
        return "unmatched"
    if p.status not in settle.CREDITABLE:
        return "processed"  # credited already (or by the buyer's return a moment ago)
    if kind == "CHECKOUT.ORDER.APPROVED":
        try:
            mail = await settle.paypal_complete(db, p)
        except paypal.PayPalError as e:
            if e.issue != "INSTRUMENT_DECLINED":
                raise
            return "ignored"  # the buyer is asked to pay another way on their return
    else:
        mail = await settle.paypal_settle(db, p, {"purchase_units": [{"payments": {"captures": [resource]}}]})
    if mail is not None:
        background.add_task(send_safely, mail)
    await db.refresh(p)
    return "processed" if p.status in ("approved", "processing") else "ignored"


@router.post("/billing/paypal/webhook", include_in_schema=False)
async def paypal_webhook(request: Request, background: BackgroundTasks,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    """PayPal's webhook (CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.*), believed only when PayPal's own
    verify-webhook-signature says so; applied once per event id, like Razorpay's."""
    raw = await request.body()
    if not await paypal.webhook_ok(request.headers, raw):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad signature.")
    event = json.loads(raw)
    if not isinstance(event, dict):
        return {"ok": True}
    kind = str(event.get("event_type") or "")[:40]
    given = event.get("resource")
    resource: dict[str, Any] = given if isinstance(given, dict) else {}
    event_id = str(event.get("id") or "")[:80] or "sha256:" + hashlib.sha256(raw).hexdigest()
    kept = {k: resource.get(k) for k in ("id", "status", "amount", "custom_id") if resource.get(k) is not None}
    if paypal.capture_order_id(resource):
        kept["order_id"] = paypal.capture_order_id(resource)
    entity_id = str(resource.get("id"))[:40] if resource.get("id") else None
    return await _run_event(db, "paypal", event_id, kind, entity_id, kept,
                            lambda: _apply_paypal(db, kind, resource, background))


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
    # Older payments past this page (?offset= for the next one).
    has_more: bool = False


async def _admin_payment(db: AsyncSession, p: Payment) -> AdminPayment:
    u = await db.get(User, p.user_id) if p.user_id else None
    out = _order_out(p)
    if u is None:
        return AdminPayment(**out.model_dump(exclude={"upi_id", "payee_name", "upi_uri"}), user_id=None,
                            email="(deleted account)", name=None, current_plan=None, current_until=None)
    running = current_grant(u)
    return AdminPayment(**out.model_dump(exclude={"upi_id", "payee_name", "upi_uri"}), user_id=u.id,
                        email=u.email, name=u.name, current_plan=plan_named(running.plan).label if running else None,
                        current_until=running_until(u))


@router.get("/admin/payments", response_model=AdminPaymentsOut)
async def admin_payments(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                         only: Literal["submitted", "all"] = "submitted",
                         limit: Annotated[int, Query(ge=1, le=500)] = 100,
                         offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0) -> AdminPaymentsOut:
    """Payments, newest first, a page at a time. "submitted" = waiting for you to check the UTR."""
    q = (select(Payment).order_by(Payment.submitted_at.desc().nulls_last(), Payment.created_at.desc(), Payment.id)
         .offset(offset).limit(limit + 1))
    if only == "submitted":
        q = q.where(Payment.status == "submitted")
    else:
        q = q.where(Payment.status.not_in(("awaiting_payment", "expired")))  # orders nobody paid for are noise
    page = (await db.scalars(q)).all()
    rows, has_more = page[:limit], len(page) > limit
    # Counted, not taken from the page: past the first hundred the tab's number was the page's.
    waiting = int(await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "submitted")) or 0)
    processing = await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "processing"))
    events = await db.scalar(select(func.count()).select_from(PaymentEvent).where(
        PaymentEvent.status.in_(("unmatched", "error"))))
    unlinked = await db.scalar(select(func.count()).select_from(PaymentRefund).where(
        PaymentRefund.payment_id.is_(None)))
    return AdminPaymentsOut(upi_configured=bool(get_settings().upi_id), waiting=waiting,
                            payments=[await _admin_payment(db, p) for p in rows], processing=int(processing or 0),
                            events_to_review=int(events or 0), unlinked_refunds=int(unlinked or 0),
                            has_more=has_more)


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
                             text=(f"We couldn't find your ₹{p.amount_inr:,} payment with UTR {p.utr} in our account."
                                   f"{reason}\n\nIf you did pay, check the UTR in your UPI app and send it again: "
                                   f"{web}/billing"))
    db.add(AuditLog(user_id=admin.id, action=f"admin.payment.{body.action}",
                    target=f"{p.id} {_label(p)} {pricing.payment_text(p)} UTR {p.utr}"))
    try:
        await db.commit()
    except IntegrityError as e:  # the credits for this payment were already added (uq_credit_entries_payment_kind)
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This payment was already credited.") from e
    await db.refresh(p)
    await db.refresh(u)
    background.add_task(send_safely, mail)
    return await _admin_payment(db, p)
