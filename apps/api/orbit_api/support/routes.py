"""Support chat.

`POST /v1/support/threads` opens a chat (signed in or out). The browser keeps a token that is the only way back in.
`POST .../messages` adds what the visitor typed, or a topic they tapped. While the thread is `bot`, Orbit answers from
the help notes only. It does not call a model. `POST .../handoff` asks for a person:
the thread waits, and a copy lands in the admin Inbox so the existing unread badge lights up.
A person replies at `POST /v1/admin/support/{id}/reply`. That line shows in the visitor's chat.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from orbit_api import entitlements
from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import optional_user
from orbit_api.billing import pricing
from orbit_api.billing.packs import packs
from orbit_api.config import get_settings
from orbit_api.contact.routes import clean_message, network_hash, one_line
from orbit_api.credits import interview_minutes_left, resume_balance
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import ContactMessage, Payment, SupportMessage, SupportThread, User
from orbit_api.ratelimit import TokenBucket, check, client_ip
from orbit_api.support.knowledge import GREETING, HANDOFF, account_choice, option_label, respond, suggestions_for

log = logging.getLogger(__name__)

router = APIRouter(tags=["support"])
admin_router = APIRouter(prefix="/v1/admin/support", tags=["admin"])

TEXT_MAX = 2000
_per_hour = TokenBucket(rate_per_s=30 / 3600, burst=30)
SLOW = "You've sent a lot of messages in a short time. Please wait a few minutes."
SIGN_IN = "Sign in to see your balance or your last payment. I can only read the account you are signed in as."
OTHER_ACCOUNT = "This chat was opened on a different account. Start a new chat while signed in to see yours."


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "bot", "human"]
    text: str
    created_at: datetime


class SuggestionOut(BaseModel):
    id: str
    label: str


class ThreadOut(BaseModel):
    id: str
    status: Literal["bot", "waiting", "closed"]
    token: str | None = None  # only when the thread is opened
    messages: list[MessageOut]
    suggestions: list[SuggestionOut] = []


class AdminDetail(ThreadOut):
    """The same chat, plus the account behind it. Only the admin route returns this."""

    account: str = ""


class ThreadIn(BaseModel):
    token: str = Field(min_length=20, max_length=80)
    text: str = Field(default="", max_length=TEXT_MAX)
    choice: str = Field(default="", max_length=40)
    page: str = Field(default="", max_length=80)


class HandoffIn(BaseModel):
    token: str = Field(min_length=20, max_length=80)
    name: str = ""
    email: str = ""


class AdminThread(BaseModel):
    id: str
    status: str
    name: str
    email: str
    updated_at: datetime
    preview: str


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=TEXT_MAX)


def _hash(token: str) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"support:{token}".encode(), hashlib.sha256).hexdigest()


def _limit(request: Request) -> None:
    check(_per_hour, f"support:{network_hash(client_ip(request))}", SLOW)


def _owns(thread: SupportThread, user: User | None) -> bool:
    """True when this signed-in person may see the account behind the chat."""
    return user is not None and (thread.user_id is None or thread.user_id == user.id)


def _out(thread: SupportThread, token: str | None = None, user: User | None = None, page: str = "",
         currency: str = pricing.INR) -> ThreadOut:
    return ThreadOut(
        id=thread.id,
        status=thread.status,
        token=token,
        messages=[
            MessageOut(id=m.id, role=m.role, text=m.text, created_at=m.created_at)
            for m in thread.messages
        ],
        suggestions=[
            SuggestionOut(id=i, label=label)
            for i, label in suggestions_for(thread.messages, thread.status, _owns(thread, user), page, currency)
        ],
    )


async def _stamp(db: AsyncSession, thread_id: str) -> datetime:
    """A time after this chat's latest line. The database is the clock, so two processes can't put a later line
    first. The chat's row is locked first, until the line is committed: a no-op update takes the row lock on Postgres
    and the write lock on SQLite, so two requests writing to one chat at once go one after the other (V3-10)."""
    await db.execute(update(SupportThread).where(SupportThread.id == thread_id)
                     .values(updated_at=SupportThread.updated_at).execution_options(synchronize_session=False))
    latest = await db.scalar(select(func.max(SupportMessage.created_at)).where(SupportMessage.thread_id == thread_id))
    now = datetime.now(UTC)
    if isinstance(latest, datetime):
        if latest.tzinfo is None:
            latest = latest.replace(tzinfo=UTC)
        if now <= latest:
            now = latest + timedelta(microseconds=1)
    return now


async def _load(db: AsyncSession, thread_id: str) -> SupportThread | None:
    return (await db.execute(
        select(SupportThread)
        .where(SupportThread.id == thread_id)
        .options(selectinload(SupportThread.messages))
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def _thread(db: AsyncSession, thread_id: str, token: str, user: User | None) -> SupportThread:
    """The chat, for whoever holds its token. A chat linked to an account also needs that account signed in: the
    token alone (a shared computer, a copied URL from an old client) isn't enough to read someone's chat (V3-12)."""
    row = await _load(db, thread_id)
    if row is None or not hmac.compare_digest(row.token_hash, _hash(token)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    if row.user_id is not None and (user is None or user.id != row.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    return row


def _presented(header: str | None, query: str | None) -> str:
    """The chat token. The header is preferred. The query still works for an old client."""
    token = (header or "").strip() or (query or "").strip()
    if not 20 <= len(token) <= 80:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    return token


async def _add(db: AsyncSession, thread: SupportThread, role: str, text: str) -> None:
    # Don't touch thread.messages: reading that list in a request is a lazy load, which async rejects.
    now = await _stamp(db, thread.id)
    db.add(SupportMessage(thread_id=thread.id, role=role, text=text, created_at=now))
    thread.updated_at = now


async def _commit(db: AsyncSession, thread: SupportThread) -> SupportThread:
    thread_id = thread.id
    await db.commit()
    loaded = await _load(db, thread_id)
    if loaded is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    return loaded


def _claim(thread: SupportThread, user: User | None) -> None:
    """A signed-in person sending into a chat that has no account yet: it becomes theirs."""
    if user is None or thread.user_id not in (None, user.id):
        return
    thread.user_id = user.id
    thread.email = thread.email or user.email
    thread.name = thread.name or (user.name or "")


_GATEWAY = {"razorpay": "Razorpay", "paypal": "PayPal"}  # anything else was a UPI transfer


def _minutes(value: float) -> str:
    """Whole minutes, as a person says them: "317 interview minutes" (not 317.3), "1,250", "less than a minute"."""
    if 0 < value < 1:
        return "less than an interview minute"
    n = int(value + 0.05)  # 59.97 is 60; 317.3 is 317
    return "1 interview minute" if n == 1 else f"{n:,} interview minutes"


def _day(value: datetime) -> str:
    return value.strftime("%d %b %Y").lstrip("0")


async def _balance_answer(db: AsyncSession, user: User) -> str:
    """What's left: the credit balance, or, on a plan, the plan, until when, and its interview time this month."""
    resume = await resume_balance(db, user.id)
    minutes = await interview_minutes_left(db, user.id)
    plan = await entitlements.plan_for(db, user.id)
    if plan.credits:
        return f"You have {_minutes(minutes)} and {_credit_word(resume)} left. They don't expire."
    until = entitlements.running_until(user)
    on = f"You're on {plan.label}" + (f" until {_day(until)}" if until else "")
    left = await entitlements.minutes_remaining(db, user.id, "interview", plan)
    allowance = ("with no limit on interview minutes" if left is None
                 else f"with {_minutes(left)} left in this month's allowance")
    kept = (f" Your credits are kept for after it: {_minutes(minutes)} and {_credit_word(resume)}."
            if until and (minutes >= 1 or resume) else "")
    return f"{on}, {allowance}.{kept}"


def _credit_word(n: int) -> str:
    return f"{n} Resume AI credit" if n == 1 else f"{n} Resume AI credits"


async def _account_answer(db: AsyncSession, user: User, kind: str, currency: str = pricing.INR) -> str:
    if kind == "balance":
        return await _balance_answer(db, user)
    payment = (await db.execute(
        select(Payment).where(Payment.user_id == user.id).order_by(Payment.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if payment is None:
        cheapest = min(packs().values(), key=lambda p: p.price_inr)
        return ("This account has no payment yet. Buy a pack on Plan & billing. Packs start at Mini "
                f"{pricing.price_of(cheapest, currency).text()}.")
    pack = packs().get(payment.plan)
    name = pack.label if pack else payment.plan
    money = pricing.payment_text(payment)  # in what was charged: "₹5,199", or "$106.99" through PayPal
    got = f"{payment.interview_minutes} interview minutes and {payment.resume_credits} Resume AI credits"
    if payment.status == "approved":
        how = _GATEWAY.get(payment.method or "", "UPI")
        return f"Your last payment landed. {name} for {money} via {how} added {got}."
    if payment.status == "submitted":
        utr = f" UTR {payment.utr}." if payment.utr else ""
        return (
            f"Your last payment is waiting to be checked. {name} for {money}.{utr} "
            "A person matches it, then the credits land."
        )
    if payment.status == "rejected":
        why = f" Reason: {payment.note}." if payment.note else ""
        return (
            f"Your last payment was not approved. {name} for {money}.{why} "
            "You can send the right UTR from Plan & billing, or tap Talk to a person."
        )
    if payment.status == "awaiting_payment":
        return (
            f"Your last order has not been paid yet. {name} for {money}, reference {payment.reference}. "
            "Finish it on Plan & billing."
        )
    return f"Your last payment is {name} for {money}. Status: {payment.status}."


async def _account_blurb(db: AsyncSession, thread: SupportThread) -> str:
    """One line for the admin: who this is, what they have left, and the last payment."""
    if thread.user_id is None:
        who = thread.email or "no email given"
        return f"Not signed in ({who}). No balance is linked to this chat."
    user = await db.get(User, thread.user_id)
    if user is None:
        return f"The account on this chat is gone. Email they typed: {thread.email or 'none'}."
    balance = await _account_answer(db, user, "balance")
    payment = await _account_answer(db, user, "payment")
    return f"{user.email}. {balance} {payment}"


async def _admin_out(db: AsyncSession, thread: SupportThread) -> AdminDetail:
    return AdminDetail(**_out(thread).model_dump(), account=await _account_blurb(db, thread))


async def _bot_answer(db: AsyncSession, thread: SupportThread, user: User | None, text: str,
                      choice: str, currency: str = pricing.INR) -> tuple[str, str]:
    """The line saved for the visitor, and the bot's exact reply, with prices in their currency. No model."""
    account = account_choice(text, choice)
    if account:
        shown = option_label(account) if choice else text[:TEXT_MAX]
        if user is None:
            return shown or "My balance", SIGN_IN
        if thread.user_id not in (None, user.id):
            return shown or "My balance", OTHER_ACCOUNT
        return shown or option_label(account) or account, await _account_answer(db, user, account, currency)
    if choice:
        label = option_label(choice, currency)
        if label is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That option isn't available.")
        answer, _options = respond("", choice, currency)
        return label, answer
    answer, _options = respond(text, currency=currency)
    return text[:TEXT_MAX], answer


@router.post("/v1/support/threads", response_model=ThreadOut, status_code=201)
async def open_thread(
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: Annotated[str, Query(max_length=80)] = "",
) -> ThreadOut:
    _limit(request)
    token = secrets.token_urlsafe(32)
    thread = SupportThread(
        token_hash=_hash(token),
        user_id=user.id if user else None,
        name=(user.name if user else "") or "",
        email=(user.email if user else "") or "",
        status="bot",
    )
    db.add(thread)
    await db.flush()
    await _add(db, thread, "bot", GREETING)
    return _out(await _commit(db, thread), token, user, page, pricing.currency_for(request, user))


@router.get("/v1/support/threads/{thread_id}", response_model=ThreadOut)
async def read_thread(
    thread_id: str,
    request: Request,
    response: Response,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str | None, Query()] = None,
    page: Annotated[str, Query(max_length=80)] = "",
    x_orbit_support_token: Annotated[str | None, Header()] = None,
) -> ThreadOut:
    # no-store: a token in an old query string must not be cached by a proxy.
    response.headers["Cache-Control"] = "no-store"
    if token and not x_orbit_support_token:
        # The token in the address is the old clients' way (before 14 Oct 2026); it's still accepted while they
        # update, and counted here (the token itself is redacted from every log). Removal: docs/SECURITY.md.
        log.info("support chat read with a token in the query string (legacy client)")
        response.headers["Deprecation"] = "true"
    return _out(await _thread(db, thread_id, _presented(x_orbit_support_token, token), user), user=user, page=page,
                currency=pricing.currency_for(request, user))


@router.post("/v1/support/threads/{thread_id}/messages", response_model=ThreadOut)
async def post_message(
    thread_id: str,
    body: ThreadIn,
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    _limit(request)
    thread = await _thread(db, thread_id, body.token, user)
    if thread.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This chat is closed. Start a new one.")
    text = clean_message(body.text)
    choice = body.choice.strip()
    if not text and not choice:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a message.")
    _claim(thread, user)
    currency = pricing.currency_for(request, user)
    if thread.status == "bot":
        shown, reply = await _bot_answer(db, thread, user, text, choice, currency)
        await _add(db, thread, "user", shown)
        await _add(db, thread, "bot", reply)
    else:
        if not text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a message.")
        await _add(db, thread, "user", text[:TEXT_MAX])
    return _out(await _commit(db, thread), user=user, page=body.page, currency=currency)


@router.post("/v1/support/threads/{thread_id}/handoff", response_model=ThreadOut)
async def handoff(
    thread_id: str,
    body: HandoffIn,
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    _limit(request)
    thread = await _thread(db, thread_id, body.token, user)
    if thread.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This chat is closed. Start a new one.")
    if thread.status == "waiting":
        return _out(thread)  # already with a person: a retry or a second tap gets the same ticket, not another
    name = one_line(body.name)[:120] or thread.name or (user.name if user else "") or "Someone"
    email = (body.email or thread.email or (user.email if user else "") or "").strip()[:320]
    if "@" not in email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add an email so the team knows who to reply to.")
    # One request moves the chat from the bot to a person. The conditional update is the lock: a request that loses
    # the race (a double tap, a retry, another worker) changes nothing and returns the chat as the winner left it.
    thread_id = thread.id
    moved = await db.execute(
        update(SupportThread).where(SupportThread.id == thread_id, SupportThread.status == "bot")
        .values(status="waiting", name=name, email=email))
    if moved.rowcount != 1:  # type: ignore[attr-defined]
        await db.rollback()
        return await _settled(db, thread_id)
    transcript = "\n".join(f"{m.role}: {m.text}" for m in thread.messages)[-2800:]
    await _add(db, thread, "bot", HANDOFF)
    db.add(ContactMessage(
        user_id=thread.user_id,
        name=name,
        email=email,
        topic="technical",
        message=f"Support chat {thread.id[:8]} is waiting for a person.\n\n{transcript}"[:3000],
        context={"support_thread_id": thread.id},
        status="new",
        network_hash=network_hash(client_ip(request)),
        source_support_thread_id=thread.id,
    ))
    try:
        return _out(await _commit(db, thread))
    except IntegrityError:  # the chat's one ticket already exists (unique source_support_thread_id)
        await db.rollback()
        return await _settled(db, thread_id)


async def _settled(db: AsyncSession, thread_id: str) -> ThreadOut:
    """The chat after another request already handed it off (or closed it)."""
    loaded = await _load(db, thread_id)
    if loaded is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    if loaded.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This chat is closed. Start a new one.")
    return _out(loaded)


@admin_router.get("", response_model=list[AdminThread])
async def list_threads(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    only: Literal["waiting", "all"] = "waiting",
) -> list[AdminThread]:
    q = (select(SupportThread).options(selectinload(SupportThread.messages))
         .order_by(SupportThread.updated_at.desc()).limit(50))
    if only == "waiting":
        q = q.where(SupportThread.status == "waiting")
    rows = (await db.execute(q)).scalars().unique().all()
    out: list[AdminThread] = []
    for thread in rows:
        last = thread.messages[-1].text if thread.messages else ""
        out.append(AdminThread(
            id=thread.id, status=thread.status, name=thread.name, email=thread.email,
            updated_at=thread.updated_at, preview=last[:160],
        ))
    return out


@admin_router.get("/{thread_id}", response_model=AdminDetail)
async def admin_thread(
    thread_id: str,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminDetail:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    return await _admin_out(db, thread)


@admin_router.post("/{thread_id}/reply", response_model=AdminDetail)
async def admin_reply(
    thread_id: str,
    body: ReplyIn,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminDetail:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    text = clean_message(body.text)
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a reply.")
    thread.status = "waiting"
    await _add(db, thread, "human", text[:TEXT_MAX])
    log.info("support reply by %s on %s", admin.email, thread.id)
    return await _admin_out(db, await _commit(db, thread))


@admin_router.post("/{thread_id}/close", response_model=AdminDetail)
async def admin_close(
    thread_id: str,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminDetail:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    thread.status = "closed"
    await _add(db, thread, "bot", "This chat is closed. Start a new one if you need something else.")
    return await _admin_out(db, await _commit(db, thread))


async def _delete_thread(db: AsyncSession, thread_id: str) -> None:
    """The chat, its lines, and its Inbox ticket (the copy made when it asked for a person), in one transaction."""
    await db.execute(delete(ContactMessage).where(ContactMessage.source_support_thread_id == thread_id))
    await db.execute(delete(SupportMessage).where(SupportMessage.thread_id == thread_id))
    await db.execute(delete(SupportThread).where(SupportThread.id == thread_id))
    await db.commit()


@router.delete("/v1/support/threads/{thread_id}", status_code=204)
async def delete_thread(
    thread_id: str,
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    x_orbit_support_token: Annotated[str | None, Header()] = None,
) -> Response:
    """The visitor deletes their own chat, signed in or not: whoever holds its token (and, for a chat linked to an
    account, is signed in as it). Its Inbox ticket goes too."""
    _limit(request)
    thread = await _thread(db, thread_id, _presented(x_orbit_support_token, None), user)
    await _delete_thread(db, thread.id)
    return Response(status_code=204)


@admin_router.delete("/{thread_id}", status_code=204)
async def admin_delete(
    thread_id: str,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Deletes a chat on request (a guest asking by email, say), with its Inbox ticket."""
    if await db.get(SupportThread, thread_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    await _delete_thread(db, thread_id)
    return Response(status_code=204)


async def purge_idle_threads(db: AsyncSession, now: datetime | None = None) -> int:
    """Chats nobody is waiting on (the bot's, or closed) untouched for ORBIT_CONTACT_RETENTION_DAYS go, with their
    lines and Inbox ticket. A chat waiting for a person is never deleted here. Commits; returns how many went."""
    days = get_settings().contact_retention_days
    if not days:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    idle = select(SupportThread.id).where(SupportThread.status.in_(("bot", "closed")),
                                          SupportThread.updated_at < cutoff)
    ids = list((await db.scalars(idle)).all())
    for thread_id in ids:
        await db.execute(delete(ContactMessage).where(ContactMessage.source_support_thread_id == thread_id))
        await db.execute(delete(SupportMessage).where(SupportMessage.thread_id == thread_id))
        await db.execute(delete(SupportThread).where(SupportThread.id == thread_id))
    await db.commit()
    return len(ids)


async def purge_idle_threads_now() -> int:
    """`purge_idle_threads` in its own database session (the session sweeper calls it each pass)."""
    async with sessionmaker()() as db:
        gone = await purge_idle_threads(db)
    if gone:
        log.info("deleted %d idle support chat(s) past retention", gone)
    return gone
