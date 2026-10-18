"""Telling an account's owner when the way into it changes (red team, 18 October 2026, "Detection").

A passkey added, two-step sign-in turned on or off (by the owner, or by the admin for someone who lost their phone and
codes), a password reset or changed: each is emailed to the account's address, with what to do if it wasn't them. A
server without SMTP drops the email (providers/email.NoEmailSender), so the same events are also in the app:
`GET /v1/auth/security-activity` lists the account's own recent ones (Settings → Security), and Home shows one that
happened in the last fortnight until it's acknowledged on that device.

The alerts never say more than the event and a coarse device name ("Chrome on Windows"); no IP address or location.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.devices import device_label
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, send_safely

router = APIRouter(prefix="/v1/auth", tags=["auth"])

# action -> (what happened, as a sentence's start; whether its owner is emailed and shown it on Home)
SECURITY_EVENTS: dict[str, tuple[str, bool]] = {
    "auth.passkey_added": ("A passkey was added", True),
    "auth.passkey_removed": ("A passkey was removed", False),
    "auth.2fa_on": ("Two-step sign-in was turned on", True),
    "auth.2fa_off": ("Two-step sign-in was turned off", True),
    "auth.2fa_off_by_admin": ("Orbit's admin turned off two-step sign-in", True),
    "auth.password_reset": ("The password was reset from an emailed link", True),
    "auth.password_change": ("The password was changed", True),
    "auth.email_changed": ("The account's email was changed", False),  # the old inbox is told when it's asked
    "auth.logout_all": ("Every device was signed out", False),
    "auth.google_claim": ("Google sign-in was connected", False),  # Google just proved that very inbox
}
ALERTED = frozenset(a for a, (_, alert) in SECURITY_EVENTS.items() if alert)
MAX_ITEMS = 20
NOTICE_DAYS = 14


def _when(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%d %b %Y, %H:%M UTC").lstrip("0")


def security_email(to: str, action: str, device: str | None, at: datetime | None = None) -> OutgoingEmail:
    what = SECURITY_EVENTS[action][0]
    web = get_settings().web_url.rstrip("/")
    from_where = f" from {device}" if device else ""
    return OutgoingEmail(
        to=to,
        subject=f"Orbit security: {what[0].lower() + what[1:]}",
        text=(
            f"{what} on your Orbit account ({to}), {_when(at or datetime.now(UTC))}{from_where}.\n\n"
            "If this was you, there's nothing to do.\n\n"
            "If it wasn't, someone else may be able to sign in:\n"
            f"1. Reset your password now: {web}/forgot-password (that signs out every device).\n"
            f"2. In Settings ({web}/settings#security-activity), remove any passkey you don't recognise and turn "
            "two-step sign-in on.\n"
            f"3. Tell us: {web}/contact"
        ),
    )


def alert(background: BackgroundTasks, user: User, action: str, request: Request | None = None) -> None:
    """Email the account's owner about a change to how it's signed in to (after the response, never failing it)."""
    if action not in ALERTED:
        return
    device = device_label(request.headers.get("user-agent", ""))[1] if request is not None else None
    background.add_task(send_safely, security_email(user.email, action, device or None))


class SecurityEvent(BaseModel):
    id: str
    action: str
    text: str
    at: datetime
    # Shown on Home until acknowledged on that device (the client keeps when it last acknowledged).
    notice: bool


class SecurityActivityOut(BaseModel):
    items: list[SecurityEvent]
    notice_days: int = NOTICE_DAYS
    # This server can send email (SMTP is set up), so each change is emailed too. Without it, the app is the alert.
    emailed: bool = False


@router.get("/security-activity", response_model=SecurityActivityOut)
async def security_activity(user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> SecurityActivityOut:
    """The account's own recent changes to how it's signed in to, newest first (at most 20)."""
    rows = (await db.scalars(
        select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.action.in_(SECURITY_EVENTS))
        .order_by(AuditLog.created_at.desc()).limit(MAX_ITEMS))).all()
    since = datetime.now(UTC) - timedelta(days=NOTICE_DAYS)

    def aware(d: datetime) -> datetime:
        return d if d.tzinfo else d.replace(tzinfo=UTC)

    return SecurityActivityOut(emailed=can_deliver(), items=[
        SecurityEvent(id=r.id, action=r.action, text=SECURITY_EVENTS[r.action][0], at=aware(r.created_at),
                      notice=r.action in ALERTED and aware(r.created_at) >= since)
        for r in rows])
