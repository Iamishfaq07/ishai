"""Approved external applications that nothing would send become the candidate's ready-to-send kits.

Orbit sends an external employer form from its hosted worker (hosted.py). Older accounts may still be in browser
mode, where only a connected browser extension sends them. When neither will run (hosted applying is off on this
deployment or not chosen, and no extension has asked for work recently), a `ready` packet would wait until it
expired. Instead it becomes a hand-off: the prepared answers, cover letter and tailored resume stay on the packet,
the candidate opens the employer form from Orbit, sends it themselves and marks it applied (routes.done_by_hand,
never charged). notify.py includes hand-offs in its "needs you" email.

Orbit Business packets (`ats == "orbit"`) are submitted by the API itself (direct.py) and are never handed off.
"""

from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import ApplicationPacket, AutoApplySetup

# A browser extension that asked for work within this long still counts as applying (web: EXECUTOR_QUIET_MS).
EXTENSION_QUIET = timedelta(days=2)
# A packet waits this long first, so an extension connected minutes ago can still claim it. The web app already
# offers the kit for a waiting packet when nothing sends it (autoapply/model.ts, sendsItself).
GRACE = timedelta(minutes=30)
REASON = ("Orbit prepared this application. Open the employer form, use the prepared answers and tailored resume, "
          "then mark it applied.")


async def hand_off_unsendable(db: AsyncSession, now: datetime, user_id: str | None = None) -> int:
    """Turns approved external packets nothing will send into hand-offs. Returns how many. The caller commits."""
    from orbit_api.auto_apply import hosted  # hosted imports the planner, which imports this

    hosted_runs = AutoApplySetup.execution == "hosted"
    no_sender = and_(~hosted_runs if hosted.enabled() else true(), or_(
        AutoApplySetup.executor_seen_at.is_(None), AutoApplySetup.executor_seen_at < now - EXTENSION_QUIET))
    q = (select(ApplicationPacket).join(AutoApplySetup, AutoApplySetup.user_id == ApplicationPacket.user_id)
         .where(ApplicationPacket.status == "ready", ApplicationPacket.ats != "orbit",
                ApplicationPacket.submission_started_at.is_(None), ApplicationPacket.updated_at < now - GRACE,
                no_sender))
    if user_id is not None:
        q = q.where(ApplicationPacket.user_id == user_id)
    changed = 0
    for p in (await db.scalars(q.limit(500))).all():
        p.status, p.reason = "handoff", REASON
        changed += 1
    return changed
