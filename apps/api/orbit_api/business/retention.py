"""The sweep: applicants' data is deleted when the retention they were told about runs out, requested deletions are
carried out, and jobs past their valid-through date close (so Google drops them).

What's deleted (D82, amended):
- a rejected application, its retention (the company's setting *when that person applied*, kept on the application)
  after the rejection;
- an application still in the pipeline (not hired, not rejected) on a job closed for longer than that retention;
- an application whose applicant asked for deletion `rules.DELETION_DAYS` (30) days ago and the company hasn't
  deleted: the company's owners and admins are reminded 7 days and 1 day before.
Hired applications stay (they're the company's employee records now), unless their applicant asked for deletion.

Runs in every API process (one instance, D12) a minute after start and then every ORBIT_BUSINESS_SWEEP_S (6 hours).
Each deletion is in the company's audit log by count, not by person.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from orbit_api.business import indexing, listings, rules
from orbit_api.business.access import audit, delete_application_rows
from orbit_api.business.jobs import public_url
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import BizApplication, BizCompany, BizJob, BizMember, User
from orbit_api.providers.email import OutgoingEmail, send_safely

log = logging.getLogger(__name__)
MONTH = timedelta(days=30)
REMINDERS = (7, 1)  # days before a requested deletion is carried out


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


async def _admins(db: AsyncSession, company_id: str) -> list[str]:
    return list((await db.scalars(select(User.email).join(BizMember, BizMember.user_id == User.id).where(
        BizMember.company_id == company_id, BizMember.role.in_(("owner", "admin"))))).all())


async def sweep(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    deleted = closed = reminded = 0
    mail: list[OutgoingEmail] = []
    web = get_settings().web_url.rstrip("/")
    async with sessionmaker()() as db:
        companies = (await db.scalars(select(BizCompany))).all()
        for c in companies:
            apps = (await db.execute(
                select(BizApplication, BizJob).join(BizJob, BizJob.id == BizApplication.job_id)
                .where(BizApplication.company_id == c.id,
                       or_(BizApplication.deletion_requested_at.is_not(None),
                           and_(BizApplication.status == "rejected", BizApplication.rejected_at.is_not(None)),
                           and_(BizApplication.status == "active", BizJob.status == "closed")))
                .options(load_only(BizApplication.id, BizApplication.reference, BizApplication.status,
                                   BizApplication.rejected_at, BizApplication.retention_months,
                                   BizApplication.deletion_requested_at, BizApplication.deletion_reminders)))).all()
            by_reason: dict[str, int] = {}
            due: list[tuple[BizApplication, BizJob, int]] = []
            for app, job in apps:
                keep = (app.retention_months or c.retention_months) * MONTH
                reason = None
                if app.deletion_requested_at is not None:
                    deadline = _aware(app.deletion_requested_at) + timedelta(days=rules.DELETION_DAYS)
                    if deadline <= now:
                        reason = "request"
                    else:
                        left = (deadline - now).total_seconds() / 86400
                        step = sum(1 for d in REMINDERS if left <= d)  # thresholds crossed: 1 at 7 days, 2 at 1
                        if step > (app.deletion_reminders or 0):
                            app.deletion_reminders = step
                            due.append((app, job, max(1, int(left + 0.999))))
                if reason is None and app.status == "rejected" and app.rejected_at is not None \
                        and _aware(app.rejected_at) + keep < now:
                    reason = "rejected"
                if reason is None and app.status == "active" and job.status == "closed" \
                        and job.closed_at is not None and _aware(job.closed_at) + keep < now:
                    reason = "job_closed"
                if reason is not None:
                    await delete_application_rows(db, app.id)
                    by_reason[reason] = by_reason.get(reason, 0) + 1
            for reason, n in by_reason.items():
                deleted += n
                audit(db, c.id, None, "retention.deleted", f"{n} applicant(s)", reason=reason)
            if due:
                admins = await _admins(db, c.id)
                for app, job, days in due:
                    reminded += 1
                    for to in admins:
                        mail.append(OutgoingEmail(
                            to=to, subject=f"Reminder: {rules.candidate_label(app.reference)}'s data is deleted in "
                                           f"{days} day{'s' if days != 1 else ''}",
                            text=f"An applicant for {rules.one_line(job.title)} asked for their data to be deleted. "
                                 f"Orbit deletes it automatically in {days} day{'s' if days != 1 else ''}, "
                                 f"{rules.DELETION_DAYS} days after the request. Export anything you must keep by "
                                 f"law first, or delete it now: {web}/business/app/{c.id}/applications/{app.id}",
                            footer="Sent by Orbit for Business."))
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
        await listings.refresh_catalog(db)
        await db.commit()
    for m in mail:
        await send_safely(m)
    if deleted or closed or reminded:
        log.info("business sweep: %d applicant(s) deleted, %d deletion reminder(s), %d job(s) closed", deleted,
                 reminded, closed)
    return {"deleted": deleted, "closed": closed, "reminded": reminded}


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
