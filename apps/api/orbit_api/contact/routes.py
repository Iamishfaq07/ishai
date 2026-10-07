"""The Contact page's form: `POST /v1/contact`, open to anyone, signed in or out (docs/DECISIONS.md D50).

A message lands in the admin console's Inbox (admin/inbox.py) and nowhere else: no email goes out when one arrives
(the owner's choice), so the Inbox tab's unread count and the badge in the admin's top bar are the notification.

What's kept is what the sender typed (name, email, an optional phone or WhatsApp number, a topic from a fixed list,
the message) plus a small, bounded context: a reported job (its listing's title, company and link, read from the job
cache when the id is known, never trusted from the client) and the page the form was opened from. Signed in, the
account is linked; the server copies nothing from it (the page prefills the form, and the sender may change it).
Everything is plain text: names lose line breaks and control characters, messages keep their lines and lose the rest,
and nothing typed ever reaches an email header (an Inbox reply goes to the validated address, under a subject built
from the topic list).

Spam protection, cheapest first:
- a honeypot field (`website`) people never see: filled in, the answer looks like success and nothing is kept;
- tight bounds on every field;
- per network (an IPv4 address or an IPv6 /64): 5 an hour and 20 a day, and from everyone together
  ORBIT_CONTACT_DAILY_CAP a rolling day, counted in the table so a restart doesn't reset it;
- the bot check (Turnstile), when it's configured, for signed-out senders (an account passed it at sign-up).
The network is kept only as a keyed hash (as the welcome grant keeps it), so the Inbox can say "3 messages from this
network this month" without holding anyone's address.

Messages marked done or spam are deleted ORBIT_CONTACT_RETENTION_DAYS (365) after that, by the session sweeper
(`purge_expired_messages`); new and open ones stay until handled.
"""

import hashlib
import hmac
import logging
import re
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.captcha import require_captcha
from orbit_api.auth.security import optional_user
from orbit_api.config import get_settings
from orbit_api.csrf import HEADER as CSRF_HEADER
from orbit_api.csrf import token_for as csrf_token_for
from orbit_api.db import get_db, sessionmaker
from orbit_api.models import ContactMessage, JobListing, User
from orbit_api.ratelimit import TokenBucket, check, client_ip, network_of

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["contact"])

# The topics, in the order the form shows them. Their labels are the only words of a message's that go in an email
# subject (an Inbox reply's "Re: Payment or credits").
TOPICS: dict[str, str] = {
    "general": "General question",
    "payment": "Payment or credits",
    "technical": "Technical problem",
    "report_job": "Report a job",
    "business": "Business or partnership",
    "feedback": "Feedback",
    "other": "Other",
}
Topic = Literal["general", "payment", "technical", "report_job", "business", "feedback", "other"]
STATUSES = ("new", "open", "done", "spam")
Status = Literal["new", "open", "done", "spam"]

NAME_MAX, MESSAGE_MIN, MESSAGE_MAX = 120, 10, 3000

# 5 an hour and 20 a day from one network (token buckets: the hour's 5 come back one every 12 minutes).
_per_hour = TokenBucket(rate_per_s=5 / 3600, burst=5)
_per_day = TokenBucket(rate_per_s=20 / 86400, burst=20)
SLOW_DOWN = "You've sent a few messages in a short time. Please wait a while (an hour at most) and try again."
DAY_LIMIT = "You've sent a lot of messages today. Please try again tomorrow."
BUSY = "Orbit's inbox is very busy today. Please try again tomorrow."


def _limit(request: Request) -> None:
    network = network_of(client_ip(request))
    check(_per_hour, f"contact:{network}", SLOW_DOWN)
    check(_per_day, f"contact-day:{network}", DAY_LIMIT)


def network_hash(ip: str) -> str:
    """A keyed hash of the caller's network, so the table never holds anyone's address (see credits.ip_hash)."""
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"contact:{network_of(ip)}".encode(), hashlib.sha256).hexdigest()


def reference(message_id: str) -> str:
    """The short reference the sender is shown and can quote ("C-1A2B3C4D"): the start of the message's id."""
    return "C-" + message_id.replace("-", "")[:8].upper()


def _no_controls(text: str, keep: str = "") -> str:
    """Without control characters (NUL, escape, line breaks...) other than those in `keep`. Format characters stay:
    the zero-width joiners Indian scripts are written with are among them."""
    return "".join(c for c in text if c in keep or unicodedata.category(c) != "Cc")


def one_line(text: str | None) -> str:
    """A name or a title as one line of plain text: every run of whitespace (line and paragraph separators too) is
    one space, and control characters go."""
    return _no_controls(" ".join((text or "").split()))


def clean_message(text: str) -> str:
    """The message as plain text: line breaks kept (as \\n), at most one blank line in a row, no other control
    characters, no trailing spaces on a line."""
    text = _no_controls(text.replace("\r\n", "\n").replace("\r", "\n"), keep="\n\t")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_PHONE = re.compile(r"[+0-9 ()\-.]{7,32}")


def clean_phone(text: str | None) -> str | None:
    """A phone or WhatsApp number as typed (+91 98765 43210), or None for nothing. 7 to 15 digits."""
    text = one_line(text)
    if not text:
        return None
    digits = sum(c.isdigit() for c in text)
    if not _PHONE.fullmatch(text) or not 7 <= digits <= 15:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That phone number doesn't look right. Use "
                                                                   "digits, with +91 if you like, or leave it empty.")
    return text


def _http_url(value: str | None) -> str | None:
    value = one_line(value)
    return value if re.match(r"https?://[^\s/]", value, re.IGNORECASE) else None


class ContextIn(BaseModel):
    """What the message is about, set by the page that opened the form (never typed): a reported job and where the
    sender came from. A value of the wrong form (a link that isn't http(s), a page that isn't a path) is dropped;
    unknown keys and over-long values are refused, like any other field."""
    model_config = ConfigDict(extra="forbid")

    listing_id: str | None = Field(None, max_length=64)
    listing_title: str | None = Field(None, max_length=300)
    listing_company: str | None = Field(None, max_length=200)
    listing_url: str | None = Field(None, max_length=600)
    reason: str | None = Field(None, max_length=80)  # "Asked me to pay a fee"
    page: str | None = Field(None, max_length=200)  # "/jobs/listing/j3f2..."

    @field_validator("listing_id")
    @classmethod
    def _id(cls, v: str | None) -> str | None:
        return v if v and re.fullmatch(r"[A-Za-z0-9_:\-]+", v) else None

    @field_validator("listing_title", "listing_company", "reason")
    @classmethod
    def _line(cls, v: str | None) -> str | None:
        return one_line(v) or None

    @field_validator("listing_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return _http_url(v)

    @field_validator("page")
    @classmethod
    def _page(cls, v: str | None) -> str | None:
        v = one_line(v)
        return v if v.startswith("/") and not v.startswith("//") else None


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    email: EmailStr
    phone: str | None = Field(None, max_length=32)
    topic: Topic
    message: str = Field(min_length=MESSAGE_MIN, max_length=MESSAGE_MAX)
    context: ContextIn | None = None
    captcha_token: str | None = Field(None, max_length=4096)
    # The honeypot: a field the page hides from people ("Website"). Only a bot fills it in.
    website: str | None = Field(None, max_length=500)


class ContactOut(BaseModel):
    status: Literal["received"] = "received"
    reference: str  # "C-1A2B3C4D", to quote when writing again


async def _context(db: AsyncSession, given: ContextIn | None) -> dict[str, Any] | None:
    """The context to keep, with a known listing's title, company and link from the job cache rather than the page."""
    if given is None:
        return None
    ctx = given.model_dump(exclude_none=True)
    if given.listing_id and (listing := await db.get(JobListing, given.listing_id)) is not None:
        ctx.update(listing_title=one_line(listing.title)[:300], listing_company=one_line(listing.company)[:200])
        if url := _http_url(listing.url):
            ctx["listing_url"] = url[:600]
    return ctx or None


def _sender(request: Request, user: User | None) -> User | None:
    """The account to link. This route needs no CSRF token (csrf.TOKEN_EXEMPT: a signed-out visitor has none), so a
    browser session counts only when the request carries its token, as the web app's always does: a page elsewhere
    that gets the browser to post here sends the cookie without it, and its message stays unlinked (and gets the bot
    check). Bearer requests (the desktop app) carry no ambient credential."""
    if user is None or not get_settings().csrf_enabled:
        return user
    if request.headers.get("authorization", "").lower().startswith("bearer "):
        return user
    sent = request.headers.get(CSRF_HEADER, "")
    return user if hmac.compare_digest(sent.encode(), csrf_token_for(user.id, user.token_version).encode()) else None


@router.post("/contact", response_model=ContactOut, status_code=201, dependencies=[Depends(_limit)])
async def send_message(body: ContactIn, request: Request, db: Annotated[AsyncSession, Depends(get_db)],
                       signed_in: Annotated[User | None, Depends(optional_user)]) -> ContactOut:
    """Leave a message for Orbit's team. 201 with a short reference; it waits in the admin's Inbox."""
    if body.website and body.website.strip():
        # A bot filled in the field people can't see: it's told what a person would be, and nothing is kept.
        log.info("contact honeypot filled; message dropped")
        return ContactOut(reference=reference(str(uuid.uuid4())))
    user = _sender(request, signed_in)
    if user is None:
        ip = client_ip(request)
        await require_captcha(body.captcha_token, None if ip == "unknown" else ip)

    name = one_line(body.name)[:NAME_MAX]
    message = clean_message(body.message)
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Tell us your name.")
    if len(message) < MESSAGE_MIN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"Write a little more: at least {MESSAGE_MIN} characters, so we know how to help.")
    email = str(body.email).strip()
    if len(email) > 320:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That email address is too long.")
    phone = clean_phone(body.phone)

    since = datetime.now(UTC) - timedelta(days=1)
    today = int(await db.scalar(select(func.count()).select_from(ContactMessage).where(
        ContactMessage.created_at >= since)) or 0)
    if today >= get_settings().contact_daily_cap:
        log.warning("contact daily cap reached (%d messages in 24 h); refusing", today)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, BUSY)

    row = ContactMessage(user_id=user.id if user else None, name=name, email=email, phone=phone, topic=body.topic,
                         message=message, context=await _context(db, body.context), status="new",
                         network_hash=network_hash(client_ip(request)))
    db.add(row)
    await db.commit()
    return ContactOut(reference=reference(row.id))


# ---- retention ---------------------------------------------------------------------------------------------------


async def purge_expired(db: AsyncSession, now: datetime | None = None) -> int:
    """Delete messages marked done or spam more than ORBIT_CONTACT_RETENTION_DAYS ago (by when they were marked, or
    sent if that's unknown). New and open ones are never deleted here. Commits; returns how many went."""
    days = get_settings().contact_retention_days
    if not days:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    result = await db.execute(delete(ContactMessage).where(
        ContactMessage.status.in_(("done", "spam")),
        func.coalesce(ContactMessage.handled_at, ContactMessage.created_at) < cutoff))
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


async def purge_expired_messages() -> int:
    """`purge_expired` in its own database session (the session sweeper calls it each pass)."""
    async with sessionmaker()() as db:
        gone = await purge_expired(db)
    if gone:
        log.info("deleted %d contact message(s) past retention", gone)
    return gone
