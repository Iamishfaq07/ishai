"""Telling the candidate when Orbit Apply needs them: a question only they can answer, a captcha or a login the
browser met, or a job board listing to apply to by hand. In the app, the Applications page's "Needs you" tab and
the extension's popup show the count (`GET /v1/apply/status`). By email, one message at most every 6 hours lists
them, each with its "Finish in one click" link (the job's packet in Orbit, with the answers ready to copy).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply.pacing import aware
from orbit_api.config import get_settings
from orbit_api.models import ApplicationPacket, AutoApplySetup, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, get_email_sender

log = logging.getLogger(__name__)
EVERY = timedelta(hours=6)
NEEDS_YOU = ("needs_answer", "needs_you", "handoff")
MAX_LISTED = 10


def finish_link(packet_id: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}/jobs/applications?packet={packet_id}"


def _email(user: User, packets: list[ApplicationPacket]) -> OutgoingEmail:
    lines = [f"Hi {user.name or 'there'},", "",
             f"Orbit Apply needs you for {len(packets)} application{'' if len(packets) == 1 else 's'}:", ""]
    for p in packets[:MAX_LISTED]:
        lines += [f"{p.title} at {p.company}", f"  {p.reason}", f"  Finish in one click: {finish_link(p.id)}", ""]
    lines += ["Answers you give are saved, so the next form that asks the same is filled in for you.", "",
              f"All your applications: {get_settings().web_url.rstrip('/')}/jobs/applications"]
    subject = (f"Orbit Apply needs you: {packets[0].title} at {packets[0].company}" if len(packets) == 1
               else f"Orbit Apply needs you for {len(packets)} applications")
    return OutgoingEmail(to=user.email, subject=subject[:150], text="\n".join(lines))


async def notify(db: AsyncSession, user: User, now: datetime | None = None) -> bool:
    """Email the candidate what needs them, unless they had one in the last 6 hours or nothing is new. The caller
    commits."""
    now = now or datetime.now(UTC)
    setup = await db.get(AutoApplySetup, user.id)
    if setup is None or not user.email_verified or not can_deliver():
        return False
    last = aware(setup.notified_at)
    if last is not None and now - last < EVERY:
        return False
    q = select(ApplicationPacket).where(ApplicationPacket.user_id == user.id,
                                        ApplicationPacket.status.in_(NEEDS_YOU))
    if last is not None:
        q = q.where(ApplicationPacket.updated_at > last)
    packets = list((await db.scalars(q.order_by(ApplicationPacket.updated_at.desc()).limit(50))).all())
    if not packets:
        return False
    try:
        await get_email_sender().send(_email(user, packets))
    except Exception:
        log.exception("orbit apply: the needs-you email failed; the app still shows them")
        return False
    setup.notified_at = now
    return True
