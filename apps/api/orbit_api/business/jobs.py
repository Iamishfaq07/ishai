"""Jobs: drafts, publishing (verified companies only, within the plan's active jobs), pausing and closing; the AI
job-description writer; the Google for Jobs JobPosting markup and the Indexing API pings.

A job is a draft until published. Open and paused jobs count as active against the plan. Only an open job shows on
the careers page with its JSON-LD; a paused or closed job's page says so and carries no markup (Google drops stale
jobs). A job past its valid_through closes itself (retention.py's sweep).
"""

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import ratelimit
from orbit_api.business import indexing, listings, rules, usage
from orbit_api.business.access import CompanyCtx, Ctx, audit, job_for, lock_company, sees_job
from orbit_api.business.ai_port import JobBrief, get_business_ai, recording
from orbit_api.business.companies import active_jobs, effective_plan, limit_error, logo_url
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import BizApplication, BizCompany, BizJob, BizMember

router = APIRouter(prefix="/v1/business", tags=["business"])

VALID_DAYS = 60
MAX_QUESTIONS = 20
MAX_STAGES = 12
_drafts = ratelimit.SlidingWindow(rate_per_s=30 / 86400, burst=30)  # AI drafts per company per day

Workplace = Literal["onsite", "hybrid", "remote"]
EmploymentType = Literal["full_time", "part_time", "contract", "temporary", "internship"]
Experience = Literal["entry", "junior", "mid", "senior", "lead"]
Period = Literal["year", "month", "hour"]
QKind = Literal["yes_no", "choice", "short_text", "number"]
StageKind = Literal["applied", "screen", "interview", "offer", "hired", "rejected"]


def now() -> datetime:
    return datetime.now(UTC)


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


class Knockout(BaseModel):
    equals: Literal["yes", "no"] | None = None
    any_of: list[str] | None = Field(None, max_length=20)
    min: float | None = None
    max: float | None = None


class Question(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8], min_length=1, max_length=16)
    text: str = Field(min_length=1, max_length=300)
    kind: QKind
    choices: list[str] | None = Field(None, max_length=20)
    required: bool = True
    knockout: Knockout | None = None


class Stage(BaseModel):
    id: str = Field(min_length=1, max_length=16, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=40)
    kind: StageKind


def _clean_list(items: list[str], n: int, size: int) -> list[str]:
    return list(dict.fromkeys(x.strip()[:size] for x in items if x.strip()))[:n]


class JobIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description_html: str = Field("", max_length=rules.MAX_DESCRIPTION * 2)
    department: str = Field("", max_length=80)
    locations: list[str] = Field(default_factory=list, max_length=10)
    workplace: Workplace = "onsite"
    allowed_countries: list[str] = Field(default_factory=list, max_length=60)
    employment_type: EmploymentType = "full_time"
    experience: Experience = "mid"
    salary_min: int | None = Field(None, ge=0, le=10**12)
    salary_max: int | None = Field(None, ge=0, le=10**12)
    salary_currency: str = Field("INR", min_length=3, max_length=3)
    salary_period: Period = "year"
    show_salary: bool = True
    must_haves: list[str] = Field(default_factory=list, max_length=15)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=15)
    questions: list[Question] = Field(default_factory=list, max_length=MAX_QUESTIONS)
    stages: list[Stage] | None = Field(None, max_length=MAX_STAGES)
    hiring_team: list[str] | None = Field(None, max_length=50)
    valid_through: datetime | None = None

    @field_validator("allowed_countries")
    @classmethod
    def _countries(cls, v: list[str]) -> list[str]:
        out = [c.strip().upper() for c in v if c.strip()]
        if any(len(c) != 2 or not c.isalpha() for c in out):
            raise ValueError("Countries are two-letter codes (IN, US).")
        return list(dict.fromkeys(out))


class JobPatch(JobIn):
    title: str = Field(None, min_length=2, max_length=160)  # type: ignore[assignment]


class Counts(BaseModel):
    applicants: int
    new: int
    by_stage: dict[str, int]


class JobOut(BaseModel):
    id: str
    company_id: str
    slug: str
    status: str
    title: str
    description_html: str
    department: str
    locations: list[str]
    workplace: str
    allowed_countries: list[str]
    employment_type: str
    experience: str
    salary_min: int | None
    salary_max: int | None
    salary_currency: str
    salary_period: str
    show_salary: bool
    must_haves: list[str]
    nice_to_haves: list[str]
    questions: list[dict[str, Any]]
    stages: list[dict[str, Any]]
    hiring_team: list[str]
    valid_through: datetime | None
    published_at: datetime | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    public_url: str
    taken_down_reason: str | None
    counts: Counts


class JobListItem(BaseModel):
    id: str
    slug: str
    title: str
    status: str
    department: str
    locations: list[str]
    workplace: str
    published_at: datetime | None
    updated_at: datetime
    applicants: int
    new_applicants: int
    public_url: str


def public_url(company: BizCompany, job: BizJob) -> str:
    return f"{get_settings().web_url.rstrip('/')}/company/{company.slug}/jobs/{job.slug}"


async def _counts(db: AsyncSession, job: BizJob) -> Counts:
    rows = (await db.execute(select(BizApplication.stage_id, BizApplication.status, func.count())
                             .where(BizApplication.job_id == job.id)
                             .group_by(BizApplication.stage_id, BizApplication.status))).all()
    by_stage: dict[str, int] = {}
    total = new = 0
    first = rules.first_stage(job.stages, "applied")
    for stage_id, st, n in rows:
        if st != "withdrawn":
            by_stage[stage_id] = by_stage.get(stage_id, 0) + int(n)
        total += int(n)
        if stage_id == first and st == "active":
            new += int(n)
    return Counts(applicants=total, new=new, by_stage=by_stage)


async def job_out(db: AsyncSession, company: BizCompany, job: BizJob) -> JobOut:
    return JobOut(
        id=job.id, company_id=job.company_id, slug=job.slug, status=job.status, title=job.title,
        description_html=job.description_html, department=job.department, locations=job.locations or [],
        workplace=job.workplace, allowed_countries=job.allowed_countries or [], employment_type=job.employment_type,
        experience=job.experience, salary_min=job.salary_min, salary_max=job.salary_max,
        salary_currency=job.salary_currency, salary_period=job.salary_period, show_salary=job.show_salary,
        must_haves=job.must_haves or [], nice_to_haves=job.nice_to_haves or [], questions=job.questions or [],
        stages=job.stages or [], hiring_team=job.hiring_team or [], valid_through=_aware(job.valid_through),
        published_at=_aware(job.published_at), closed_at=_aware(job.closed_at),
        created_at=_aware(job.created_at) or now(), updated_at=_aware(job.updated_at) or now(),
        public_url=public_url(company, job), taken_down_reason=job.taken_down_reason, counts=await _counts(db, job))


def _check_stages(stages: list[Stage]) -> list[dict[str, Any]]:
    ids = [s.id for s in stages]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Each stage needs its own id.")
    kinds = {s.kind for s in stages}
    if "applied" not in kinds or "rejected" not in kinds:
        raise HTTPException(422, "Keep an Applied stage and a Rejected stage.")
    return [s.model_dump() for s in stages]


def _check_questions(questions: list[Question]) -> list[dict[str, Any]]:
    out = []
    ids = set()
    for q in questions:
        if q.id in ids:
            raise HTTPException(422, "Each question needs its own id.")
        ids.add(q.id)
        if q.kind == "choice" and not (q.choices and len([c for c in q.choices if c.strip()]) >= 2):
            raise HTTPException(422, f"Give at least two choices for: {q.text}")
        d = q.model_dump()
        d["choices"] = [c.strip()[:120] for c in (q.choices or []) if c.strip()] if q.kind == "choice" else None
        out.append(d)
    return out


async def _check_team(db: AsyncSession, company_id: str, user_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return []
    found = set((await db.scalars(select(BizMember.user_id).where(BizMember.company_id == company_id,
                                                                  BizMember.user_id.in_(ids)))).all())
    if set(ids) - found:
        raise HTTPException(422, "The hiring team can only include this company's members.")
    return ids


SLUG_TRIES = 5


async def _unique_job_slug(db: AsyncSession, company_id: str, title: str, job_id: str | None = None,
                           suffix: str = "") -> str:
    base = rules.slugify(title, 74) + (f"-{suffix}" if suffix else "")
    slug, n = base, 2
    while True:
        other = await db.scalar(select(BizJob.id).where(BizJob.company_id == company_id, BizJob.slug == slug))
        if other is None or other == job_id:
            return slug
        slug, n = f"{base}-{n}", n + 1


async def _apply_fields(db: AsyncSession, ctx: Ctx, job: BizJob, body: JobIn, fields: set[str]) -> None:
    if "title" in fields and body.title is not None:
        title = rules.one_line(body.title)  # no CR/LF or other control characters: it goes into email subjects
        if len(title) < 2:
            raise HTTPException(422, "Give the job a title.")
        job.title = title
    if "description_html" in fields:
        try:
            job.description_html = rules.sanitize_html(body.description_html)
        except rules.DescriptionTooLong as e:
            raise HTTPException(422, str(e)) from e
    simple = ("department", "workplace", "employment_type", "experience", "salary_min", "salary_max",
              "salary_period", "show_salary", "allowed_countries")
    for f in simple:
        if f in fields:
            v = getattr(body, f)
            setattr(job, f, v.strip() if isinstance(v, str) else v)
    if "salary_currency" in fields:
        job.salary_currency = body.salary_currency.upper()
    if "locations" in fields:
        job.locations = _clean_list([rules.one_line(x) for x in body.locations], 10, 120)
    if "must_haves" in fields:
        job.must_haves = _clean_list(body.must_haves, 15, 160)
    if "nice_to_haves" in fields:
        job.nice_to_haves = _clean_list(body.nice_to_haves, 15, 160)
    if "questions" in fields:
        job.questions = _check_questions(body.questions)
    if "stages" in fields and body.stages is not None:
        new = _check_stages(body.stages)
        kept = {s["id"] for s in new}
        in_use = set((await db.scalars(select(BizApplication.stage_id).where(BizApplication.job_id == job.id)
                                       .distinct())).all()) if job.id else set()
        if in_use - kept:
            raise HTTPException(409, "Move the applicants out of a stage before removing it.")
        job.stages = new
    if "hiring_team" in fields and body.hiring_team is not None:
        job.hiring_team = await _check_team(db, ctx.company.id, body.hiring_team)
    if "valid_through" in fields:
        job.valid_through = body.valid_through
    if job.salary_min is not None and job.salary_max is not None and job.salary_min > job.salary_max:
        raise HTTPException(422, "The salary's minimum is above its maximum.")


# ---- routes --------------------------------------------------------------------------------------------------------


@router.get("/companies/{company_id}/jobs", response_model=list[JobListItem])
async def list_jobs(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> list[JobListItem]:
    jobs = (await db.scalars(select(BizJob).where(BizJob.company_id == ctx.company.id)
                             .order_by(BizJob.updated_at.desc()))).all()
    if ctx.role == "interviewer":
        rows = (await db.execute(select(BizApplication.job_id, BizApplication.interviewers).where(
            BizApplication.company_id == ctx.company.id))).all()
        mine = {jid for jid, people in rows if ctx.user.id in (people or [])}
        jobs = [j for j in jobs if j.id in mine]
    else:
        jobs = [j for j in jobs if sees_job(ctx, j)]
    out = []
    for j in jobs:
        c = await _counts(db, j)
        out.append(JobListItem(id=j.id, slug=j.slug, title=j.title, status=j.status, department=j.department,
                               locations=j.locations or [], workplace=j.workplace,
                               published_at=_aware(j.published_at), updated_at=_aware(j.updated_at) or now(),
                               applicants=c.applicants, new_applicants=c.new, public_url=public_url(ctx.company, j)))
    return out


@router.post("/companies/{company_id}/jobs", response_model=JobOut, status_code=201)
async def create_job(body: JobIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    ctx.require("manage_jobs")
    ctx.writable()
    title = rules.one_line(body.title)
    fields = set(body.model_fields_set) | {"description_html", "locations", "must_haves", "nice_to_haves",
                                            "questions"}
    slug = await _unique_job_slug(db, ctx.company.id, title)
    for attempt in range(SLUG_TRIES):
        job = BizJob(company_id=ctx.company.id, slug=slug, title=title, status="draft", created_by=ctx.user.id,
                     stages=[dict(s) for s in rules.DEFAULT_STAGES], hiring_team=[])
        await _apply_fields(db, ctx, job, body, fields)
        try:
            async with db.begin_nested():  # the same title saved twice at once: the second takes the next slug
                db.add(job)
                await db.flush()
            break
        except IntegrityError:
            if attempt == SLUG_TRIES - 1:
                raise HTTPException(409, "Couldn't save the job just now. Try again.") from None
            slug = await _unique_job_slug(db, ctx.company.id, title, suffix=secrets.token_hex(2))
    audit(db, ctx.company.id, ctx.user, "job.created", job.title, job_id=job.id)
    await db.commit()
    return await job_out(db, ctx.company, job)


@router.get("/companies/{company_id}/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    job = await job_for(db, ctx, job_id, for_interviewer=True)
    return await job_out(db, ctx.company, job)


@router.patch("/companies/{company_id}/jobs/{job_id}", response_model=JobOut)
async def update_job(job_id: str, body: JobPatch, ctx: CompanyCtx,
                     db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    ctx.require("manage_jobs")
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    if job.status == "closed":
        raise HTTPException(409, "Reopen the job to edit it.")
    await _apply_fields(db, ctx, job, body, set(body.model_fields_set))
    if "title" in body.model_fields_set and job.status == "draft":
        job.slug = await _unique_job_slug(db, ctx.company.id, job.title, job.id)  # the address is fixed once live
    audit(db, ctx.company.id, ctx.user, "job.updated", job.title, job_id=job.id,
          fields=sorted(body.model_fields_set))
    if job.status == "open":
        await indexing.notify(db, public_url(ctx.company, job), deleted=False)
    await listings.sync(db, ctx.company, job)
    await db.commit()
    return await job_out(db, ctx.company, job)


def _require_publishable(ctx: Ctx, job: BizJob) -> None:
    if ctx.company.verified_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "biz_unverified",
            "message": "Verify the company (a work email at its domain, or a DNS record) before publishing jobs."})
    if job.taken_down_reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "biz_taken_down", "message": f"The Orbit team took this job down: {job.taken_down_reason}"})
    if len(rules.html_to_text(job.description_html)) < 50:
        raise HTTPException(422, "Write a description of at least a few sentences before publishing.")
    if not job.locations and job.workplace != "remote":
        raise HTTPException(422, "Add where the job is (or make it remote) before publishing.")


@router.post("/companies/{company_id}/jobs/{job_id}/publish", response_model=JobOut)
async def publish(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    ctx.require("manage_jobs")
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    _require_publishable(ctx, job)
    if job.status in {"draft", "closed"}:
        await lock_company(db, ctx.company.id)  # two publishes at once can't both take the last active job
        plan = effective_plan(ctx.company)
        if await active_jobs(db, ctx.company.id) >= rules.PLANS[plan].jobs:
            raise limit_error("jobs", plan)
    if job.status != "open":
        job.status, job.closed_at = "open", None
        job.published_at = job.published_at or now()
        if job.valid_through is None or (_aware(job.valid_through) or now()) <= now():
            job.valid_through = now() + timedelta(days=VALID_DAYS)
        audit(db, ctx.company.id, ctx.user, "job.published", job.title, job_id=job.id)
        await indexing.notify(db, public_url(ctx.company, job), deleted=False)
    await listings.sync(db, ctx.company, job)
    await db.commit()
    return await job_out(db, ctx.company, job)


async def _set_status(db: AsyncSession, ctx: Ctx, job_id: str, to: str) -> JobOut:
    ctx.require("manage_jobs")
    ctx.writable()
    job = await job_for(db, ctx, job_id)
    if to == "paused" and job.status != "open":
        raise HTTPException(409, "Only an open job can be paused.")
    if to == "closed" and job.status == "closed":
        return await job_out(db, ctx.company, job)
    was_open = job.status == "open"
    job.status = to
    if to == "closed":
        job.closed_at = now()
    audit(db, ctx.company.id, ctx.user, f"job.{to}", job.title, job_id=job.id)
    if was_open:
        await indexing.notify(db, public_url(ctx.company, job), deleted=True)
    await listings.sync(db, ctx.company, job)
    await db.commit()
    return await job_out(db, ctx.company, job)


@router.post("/companies/{company_id}/jobs/{job_id}/pause", response_model=JobOut)
async def pause(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    return await _set_status(db, ctx, job_id, "paused")


@router.post("/companies/{company_id}/jobs/{job_id}/close", response_model=JobOut)
async def close(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    return await _set_status(db, ctx, job_id, "closed")


@router.post("/companies/{company_id}/jobs/{job_id}/reopen", response_model=JobOut)
async def reopen(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> JobOut:
    return await publish(job_id, ctx, db)


class BriefIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    seniority: str = Field("", max_length=40)
    location: str = Field("", max_length=160)
    employment_type: str = Field("", max_length=40)
    must_haves: list[str] = Field(default_factory=list, max_length=15)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=15)
    about_company: str = Field("", max_length=2000)
    notes: str = Field("", max_length=2000)
    language: str = Field("en", max_length=8)


class SuggestedQuestionOut(BaseModel):
    text: str
    kind: str
    choices: list[str] | None = None


class DraftOut(BaseModel):
    title: str
    summary: str
    responsibilities: list[str]
    must_haves: list[str]
    nice_to_haves: list[str]
    description_markdown: str
    description_html: str
    suggested_screening_questions: list[SuggestedQuestionOut]
    # Coded words the writer replaced (shown to the recruiter), and "template" when the AI writer couldn't be
    # reached and the draft is the brief laid out.
    inclusive_language_notes: list[str]
    source: Literal["ai", "template"]


@router.post("/companies/{company_id}/jobs/draft", response_model=DraftOut)
async def draft(body: BriefIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> DraftOut:
    ctx.require("manage_jobs")
    ctx.writable()
    ratelimit.check(_drafts, f"biz-draft:{ctx.company.id}", "That's the AI writer's limit for today.")
    brief = JobBrief(**body.model_dump(), )
    if not brief.about_company and ctx.company.about:
        brief.about_company = ctx.company.about[:2000]
    try:
        with recording() as calls:
            out = await get_business_ai().write_job_description(brief)
    except Exception as e:  # the provider failed: say so, nothing was saved
        raise HTTPException(503, "The AI writer isn't available right now. Try again in a minute.") from e
    audit(db, ctx.company.id, ctx.user, "job.ai_draft", body.title, source=out.source)
    usage.store(db, ctx.company.id, ctx.user.id, calls)
    await db.commit()
    return DraftOut(title=out.title, summary=out.summary, responsibilities=out.responsibilities,
                    must_haves=out.must_haves, nice_to_haves=out.nice_to_haves,
                    description_markdown=out.description_markdown,
                    description_html=rules.markdown_to_html(out.description_markdown),
                    suggested_screening_questions=[SuggestedQuestionOut(**q.model_dump())
                                                   for q in out.suggested_screening_questions],
                    inclusive_language_notes=out.inclusive_language_notes, source=out.source)


# ---- the public face: location line and Google for Jobs ------------------------------------------------------------

EMPLOYMENT_SCHEMA = {"full_time": "FULL_TIME", "part_time": "PART_TIME", "contract": "CONTRACTOR",
                     "temporary": "TEMPORARY", "internship": "INTERN"}
PERIOD_SCHEMA = {"year": "YEAR", "month": "MONTH", "hour": "HOUR"}


def location_line(job: BizJob) -> str:
    places = job.locations or []
    where = " / ".join(places[:3]) + (f" +{len(places) - 3}" if len(places) > 3 else "")
    if job.workplace == "remote":
        scope = ", ".join(job.allowed_countries[:4]) if job.allowed_countries else "anywhere"
        return f"Remote ({scope})"
    mode = " · Hybrid" if job.workplace == "hybrid" else ""
    return f"{where}{mode}" if where else ("Hybrid" if mode else "On-site")


def _place(text: str, fallback_country: str) -> dict[str, Any]:
    parts = [p.strip() for p in text.split(",") if p.strip()]
    country = parts[-1].upper() if len(parts) > 1 and len(parts[-1]) == 2 else fallback_country
    address: dict[str, Any] = {"@type": "PostalAddress", "addressLocality": parts[0] if parts else text,
                               "addressCountry": country}
    if len(parts) > 2:
        address["addressRegion"] = parts[1]
    return {"@type": "Place", "address": address}


def json_ld(company: BizCompany, job: BizJob) -> dict[str, Any] | None:
    """Google for Jobs JobPosting (developers.google.com/search/docs/appearance/structured-data/job-posting), only
    while the job is open; None otherwise, so a closed job's page carries no markup."""
    if job.status != "open" or company.status != "active" or job.taken_down_reason:
        return None
    posted = _aware(job.published_at) or now()
    org: dict[str, Any] = {"@type": "Organization", "name": company.name, "sameAs": company.website}
    if logo_url(company):
        org["logo"] = logo_url(company)
    data: dict[str, Any] = {
        "@context": "https://schema.org/", "@type": "JobPosting", "title": job.title,
        "description": job.description_html, "datePosted": posted.date().isoformat(),
        "hiringOrganization": org,
        "identifier": {"@type": "PropertyValue", "name": company.name, "value": job.id},
        "directApply": True, "url": public_url(company, job),
        "employmentType": EMPLOYMENT_SCHEMA.get(job.employment_type, "FULL_TIME"),
    }
    if job.valid_through is not None:
        data["validThrough"] = (_aware(job.valid_through) or now()).isoformat()
    if job.workplace == "remote":
        data["jobLocationType"] = "TELECOMMUTE"
        countries = job.allowed_countries or [company.country]
        data["applicantLocationRequirements"] = [{"@type": "Country", "name": c} for c in countries]
    if job.workplace != "remote" or job.locations:
        places = job.locations or [company.country]
        data["jobLocation"] = [_place(p, company.country) for p in places]
    if job.show_salary and (job.salary_min is not None or job.salary_max is not None):
        value: dict[str, Any] = {"@type": "QuantitativeValue", "unitText": PERIOD_SCHEMA.get(job.salary_period, "YEAR")}
        if job.salary_min is not None and job.salary_max is not None and job.salary_min != job.salary_max:
            value["minValue"], value["maxValue"] = job.salary_min, job.salary_max
        else:
            value["value"] = job.salary_min if job.salary_min is not None else job.salary_max
        data["baseSalary"] = {"@type": "MonetaryAmount", "currency": job.salary_currency, "value": value}
    return data
