"""Ends sessions that were left open.

A dropped connection doesn't end a session (the client reconnects — see the live socket in routes.py), so a session
closed without pressing End stayed "live" forever: no report, and "Live · 0 min" in every list. A periodic sweep
ends any session with no live connection and no activity for `abandoned_session_min`, exactly as the End button
would (status, ended_at, the durable report job). Activity is the newest transcript turn or question, else the
start. A session whose connection just dropped is left alone while its state waits for the reconnect
(live/carryover.py keeps it as long as an idle session lives): a quiet stretch before the drop mustn't end it
mid-reconnect. In-process like the live-socket registry it consults, which is fine for the one API instance (D12).
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from orbit_api import jobs
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.live import carryover
from orbit_api.models import LiveSessionRow, Question, SessionTurn
from orbit_api.sessions import companion
from orbit_api.sessions.routes import _live_engines, _live_sockets  # sessions with a live connection

log = logging.getLogger(__name__)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite returns naive datetimes


async def end_abandoned_sessions(now: datetime | None = None) -> int:
    """End every open session that is disconnected and idle past the cutoff. Returns how many were ended."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(minutes=get_settings().abandoned_session_min)
    ended = 0
    # One query: each open session with its newest turn and question (index lookups on session_id).
    last_turn = (select(func.max(SessionTurn.created_at)).where(SessionTurn.session_id == LiveSessionRow.id)
                 .correlate(LiveSessionRow).scalar_subquery())
    last_question = (select(func.max(Question.created_at)).where(Question.session_id == LiveSessionRow.id)
                     .correlate(LiveSessionRow).scalar_subquery())
    async with sessionmaker()() as db:
        rows = (await db.execute(select(LiveSessionRow, last_turn, last_question)
                                 .where(LiveSessionRow.status != "ended"))).all()
        # A connected socket or a running engine (registered together; either means "in use").
        connected = set(_live_engines) | {sid for sockets in _live_sockets.values() for sid in sockets}
        for row, turn_at, question_at in rows:
            if row.id in connected or carryover.held(row.id):
                continue
            stamps = [_aware(t) for t in (row.created_at, row.started_at, turn_at, question_at) if t is not None]
            last_activity = max(stamps)
            if last_activity > cutoff:
                continue
            row.status = "ended"
            row.ended_at = last_activity  # when it actually stopped, not when the sweep noticed
            row.carryover = None  # the dropped connection's saved state: nothing will continue it
            await jobs.enqueue(db, "report", {"session_id": row.id}, jobs.report_key(row.id))
            companion.stop_sharing(row.id)
            ended += 1
        if ended:
            await db.commit()
            log.info("ended %d abandoned session(s)", ended)
    return ended


async def sweeper(interval_s: float) -> None:
    from orbit_api.billing.settle import reconcile_now
    from orbit_api.contact.routes import purge_expired_messages
    from orbit_api.job_portal.alerts import send_due
    from orbit_api.support.routes import purge_idle_threads_now

    while True:
        try:
            await end_abandoned_sessions()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("abandoned-session sweep failed")
        # The same pass keeps the Inbox tidy: contact messages handled long ago go (ORBIT_CONTACT_RETENTION_DAYS).
        try:
            await purge_expired_messages()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("contact retention sweep failed")
        # Razorpay and PayPal orders still open are checked with the gateway (a lost webhook or a closed page can't
        # leave a captured payment uncredited), on a backoff per order (billing/settle.py).
        try:
            await reconcile_now()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("payment reconcile sweep failed")
        # And support chats nobody is waiting on, idle that long, go with their Inbox tickets.
        try:
            await purge_idle_threads_now()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("support retention sweep failed")
        # Job alerts that are due (job_portal/alerts.py): a cheap query when none are.
        try:
            await send_due()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("job alerts sweep failed")
        await asyncio.sleep(interval_s)


@contextlib.asynccontextmanager
async def running_sweeper(interval_s: float) -> AsyncIterator[asyncio.Task[None]]:
    task = asyncio.create_task(sweeper(interval_s))
    try:
        yield task
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
