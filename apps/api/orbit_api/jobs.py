"""Durable background jobs with lease ownership, bounded retries and serialized follow-up runs.

Workers acknowledge only their own lease. Startup recovers expired leases, leaving other live workers alone.
Handlers remain at-least-once and must make external side effects idempotent: a lease cannot retract a network
request made by a process that later dies. Graceful shutdown releases its own lease without spending an attempt.
"""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, case, or_, select, update
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
_timeouts: dict[str, float] = {}  # a kind's own limit, when its work runs longer than JOB_TIMEOUT_S


def timeout(kind: str, seconds: float) -> None:
    _timeouts[kind] = seconds


def handler(kind: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        _handlers[kind] = fn
        return fn
    return register


def report_key(session_id: str) -> str:
    return f"report:{session_id}"


async def enqueue(db: AsyncSession, kind: str, payload: dict[str, Any], dedupe_key: str | None = None) -> None:
    """Queue a job in the caller's transaction (commit is the caller's). A job with the same dedupe key is
    re-armed rather than duplicated — e.g. a report re-queued after its session was rejoined and ended again. A
    running one keeps its lease; a changed payload requests a follow-up run after the current run ends.
    Repeated changes coalesce into the latest payload."""
    if dedupe_key is not None:
        # Acquire the row's write lock before reading state, including on SQLite, where FOR UPDATE is ignored.
        await db.execute(update(Job).where(Job.dedupe_key == dedupe_key).values(updated_at=Job.updated_at))
        existing = await db.scalar(select(Job).where(Job.dedupe_key == dedupe_key)
                                   .execution_options(populate_existing=True))
        if existing is not None:
            changed = existing.kind != kind or dict(existing.payload) != payload
            if existing.status == "running":
                if changed:
                    existing.kind, existing.payload, existing.rerun_requested = kind, payload, True
            else:
                existing.kind, existing.payload = kind, payload
                existing.status, existing.attempts, existing.last_error = "queued", 0, None
                existing.run_after, existing.rerun_requested = datetime.now(UTC), False
                existing.lease_token, existing.lease_until = None, None
            return
    db.add(Job(kind=kind, payload=payload, dedupe_key=dedupe_key))


async def enqueue_now(kind: str, payload: dict[str, Any], dedupe_key: str | None = None) -> None:
    async with sessionmaker()() as db:
        for attempt in range(2):
            try:
                await enqueue(db, kind, payload, dedupe_key)
                await db.commit()
                return
            except IntegrityError:
                await db.rollback()
                if attempt:
                    raise
                # A concurrent insertion won. Preserve this newer payload through the normal re-arm path.


async def job_status(db: AsyncSession, dedupe_keys: list[str]) -> dict[str, str]:
    if not dedupe_keys:
        return {}
    rows = (await db.execute(select(Job.dedupe_key, Job.status).where(Job.dedupe_key.in_(dedupe_keys)))).all()
    return {k: s for k, s in rows if k}


async def _claim(db: AsyncSession, job_id: str) -> str | None:
    now = datetime.now(UTC)
    token = str(uuid.uuid4())
    # Every registered handler is time-bounded; the lease exceeds the longest timeout plus a shutdown margin.
    lifetime = max([JOB_TIMEOUT_S, *_timeouts.values()]) + 60
    claimed = await db.scalar(update(Job).where(Job.id == job_id, Job.status == "queued",
        or_(Job.run_after <= now, Job.run_after.is_(None))).values(status="running", attempts=Job.attempts + 1,
        lease_token=token, lease_until=now + timedelta(seconds=lifetime), updated_at=now)
        .returning(Job.id).execution_options(synchronize_session="fetch"))
    await db.commit()
    return token if claimed else None


async def _requeue(job_id: str, token: str) -> None:
    """Release only this worker's claim; a replacement lease can never be cancelled by its predecessor."""
    async with sessionmaker()() as db:
        await db.execute(update(Job).where(Job.id == job_id, Job.status == "running", Job.lease_token == token)
            .values(status="queued", attempts=case((Job.rerun_requested, 0), (Job.attempts > 0, Job.attempts - 1),
                else_=0), last_error=case((Job.rerun_requested, None), else_=Job.last_error),
                run_after=datetime.now(UTC), rerun_requested=False, lease_token=None, lease_until=None))
        await db.commit()


def expired(now: datetime) -> Any:
    return and_(Job.status == "running", or_(Job.lease_until <= now,
        and_(Job.lease_until.is_(None), Job.updated_at < now - STALE_AFTER)))


async def requeue_interrupted() -> int:
    """Recover expired leases, including stale legacy records, without disturbing another live process."""
    now = datetime.now(UTC)
    async with sessionmaker()() as db:
        result = await db.execute(update(Job).where(expired(now)).values(
            status=case((Job.rerun_requested, "queued"), (Job.attempts >= MAX_ATTEMPTS, "failed"), else_="queued"),
            last_error=case((Job.rerun_requested, None),
                (Job.attempts >= MAX_ATTEMPTS, "WorkerLeaseExpired: worker repeatedly exited before completion"),
                else_=Job.last_error), run_after=now,
            attempts=case((Job.rerun_requested, 0), else_=Job.attempts), rerun_requested=False,
            lease_token=None, lease_until=None))
        await db.commit()
    count = int(getattr(result, "rowcount", 0) or 0)
    if count:
        log.info("recovered %d expired job lease(s)", count)
    return count


async def _finish(job_id: str, token: str, attempts: int, error: str | None) -> bool:
    """Atomically acknowledge a lease and promote any newer payload into its next run."""
    now = datetime.now(UTC)
    status = "done" if error is None else "failed" if attempts >= MAX_ATTEMPTS else "queued"
    retry_at = now + timedelta(seconds=RETRY_BACKOFF_S[min(max(attempts, 1), 3) - 1])
    async with sessionmaker()() as db:
        completed = await db.scalar(update(Job).where(Job.id == job_id, Job.status == "running",
            Job.lease_token == token).values(status=case((Job.rerun_requested, "queued"), else_=status),
            attempts=case((Job.rerun_requested, 0), else_=Job.attempts),
            last_error=case((Job.rerun_requested, None), else_=error),
            run_after=case((Job.rerun_requested, now), else_=retry_at if error else now),
            lease_token=None, lease_until=None, rerun_requested=False).returning(Job.id))
        await db.commit()
    return completed is not None


async def run_due_jobs(limit: int = 5) -> int:
    """Run up to `limit` due jobs; returns how many ran. Also re-queues jobs orphaned by a crashed worker."""
    now = datetime.now(UTC)
    await requeue_interrupted()
    async with sessionmaker()() as db:
        ids = (await db.scalars(
            select(Job.id).where(Job.status == "queued", or_(Job.run_after <= now, Job.run_after.is_(None)))
            .order_by(Job.run_after, Job.created_at, Job.id).limit(limit)
        )).all()
    ran = 0
    for job_id in ids:
        async with sessionmaker()() as db:
            token = await _claim(db, job_id)
            if token is None:
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
            await asyncio.wait_for(fn(payload), timeout=_timeouts.get(kind, JOB_TIMEOUT_S))
        except asyncio.CancelledError:
            # Shutdown mid-job (a deploy): the next process picks it up at once. Shielded, so the write completes
            # although this task is being cancelled; the cancellation goes on whatever happens to it.
            log.info("job %s (%s) interrupted by shutdown; re-queued", job_id, kind)
            with contextlib.suppress(Exception):
                await asyncio.shield(_requeue(job_id, token))
            raise
        except Exception as e:
            error = f"{type(e).__name__}: {e}"[:2000]
            log.warning("job %s (%s) attempt %d failed: %s", job_id, kind, attempts, error)
        acknowledged = await _finish(job_id, token, attempts, error)
        if acknowledged and error and attempts >= MAX_ATTEMPTS:
            log.error("job %s (%s) exhausted %d attempts", job_id, kind, attempts)
    return ran


async def worker(poll_s: float) -> None:
    try:
        await requeue_interrupted()
    except Exception:
        log.exception("couldn't re-queue interrupted jobs; they're retried after %s", STALE_AFTER)
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
