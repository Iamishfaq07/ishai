"""The daily sweep: rejected applicants' data is deleted when the company's retention runs out (default 12 months
after the rejection), and jobs past their valid-through date close (so Google drops them).

Runs in every API process (one instance, D12) a minute after start and then every ORBIT_BUSINESS_SWEEP_S (6 hours).
Each deletion is in the company's audit log by count, not by person.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from orbit_api.business import indexing
from orbit_api.business.access import audit
from orbit_api.business.jobs import public_url
from orbit_api.business.pipeline import delete_application_rows
from orbit_api.db import sessionmaker
from orbit_api.models import BizApplication, BizCompany, BizJob

log = logging.getLogger(__name__)
MONTH = timedelta(days=30)


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


async def sweep(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    deleted = closed = 0
    async with sessionmaker()() as db:
        companies = (await db.scalars(select(BizCompany))).all()
        for c in companies:
            cutoff = now - c.retention_months * MONTH
            old = (await db.scalars(select(BizApplication.id).where(
                BizApplication.company_id == c.id, BizApplication.status == "rejected",
                BizApplication.rejected_at.is_not(None), BizApplication.rejected_at < cutoff))).all()
            for app_id in old:
                await delete_application_rows(db, app_id)
            if old:
                deleted += len(old)
                audit(db, c.id, None, "retention.deleted", f"{len(old)} applicant(s)", months=c.retention_months)
        expired = (await db.execute(select(BizJob, BizCompany).join(BizCompany, BizCompany.id == BizJob.company_id)
                                    .where(BizJob.status.in_(("open", "paused")), BizJob.valid_through.is_not(None),
                                           BizJob.valid_through < now))).all()
        for job, c in expired:
            if job.valid_through is not None and _aware(job.valid_through) < now:
                was_open = job.status == "open"
                job.status, job.closed_at = "closed", now
                closed += 1
                audit(db, c.id, None, "job.expired", job.title, job_id=job.id)
                if was_open:
                    await indexing.notify(db, public_url(c, job), deleted=True)
        await db.commit()
    if deleted or closed:
        log.info("business sweep: %d applicant(s) deleted by retention, %d job(s) closed", deleted, closed)
    return {"deleted": deleted, "closed": closed}


async def _loop(every_s: float) -> None:
    await asyncio.sleep(min(60.0, every_s))
    while True:
        try:
            await sweep()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("business retention sweep failed")
        await asyncio.sleep(every_s)


@contextlib.asynccontextmanager
async def running_sweeper() -> AsyncIterator[None]:
    every = float(os.environ.get("ORBIT_BUSINESS_SWEEP_S", str(6 * 3600)))
    task = asyncio.create_task(_loop(every))
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
