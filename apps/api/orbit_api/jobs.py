"""Durable background jobs (DB-backed): work that must survive a restart and must not block a request or a
live-session teardown — today, end-of-session reports.

Every API process runs one worker loop (started in the app lifespan). A job is claimed with a conditional
UPDATE (status queued → running), so two processes can never run the same job. Failures retry with backoff
up to MAX_ATTEMPTS; a job left "running" by a crashed process is re-queued after STALE_AFTER.
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db import sessionmaker
from orbit_api.models import Job

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
JOB_TIMEOUT_S = 120
STALE_AFTER = timedelta(minutes=10)
RETRY_BACKOFF_S = (15, 60, 300)

Handler = Callable[[dict[str, Any]], Awaitable[None]]
_handlers: dict[str, Handler] = {}


def handler(kind: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        _handlers[kind] = fn
        return fn
    return register


def report_key(session_id: str) -> str:
    return f"report:{session_id}"


async def enqueue(db: AsyncSession, kind: str, payload: dict[str, Any], dedupe_key: str | None = None) -> None:
    """Queue a job in the caller's transaction (commit is the caller's). A job with the same dedupe key is
    re-armed rather than duplicated — e.g. a report re-queued after its session was rejoined and ended again."""
    if dedupe_key is not None:
        existing = await db.scalar(select(Job).where(Job.dedupe_key == dedupe_key))
        if existing is not None:
            if existing.status != "running":
                existing.status, existing.attempts, existing.last_error = "queued", 0, None
                existing.run_after, existing.payload = datetime.now(UTC), payload
            return
    db.add(Job(kind=kind, payload=payload, dedupe_key=dedupe_key))


async def enqueue_now(kind: str, payload: dict[str, Any], dedupe_key: str | None = None) -> None:
    async with sessionmaker()() as db:
        await enqueue(db, kind, payload, dedupe_key)
        try:
            await db.commit()
        except IntegrityError:  # a concurrent enqueue with the same key won; that job covers this one
            await db.rollback()


async def job_status(db: AsyncSession, dedupe_keys: list[str]) -> dict[str, str]:
    if not dedupe_keys:
        return {}
    rows = (await db.execute(select(Job.dedupe_key, Job.status).where(Job.dedupe_key.in_(dedupe_keys)))).all()
    return {k: s for k, s in rows if k}


async def _claim(db: AsyncSession, job_id: str) -> bool:
    res = await db.execute(
        update(Job).where(Job.id == job_id, Job.status == "queued")
        .values(status="running", attempts=Job.attempts + 1, updated_at=datetime.now(UTC))
    )
    await db.commit()
    return bool(getattr(res, "rowcount", 0))


async def run_due_jobs(limit: int = 5) -> int:
    """Run up to `limit` due jobs; returns how many ran. Also re-queues jobs orphaned by a crashed worker."""
    now = datetime.now(UTC)
    async with sessionmaker()() as db:
        await db.execute(
            update(Job).where(Job.status == "running", Job.updated_at < now - STALE_AFTER)
            .values(status="queued", run_after=now)
        )
        await db.commit()
        ids = (await db.scalars(
            select(Job.id).where(Job.status == "queued", or_(Job.run_after <= now, Job.run_after.is_(None)))
            .order_by(Job.run_after).limit(limit)
        )).all()
    ran = 0
    for job_id in ids:
        async with sessionmaker()() as db:
            if not await _claim(db, job_id):
                continue  # another worker took it
            job = await db.get(Job, job_id)
            if job is None:
                continue
            kind, payload, attempts = job.kind, dict(job.payload), job.attempts
        ran += 1
        error: str | None = None
        fn = _handlers.get(kind)
        try:
            if fn is None:
                raise RuntimeError(f"no handler for job kind {kind!r}")
            await asyncio.wait_for(fn(payload), timeout=JOB_TIMEOUT_S)
        except Exception as e:
            error = f"{type(e).__name__}: {e}"[:2000]
            log.warning("job %s (%s) attempt %d failed: %s", job_id, kind, attempts, error)
        async with sessionmaker()() as db:
            job = await db.get(Job, job_id)
            if job is None:
                continue
            if error is None:
                job.status, job.last_error = "done", None
            elif attempts >= MAX_ATTEMPTS:
                job.status, job.last_error = "failed", error
                log.error("job %s (%s) failed permanently after %d attempts", job_id, kind, attempts)
            else:
                job.status, job.last_error = "queued", error
                job.run_after = datetime.now(UTC) + timedelta(seconds=RETRY_BACKOFF_S[min(attempts, 3) - 1])
            await db.commit()
    return ran


async def worker(poll_s: float) -> None:
    while True:
        try:
            if await run_due_jobs() == 0:
                await asyncio.sleep(poll_s)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("job worker iteration failed")
            await asyncio.sleep(poll_s * 5)


@contextlib.asynccontextmanager
async def running_worker(poll_s: float) -> Any:
    task = asyncio.create_task(worker(poll_s))
    try:
        yield task
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
