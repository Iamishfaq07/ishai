"""Support chat.

`POST /v1/support/threads` opens a chat (signed in or out). The browser keeps a token that is the only way back in.
`POST .../messages` adds what the visitor typed. While the thread is `bot`, Orbit answers from the help notes and,
if those don't cover it, from the model, which is not allowed to invent prices. `POST .../handoff` asks for a person:
the thread waits, and a copy lands in the admin Inbox so the existing unread badge lights up.
A person replies at `POST /v1/admin/support/{id}/reply`. That line shows in the visitor's chat.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from orbit_api.admin.routes import require_admin
from orbit_api.auth.security import optional_user
from orbit_api.config import get_settings
from orbit_api.contact.routes import clean_message, network_hash, one_line
from orbit_api.db import get_db
from orbit_api.models import ContactMessage, SupportMessage, SupportThread, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMMessage, LLMRequest
from orbit_api.ratelimit import TokenBucket, check, client_ip
from orbit_api.support.knowledge import GREETING, HANDOFF, UNKNOWN, facts, lookup

log = logging.getLogger(__name__)

router = APIRouter(tags=["support"])
admin_router = APIRouter(prefix="/v1/admin/support", tags=["admin"])

TEXT_MAX = 2000
_per_hour = TokenBucket(rate_per_s=30 / 3600, burst=30)
SLOW = "You've sent a lot of messages in a short time. Please wait a few minutes."

_SYSTEM = (
    "You are Orbit's support bot. Answer in plain sentences, under 120 words. "
    "Use only the notes below. If the notes don't cover the question, say you don't know and tell them to tap "
    "Talk to a person. Never invent a price, a refund, or a feature. Never ask for a password or a UPI PIN.\n\n"
    "Notes:\n" + facts()
)


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "bot", "human"]
    text: str
    created_at: datetime


class ThreadOut(BaseModel):
    id: str
    status: Literal["bot", "waiting", "closed"]
    token: str | None = None  # only when the thread is opened
    messages: list[MessageOut]


class ThreadIn(BaseModel):
    token: str = Field(min_length=20, max_length=80)
    text: str = Field(min_length=1, max_length=TEXT_MAX)


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


def _out(thread: SupportThread, token: str | None = None) -> ThreadOut:
    return ThreadOut(
        id=thread.id,
        status=thread.status,  # type: ignore[arg-type]
        token=token,
        messages=[
            MessageOut(id=m.id, role=m.role, text=m.text, created_at=m.created_at)  # type: ignore[arg-type]
            for m in thread.messages
        ],
    )


_last_stamp = datetime.min.replace(tzinfo=UTC)


def _stamp() -> datetime:
    """A time that moves forward even when two lines are saved in the same instant, so the chat stays in order."""
    global _last_stamp
    now = datetime.now(UTC)
    if now <= _last_stamp:
        now = _last_stamp + timedelta(microseconds=1)
    _last_stamp = now
    return now


async def _load(db: AsyncSession, thread_id: str) -> SupportThread | None:
    return (await db.execute(
        select(SupportThread)
        .where(SupportThread.id == thread_id)
        .options(selectinload(SupportThread.messages))
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def _thread(db: AsyncSession, thread_id: str, token: str) -> SupportThread:
    row = await _load(db, thread_id)
    if row is None or not hmac.compare_digest(row.token_hash, _hash(token)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    return row


def _add(db: AsyncSession, thread: SupportThread, role: str, text: str) -> None:
    # Don't touch thread.messages: reading that list in a request is a lazy load, which async rejects.
    now = _stamp()
    db.add(SupportMessage(thread_id=thread.id, role=role, text=text, created_at=now))
    thread.updated_at = now


async def _commit(db: AsyncSession, thread: SupportThread) -> SupportThread:
    thread_id = thread.id
    await db.commit()
    loaded = await _load(db, thread_id)
    if loaded is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This chat can't be found. Start a new one.")
    return loaded


async def _bot_answer(text: str) -> str:
    known = lookup(text)
    if known:
        return known
    try:
        reply = await get_llm_provider().generate(LLMRequest(
            messages=[LLMMessage("system", _SYSTEM), LLMMessage("user", text)],
            reasoning="light",
            thinking="off",
            max_tokens=220,
            temperature=0.2,
            request_type="chat",
            allow_fallback=True,
        ))
    except (LLMError, TimeoutError, OSError) as exc:
        log.info("support bot fell back: %s", exc)
        return UNKNOWN
    cleaned = clean_message(reply.text)
    return cleaned or UNKNOWN


@router.post("/v1/support/threads", response_model=ThreadOut, status_code=201)
async def open_thread(
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
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
    _add(db, thread, "bot", GREETING)
    return _out(await _commit(db, thread), token)


@router.get("/v1/support/threads/{thread_id}", response_model=ThreadOut)
async def read_thread(
    thread_id: str,
    token: Annotated[str, Query(min_length=20, max_length=80)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    return _out(await _thread(db, thread_id, token))


@router.post("/v1/support/threads/{thread_id}/messages", response_model=ThreadOut)
async def post_message(
    thread_id: str,
    body: ThreadIn,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    _limit(request)
    thread = await _thread(db, thread_id, body.token)
    if thread.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This chat is closed. Start a new one.")
    text = clean_message(body.text)
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a message.")
    _add(db, thread, "user", text[:TEXT_MAX])
    if thread.status == "bot":
        _add(db, thread, "bot", await _bot_answer(text))
    return _out(await _commit(db, thread))


@router.post("/v1/support/threads/{thread_id}/handoff", response_model=ThreadOut)
async def handoff(
    thread_id: str,
    body: HandoffIn,
    request: Request,
    user: Annotated[User | None, Depends(optional_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    _limit(request)
    thread = await _thread(db, thread_id, body.token)
    name = one_line(body.name)[:120] or thread.name or (user.name if user else "") or "Someone"
    email = (body.email or thread.email or (user.email if user else "") or "").strip()[:320]
    if "@" not in email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add an email so the team knows who to reply to.")
    thread.name = name
    thread.email = email
    thread.status = "waiting"
    transcript = "\n".join(f"{m.role}: {m.text}" for m in thread.messages)[-2800:]
    _add(db, thread, "bot", HANDOFF)
    db.add(ContactMessage(
        user_id=thread.user_id,
        name=name,
        email=email,
        topic="technical",
        message=f"Support chat {thread.id[:8]} is waiting for a person.\n\n{transcript}"[:3000],
        context={"support_thread_id": thread.id},
        status="new",
        network_hash=network_hash(client_ip(request)),
    ))
    return _out(await _commit(db, thread))


@admin_router.get("", response_model=list[AdminThread])
async def list_threads(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    only: Literal["waiting", "all"] = "waiting",
) -> list[AdminThread]:
    q = select(SupportThread).options(selectinload(SupportThread.messages)).order_by(SupportThread.updated_at.desc()).limit(50)
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


@admin_router.get("/{thread_id}", response_model=ThreadOut)
async def admin_thread(
    thread_id: str,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    return _out(thread)


@admin_router.post("/{thread_id}/reply", response_model=ThreadOut)
async def admin_reply(
    thread_id: str,
    body: ReplyIn,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    text = clean_message(body.text)
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type a reply.")
    thread.status = "waiting"
    _add(db, thread, "human", text[:TEXT_MAX])
    log.info("support reply by %s on %s", admin.email, thread.id)
    return _out(await _commit(db, thread))


@admin_router.post("/{thread_id}/close", response_model=ThreadOut)
async def admin_close(
    thread_id: str,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreadOut:
    thread = (await db.execute(
        select(SupportThread).where(SupportThread.id == thread_id).options(selectinload(SupportThread.messages))
    )).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No chat with that id.")
    thread.status = "closed"
    _add(db, thread, "bot", "This chat is closed. Start a new one if you need something else.")
    return _out(await _commit(db, thread))
