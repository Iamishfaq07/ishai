"""Applying, and the public pages: the careers page and job page data (with the JSON-LD), the sitemap, "Report this
job", and the applicant's own status page.

Two ways to apply, both with the notice agreed (its version and the time recorded):
- Signed in with Orbit, in one click: the candidate picks one of their resumes and sees exactly what's shared (the
  preview); its text is copied into the application. The company never reads the Orbit resume itself, or anything
  else of the account. The job joins the candidate's Jobs AI tracker as "Applied via Orbit" and moves as the company
  moves it.
- Signed out: name, email, phone, a PDF or DOCX resume (read like any upload, then thrown away: only its text is
  kept), with the bot check and rate limits; the confirmation email's link confirms the address.

One application per email per job: a second gets 200 "already_applied" (never an error that says the address applied).
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs as job_queue
from orbit_api import ratelimit
from orbit_api.auth.captcha import require_captcha
from orbit_api.auth.guards import require_verified_email
from orbit_api.business import emails, rules
from orbit_api.business.access import audit, delete_application_rows, lock_company, timeline
from orbit_api.business.companies import logo_url
from orbit_api.business.jobs import json_ld, location_line, public_url
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.job_portal.interview import resume_document_text
from orbit_api.models import (
    BizApplication,
    BizCompany,
    BizExperienceInvite,
    BizInterview,
    BizJob,
    BizMember,
    BizReport,
    Document,
    JobApplication,
    Resume,
    User,
)
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/business", tags=["business"])
public_router = APIRouter(prefix="/v1/public/business", tags=["business-public"])

RANK_KIND = "biz_rank"
TRACKER_SOURCE = "orbit_direct"
MAX_RESUME_CHARS = 60_000
_apply_ip = ratelimit.SlidingWindow(rate_per_s=10 / 3600, burst=10)
_apply_email = ratelimit.SlidingWindow(rate_per_s=5 / 86400, burst=5)
_apply_user = ratelimit.SlidingWindow(rate_per_s=30 / 86400, burst=30)
_reports = ratelimit.SlidingWindow(rate_per_s=5 / 3600, burst=5)
_status_reads = ratelimit.SlidingWindow(rate_per_s=1, burst=30)

Source = Literal["careers", "widget", "orbit", "google", "linkedin", "direct", "other"]
SOURCES = ("careers", "widget", "orbit", "google", "linkedin", "direct", "other")
PUBLIC_CACHE = {"Cache-Control": "public, max-age=120"}


def now() -> datetime:
    return datetime.now(UTC)


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


def iso(when: datetime | None) -> str | None:
    aware = _aware(when)
    return aware.isoformat() if aware is not None else None


def tracker_listing_id(job: BizJob) -> str:
    return "biz:" + job.id.replace("-", "")[:32]


# ---- the public job and company ------------------------------------------------------------------------------------


class PublicQuestion(BaseModel):
    id: str
    text: str
    kind: str
    choices: list[str] | None = None
    required: bool


class Salary(BaseModel):
    min: int | None
    max: int | None
    currency: str
    period: str


class PublicCompanyRef(BaseModel):
    slug: str
    name: str
    logo_url: str | None
    website: str
    verified: bool
    # The domain the company proved ("Verified: acme.com" on the badge); None while unverified.
    verified_domain: str | None = None


class Notice(BaseModel):
    version: str
    text: str


class PublicJob(BaseModel):
    id: str
    slug: str
    status: str
    title: str
    description_html: str
    department: str
    locations: list[str]
    location_line: str
    workplace: str
    allowed_countries: list[str]
    employment_type: str
    experience: str
    salary: Salary | None
    published_at: datetime | None
    valid_through: datetime | None
    questions: list[PublicQuestion]
    company: PublicCompanyRef
    url: str
    notice: Notice
    json_ld: dict[str, Any] | None


class PublicJobSummary(BaseModel):
    id: str
    slug: str
    title: str
    department: str
    location_line: str
    employment_type: str
    published_at: datetime
    url: str


class PublicCompany(BaseModel):
    slug: str
    name: str
    website: str
    logo_url: str | None
    about: str
    country: str
    verified: bool
    verified_domain: str | None = None
    jobs: list[PublicJobSummary]


def _listed(job: BizJob) -> bool:
    return job.status == "open" and not job.taken_down_reason


async def _public_company(db: AsyncSession, slug: str) -> BizCompany:
    c = await db.scalar(select(BizCompany).where(BizCompany.slug == slug))
    if c is None or c.status != "active":
        raise HTTPException(404, "Not found.")
    return c


def verified_domain(company: BizCompany) -> str | None:
    return company.domain if company.verified_at is not None else None


def notice(company: BizCompany) -> Notice:
    return Notice(version=rules.NOTICE_VERSION, text=rules.notice_text(company.name, company.retention_months))


def public_job(company: BizCompany, job: BizJob) -> PublicJob:
    open_ = _listed(job)
    salary = Salary(min=job.salary_min, max=job.salary_max, currency=job.salary_currency, period=job.salary_period) \
        if job.show_salary and (job.salary_min is not None or job.salary_max is not None) else None
    return PublicJob(
        id=job.id, slug=job.slug, status="open" if open_ else ("paused" if job.status == "paused" else "closed"),
        title=job.title, description_html=job.description_html, department=job.department,
        locations=job.locations or [], location_line=location_line(job), workplace=job.workplace,
        allowed_countries=job.allowed_countries or [], employment_type=job.employment_type,
        experience=job.experience, salary=salary, published_at=_aware(job.published_at),
        valid_through=_aware(job.valid_through),
        questions=[PublicQuestion(id=q["id"], text=q["text"], kind=q["kind"], choices=q.get("choices"),
                                  required=bool(q.get("required", True))) for q in job.questions or []]
        if open_ else [],
        company=PublicCompanyRef(slug=company.slug, name=company.name, logo_url=logo_url(company),
                                 website=company.website, verified=company.verified_at is not None,
                                 verified_domain=verified_domain(company)),
        url=public_url(company, job), notice=notice(company), json_ld=json_ld(company, job) if open_ else None)


@public_router.get("/companies/{slug}", response_model=PublicCompany)
async def get_public_company(slug: str, db: Annotated[AsyncSession, Depends(get_db)]) -> JSONResponse:
    c = await _public_company(db, slug)
    jobs = (await db.scalars(select(BizJob).where(BizJob.company_id == c.id, BizJob.status == "open",
                                                  BizJob.taken_down_reason.is_(None))
                             .order_by(BizJob.published_at.desc()))).all()
    out = PublicCompany(slug=c.slug, name=c.name, website=c.website, logo_url=logo_url(c), about=c.about or "",
                        country=c.country, verified=c.verified_at is not None, verified_domain=verified_domain(c),
                        jobs=[PublicJobSummary(id=j.id, slug=j.slug, title=j.title, department=j.department,
                                               location_line=location_line(j), employment_type=j.employment_type,
                                               published_at=_aware(j.published_at) or now(),
                                               url=public_url(c, j)) for j in jobs])
    return JSONResponse(out.model_dump(mode="json"), headers=PUBLIC_CACHE)


@public_router.get("/companies/{slug}/jobs/{job_slug}", response_model=PublicJob)
async def get_public_job(slug: str, job_slug: str, db: Annotated[AsyncSession, Depends(get_db)]) -> JSONResponse:
    c = await _public_company(db, slug)
    job = await db.scalar(select(BizJob).where(BizJob.company_id == c.id, BizJob.slug == job_slug))
    if job is None or job.status == "draft" or job.taken_down_reason:
        raise HTTPException(404, "Not found.")
    return JSONResponse(public_job(c, job).model_dump(mode="json"), headers=PUBLIC_CACHE)


class SitemapEntry(BaseModel):
    loc: str
    lastmod: str


@public_router.get("/sitemap", response_model=list[SitemapEntry])
async def sitemap(db: Annotated[AsyncSession, Depends(get_db)]) -> JSONResponse:
    rows = (await db.execute(select(BizJob, BizCompany).join(BizCompany, BizCompany.id == BizJob.company_id).where(
        BizJob.status == "open", BizJob.taken_down_reason.is_(None), BizCompany.status == "active")
        .order_by(BizJob.updated_at.desc()).limit(45_000))).all()
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    web = get_settings().web_url.rstrip("/")
    for job, c in rows:
        when = (_aware(job.updated_at) or now()).date().isoformat()
        if c.id not in seen:
            seen.add(c.id)
            out.append({"loc": f"{web}/company/{c.slug}", "lastmod": when})
        out.append({"loc": public_url(c, job), "lastmod": when})
    return JSONResponse(out, headers={"Cache-Control": "public, max-age=600"})


class ReportIn(BaseModel):
    reason: Literal["scam", "fake_company", "discriminatory", "misleading", "other"]
    details: str = Field("", max_length=2000)
    email: EmailStr | None = None


@public_router.post("/jobs/{job_id}/report", status_code=201)
async def report_job(job_id: str, body: ReportIn, request: Request,
                     db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    ratelimit.check(_reports, f"biz-report:{ratelimit.client_network(request)}")
    job = await db.get(BizJob, job_id)
    if job is None or job.status == "draft":
        raise HTTPException(404, "Not found.")
    db.add(BizReport(company_id=job.company_id, job_id=job.id, reason=body.reason, details=body.details.strip(),
                     email=str(body.email).lower() if body.email else None))
    await db.commit()
    admin = get_settings().admin_email
    if admin:
        await send_safely(OutgoingEmail(to=admin, subject=f"Orbit for Business: a job was reported ({body.reason})",
                                        text=f"{job.title}\n\n{body.details.strip()[:1000]}\n\nReview it: "
                                             f"{get_settings().web_url.rstrip('/')}/admin/business"))
    return {"status": "received"}


# ---- applying ------------------------------------------------------------------------------------------------------


class AnswerIn(BaseModel):
    question_id: str = Field(max_length=16)
    answer: str = Field("", max_length=2000)


_answers = TypeAdapter(list[AnswerIn])


class ApplyResult(BaseModel):
    status: Literal["applied", "already_applied"]
    message: str
    status_url: str | None
    tracker_id: str | None


def _check_answers(job: BizJob, answers: list[AnswerIn]) -> tuple[list[dict[str, Any]], list[str]]:
    given = {a.question_id: a.answer.strip() for a in answers}
    out: list[dict[str, Any]] = []
    fails: list[str] = []
    for q in job.questions or []:
        a = given.get(q["id"], "")
        if not a and q.get("required", True):
            raise HTTPException(422, f"Answer: {q['text']}")
        if a and q["kind"] == "yes_no" and a.lower() not in {"yes", "no"}:
            raise HTTPException(422, f"Answer yes or no: {q['text']}")
        if a and q["kind"] == "choice" and a not in (q.get("choices") or []):
            raise HTTPException(422, f"Pick one of the choices: {q['text']}")
        if a and q["kind"] == "number":
            try:
                float(a)
            except ValueError as e:
                raise HTTPException(422, f"Answer with a number: {q['text']}") from e
        why = rules.knockout_failure(q, a) if a else None
        if why:
            fails.append(why)
        out.append({"question_id": q["id"], "question": q["text"], "answer": a[:2000],
                    "knockout_failed": why is not None})
    return out, fails


async def _open_job(db: AsyncSession, job_id: str) -> tuple[BizJob, BizCompany]:
    job = await db.get(BizJob, job_id)
    company = await db.get(BizCompany, job.company_id) if job is not None else None
    if job is None or company is None or company.status != "active" or job.status == "draft" or job.taken_down_reason:
        raise HTTPException(404, "Not found.")
    if job.status != "open":
        raise HTTPException(409, detail={"code": "biz_job_closed", "message": "This job isn't taking applications."})
    return job, company


def _check_consent(consent: bool, version: str) -> None:
    if not consent:
        raise HTTPException(422, "Please read the notice and tick the box to apply.")
    if version != rules.NOTICE_VERSION:
        raise HTTPException(409, detail={"code": "biz_notice_changed",
                                         "message": "The notice changed. Reload the page, read it and apply again."})


async def _create(db: AsyncSession, *, job: BizJob, company: BizCompany, name: str, email: str, phone: str | None,
                  resume_text: str, filename: str | None, resume_source: str, answers: list[AnswerIn], source: str,
                  user: User | None) -> tuple[BizApplication | None, str]:
    """The application, or (None, "") when this email already applied to this job.

    An earlier signed-out application from the same address that was never confirmed proves nothing (anyone can type
    someone else's address): a new one replaces it, so a stranger can't hold a person's place for a job. A confirmed or
    one-click application is never replaced."""
    email = email.strip().lower()
    checked, fails = _check_answers(job, answers)
    same = select(BizApplication).where(BizApplication.job_id == job.id, BizApplication.email == email)
    existing = await db.scalar(same)
    if existing is not None:
        if existing.user_id is not None or existing.email_confirmed_at is not None:
            return None, ""
        # Replacing it: the company's row, then the application's, locked in that order, the order ranking takes
        # them in (Postgres would otherwise find a deadlock with a ranking of the old application, or with another
        # apply from this address replacing it too). Read again under the lock: someone may have got there first.
        await lock_company(db, company.id)
        existing = await db.scalar(same.with_for_update().execution_options(populate_existing=True))
    if existing is not None:
        if existing.user_id is not None or existing.email_confirmed_at is not None:
            return None, ""
        ref = existing.reference
        await delete_application_rows(db, existing.id)
        audit(db, company.id, None, "application.replaced", ref, job_id=job.id,
              by="orbit_account" if user is not None else "new_application")
        await db.flush()
    app_id = str(uuid.uuid4())
    raw, token_hash, sealed = rules.new_status_token()
    text = rules.notice_text(company.name, company.retention_months)
    app = BizApplication(
        id=app_id, reference=rules.reference(), company_id=company.id, job_id=job.id, user_id=user.id if user else None,
        name=rules.one_line(name)[:160], email=email, phone=(phone or "").strip()[:40] or None,
        resume_text=resume_text[:MAX_RESUME_CHARS], resume_filename=filename, resume_source=resume_source,
        answers=checked, knockout_failed=bool(fails), knockout_reasons=fails,
        source=source if source in SOURCES else "other",
        consent={"notice_version": rules.NOTICE_VERSION, "accepted_at": now().isoformat(),
                 "text_sha256": rules.notice_digest(text), "retention_months": company.retention_months},
        retention_months=company.retention_months,
        email_confirmed_at=now() if user is not None and user.email_verified else None,
        status_token_hash=token_hash, status_token_sealed=sealed,
        stage_id=rules.first_stage(job.stages, "applied") or "applied",
        status="active", ranking_status="pending")
    try:
        # A savepoint: when the same email applies at the same moment, only this insert is undone. A full rollback
        # would expire the job, company and user the caller still reads (an async lazy load is a MissingGreenlet).
        # The "applied" event goes in with it: on SQLite a savepoint with nothing written before it is the whole
        # transaction, so its release commits, and a concurrent apply may replace the row before a later insert.
        async with db.begin_nested():
            db.add(app)
            timeline(db, app, "applied", None, source=app.source, via_orbit=user is not None)
            await db.flush()
    except IntegrityError:
        return None, ""
    await job_queue.enqueue(db, RANK_KIND, {"application_id": app.id}, dedupe_key=f"{RANK_KIND}:{app.id}")
    return app, raw


async def _confirmation(company: BizCompany, job: BizJob, app: BizApplication, raw: str) -> None:
    values = emails.values(company, job, app, token=raw)
    if app.email_confirmed_at is None:
        # Not confirmed yet: Orbit's fixed words, never the company's template (D82: the address might not be the
        # applicant's). Opening the link confirms the address (the status page posts confirm).
        subject, body = emails.CONFIRMATION
        values["status_link"] += "?confirm=1"
    else:
        subject, body, _ = await _template(company.id, "received")
    await emails.send_to_applicant(company, app, emails.render(subject, values), emails.render(body, values), None)


async def _template(company_id: str, kind: str) -> tuple[str, str, bool]:
    from orbit_api.db import sessionmaker

    async with sessionmaker()() as db:
        return await emails.template(db, company_id, kind)


async def _sync_new_tracker(db: AsyncSession, user: User, company: BizCompany, job: BizJob) -> str:
    """The job in the candidate's own tracker, as applied (made or moved)."""
    listing = tracker_listing_id(job)
    entry = await db.scalar(select(JobApplication).where(JobApplication.user_id == user.id,
                                                         JobApplication.listing_id == listing))
    url = public_url(company, job)
    if entry is None:
        entry = JobApplication(user_id=user.id, listing_id=listing, source=TRACKER_SOURCE, company=company.name,
                               title=job.title, location=location_line(job)[:300], url=url, apply_url=url,
                               posted_at=job.published_at, status="applied", applied_at=now(), status_at=now(),
                               notes="Applied via Orbit.")
        db.add(entry)
        await db.flush()
    else:
        entry.status, entry.applied_at, entry.status_at = "applied", entry.applied_at or now(), now()
    return entry.id


async def sync_tracker_status(db: AsyncSession, app: BizApplication, kind: str) -> None:
    """The company moved the application: the candidate's tracker row follows (in plain statuses)."""
    if not app.tracker_id or not app.user_id:
        return
    entry = await db.get(JobApplication, app.tracker_id)
    if entry is None or entry.user_id != app.user_id:
        return
    status_ = rules.TRACKER_STATUS.get(kind, "applied")
    if entry.status != status_:
        entry.status, entry.status_at = status_, now()
        if status_ in ("hired", "withdrawn"):
            entry.next_at = None


@public_router.post("/jobs/{job_id}/apply", response_model=ApplyResult)
async def apply_signed_out(
    job_id: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)],
    name: Annotated[str, Form(min_length=2, max_length=160)],
    email: Annotated[str, Form(max_length=320)],
    file: UploadFile,
    consent: Annotated[bool, Form()],
    notice_version: Annotated[str, Form(max_length=40)],
    phone: Annotated[str, Form(max_length=40)] = "",
    answers: Annotated[str, Form(max_length=50_000)] = "[]",
    source: Annotated[str, Form(max_length=16)] = "careers",
    captcha_token: Annotated[str | None, Form(max_length=4096)] = None,
    website: Annotated[str, Form(max_length=300)] = "",
) -> ApplyResult:
    ok = ApplyResult(status="applied", message="Thanks for applying. Check your inbox: we sent a link to confirm "
                     "your email and see your application's status.", status_url=None, tracker_id=None)
    if website.strip():  # the honeypot: a bot filled the hidden field; it's told it worked, nothing is kept
        return ok
    network = ratelimit.client_network(request)
    ratelimit.check(_apply_ip, f"biz-apply:{network}", "Too many applications from here. Try again later.")
    try:
        address = str(TypeAdapter(EmailStr).validate_python(email.strip())).lower()
        parsed_answers = _answers.validate_json(answers or "[]")
    except (ValidationError, ValueError) as e:
        raise HTTPException(422, "Check your email address and answers.") from e
    # The bot check first: a failed one must not use up the address's own daily allowance.
    await require_captcha(captcha_token, ratelimit.client_ip(request))
    ratelimit.check(_apply_email, f"biz-apply-email:{address}", "Too many applications from this email today.")
    _check_consent(consent, notice_version)
    job, company = await _open_job(db, job_id)
    max_bytes = get_settings().max_upload_bytes
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"The resume can be up to {max_bytes // 1_048_576} MB.")
    filename = (file.filename or "resume").replace("\\", "/").rsplit("/", 1)[-1][:200]
    try:
        fmt = detect_format(filename, file.content_type, data[:8])
        if fmt not in {"pdf", "docx"}:
            raise ParseError("Upload your resume as a PDF or Word (DOCX) file.")
        text = await asyncio.to_thread(extract_text_isolated, data, fmt)
    except ParseError as e:
        raise HTTPException(422, str(e)) from e
    app, raw = await _create(db, job=job, company=company, name=name, email=address, phone=phone, resume_text=text,
                             filename=filename, resume_source="upload", answers=parsed_answers, source=source,
                             user=None)
    if app is None:
        await send_safely(OutgoingEmail(
            to=address, subject=f"You've already applied for {job.title}",
            text=f"We got another application for {job.title} at {company.name} from this address. You'd already "
                 "applied, so nothing changed: the link in your first email shows where your application is.",
            footer=emails.APPLICANT_FOOTER.format(company=company.name)))
        return ok
    await db.commit()
    await _confirmation(company, job, app, raw)
    return ok


class PreviewResume(BaseModel):
    id: str
    kind: Literal["orbit_resume", "orbit_document"]
    title: str
    updated_at: datetime


class PreviewOut(BaseModel):
    name: str
    email: str
    phone: str | None
    resume_title: str
    resume_text: str
    resumes: list[PreviewResume]
    already_applied: bool


async def _resumes(db: AsyncSession, user: User) -> list[PreviewResume]:
    built = (await db.scalars(select(Resume).where(Resume.user_id == user.id).order_by(Resume.updated_at.desc())
                              .limit(30))).all()
    docs = (await db.scalars(select(Document).where(Document.user_id == user.id, Document.kind == "resume",
                                                    Document.status == "ready", Document.origin == "user")
                             .order_by(Document.created_at.desc()).limit(30))).all()
    return [PreviewResume(id=r.id, kind="orbit_resume", title=r.title, updated_at=_aware(r.updated_at) or now())
            for r in built] + \
           [PreviewResume(id=d.id, kind="orbit_document", title=d.title, updated_at=_aware(d.created_at) or now())
            for d in docs]


async def _shared(db: AsyncSession, user: User, resume_id: str | None,
                  document_id: str | None) -> tuple[str, str, str | None, str, str]:
    """(title, text, phone, name, source) of the resume the candidate chose: theirs only."""
    if resume_id:
        r = await db.get(Resume, resume_id)
        if r is None or r.user_id != user.id:
            raise HTTPException(404, "Not found.")
        data = ResumeData.model_validate(r.data or {})
        b = data.visible().basics
        return r.title, resume_document_text(data), b.phone or None, b.name or user.name or "", "orbit_resume"
    if document_id:
        d = await db.get(Document, document_id)
        if d is None or d.user_id != user.id or d.kind != "resume":
            raise HTTPException(404, "Not found.")
        return d.title, d.source_text or "", None, user.name or "", "orbit_document"
    raise HTTPException(422, "Choose the resume to send.")


@router.get("/apply/{job_id}/preview", response_model=PreviewOut)
async def preview(job_id: str, user: Annotated[User, Depends(require_verified_email)],
                  db: Annotated[AsyncSession, Depends(get_db)],
                  resume_id: Annotated[str | None, Query(max_length=36)] = None,
                  document_id: Annotated[str | None, Query(max_length=36)] = None) -> PreviewOut:
    job, _company = await _open_job(db, job_id)
    resumes = await _resumes(db, user)
    if not resume_id and not document_id and resumes:
        first = resumes[0]
        resume_id, document_id = (first.id, None) if first.kind == "orbit_resume" else (None, first.id)
    title, text, phone, name = "", "", None, user.name or ""
    if resume_id or document_id:
        title, text, phone, name, _ = await _shared(db, user, resume_id, document_id)
    applied = await db.scalar(select(BizApplication).where(BizApplication.job_id == job.id,
                                                           BizApplication.email == user.email.lower()))
    # An unconfirmed signed-out application from this address doesn't count: applying replaces it.
    held = applied is not None and (applied.user_id is not None or applied.email_confirmed_at is not None)
    return PreviewOut(name=name or user.email.split("@")[0], email=user.email, phone=phone, resume_title=title,
                      resume_text=text[:MAX_RESUME_CHARS], resumes=resumes, already_applied=held)


class OneClickIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)
    document_id: str | None = Field(None, max_length=36)
    phone: str | None = Field(None, max_length=40)
    answers: list[AnswerIn] = Field(default_factory=list, max_length=40)
    consent: bool
    notice_version: str = Field(max_length=40)
    source: Source = "careers"


@router.post("/apply/{job_id}", response_model=ApplyResult)
async def apply_one_click(job_id: str, body: OneClickIn, user: Annotated[User, Depends(require_verified_email)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> ApplyResult:
    ratelimit.check(_apply_user, f"biz-apply-user:{user.id}", "That's a lot of applications today. Try tomorrow.")
    _check_consent(body.consent, body.notice_version)
    job, company = await _open_job(db, job_id)
    title, text, phone, name, source_kind = await _shared(db, user, body.resume_id, body.document_id)
    if not text.strip():
        raise HTTPException(422, "That resume is empty. Pick another one.")
    app, raw = await _create(db, job=job, company=company, name=name or user.email.split("@")[0], email=user.email,
                             phone=body.phone or phone, resume_text=text, filename=title[:200],
                             resume_source=source_kind,
                             answers=body.answers, source=body.source, user=user)
    if app is None:
        existing = await db.scalar(select(BizApplication).where(BizApplication.job_id == job.id,
                                                               BizApplication.email == user.email.lower()))
        return ApplyResult(status="already_applied", message="You've already applied for this job.", status_url=None,
                           tracker_id=existing.tracker_id if existing is not None else None)
    app.tracker_id = await _sync_new_tracker(db, user, company, job)
    await db.commit()
    await _confirmation(company, job, app, raw)
    return ApplyResult(status="applied", message=f"Applied. {company.name} will see your application.",
                       status_url=emails.status_link(raw), tracker_id=app.tracker_id)


# ---- the applicant's status page -----------------------------------------------------------------------------------


class StatusInterview(BaseModel):
    slots: list[str]
    duration_min: int
    location: str
    chosen: str | None


class StatusCompany(BaseModel):
    name: str
    logo_url: str | None
    slug: str


class StatusOut(BaseModel):
    reference: str
    application_state: Literal["active", "rejected", "hired", "withdrawn"]
    can_withdraw: bool
    withdrawn_at: datetime | None
    withdrawal_notice_version: str
    withdrawal_notice: str
    company: StatusCompany
    job_title: str
    job_url: str
    stage_label: str
    stage_detail: str
    applied_at: datetime
    email_confirmed: bool
    interview: StatusInterview | None
    deletion_requested: bool
    experience_invited: bool = False


async def _by_token(db: AsyncSession, token: str, request: Request) -> tuple[BizApplication, BizJob, BizCompany]:
    ratelimit.check(_status_reads, f"biz-status:{ratelimit.client_network(request)}")
    app = await db.scalar(select(BizApplication).where(BizApplication.status_token_hash == rules.digest(token)))
    job = await db.get(BizJob, app.job_id) if app is not None else None
    company = await db.get(BizCompany, app.company_id) if app is not None else None
    if app is None or job is None or company is None:
        raise HTTPException(404, "This link isn't valid any more. The application may have been deleted.")
    return app, job, company


async def latest_interview(db: AsyncSession, app_id: str) -> BizInterview | None:
    row: BizInterview | None = await db.scalar(select(BizInterview).where(BizInterview.application_id == app_id)
                           .order_by(BizInterview.created_at.desc(), BizInterview.id.desc())
                           .execution_options(populate_existing=True).limit(1))
    return row


async def _status(db: AsyncSession, app: BizApplication, job: BizJob, company: BizCompany) -> StatusOut:
    from orbit_api.business.scheduling import available_slots
    kind = app.status if app.status in ("rejected", "withdrawn") else rules.stage_kind(job.stages, app.stage_id)
    label, detail = rules.CANDIDATE_STAGE.get(kind, rules.CANDIDATE_STAGE["applied"])
    iv = await latest_interview(db, app.id)
    interview = StatusInterview(slots=await available_slots(db, iv, app.interviewers or []),
                                duration_min=iv.duration_min, location=iv.location,
                                chosen=iso(iv.chosen)) \
        if iv is not None and iv.slots and app.status == "active" else None
    return StatusOut(reference=app.reference, application_state=app.status,
                     withdrawal_notice_version=rules.WITHDRAWAL_NOTICE_VERSION,
                     withdrawal_notice=rules.withdrawal_notice(app.retention_months or company.retention_months),
                     can_withdraw=app.status == "active" and app.email_confirmed_at is not None,
                     withdrawn_at=_aware(app.stage_changed_at) if app.status == "withdrawn" else None,
                     company=StatusCompany(name=company.name, logo_url=logo_url(company), slug=company.slug),
                     job_title=job.title, job_url=public_url(company, job), stage_label=label, stage_detail=detail,
                     applied_at=_aware(app.created_at) or now(), email_confirmed=app.email_confirmed_at is not None,
                     experience_invited=await db.get(BizExperienceInvite, app.id) is not None,
                     interview=interview, deletion_requested=app.deletion_requested_at is not None)


@public_router.get("/applications/{token}", response_model=StatusOut)
async def application_status(token: str, request: Request,
                             db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    app, job, company = await _by_token(db, token, request)
    return await _status(db, app, job, company)


@public_router.post("/applications/{token}/confirm", response_model=StatusOut)
async def confirm_email(token: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    app, job, company = await _by_token(db, token, request)
    if app.email_confirmed_at is None:
        app.email_confirmed_at = now()
        timeline(db, app, "email_confirmed")
        await db.commit()
    return await _status(db, app, job, company)


class BookIn(BaseModel):
    slot: str = Field(max_length=40)


@public_router.post("/applications/{token}/book", response_model=StatusOut)
async def book(token: str, body: BookIn, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    from orbit_api.business.access import lock_company
    from orbit_api.business.scheduling import available_slots, booking_writes

    app, job, company = await _by_token(db, token, request)
    if company.status == "suspended" or app.deletion_requested_at is not None:
        raise HTTPException(403, "This application is not accepting interview bookings.")
    ratelimit.check(booking_writes, f"biz-book:{app.status_token_hash}")
    await lock_company(db, company.id)
    await db.refresh(app)
    await db.refresh(company)
    if company.status == "suspended":
        raise HTTPException(403, "This application is not accepting interview bookings.")
    if app.deletion_requested_at is not None:
        raise HTTPException(409, "This application is not accepting interview bookings.")
    iv = await latest_interview(db, app.id)
    if iv is None or app.status != "active":
        raise HTTPException(409, "There's no interview to book.")
    if body.slot not in iv.slots:
        raise HTTPException(422, "Pick one of the times offered.")
    when = datetime.fromisoformat(body.slot.replace("Z", "+00:00"))
    if iv.chosen is not None and _aware(iv.chosen) == when:
        return await _status(db, app, job, company)  # A retried response does not send duplicate invitations.
    if body.slot not in await available_slots(db, iv, app.interviewers or []):
        raise HTTPException(409, "That time is no longer available for the interview panel. Pick another time.")
    if when <= now():
        raise HTTPException(422, "That time has passed. Ask the team for new times.")
    first = iv.chosen is None
    from orbit_api.business.coordination import close_on_booking

    await close_on_booking(db, app, iv)
    iv.chosen = when
    iv.revision += 1
    if app.email_confirmed_at is None:
        app.email_confirmed_at = now()  # the link came to their inbox
    timeline(db, app, "interview_booked", None, slot=body.slot)
    await db.commit()
    cal = emails.ics(uid=iv.id, start=when, minutes=iv.duration_min,
                     summary=f"Interview: {job.title} at {company.name}",
                     description=f"Interview for {job.title} at {company.name}.", location=iv.location,
                     organizer=iv.reply_to, sequence=iv.revision)
    when_text = when.strftime("%A %d %B %Y, %H:%M UTC")
    await emails.send_to_applicant(
        company, app, f"Interview booked: {job.title}, {when_text}",
        f"Hi {app.name.split()[0] if app.name else 'there'},\n\nYou're booked for {when_text} ({iv.duration_min} "
        f"minutes){' — changed from your earlier pick' if not first else ''}.\nWhere: {iv.location}\n\nThe calendar "
        "file is attached.", iv.reply_to, attachments=(("interview.ics", "text/calendar", cal),))
    if iv.reply_to:
        await send_safely(OutgoingEmail(
            to=iv.reply_to, subject=f"{rules.candidate_label(app.reference)} booked {when_text} for {job.title}",
            text=f"An applicant for {job.title} picked {when_text}. Open the application in Orbit for Business to "
                 "see who.", attachments=(("interview.ics", "text/calendar", cal),),
            footer="Sent by Orbit for Business."))
    return await _status(db, app, job, company)


@public_router.post("/applications/{token}/delete-request", response_model=StatusOut)
async def delete_request(token: str, request: Request,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    """The applicant asks for their application to be deleted. It's flagged at the top of the pipeline and the
    company's admins are told; deleting it is the company's click (and is logged)."""
    app, job, company = await _by_token(db, token, request)
    from orbit_api.business.access import lock_company

    await lock_company(db, company.id)
    await db.refresh(app)
    if app.deletion_requested_at is None:
        app.deletion_requested_at = now()
        timeline(db, app, "deletion_requested")
        audit(db, company.id, None, "application.deletion_requested", app.reference, job_id=job.id)
        await db.commit()
        admins = (await db.scalars(select(User.email).join(BizMember, BizMember.user_id == User.id).where(
            BizMember.company_id == company.id, BizMember.role.in_(("owner", "admin"))))).all()
        for to in admins:
            await send_safely(OutgoingEmail(
                to=to, subject=f"{rules.candidate_label(app.reference)} asked for their application to be deleted",
                text=f"An applicant for {job.title} asked for their data to be deleted. Delete it from the "
                     f"application in Orbit for Business: {get_settings().web_url.rstrip('/')}/business/app/"
                     f"{company.id}/applications/{app.id}\n\nIf it isn't deleted before then, Orbit deletes it "
                     f"automatically {rules.DELETION_DAYS} days after the request, with a reminder to you a week "
                     "and a day before.",
                footer="Sent by Orbit for Business."))
    return await _status(db, app, job, company)
