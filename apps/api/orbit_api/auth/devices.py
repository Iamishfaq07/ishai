"""Signed-in devices (Settings → Security → Devices): each sign-in is a `UserSession`, named by the token's `sid`
claim and kept across renewals. Signing one device out revokes its row, and every token carrying that id stops working
on its next request. "Sign out everywhere" (token_version) still ends all of them at once.

Tokens minted before sessions existed have no `sid`; they keep working until they expire, so nobody is signed out by
this change.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user, decode_claims, token_from_request
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User, UserSession

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/auth/sessions", tags=["auth"])
TOUCH_EVERY = timedelta(minutes=5)  # how often last_seen_at is written while a device is in use
MAX_LISTED = 50


def device_label(user_agent: str) -> tuple[Literal["web", "desktop", "extension", "other"], str]:
    """A coarse, readable name: "Orbit for Windows", "Chrome on Android". Nothing more specific is kept."""
    ua = user_agent or ""
    if "Tauri" in ua or "orbit-desktop" in ua.lower():
        return "desktop", "Orbit for Windows"
    browser = next((name for pat, name in (
        (r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Firefox/", "Firefox"), (r"Chrome/|CriOS/", "Chrome"),
        (r"Safari/", "Safari")) if re.search(pat, ua)), None)
    system = next((name for pat, name in (
        (r"Android", "Android"), (r"iPhone|iPad|iOS", "iOS"), (r"Windows", "Windows"), (r"Mac OS X|Macintosh", "macOS"),
        (r"CrOS", "ChromeOS"), (r"Linux", "Linux")) if re.search(pat, ua)), None)
    if browser and system:
        return "web", f"{browser} on {system}"
    if browser or system:
        return "web", browser or f"A browser on {system}"
    return "other", "Another app"


async def start_session(db: AsyncSession, user: User, request: Request) -> str:
    """A new device row for a sign-in; returns its id (the token's `sid`). Committed by the caller's commit."""
    kind, label = device_label(request.headers.get("user-agent", ""))
    sid = uuid.uuid4().hex
    db.add(UserSession(id=sid, user_id=user.id, kind=kind, label=label))
    await db.flush()
    return sid


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def check_session(db: AsyncSession, user: User, sid: str | None) -> bool:
    """Whether a token's device is still signed in (always true for older tokens without one). Touches last_seen."""
    if not sid:
        return True
    row = await db.get(UserSession, sid)
    if row is None or row.user_id != user.id or row.revoked_at is not None:
        return False
    now = datetime.now(UTC)
    if now - _aware(row.last_seen_at) >= TOUCH_EVERY:
        row.last_seen_at = now
        try:
            await db.commit()
        except DBAPIError:
            # Only a "last used" time: a database refusing writes (read-only, D56) mustn't turn every signed-in
            # request into a 500. The rollback expires the account, so it's read again for the caller.
            log.warning("couldn't touch device %s; carrying on", sid, exc_info=True)
            await db.rollback()
            await db.refresh(user)
    return True


async def revoke(db: AsyncSession, user_id: str, sid: str) -> bool:
    row = await db.get(UserSession, sid)
    if row is None or row.user_id != user_id or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now(UTC)
    return True


class DeviceOut(BaseModel):
    id: str
    kind: str
    label: str
    created_at: datetime
    last_seen_at: datetime
    current: bool


def _current_sid(request: Request) -> str | None:
    token = token_from_request(request)
    claims = decode_claims(token) if token else None
    sid = claims.get("sid") if claims else None
    return sid if isinstance(sid, str) else None


@router.get("", response_model=list[DeviceOut])
async def list_devices(request: Request, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> list[DeviceOut]:
    """The account's signed-in devices, most recently used first (signed-out ones aren't listed)."""
    me = _current_sid(request)
    rows = (await db.scalars(select(UserSession).where(UserSession.user_id == user.id,
                                                       UserSession.revoked_at.is_(None))
                             .order_by(UserSession.last_seen_at.desc()).limit(MAX_LISTED))).all()
    return [DeviceOut(id=r.id, kind=r.kind, label=r.label, created_at=_aware(r.created_at),
                      last_seen_at=_aware(r.last_seen_at), current=r.id == me) for r in rows]


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_device(session_id: str, request: Request, response: Response,
                          user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Sign one device out. Signing out this one clears its cookie too."""
    if not await revoke(db, user.id, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    db.add(AuditLog(user_id=user.id, action="auth.device_signed_out"))
    await db.commit()
    if session_id == _current_sid(request):
        from orbit_api.auth.routes import _clear_cookie

        _clear_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
