"""Single-use, expiring, hashed tokens for email verification and password reset."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import EmailToken

Purpose = Literal["verify_email", "reset_password", "change_email"]
TTL: dict[Purpose, timedelta] = {"verify_email": timedelta(hours=48), "reset_password": timedelta(hours=1),
                                 "change_email": timedelta(hours=24)}
# At most one email per purpose per user in this window (stops inbox flooding via the public endpoint).
RESEND_COOLDOWN = timedelta(seconds=60)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite returns naive datetimes


async def recently_issued(db: AsyncSession, user_id: str, purpose: Purpose) -> bool:
    latest = await db.scalar(
        select(EmailToken.created_at).where(EmailToken.user_id == user_id, EmailToken.purpose == purpose)
        .order_by(EmailToken.created_at.desc()).limit(1)
    )
    return latest is not None and datetime.now(UTC) - _aware(latest) < RESEND_COOLDOWN


async def issue(db: AsyncSession, user_id: str, purpose: Purpose, *, new_email: str | None = None) -> str:
    """Creates a new token and invalidates older unused ones of the same purpose. Caller commits."""
    now = datetime.now(UTC)
    await db.execute(
        update(EmailToken)
        .where(EmailToken.user_id == user_id, EmailToken.purpose == purpose, EmailToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = secrets.token_urlsafe(32)
    db.add(EmailToken(user_id=user_id, purpose=purpose, token_hash=_hash(token), expires_at=now + TTL[purpose],
                      new_email=new_email))
    return token


async def revoke_all(db: AsyncSession, user_id: str) -> None:
    """Every unused link for this account stops working (a password reset, "sign out everywhere", an email change):
    a pending email change started by someone who had the password can't be finished after the owner recovers the
    account. Caller commits."""
    await db.execute(update(EmailToken).where(EmailToken.user_id == user_id, EmailToken.used_at.is_(None))
                     .values(used_at=datetime.now(UTC)))


async def consume(db: AsyncSession, token: str, purpose: Purpose) -> str | None:
    """Marks the token used and returns its user id, or None if unknown/expired/used. Caller commits."""
    row = await consume_row(db, token, purpose)
    return row.user_id if row else None


async def consume_row(db: AsyncSession, token: str, purpose: Purpose) -> EmailToken | None:
    """Like `consume`, but returns the token row (for purposes that carry data, e.g. the new email address)."""
    if not token or len(token) > 200:
        return None
    row = await db.scalar(select(EmailToken).where(EmailToken.token_hash == _hash(token),
                                                   EmailToken.purpose == purpose))
    now = datetime.now(UTC)
    if row is None or row.used_at is not None or _aware(row.expires_at) < now:
        return None
    # Claimed with a conditional update: two requests opening the same link at once can't both use it.
    claimed = await db.execute(update(EmailToken).where(EmailToken.id == row.id, EmailToken.used_at.is_(None))
                               .values(used_at=now))
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        return None
    await db.refresh(row)
    return row
