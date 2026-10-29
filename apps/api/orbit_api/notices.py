"""Telling a person what their account was given: AI credits, interview minutes, a plan, an approval, a referral
reward, a purchase. Each one becomes an AccountNotice (the bell in the app, and a card on Today until it's read);
`credits_email` is the email for the grants that had none (the admin's credits, a referral reward). A plan grant, an
approval and a payment already send their own email (admin/routes.py, billing/settle.py)."""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import event, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AccountNotice, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit_user

Kind = Literal["credits", "plan", "approved", "referral", "purchase", "mentor"]
SHOWN = 30

router = APIRouter(prefix="/v1/notices", tags=["notices"],
                   dependencies=[Depends(limit_user("notices", rate_per_s=2, burst=30))])


def notify(db: AsyncSession, user_id: str, kind: Kind, title: str, body: str = "", link: str | None = None) -> None:
    """Adds the notice to the session; the caller's commit saves it with the grant itself."""
    db.add(AccountNotice(user_id=user_id, kind=kind, title=title[:160], body=body[:600], link=link))


def send_after_commit(db: AsyncSession, mail: OutgoingEmail) -> None:
    """For code whose caller commits (a payment's settlement): the email goes once the grant is saved, and not at all
    if it's rolled back."""
    state = {"done": False}

    def committed(_session: object) -> None:
        if not state["done"]:
            state["done"] = True
            asyncio.get_running_loop().create_task(send_safely(mail))

    def rolled_back(_session: object) -> None:
        state["done"] = True

    event.listen(db.sync_session, "after_commit", committed, once=True)
    event.listen(db.sync_session, "after_rollback", rolled_back, once=True)


def credits_line(resume: int, minutes: int) -> str:
    """'10 AI credits and 30 interview minutes'."""
    parts = []
    if resume:
        parts.append(f"{resume} AI credit{'' if resume == 1 else 's'}")
    if minutes:
        parts.append(f"{minutes} interview minute{'' if minutes == 1 else 's'}")
    return " and ".join(parts)


def credits_given(db: AsyncSession, user: User, resume: int, minutes: int, note: str | None) -> OutgoingEmail:
    """The admin gave credits by hand: the notice now, and the email for the caller to send after its commit."""
    what = credits_line(resume, minutes)
    reason = f" Note from the Orbit team: {note}" if note else ""
    notify(db, user.id, "credits", f"You've got {what}", f"They're in your account now and never expire.{reason}",
           "/billing")
    lines = [f"Hi {user.name or 'there'},", "", f"The Orbit team added {what} to your account. They never expire."]
    if note:
        lines += ["", f"Note: {note}"]
    lines += ["", f"See your balance: {get_settings().web_url.rstrip('/')}/billing"]
    return OutgoingEmail(to=user.email, subject=f"You've got {what} on Orbit", text="\n".join(lines))


class NoticeOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str | None
    created_at: datetime
    read: bool


class NoticesOut(BaseModel):
    items: list[NoticeOut]
    unread: int


class ReadIn(BaseModel):
    ids: list[str] | None = Field(None, max_length=SHOWN)  # none: all of them


async def _out(db: AsyncSession, user: User) -> NoticesOut:
    rows = (await db.scalars(select(AccountNotice).where(AccountNotice.user_id == user.id)
                             .order_by(AccountNotice.created_at.desc(), AccountNotice.id).limit(SHOWN))).all()
    unread = await db.scalar(select(func.count()).select_from(AccountNotice).where(
        AccountNotice.user_id == user.id, AccountNotice.read_at.is_(None)))
    def at(d: datetime) -> datetime:
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    return NoticesOut(items=[NoticeOut(id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link,
                                       created_at=at(n.created_at), read=n.read_at is not None) for n in rows],
                      unread=int(unread or 0))


@router.get("", response_model=NoticesOut)
async def notices(user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> NoticesOut:
    return await _out(db, user)


@router.post("/read", response_model=NoticesOut)
async def mark_read(body: ReadIn, user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> NoticesOut:
    q = update(AccountNotice).where(AccountNotice.user_id == user.id, AccountNotice.read_at.is_(None))
    if body.ids is not None:
        q = q.where(AccountNotice.id.in_(body.ids))
    await db.execute(q.values(read_at=datetime.now(UTC)))
    await db.commit()
    return await _out(db, user)
