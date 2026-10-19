"""Local Business jobs projected into Jobs AI; no external feed or network calls."""
from datetime import UTC, datetime

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import rules
from orbit_api.job_portal import ranking
from orbit_api.job_portal.geo import city_country
from orbit_api.job_portal.postings import all_cities, dedupe_key
from orbit_api.models import BizCompany, BizJob, JobListing


async def sync(db: AsyncSession, company: BizCompany, job: BizJob) -> None:
    from orbit_api.business.apply import tracker_listing_id
    from orbit_api.business.jobs import public_url

    lid = tracker_listing_id(job)
    if job.status != "open" or company.status != "active" or job.taken_down_reason:
        await db.execute(delete(JobListing).where(JobListing.id == lid, JobListing.source == "orbit"))
    else:
        row = await db.get(JobListing, lid)
        if row is None:
            row = JobListing(id=lid, source="orbit", external_id=job.id, board=company.id)
            db.add(row)
        row.company, row.title = company.name, job.title
        row.locations = job.locations or []
        row.cities = all_cities(" / ".join(row.locations))
        explicit = {s.rsplit(",", 1)[-1].strip().upper() for s in row.locations
                    if len(s.rsplit(",", 1)[-1].strip()) == 2}
        inferred = {city_country(c) for c in row.cities if city_country(c)}
        row.country = (next(iter(explicit)) if len(explicit) == 1 else
                       next(iter(inferred)) if len(inferred) == 1 else company.country)
        row.remote_scope = (job.allowed_countries or ["*"]) if job.workplace == "remote" else None
        row.workplace, row.employment_type = job.workplace, job.employment_type
        row.level = {"entry": "fresher", "lead": "senior"}.get(job.experience, job.experience)
        row.posted_at = job.published_at or datetime.now(UTC)
        row.url = row.apply_url = public_url(company, job)
        row.description = rules.html_to_text(job.description_html)
        row.snippet = row.description[:800]
        row.keywords = list(job.must_haves or []) + list(job.nice_to_haves or [])
        row.salary = (f"{job.salary_min or ''}-{job.salary_max or ''} {job.salary_currency}/{job.salary_period}"
                      if job.show_salary and (job.salary_min or job.salary_max) else None)
        row.dedupe_key = dedupe_key(company.name, job.title, row.cities, job.workplace)
        row.fetched_at = datetime.now(UTC)
    ranking.clear_cache()


async def refresh_catalog(db: AsyncSession) -> None:
    """Backfill older published jobs in bounded sweeps; new publish/edit paths sync in their own transaction."""
    rows = await db.execute(select(BizCompany, BizJob).join(BizJob, BizJob.company_id == BizCompany.id)
        .outerjoin(JobListing, and_(JobListing.source == "orbit", JobListing.external_id == BizJob.id))
        .where(BizCompany.status == "active", BizCompany.verified_at.is_not(None), BizJob.status == "open",
            BizJob.taken_down_reason.is_(None), or_(JobListing.id.is_(None), JobListing.fetched_at < BizJob.updated_at,
                JobListing.fetched_at < BizCompany.updated_at)).order_by(BizJob.updated_at).limit(200))
    for company, job in rows:
        await sync(db, company, job)
