"""Ends sessions that were left open.

A dropped connection doesn't end a session (the client reconnects — see the live socket in routes.py), so a session
closed without pressing End stayed "live" forever: no report, and "Live · 0 min" in every list. A periodic sweep
ends any session with no live connection and no activity for `abandoned_session_min`, exactly as the End button
would (status, ended_at, the durable report job). Activity is the newest transcript turn or question, else the
start. In-process like the live-socket registry it consults, which is fine for the one API instance (D12).
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
from orbit_api.models import LiveSessionRow, Question, SessionTurn
from orbit_api.sessions.routes import _live_engines  # sessions with a connected live socket

log = logging.getLogger(__name__)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite returns naive datetimes


async def end_abandoned_sessions(now: datetime | None = None) -> int:
    """End every open session that is disconnected and idle past the cutoff. Returns how many were ended."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(minutes=get_settings().abandoned_session_min)
    ended = 0
    async with sessionmaker()() as db:
        rows = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.status != "ended"))).all()
        for row in rows:
            if row.id in _live_engines:
                continue
            last_turn = await db.scalar(
                select(func.max(SessionTurn.created_at)).where(SessionTurn.session_id == row.id))
            last_question = await db.scalar(
                select(func.max(Question.created_at)).where(Question.session_id == row.id))
            stamps = [_aware(t) for t in (row.created_at, row.started_at, last_turn, last_question) if t is not None]
            last_activity = max(stamps)
            if last_activity > cutoff:
                continue
            row.status = "ended"
            row.ended_at = last_activity  # when it actually stopped, not when the sweep noticed
            await jobs.enqueue(db, "report", {"session_id": row.id}, jobs.report_key(row.id))
            ended += 1
        if ended:
            await db.commit()
            log.info("ended %d abandoned session(s)", ended)
    return ended


async def sweeper(interval_s: float) -> None:
    while True:
        try:
            await end_abandoned_sessions()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("abandoned-session sweep failed")
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
