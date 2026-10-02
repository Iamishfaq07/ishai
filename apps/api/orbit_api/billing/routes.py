"""Plans and entitlements over HTTP, and buying a plan over UPI (billing/upi.py). Limits and features never come from
clients; a payment only changes anything once the admin has approved it."""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import entitlements
from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import current_user
from orbit_api.billing import upi
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import active_grant, buyable, plan_named, plans
from orbit_api.models import AuditLog, Payment, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1", tags=["billing"])

order_limit = limit_user("upi-order", rate_per_s=1 / 60, burst=10)
utr_limit = limit_user("upi-utr", rate_per_s=1 / 60, burst=8)


@router.get("/plans")
async def list_plans() -> list[dict[str, Any]]:
    """Public: what each plan includes (the pricing page renders this, not a hard-coded copy)."""
    return entitlements.public_plans()


@router.get("/entitlements")
async def my_entitlements(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """The signed-in user's plan, its limits, this month's usage, and which features are on."""
    return await entitlements.for_user(db, user)


# ---- UPI ---------------------------------------------------------------------------------------------------------

PaymentStatus = Literal["awaiting_payment", "submitted", "approved", "rejected"]


class UpiOrderOut(BaseModel):
    id: str
    plan: str
    plan_label: str
    amount_inr: int
    days: int
    reference: str
    status: PaymentStatus
    utr: str | None
    note: str | None
    created_at: datetime
    submitted_at: datetime | None
    decided_at: datetime | None
    # How to pay; only while there's still something to pay (not once it's submitted or approved). The app shows
    # `upi_uri` as a QR, and as a tap-through link on phones.
    upi_id: str | None = None
    payee_name: str | None = None
    upi_uri: str | None = None


def _order_out(p: Payment) -> UpiOrderOut:
    label = plan_named(p.plan).label
    out = UpiOrderOut(id=p.id, plan=p.plan, plan_label=label, amount_inr=p.amount_inr, days=p.days,
                      reference=p.reference, status=p.status, utr=p.utr, note=p.note,
                      created_at=upi.aware(p.created_at),
                      submitted_at=upi.aware(p.submitted_at) if p.submitted_at else None,
                      decided_at=upi.aware(p.decided_at) if p.decided_at else None)
    s = get_settings()
    if p.status in ("awaiting_payment", "rejected") and s.upi_id:
        out.upi_id, out.payee_name, out.upi_uri = s.upi_id, s.upi_name, upi.upi_uri(p, label)
    return out


class OrderIn(BaseModel):
    plan: str = Field(min_length=1, max_length=32)


@router.post("/billing/upi/orders", response_model=UpiOrderOut, status_code=201, dependencies=[Depends(order_limit)])
async def create_order(body: OrderIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> UpiOrderOut:
    """Start paying for a plan: the amount, reference, QR and UPI link. An open order for the same plan from the last
    day is handed back instead of making another."""
    plan = plans().get(body.plan)
    if plan is None or not plan.price_inr_month:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That plan can't be bought.")
    if not buyable(plan):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "UPI payments aren't set up yet.")
    since = datetime.now(UTC) - upi.OPEN_ORDER_REUSE
    open_order = await db.scalar(
        select(Payment).where(Payment.user_id == user.id, Payment.plan == plan.name,
                              Payment.status == "awaiting_payment", Payment.amount_inr == plan.price_inr_month,
                              Payment.created_at >= since)
        .order_by(Payment.created_at.desc()).limit(1))
    if open_order is not None:
        return _order_out(open_order)
    p = Payment(user_id=user.id, plan=plan.name, amount_inr=plan.price_inr_month, days=upi.PLAN_DAYS,
                reference=upi.new_reference(), status="awaiting_payment")
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
    return [_order_out(p) for p in rows]


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
    p.utr, p.status, p.submitted_at, p.note = utr, "submitted", datetime.now(UTC), None
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "That UTR was already used for a payment. Check the number in your UPI app.") from e
    await db.refresh(p)
    s = get_settings()
    if first_time and s.admin_email and not s.is_admin_email(user.email):
        background.add_task(send_safely, OutgoingEmail(
            to=s.admin_email, subject=f"UPI payment to check: ₹{p.amount_inr} from {user.email}",
            text=(f"{user.email} says they paid ₹{p.amount_inr} for {plan_named(p.plan).label}.\n\n"
                  f"UTR: {utr}\nReference (in the UPI note): {p.reference}\n\n"
                  f"Check your bank statement, then approve or reject it: {s.web_url.rstrip('/')}/admin/payments")))
    return _order_out(p)


# ---- admin: check and approve payments --------------------------------------------------------------------------


class AdminPayment(UpiOrderOut):
    user_id: str
    email: str
    name: str | None
    # What the account has right now, so approving one plan over another is a decision, not an accident.
    current_plan: str | None
    current_until: datetime | None


class AdminPaymentsOut(BaseModel):
    upi_configured: bool
    waiting: int
    payments: list[AdminPayment]


async def _admin_payment(db: AsyncSession, p: Payment) -> AdminPayment:
    u = await db.get(User, p.user_id)
    assert u is not None  # payments go with the account
    out = _order_out(p)
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


@router.post("/admin/payments/{payment_id}", response_model=AdminPayment)
async def decide_payment(payment_id: str, body: DecisionIn, background: BackgroundTasks,
                         admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> AdminPayment:
    """Approve: the money is in your account, so the plan turns on for the order's days (added on to a running grant of
    the same plan) and the account no longer waits for sign-up approval. Reject: the payer sees your note."""
    p = await db.get(Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    if p.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a payment with a UTR waiting to be checked can be decided.")
    u = await db.get(User, p.user_id)
    assert u is not None
    now = datetime.now(UTC)
    label = plan_named(p.plan).label
    web = get_settings().web_url.rstrip("/")
    note = (body.note or "").strip() or None
    if body.action == "approve":
        running = u.grant_until if active_grant(u, now) == p.plan and u.grant_until else None
        u.grant_plan, u.grant_until = p.plan, upi.grant_window(now, upi.aware(running) if running else None, p.days)
        u.approved = True
        p.status, p.decided_at, p.note = "approved", now, note
        until = f"{u.grant_until:%d %b %Y}"
        mail = OutgoingEmail(to=u.email, subject=f"Payment received: Orbit {label} until {until}",
                             text=(f"Thanks! We received your ₹{p.amount_inr} payment (UTR {p.utr}).\n\n"
                                   f"Your account has {label} until {until}. Sign in to use it: {web}/login"))
    else:
        p.status, p.decided_at, p.note = "rejected", now, note
        reason = f"\n\nWhy: {note}" if note else ""
        mail = OutgoingEmail(to=u.email, subject="We couldn't confirm your Orbit payment",
                             text=(f"We couldn't find your ₹{p.amount_inr} payment with UTR {p.utr} in our account."
                                   f"{reason}\n\nIf you did pay, check the UTR in your UPI app and send it again: "
                                   f"{web}/billing"))
    db.add(AuditLog(user_id=admin.id, action=f"admin.payment.{body.action}",
                    target=f"{p.id} {p.plan} ₹{p.amount_inr} {p.utr}"))
    await db.commit()
    await db.refresh(p)
    await db.refresh(u)
    background.add_task(send_safely, mail)
    return await _admin_payment(db, p)
