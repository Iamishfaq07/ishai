"""Single-use, expiring, hashed tokens for email verification and password reset."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import EmailToken

Purpose = Literal["verify_email", "reset_password"]
TTL: dict[Purpose, timedelta] = {"verify_email": timedelta(hours=48), "reset_password": timedelta(hours=1)}
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


async def issue(db: AsyncSession, user_id: str, purpose: Purpose) -> str:
    """Creates a new token and invalidates older unused ones of the same purpose. Caller commits."""
    now = datetime.now(UTC)
    await db.execute(
        update(EmailToken)
        .where(EmailToken.user_id == user_id, EmailToken.purpose == purpose, EmailToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = secrets.token_urlsafe(32)
    db.add(EmailToken(user_id=user_id, purpose=purpose, token_hash=_hash(token), expires_at=now + TTL[purpose]))
    return token


async def consume(db: AsyncSession, token: str, purpose: Purpose) -> str | None:
    """Marks the token used and returns its user id, or None if unknown/expired/used. Caller commits."""
    if not token or len(token) > 200:
        return None
    row = await db.scalar(select(EmailToken).where(EmailToken.token_hash == _hash(token),
                                                   EmailToken.purpose == purpose))
    now = datetime.now(UTC)
    if row is None or row.used_at is not None or _aware(row.expires_at) < now:
        return None
    row.used_at = now
    return row.user_id
