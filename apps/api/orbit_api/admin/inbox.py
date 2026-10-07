"""Admin: the Inbox, where the Contact page's messages wait (contact/routes.py, docs/DECISIONS.md D50).

- `GET /v1/admin/inbox`: newest first, by status ("todo" = new and open, the default; "new" = unread; done; spam;
  "all") and topic, searched (name, email, phone, the message, or its reference), a page at a time, with the count of
  each status for the tabs and the unread badge.
- `GET /v1/admin/inbox/{id}`: one message in full: the sender, their account when they were signed in, the context
  (a reported job), the replies, and how many messages came from the same network in 30 days. Opening an unread
  message marks it read (new → open); that's reading, not a change, so it isn't audited.
- `PATCH /v1/admin/inbox/{id}`: the status (done, spam, open again, or back to unread) and the admin's note.
- `POST /v1/admin/inbox/{id}/reply`: email the sender from Orbit's address with Reply-To set to the admin, so their
  answer lands in the admin's own mailbox. Sent within the request, so a failure shows; kept on the message, which
  is then done. Without SMTP it's refused, and the Inbox offers the admin's own mail app instead.
- `DELETE /v1/admin/inbox/{id}`.

Every change writes an AuditLog row whose target starts with the message's id; the audit log shows it as about the
sender's account, if there was one (admin/accounts.audit_items).
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Select, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin, search_term
from orbit_api.config import get_settings
from orbit_api.contact.routes import TOPICS, Status, Topic, clean_message, one_line, reference
from orbit_api.db import get_db
from orbit_api.models import AuditLog, ContactMessage, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, send_now

router = APIRouter(prefix="/v1/admin/inbox", tags=["admin"])

NOTE_MAX, REPLY_MIN, REPLY_MAX, REPLIES_MAX = 2000, 2, 5000, 50
SNIPPET = 160
InboxFilter = Literal["todo", "new", "done", "spam", "all"]


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


class InboxItem(BaseModel):
    """A message in the list: who, about what, the start of it."""
    id: str
    reference: str
    created_at: datetime
    name: str
    email: str
    topic: str
    topic_label: str
    status: str
    snippet: str  # the start of the message, on one line
    user_id: str | None  # the account it was sent from, if signed in
    listing_title: str | None = None  # a reported job
    replies: int = 0


class InboxCounts(BaseModel):
    new: int = 0  # unread
    open: int = 0
    done: int = 0
    spam: int = 0
    todo: int = 0  # new + open
    all: int = 0


class InboxOut(BaseModel):
    items: list[InboxItem]
    total: int  # matching the filters and the search, all pages
    offset: int
    has_more: bool
    counts: InboxCounts  # every message, whatever the filters


class ReplyItem(BaseModel):
    at: datetime
    by: str  # the admin's email
    text: str


class SenderAccount(BaseModel):
    id: str
    email: str
    name: str | None


class MessageOut(BaseModel):
    id: str
    reference: str
    created_at: datetime
    name: str
    email: str
    phone: str | None
    topic: str
    topic_label: str
    message: str
    context: dict[str, Any] | None
    status: str
    read_at: datetime | None
    handled_at: datetime | None
    admin_note: str | None
    replies: list[ReplyItem]
    account: SenderAccount | None  # the account it was sent from (None if signed out, or since deleted)
    same_network_30d: int  # messages from the same network in the last 30 days, this one included
    can_reply: bool  # this server can send email (SMTP); else reply from your own mail app


def _item(m: ContactMessage) -> InboxItem:
    ctx = m.context or {}
    snippet = one_line(m.message)
    return InboxItem(id=m.id, reference=reference(m.id), created_at=_aware(m.created_at), name=m.name, email=m.email,
                     topic=m.topic, topic_label=TOPICS.get(m.topic, m.topic), status=m.status,
                     snippet=snippet if len(snippet) <= SNIPPET else snippet[: SNIPPET - 1].rstrip() + "…",
                     user_id=m.user_id, listing_title=ctx.get("listing_title"), replies=len(m.replies or []))


def _query(only: InboxFilter, topic: Topic | None, q: str | None) -> Select[tuple[ContactMessage]]:
    query = select(ContactMessage)
    if only == "todo":
        query = query.where(ContactMessage.status.in_(("new", "open")))
    elif only != "all":
        query = query.where(ContactMessage.status == only)
    if topic:
        query = query.where(ContactMessage.topic == topic)
    term = search_term(q)
    if term is not None:
        like = f"%{term}%"
        ref = term.removeprefix("c-").replace("-", "")
        by_ref = (ContactMessage.id.like(f"{ref}%") if 4 <= len(ref) <= 8 and all(c in "0123456789abcdef" for c in ref)
                  else false())
        query = query.where(or_(func.lower(ContactMessage.name).like(like), func.lower(ContactMessage.email).like(like),
                                func.lower(func.coalesce(ContactMessage.phone, "")).like(like),
                                func.lower(ContactMessage.message).like(like), by_ref) if term else false())
    return query


async def _counts(db: AsyncSession) -> InboxCounts:
    by = {s: int(n) for s, n in (await db.execute(
        select(ContactMessage.status, func.count()).group_by(ContactMessage.status))).all()}
    c = InboxCounts(new=by.get("new", 0), open=by.get("open", 0), done=by.get("done", 0), spam=by.get("spam", 0))
    c.todo, c.all = c.new + c.open, sum(by.values())
    return c


@router.get("", response_model=InboxOut)
async def list_messages(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                        status_: Annotated[InboxFilter, Query(alias="status")] = "todo",
                        topic: Topic | None = None,
                        q: Annotated[str | None, Query(max_length=120)] = None,
                        offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
                        limit: Annotated[int, Query(ge=1, le=200)] = 50) -> InboxOut:
    query = _query(status_, topic, q)
    total = int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list((await db.scalars(query.order_by(ContactMessage.created_at.desc(), ContactMessage.id.desc())
                                  .offset(offset).limit(limit))).all())
    return InboxOut(items=[_item(m) for m in rows], total=total, offset=offset,
                    has_more=offset + len(rows) < total, counts=await _counts(db))


async def _message(db: AsyncSession, message_id: str) -> ContactMessage:
    m = await db.get(ContactMessage, message_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return m


async def _out(db: AsyncSession, m: ContactMessage) -> MessageOut:
    account = await db.get(User, m.user_id) if m.user_id else None
    same = 0
    if m.network_hash:
        same = int(await db.scalar(select(func.count()).select_from(ContactMessage).where(
            ContactMessage.network_hash == m.network_hash,
            ContactMessage.created_at >= datetime.now(UTC) - timedelta(days=30))) or 0)
    return MessageOut(
        id=m.id, reference=reference(m.id), created_at=_aware(m.created_at), name=m.name, email=m.email,
        phone=m.phone, topic=m.topic, topic_label=TOPICS.get(m.topic, m.topic), message=m.message, context=m.context,
        status=m.status, read_at=_aware(m.read_at) if m.read_at else None,
        handled_at=_aware(m.handled_at) if m.handled_at else None, admin_note=m.admin_note,
        replies=[ReplyItem(at=r["at"], by=r["by"], text=r["text"]) for r in (m.replies or [])],
        account=SenderAccount(id=account.id, email=account.email, name=account.name) if account else None,
        same_network_30d=same, can_reply=can_deliver())


@router.get("/{message_id}", response_model=MessageOut)
async def get_message(message_id: str, _: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> MessageOut:
    """The message in full. An unread one is marked read (and open)."""
    m = await _message(db, message_id)
    if m.read_at is None or m.status == "new":
        m.read_at = m.read_at or datetime.now(UTC)
        if m.status == "new":
            m.status = "open"
        await db.commit()
        await db.refresh(m)
    return await _out(db, m)


def _set_status(m: ContactMessage, new: Status, now: datetime) -> None:
    """new: back to unread · open: needs an answer again · done / spam: handled now."""
    m.status = new
    if new == "new":
        m.read_at = m.handled_at = None
        return
    m.read_at = m.read_at or now
    m.handled_at = now if new in ("done", "spam") else None


class MessagePatch(BaseModel):
    """Leave a field out to keep it. An empty note clears it."""
    status: Status | None = None
    admin_note: str | None = Field(None, max_length=NOTE_MAX)


@router.patch("/{message_id}", response_model=MessageOut)
async def update_message(message_id: str, body: MessagePatch, admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> MessageOut:
    m = await _message(db, message_id)
    fields = body.model_dump(exclude_unset=True)
    changed: list[str] = []
    if fields.get("status") is not None and body.status is not None:
        _set_status(m, body.status, datetime.now(UTC))
        changed.append(body.status)
    if "admin_note" in fields:
        m.admin_note = (body.admin_note or "").strip() or None
        changed.append("note")
    if not changed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to change.")
    db.add(AuditLog(user_id=admin.id, action="admin.contact.update", target=f"{m.id} {','.join(changed)}"))
    await db.commit()
    await db.refresh(m)
    return await _out(db, m)


class ReplyIn(BaseModel):
    text: str = Field(min_length=REPLY_MIN, max_length=REPLY_MAX)


def reply_email(m: ContactMessage, text: str, admin_email: str) -> OutgoingEmail:
    """The reply as the sender gets it: the admin's words, how to answer, and their own message quoted. The subject
    is built from the topic list and the reference only, so nothing anyone typed reaches a header."""
    sent = _aware(m.created_at).strftime("%d %b %Y").lstrip("0")
    quoted = "\n".join(f"> {line}" if line else ">" for line in m.message.split("\n"))
    return OutgoingEmail(
        to=m.email,
        subject=f"Re: {TOPICS.get(m.topic, 'Your message')} ({reference(m.id)})",
        text=(f"{text}\n\n-- \nOrbit\nReply to this email to write back.\n\n"
              f"On {sent} you wrote ({reference(m.id)}):\n{quoted}\n"),
        reply_to=admin_email,
    )


@router.post("/{message_id}/reply", response_model=MessageOut)
async def reply(message_id: str, body: ReplyIn, admin: Annotated[User, Depends(require_admin)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> MessageOut:
    """Email the sender from Orbit, Reply-To the admin. The message is then done, with the reply kept on it."""
    m = await _message(db, message_id)
    text = clean_message(body.text)
    if len(text) < REPLY_MIN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write the reply first.")
    if len(m.replies or []) >= REPLIES_MAX:
        raise HTTPException(status.HTTP_409_CONFLICT, "That's a long thread: carry on from your own mail app.")
    if not can_deliver():
        raise HTTPException(status.HTTP_409_CONFLICT, "This server can't send email (no SMTP), so reply from your "
                                                      "own mail app instead.")
    admin_email = get_settings().admin_email or admin.email
    if not await send_now(reply_email(m, text, admin_email)):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The email couldn't be sent. Try again, or reply from your "
                                                         "own mail app.")
    now = datetime.now(UTC)
    m.replies = [*(m.replies or []), {"at": now.isoformat(), "by": admin.email, "text": text}]
    _set_status(m, "done", now)
    db.add(AuditLog(user_id=admin.id, action="admin.contact.reply", target=f"{m.id} {m.email}"))
    await db.commit()
    await db.refresh(m)
    return await _out(db, m)


@router.delete("/{message_id}", status_code=204)
async def delete_message(message_id: str, admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Gone for good. The audit entry keeps the sender's email."""
    m = await _message(db, message_id)
    db.add(AuditLog(user_id=admin.id, action="admin.contact.delete", target=f"{m.id} {m.email}"))
    await db.delete(m)
    await db.commit()
    return Response(status_code=204)
