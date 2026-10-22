"""Orbit Apply's API: `/v1/apply/...` (docs/PROTOCOL.md, "Orbit Apply").

For the web app (a full sign-in):
- `GET/PUT /setup`: the setup (resume, facts, filters, mode, limit, quiet hours, consent), with the quota.
- `GET/PUT /bank`: the answer bank.
- `POST /plan`: plan now (the sweeper also plans every few hours).
- `GET /packets?group=`, `GET /packets/{id}`, its `screenshot` and `resume.pdf`; `POST /packets/{id}/answers`,
  `/approve`, `/dont-apply`, `/retry`, `/done` (applied by hand); `POST /pause`, `/resume`.

For the executor (the extension, or the Windows app; an extension-scoped token works, auth/security.py):
- `GET /next`: 204 when nothing is due, else the packet, leased for 15 minutes.
- `POST /{id}/result`: what happened.
- `GET /status`: today's count and limit, paused, when the next is due.
- `GET /{id}/resume.pdf?exp=&sig=`: the tailored resume, by the short-lived signed link in the packet.

And for the admin, `GET/PUT /v1/admin/apply/sites`: the per-site kill switch.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.admin.routes import require_admin
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user, decode_claims, token_from_request
from orbit_api.auto_apply import bank, handoff, pacing, packets, planner, quota, rules
from orbit_api.auto_apply import coverage as coverage_mod
from orbit_api.auto_apply.pacing import aware
from orbit_api.auto_apply.pdf import resume_pdf
from orbit_api.auto_apply.setup import Facts, Filters, Mode, QuietHours, WorkAuth
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.job_portal.profile import resume_hash, years_of_experience
from orbit_api.models import (
    AnswerBankEntry,
    ApplicationPacket,
    ApplyProof,
    ApplySiteState,
    AuditLog,
    AutoApplySetup,
    BizApplication,
    CareerPlaybook,
    JobApplication,
    ProviderRequest,
    Resume,
    User,
)
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.schema import ResumeData
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/apply", tags=["apply"])
admin_router = APIRouter(prefix="/v1/admin/apply", tags=["admin"])
read_limit = Depends(limit_user("apply-read", rate_per_s=3, burst=60))
write_limit = Depends(limit_user("apply-write", rate_per_s=1, burst=30))
# Preparing applications: per job from a job page or the tracker, so generous; the plan quota caps real cost.
plan_limit = Depends(limit_user("apply-plan", rate_per_s=120 / 3600, burst=30))
executor_limit = Depends(limit_user("apply-executor", rate_per_s=1, burst=30))
SIGNED_URL_S = 15 * 60


# ---- setup -------------------------------------------------------------------------------------------------------


class ResumeRef(BaseModel):
    id: str
    title: str


class MasterResume(ResumeRef):
    approved: bool  # approved, and unchanged since
    approved_at: datetime | None
    changed_since: bool  # approved once, edited since


class QuotaOut(BaseModel):
    plan: str
    included: int
    used: int
    credits: int
    left: int
    trial: bool  # the Free plan's applications, once per account


class Caps(BaseModel):
    max_daily_limit: int = rules.MAX_DAILY_LIMIT
    default_daily_limit: int = rules.DEFAULT_DAILY_LIMIT
    per_company: int = rules.PER_COMPANY_LIMIT
    per_company_days: int = rules.PER_COMPANY_WINDOW.days
    max_fresh_days: int = rules.MAX_FRESH_DAYS
    min_threshold: int = rules.MIN_THRESHOLD
    free_trial: int = rules.FREE_TRIAL_APPLICATIONS


class SetupOut(BaseModel):
    configured: bool  # consented: Orbit may apply
    consent_at: datetime | None
    consent_text: str = rules.CONSENT_TEXT
    consent_version: str = rules.CONSENT_VERSION
    ai_line_text: str = rules.AI_LINE
    mode: Mode
    daily_limit: int
    threshold: int
    ai_line: bool
    paused: bool
    # When the browser extension (auto-apply switched on there) last asked for work; None: never. Nothing is sent
    # without it.
    executor_seen_at: datetime | None = None
    execution: Literal["browser", "hosted"] = "browser"
    stop_when_hired: bool = True
    hosted_enabled: bool = False
    hosted_online: bool = False
    hosted_seen_at: datetime | None = None
    hosted_consent_at: datetime | None = None
    hosted_consent_text: str = rules.HOSTED_CONSENT
    hosted_sites: list[str] = Field(default_factory=lambda: list(rules.ATS_SUPPORTED))
    quiet_hours: QuietHours | None
    tz_offset_min: int
    resume: MasterResume | None
    resumes: list[ResumeRef]
    facts: Facts
    facts_suggested: bool  # filled in from the resume, not saved yet
    filters: Filters
    profile_titles: list[str]  # Jobs AI's titles, what empty title filters mean
    quota: QuotaOut
    caps: Caps = Field(default_factory=Caps)


class SetupIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)
    approve_resume: bool = False
    facts: Facts
    filters: Filters = Field(default_factory=Filters)
    mode: Mode = "automatic"
    daily_limit: int = Field(rules.DEFAULT_DAILY_LIMIT, ge=1, le=rules.MAX_DAILY_LIMIT)
    threshold: int = Field(rules.DEFAULT_THRESHOLD, ge=rules.MIN_THRESHOLD, le=95)
    ai_line: bool = True
    quiet_hours: QuietHours | None = None
    tz_offset_min: int = Field(0, ge=-14 * 60, le=14 * 60)
    consent: bool = False
    execution: Literal["browser", "hosted"] = "browser"
    stop_when_hired: bool = True
    hosted_consent: bool = False


def _link(links: list[tuple[str, str]], needle: str) -> str:
    return next((u for label, u in links if needle in label.lower() or needle in u.lower()), "")


def suggest_facts(user: User, data: ResumeData | None) -> Facts:
    """The facts as the resume gives them, for the candidate to confirm. Work authorisation and salary stay empty:
    only the candidate can state those."""
    if data is None:
        first, _, last = (user.name or "").partition(" ")
        return Facts(first_name=first, last_name=last.strip(), email=user.email, country=user.country or "")
    b = data.basics
    first, _, last = (b.name or user.name or "").strip().partition(" ")
    links = [(link.label, link.url) for link in b.links]
    linkedin, github = _link(links, "linkedin"), _link(links, "github")
    website = next((u for _, u in links if u and u not in (linkedin, github)), "")
    role = next((e for e in data.experience if e.current), data.experience[0] if data.experience else None)
    years = years_of_experience(data)
    return Facts(first_name=first, last_name=last.strip(), email=b.email or user.email, phone=b.phone,
                 city=(b.location or "").split(",")[0].strip()[:80], country=user.country or "",
                 linkedin=linkedin, github=github, website=website,
                 current_company=role.company if role else "", current_title=role.title if role else "",
                 years_experience=round(years, 1) if years else None,
                 highest_degree=data.education[0].degree if data.education else "")


async def _resumes(db: AsyncSession, user: User) -> list[Resume]:
    return list((await db.scalars(select(Resume).where(Resume.user_id == user.id)
                                  .order_by(Resume.updated_at.desc()))).all())


async def _setup_out(db: AsyncSession, user: User, setup: AutoApplySetup | None) -> SetupOut:
    from orbit_api.auto_apply import hosted
    from orbit_api.job_portal.routes import _profile

    resumes = await _resumes(db, user)
    master = None
    data: ResumeData | None = None
    if setup is not None:
        resume, data, approved = await planner.master_resume(db, setup)
        if resume is not None:
            master = MasterResume(id=resume.id, title=resume.title, approved=approved,
                                  approved_at=aware(setup.resume_approved_at),
                                  changed_since=bool(setup.resume_hash) and not approved)
    if data is None and resumes:
        _, _, best = await _profile(db, user)
        best = best or resumes[0]
        data = ResumeData.model_validate(best.data or {})
    saved = setup is not None and bool(setup.profile)
    facts = Facts.model_validate(setup.profile) if saved and setup is not None else suggest_facts(user, data)
    _, prefs, _ = await _profile(db, user)
    q = await quota.quota(db, user)
    s = setup or AutoApplySetup(user_id=user.id, mode="automatic", daily_limit=rules.DEFAULT_DAILY_LIMIT,
                                threshold=rules.DEFAULT_THRESHOLD, ai_line=True, paused=False, tz_offset_min=0)
    return SetupOut(
        configured=bool(setup and setup.consent_at and setup.consent_version == rules.CONSENT_VERSION),
        consent_at=aware(setup.consent_at) if setup else None,
        mode="review" if s.mode == "review" else "automatic", daily_limit=pacing.daily_limit(s),
        threshold=s.threshold or rules.DEFAULT_THRESHOLD, ai_line=bool(s.ai_line), paused=bool(s.paused),
        executor_seen_at=aware(s.executor_seen_at),
        execution="hosted" if s.execution == "hosted" else "browser", hosted_enabled=hosted.enabled(),
        stop_when_hired=s.stop_when_hired if s.stop_when_hired is not None else True,
        hosted_online=await hosted.online(db), hosted_seen_at=aware(s.hosted_seen_at),
        hosted_consent_at=aware(s.hosted_consent_at),
        quiet_hours=QuietHours(start=s.quiet_start, end=s.quiet_end)
        if s.quiet_start is not None and s.quiet_end is not None else None,
        tz_offset_min=s.tz_offset_min or 0, resume=master,
        resumes=[ResumeRef(id=r.id, title=r.title) for r in resumes], facts=facts, facts_suggested=not saved,
        filters=Filters.model_validate(s.filters or {}), profile_titles=prefs.titles,
        quota=QuotaOut(plan=q.plan, included=q.included, used=q.used, credits=q.credits, left=q.left, trial=q.trial))


@router.get("/setup", response_model=SetupOut, dependencies=[read_limit])
async def get_setup(user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> SetupOut:
    return await _setup_out(db, user, await db.get(AutoApplySetup, user.id))


@router.put("/setup", response_model=SetupOut, dependencies=[write_limit])
async def save_setup(body: SetupIn, request: Request, user: Annotated[User, Depends(require_verified_email)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> SetupOut:
    from orbit_api.auth.routes import _ip

    await lock_account(db, user.id)
    setup = await db.get(AutoApplySetup, user.id)
    if setup is None:
        setup = AutoApplySetup(user_id=user.id)
        db.add(setup)
        # Applications sent for you get their follow-up reminder too: a 7-day follow-up rule and an interview-eve
        # email, unless the candidate already chose their own workflow rules.
        if await db.get(CareerPlaybook, user.id) is None:
            db.add(CareerPlaybook(user_id=user.id, follow_up_days=7, interview_eve_email=True))
    if body.resume_id is not None:
        resume = await db.get(Resume, body.resume_id)
        if resume is None or resume.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
        if body.resume_id != setup.resume_id:
            setup.resume_id, setup.resume_hash, setup.resume_approved_at = resume.id, None, None
        if body.approve_resume:
            setup.resume_hash = resume_hash(ResumeData.model_validate(resume.data or {}))
            setup.resume_approved_at = datetime.now(UTC)
    setup.profile = body.facts.model_dump(mode="json")
    setup.filters = body.filters.model_dump(mode="json")
    setup.mode, setup.daily_limit, setup.threshold = body.mode, body.daily_limit, body.threshold
    setup.ai_line = body.ai_line
    setup.quiet_start = body.quiet_hours.start if body.quiet_hours else None
    setup.quiet_end = body.quiet_hours.end if body.quiet_hours else None
    setup.tz_offset_min = body.tz_offset_min
    setup.stop_when_hired = body.stop_when_hired
    if body.execution == "hosted" and body.consent:
        from orbit_api.auto_apply.hosted import enabled

        if not enabled():
            raise HTTPException(422, "Hosted applying is not enabled on this deployment yet. "
                                     "Orbit will prepare applications for you to send.")
        if not user.email_verified:
            raise HTTPException(403, "Verify your email before enabling hosted applications.")
        if not body.hosted_consent and setup.hosted_consent_at is None:
            raise HTTPException(422, "Authorise hosted applying before turning it on.")
        if setup.hosted_consent_at is None:
            setup.hosted_consent_at = datetime.now(UTC)
            db.add(AuditLog(user_id=user.id, action="apply.hosted_consent", ip=_ip(request)))
    setup.execution = body.execution
    if not body.consent or body.execution == "browser":
        setup.agent_mode = False
        if setup.hosted_consent_at is not None:
            db.add(AuditLog(user_id=user.id, action="apply.hosted_consent_withdrawn", ip=_ip(request)))
        setup.hosted_consent_at = None
    if body.consent and (setup.consent_at is None or setup.consent_version != rules.CONSENT_VERSION):
        if not setup.resume_id or not setup.resume_hash:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "Approve the resume Orbit Apply should use before you turn it on.")
        if not (body.facts.first_name and body.facts.email):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add your name and email first.")
        setup.consent_at, setup.consent_version = datetime.now(UTC), rules.CONSENT_VERSION
        setup.campaign_started_at = setup.consent_at
        db.add(AuditLog(user_id=user.id, action="apply.consent", ip=_ip(request), target=rules.CONSENT_VERSION))
    elif not body.consent and setup.consent_at is not None:
        setup.consent_at = None
        db.add(AuditLog(user_id=user.id, action="apply.consent_withdrawn", ip=_ip(request)))
    await db.flush()
    await packets.refresh_waiting(db, user)
    await db.commit()
    return await _setup_out(db, user, setup)


# ---- hosted AI form agent ----------------------------------------------------------------------------------------


class AgentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool


@router.get("/agent", dependencies=[read_limit])
async def agent_state(user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    from orbit_api.auto_apply.form_agent import KIND

    setup = await db.get(AutoApplySetup, user.id)
    used = await db.scalar(select(func.count()).select_from(ProviderRequest).where(
        ProviderRequest.user_id == user.id, ProviderRequest.request_type == KIND,
        ProviderRequest.created_at >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)))
    recent = (await db.scalars(select(ApplicationPacket).where(ApplicationPacket.user_id == user.id,
        ApplicationPacket.agent_decisions.is_not(None)).order_by(ApplicationPacket.updated_at.desc()).limit(20))).all()
    return {"enabled": bool(setup and setup.agent_mode), "used_today": used or 0, "daily_allowance": 5,
        "applications": [{"id": p.id, "title": p.title, "company": p.company, "status": p.status,
            "decisions": [{k: v for k, v in e.items() if k != "key"} for e in p.agent_decisions or []]}
            for p in recent]}


@router.put("/agent", dependencies=[write_limit])
async def set_agent(body: AgentIn, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, bool]:
    from orbit_api.auto_apply.hosted import authorised

    await lock_account(db, user.id)
    setup = await db.get(AutoApplySetup, user.id, populate_existing=True)
    if body.enabled and not await authorised(db, user, setup):
        raise HTTPException(409, "Configure hosted applying, approve your resume and resume applying first.")
    if setup is not None and bool(setup.agent_mode) != body.enabled:
        setup.agent_mode = body.enabled
        db.add(AuditLog(user_id=user.id, action="apply.agent_enabled" if body.enabled else "apply.agent_disabled"))
    await db.commit()
    return {"enabled": body.enabled}


# ---- the bank ----------------------------------------------------------------------------------------------------


class BankItem(BaseModel):
    norm: str  # what to send back to change it
    key: str  # a seed's key, or "custom"
    label: str
    kind: str
    value: str
    default: str  # what Orbit answers when the value is empty ("" for nothing: the question stops and asks)
    group: Literal["legal", "eeo", "yours", "custom"]
    help: str = ""


class BankIn(BaseModel):
    norm: str = Field(max_length=200)
    value: str = Field(max_length=bank.MAX_ANSWER)
    label: str = Field("", max_length=500)


SETUP_SEEDS = [s for s in bank.SEEDS if s.eeo or (s.legal and not s.derived and not s.per_company)
               or (not s.derived and not s.legal)]


async def _bank_out(db: AsyncSession, user: User) -> list[BankItem]:
    rows = {r.norm: r for r in (await db.scalars(select(AnswerBankEntry).where(
        AnswerBankEntry.user_id == user.id))).all()}
    out = []
    for s in SETUP_SEEDS:
        r = rows.pop(s.key, None)
        out.append(BankItem(norm=s.key, key=s.key, label=s.label, kind=s.kind, value=r.value if r else "",
                            default=s.default, group="eeo" if s.eeo else "legal" if s.legal else "yours",
                            help=s.help))
    for r in sorted(rows.values(), key=lambda r: r.label.lower()):
        out.append(BankItem(norm=r.norm, key=r.key, label=r.label, kind=r.kind, value=r.value, default="",
                            group="custom", help="Saved from a form that asked it."
                            + (" Used for that company only." if "@" in r.norm else "")))
    return out


@router.get("/bank", response_model=list[BankItem], dependencies=[read_limit])
async def get_bank(user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> list[BankItem]:
    return await _bank_out(db, user)


@router.put("/bank", response_model=list[BankItem], dependencies=[write_limit])
async def save_bank(body: list[BankIn], user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> list[BankItem]:
    if len(body) > 200:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "At most 200 answers at a time.")
    for item in body:
        seed = bank.SEED_BY_KEY.get(item.norm.split("@", 1)[0])
        existing = await db.scalar(select(AnswerBankEntry).where(AnswerBankEntry.user_id == user.id,
                                                                 AnswerBankEntry.norm == item.norm))
        if seed is None and existing is None and not item.label:
            continue  # a custom answer is made from a form's question, with its label
        label = item.label or (existing.label if existing else seed.label if seed else item.norm)
        await packets.save_answer(db, user.id, norm=item.norm, label=label,
                                  kind=seed.kind if seed else existing.kind if existing else "text",
                                  value=item.value, legal=bool(seed and seed.legal))
    await db.flush()
    await packets.refresh_waiting(db, user)
    await db.commit()
    return await _bank_out(db, user)


# ---- planning and packets ----------------------------------------------------------------------------------------


class SkipOut(BaseModel):
    listing_id: str
    title: str
    company: str
    reason: str


class PlanOut(BaseModel):
    created: int
    considered: int
    blocked: str | None
    skipped: list[SkipOut]


class ShortlistIn(BaseModel):
    listing_ids: list[str] = Field(min_length=1, max_length=20)


@router.post("/plan-shortlist", response_model=PlanOut, dependencies=[plan_limit])
async def plan_shortlist(body: ShortlistIn, user: Annotated[User, Depends(require_verified_email)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> PlanOut:
    selected = set(body.listing_ids)
    if any(len(i) > 36 for i in selected):
        raise HTTPException(422, "Choose saved jobs from your tracker.")
    saved = set(await db.scalars(select(JobApplication.listing_id).where(
        JobApplication.user_id == user.id, JobApplication.status == "saved",
        JobApplication.listing_id.in_(selected))))
    if saved != selected:
        raise HTTPException(404, "Some jobs are no longer in your saved shortlist. Refresh your tracker.")
    report = await planner.plan_for_user(db, user, listing_ids=selected)
    return PlanOut(created=report.created, considered=report.considered, blocked=report.blocked,
                   skipped=[SkipOut(**vars(s)) for s in report.skipped])


@router.post("/plan", response_model=PlanOut, dependencies=[plan_limit])
async def plan_now(user: Annotated[User, Depends(require_verified_email)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> PlanOut:
    report = await planner.plan_for_user(db, user)
    return PlanOut(created=report.created, considered=report.considered, blocked=report.blocked,
                   skipped=[SkipOut(**vars(s)) for s in report.skipped])


class PacketSummary(BaseModel):
    id: str
    listing_id: str
    status: str
    group: str
    ats: str
    site: str | None
    company: str
    title: str
    url: str
    apply_url: str
    match_score: int
    match_reason: str
    reason: str
    missing: int
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None
    has_proof: bool
    submission_uncertain: bool = False


class PacketDetail(PacketSummary):
    posting_text: str | None = None
    employer_status_path: str | None
    resume_title: str
    resume_diff: list[dict[str, Any]]
    cover_letter: str | None
    fields: dict[str, Any]
    answers: list[dict[str, Any]]
    missing_questions: list[dict[str, Any]]
    unknown_questions: list[dict[str, Any]]
    form_source: str
    result_status: str | None
    result_reason: str | None
    confirmation_text: str | None
    final_url: str | None
    submitted: dict[str, Any] | None
    screenshot_url: str | None
    resume_pdf_url: str
    tracker_id: str | None


def _has_proof(p: ApplicationPacket, screenshot: bool) -> bool:
    """A submission's proof: the site's own confirmation text and page address (the extension can't always take a
    screenshot, and sends none then), and the screenshot when there is one."""
    return screenshot or (p.status == "submitted" and bool(p.confirmation_text or p.final_url))


def _summary(p: ApplicationPacket, has_proof: bool) -> dict[str, Any]:
    return dict(id=p.id, listing_id=p.listing_id, status=p.status, group=packets.GROUP_OF.get(p.status, "prepared"),
                ats=p.ats, site=p.site, company=p.company, title=p.title, url=p.url, apply_url=p.apply_url,
                match_score=p.match_score, match_reason=p.match_reason, reason=p.reason,
                missing=len(p.missing or []), created_at=aware(p.created_at), updated_at=aware(p.updated_at),
                submitted_at=aware(p.submitted_at), has_proof=has_proof,
                submission_uncertain=p.submission_started_at is not None and p.status not in ("submitted", "applied"))


async def _detail(db: AsyncSession, p: ApplicationPacket) -> PacketDetail:
    proof = await db.get(ApplyProof, p.id)
    # A prepared packet can belong to an already saved job before any submission links it.
    # Resolve context by owned listing; this GET never creates or marks an application as sent.
    tracker_id = await db.scalar(select(JobApplication.id).where(
        JobApplication.user_id == p.user_id, JobApplication.listing_id == p.listing_id))
    status_path = None
    if p.ats == "orbit" and p.status == "submitted":
        from orbit_api.business.emails import status_token_for
        app_id = (p.submitted_payload or {}).get("business_application_id")
        app = await db.get(BizApplication, app_id) if isinstance(app_id, str) else None
        if app is not None and app.user_id == p.user_id and app.job_id == p.job_ref:
            token = status_token_for(app)
            status_path = f"/application/{token}" if token else None
    return PacketDetail(
        employer_status_path=status_path,
        **_summary(p, _has_proof(p, proof is not None)), resume_title=p.resume_title, resume_diff=p.resume_diff or [],
        cover_letter=p.cover_letter, posting_text=p.posting_text, fields=p.fields or {}, answers=p.answers or [],
        missing_questions=p.missing or [], unknown_questions=p.unknown_questions or [], form_source=p.form_source,
        result_status=p.result_status, result_reason=p.result_reason, confirmation_text=p.confirmation_text,
        final_url=p.final_url, submitted=p.submitted_payload,
        screenshot_url=f"/v1/apply/packets/{p.id}/screenshot" if proof is not None else None,
        resume_pdf_url=f"/v1/apply/packets/{p.id}/resume.pdf", tracker_id=tracker_id)


@router.get("/coverage", response_model=coverage_mod.Coverage, dependencies=[read_limit])
async def apply_coverage(user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> coverage_mod.Coverage:
    """Which tracked jobs Orbit can send, and what the rest need (coverage.py)."""
    return await coverage_mod.coverage(db, user.id)


@router.get("/packets", response_model=list[PacketSummary], dependencies=[read_limit])
async def list_packets(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                       group: Annotated[packets.Group | None, Query()] = None) -> list[PacketSummary]:
    await pacing.expire(db, datetime.now(UTC), user.id)
    await handoff.hand_off_unsendable(db, datetime.now(UTC), user.id)
    await db.commit()
    q = select(ApplicationPacket).where(ApplicationPacket.user_id == user.id)
    if group is not None:
        q = q.where(ApplicationPacket.status.in_(packets.GROUPS[group]))
    rows = (await db.scalars(q.order_by(ApplicationPacket.updated_at.desc()).limit(300))).all()
    proofs = set((await db.scalars(select(ApplyProof.packet_id).where(
        ApplyProof.packet_id.in_([p.id for p in rows])))).all()) if rows else set()
    return [PacketSummary(**_summary(p, _has_proof(p, p.id in proofs))) for p in rows]


@router.get("/packets/{packet_id}", response_model=PacketDetail, dependencies=[read_limit])
async def get_packet(packet_id: str, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    return await _detail(db, await packets.owned(db, user, packet_id))


@router.get("/packets/{packet_id}/screenshot", dependencies=[read_limit])
async def packet_screenshot(packet_id: str, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    p = await packets.owned(db, user, packet_id)
    proof = await db.get(ApplyProof, p.id)
    if proof is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No screenshot for this application.")
    return Response(proof.png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


def _filename(name: str) -> str:
    clean = re.sub(r"[^\w .-]", "", name).strip() or "Resume"
    return f"{clean[:60]} - Resume.pdf"


def _pdf_response(p: ApplicationPacket) -> Response:
    data = ResumeData.model_validate(p.resume_data or {})
    name = (p.fields or {}).get("full_name") or data.basics.name or "Resume"
    return Response(resume_pdf(data), media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{_filename(str(name))}"', "Cache-Control": "private, no-store"})


@router.get("/packets/{packet_id}/resume.pdf", dependencies=[read_limit])
async def packet_resume(packet_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    return _pdf_response(await packets.owned(db, user, packet_id))


class AnswersIn(BaseModel):
    answers: list[packets.GivenAnswer] = Field(max_length=50)


@router.post("/packets/{packet_id}/answers", response_model=PacketDetail, dependencies=[write_limit])
async def answer_packet(packet_id: str, body: AnswersIn, user: Annotated[User, Depends(require_verified_email)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    p = await packets.owned(db, user, packet_id)
    await packets.answer_missing(db, user, p, body.answers)
    await db.commit()
    return await _detail(db, p)


async def _move(db: AsyncSession, user: User, packet_id: str, allowed: tuple[str, ...], to: str,
                reason: str = "") -> PacketDetail:
    await lock_account(db, user.id)
    p = await packets.owned(db, user, packet_id)
    if p.status not in allowed:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Can't do that to an application that's {p.status}.")
    if to == "ready" and p.missing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Answer its open questions first.")
    p.status, p.reason = to, reason
    if to == "ready":
        now = datetime.now(UTC)
        p.not_before = now
        p.expires_at = max(aware(p.expires_at) or now, now + rules.PACKET_TTL)
        p.result_status = p.result_reason = None
        p.result_at = None
        p.hosted_token = p.submission_started_at = None
    await db.commit()
    return await _detail(db, p)


@router.post("/packets/{packet_id}/approve", response_model=PacketDetail, dependencies=[write_limit])
async def approve_packet(packet_id: str, user: Annotated[User, Depends(require_verified_email)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    return await _move(db, user, packet_id, ("review",), "ready")


@router.post("/packets/{packet_id}/dont-apply", response_model=PacketDetail, dependencies=[write_limit])
async def dont_apply(packet_id: str, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    return await _move(db, user, packet_id, ("needs_answer", "review", "ready", "needs_you", "handoff", "failed",
                                             "expired"), "cancelled", "You chose not to apply.")


class RetryIn(BaseModel):
    confirm_not_submitted: bool = False


@router.post("/packets/{packet_id}/retry", response_model=PacketDetail, dependencies=[write_limit])
async def retry_packet(packet_id: str, user: Annotated[User, Depends(require_verified_email)],
                       body: RetryIn | None = None, *,
                       db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    await lock_account(db, user.id)
    p = await packets.owned(db, user, packet_id)
    if p.status not in ("needs_you", "failed", "expired", "skipped", "cancelled"):
        raise HTTPException(409, "This application cannot be retried now.")
    if p.submission_started_at is not None and not (body and body.confirm_not_submitted):
        raise HTTPException(409, "Check the employer first and confirm this application was not submitted.")
    setup = await db.get(AutoApplySetup, user.id)
    if (setup and setup.execution == "hosted" and p.approval_fingerprint != planner.approval_fingerprint(
            setup, await planner.load_bank(db, user.id))):
        p.submission_started_at = None  # The candidate confirmed the previous attempt was not submitted above.
        await planner.rebuild_packet(db, user, setup, p)
        await db.commit()
        return await _detail(db, p)
    if p.missing:
        raise HTTPException(409, "Answer its open questions first.")
    if setup and setup.mode == "review":
        p.status, p.reason = "review", "Ready for your review"
        p.hosted_token = p.submission_started_at = None
        p.result_at = p.result_status = p.result_reason = None
        await db.commit()
        return await _detail(db, p)
    return await _move(db, user, packet_id, ("needs_you", "failed", "expired", "skipped", "cancelled"), "ready")


@router.post("/packets/{packet_id}/done", response_model=PacketDetail, dependencies=[write_limit])
async def done_by_hand(packet_id: str, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> PacketDetail:
    """The candidate finished it themselves (a hand-off, or after a captcha): on the tracker, never charged."""
    p = await packets.owned(db, user, packet_id)
    if p.status not in ("needs_you", "handoff", "needs_answer", "failed", "review", "ready"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Can't do that to an application that's {p.status}.")
    p.status, p.reason, p.submitted_at = "applied", "You applied yourself.", datetime.now(UTC)
    await packets.track_applied(db, user, p, by_orbit=False)
    await db.commit()
    return await _detail(db, p)


class PauseOut(BaseModel):
    paused: bool


async def _pause(db: AsyncSession, user: User, paused: bool) -> PauseOut:
    await lock_account(db, user.id)
    setup = await db.get(AutoApplySetup, user.id)
    if setup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set up Orbit Apply first.")
    if not paused and setup.paused:
        setup.campaign_started_at = datetime.now(UTC)
    setup.paused = paused
    await db.commit()
    return PauseOut(paused=paused)


@router.post("/pause", response_model=PauseOut, dependencies=[write_limit])
async def pause(user: Annotated[User, Depends(current_user)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> PauseOut:
    return await _pause(db, user, True)


@router.post("/resume", response_model=PauseOut, dependencies=[write_limit])
async def resume(user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> PauseOut:
    return await _pause(db, user, False)


# ---- the executor ------------------------------------------------------------------------------------------------


def _signature(packet_id: str, exp: int) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"apply-resume:{packet_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:40]


def signed_resume_url(request: Request, packet_id: str, now: float | None = None) -> str:
    exp = int((now or time.time()) + SIGNED_URL_S)
    base = (get_settings().api_public_url or str(request.base_url)).rstrip("/")
    return f"{base}/v1/apply/{packet_id}/resume.pdf?exp={exp}&sig={_signature(packet_id, exp)}"


class JobOut(BaseModel):
    url: str
    apply_url: str
    ats: Literal["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable", "recruitee"]
    company: str
    title: str


class ResumeFile(BaseModel):
    filename: str
    download_url: str  # signed, 15 minutes, a PDF


class ExecutorAnswer(BaseModel):
    question_id: str | None
    label: str
    kind: str
    value: str | list[str]
    source: Literal["bank", "profile", "generated"]
    required: bool = False
    options: list[str] | None = None


class ExecutorPacket(BaseModel):
    """The executor contract (docs/PROTOCOL.md, packages/types autoApply.ts)."""

    id: str
    job: JobOut
    resume: ResumeFile
    cover_letter: str | None
    fields: dict[str, str]
    answers: list[ExecutorAnswer]
    eeo: Literal["decline", "as_answered"]
    not_before: datetime
    expires_at: datetime
    lease_expires_at: datetime


def _eeo(p: ApplicationPacket) -> Literal["decline", "as_answered"]:
    seeds = [bank.seed_for(str(a.get("label", ""))) for a in p.answers or []]
    eeo_values = [a for a, s in zip(p.answers or [], seeds, strict=True) if s is not None and s.eeo]
    return "as_answered" if any(not bank._DECLINE_RE.search(str(a.get("value"))) for a in eeo_values) else "decline"


def lease_holder(request: Request) -> str:
    """The device asking: its session id (an extension's connect makes one, auth/devices.py), "" without one."""
    token = token_from_request(request)
    claims = decode_claims(token) if token else None
    sid = claims.get("sid") if claims else None
    return sid[:64] if isinstance(sid, str) else ""


def from_executor(request: Request) -> bool:
    """A bearer token (the extension, the Windows app), not the web app's cookie."""
    return request.headers.get("authorization", "").lower().startswith("bearer ")


async def seen(db: AsyncSession, user: User, now: datetime) -> None:
    """Notes that an executor asked (at most once a minute, so the setup's row isn't written on every poll)."""
    setup = await db.get(AutoApplySetup, user.id)
    last = aware(setup.executor_seen_at) if setup is not None else None
    if setup is not None and (last is None or now - last > rules.MIN_GAP):
        setup.executor_seen_at = now


@router.get("/next", response_model=ExecutorPacket, dependencies=[executor_limit],
            responses={204: {"description": "Nothing is due"}})
async def next_packet(request: Request, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    setup = await db.get(AutoApplySetup, user.id)
    if setup and setup.execution == "hosted":
        return Response(status_code=204, headers={"X-Orbit-Apply-Why": "hosted"})
    due = await pacing.next_due(db, user, holder=lease_holder(request), allowed_ats=rules.BROWSER_ATS)
    if from_executor(request):
        await seen(db, user, datetime.now(UTC))
    await db.commit()
    p = due.packet
    if p is None:
        headers = {"X-Orbit-Apply-Why": due.why or "none"}
        if due.next_at is not None:
            headers["Retry-After"] = str(max(int((due.next_at - datetime.now(UTC)).total_seconds()), 1))
        return Response(status_code=status.HTTP_204_NO_CONTENT, headers=headers)
    return executor_packet(request, p)


def executor_packet(request: Request, p: ApplicationPacket) -> ExecutorPacket:
    name = (p.fields or {}).get("full_name") or "Resume"
    return ExecutorPacket(
        id=p.id, job=JobOut(url=p.url, apply_url=p.apply_url, ats=p.ats, company=p.company, title=p.title),
        resume=ResumeFile(filename=_filename(str(name)), download_url=signed_resume_url(request, p.id)),
        cover_letter=p.cover_letter, fields={k: str(v or "") for k, v in (p.fields or {}).items()},
        answers=[ExecutorAnswer.model_validate(a) for a in p.answers or []], eeo=_eeo(p),
        not_before=aware(p.not_before) or datetime.now(UTC), expires_at=aware(p.expires_at) or datetime.now(UTC),
        lease_expires_at=aware(p.lease_until) or datetime.now(UTC))


@router.get("/{packet_id}/resume.pdf")
async def signed_resume(packet_id: str, db: Annotated[AsyncSession, Depends(get_db)],
                        exp: Annotated[int, Query()], sig: Annotated[str, Query(max_length=64)]) -> Response:
    """The tailored resume by its signed link: no session needed (the link is the permission), 15 minutes."""
    if exp < time.time() or not hmac.compare_digest(sig, _signature(packet_id, exp)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That link has expired.")
    p = await db.get(ApplicationPacket, packet_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return _pdf_response(p)


@router.post("/{packet_id}/result", response_model=packets.ResultOut, dependencies=[executor_limit])
async def post_result(packet_id: str, body: packets.ResultIn, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> packets.ResultOut:
    from orbit_api.auto_apply.notify import notify

    await lock_account(db, user.id)
    p = await packets.owned(db, user, packet_id)
    if p.hosted_token:
        raise HTTPException(409, "This application belongs to the hosted worker.")
    out = await packets.record_result(db, user, p, body)
    await db.commit()
    if out.status in ("needs_you",) and await notify(db, user):
        await db.commit()
    return out


class StatusOut(BaseModel):
    configured: bool
    paused: bool
    today: int  # submitted today (the candidate's own day) and in hand
    limit: int
    next_due_at: datetime | None
    why_not: str | None  # what's holding the next one: quiet_hours | daily_limit | pacing | no_quota | ...
    ready: int  # prepared and waiting to go
    needs_you: int
    quota_left: int
    sites_paused: list[str]
    executor_seen_at: datetime | None = None  # when an executor last asked for work (see SetupOut)


@router.get("/status", response_model=StatusOut, dependencies=[executor_limit])
async def apply_status(request: Request, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    now = datetime.now(UTC)
    await pacing.expire(db, now, user.id)
    if from_executor(request):
        await seen(db, user, now)
    await db.commit()
    setup = await db.get(AutoApplySetup, user.id)
    counts: dict[str, int] = {str(s): int(n) for s, n in (await db.execute(
        select(ApplicationPacket.status, func.count()).where(ApplicationPacket.user_id == user.id)
        .group_by(ApplicationPacket.status))).all()}
    paused_sites = await pacing.paused_sites(db, now)
    q = await quota.quota(db, user, now)
    why, next_at = None, None
    if setup is None or setup.consent_at is None:
        why = "not_set_up"
    elif setup.paused:
        why = "paused"
    elif (until := pacing.quiet_until(setup, now)) is not None:
        why, next_at = "quiet_hours", until
    elif setup is not None and await pacing.today_count(db, user.id, setup, now) >= pacing.daily_limit(setup):
        why = "daily_limit"
    elif q.left <= 0:
        why = "no_quota"
    if why is None and counts.get("ready"):
        first = await db.scalar(select(func.min(ApplicationPacket.not_before)).where(
            ApplicationPacket.user_id == user.id, ApplicationPacket.status == "ready"))
        next_at = max(aware(first) or now, now)
    return StatusOut(
        configured=bool(setup and setup.consent_at), paused=bool(setup and setup.paused),
        today=await pacing.today_count(db, user.id, setup, now) if setup else 0,
        limit=pacing.daily_limit(setup) if setup else rules.DEFAULT_DAILY_LIMIT, next_due_at=next_at, why_not=why,
        ready=int(counts.get("ready", 0)),
        needs_you=sum(counts.get(s, 0) for s in packets.GROUPS["needs_you"]), quota_left=q.left,
        sites_paused=sorted(paused_sites), executor_seen_at=aware(setup.executor_seen_at) if setup else None)


# ---- admin: the per-site kill switch -----------------------------------------------------------------------------


class SiteOut(BaseModel):
    site: str
    admin_paused: bool
    auto_paused_until: datetime | None
    reason: str
    recent: int  # results in the last day
    bad: int  # of those: captcha, blocked or failed


class SiteIn(BaseModel):
    paused: bool
    reason: str = Field("", max_length=300)
    clear_auto: bool = False  # lift an automatic pause


async def _sites(db: AsyncSession) -> list[SiteOut]:
    now = datetime.now(UTC)
    out = []
    for site in rules.ATS_SUPPORTED:
        state = await db.get(ApplySiteState, site)
        rows = (await db.execute(select(ApplicationPacket.result_status, ApplicationPacket.result_reason).where(
            ApplicationPacket.ats == site, ApplicationPacket.result_at >= now - rules.KILL_LOOKBACK))).all()
        bad = sum(1 for s, r in rows if s == "failed" or r in rules.BAD_REASONS)
        out.append(SiteOut(site=site, admin_paused=bool(state and state.admin_paused),
                           auto_paused_until=aware(state.auto_paused_until) if state else None,
                           reason=state.reason if state else "", recent=len(rows), bad=bad))
    return out


@admin_router.get("/sites", response_model=list[SiteOut])
async def admin_sites(_: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> list[SiteOut]:
    return await _sites(db)


@admin_router.put("/sites/{site}", response_model=list[SiteOut])
async def admin_set_site(site: str, body: SiteIn, admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> list[SiteOut]:
    if site not in rules.ATS_SUPPORTED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown site")
    state = await db.get(ApplySiteState, site)
    if state is None:
        state = ApplySiteState(site=site)
        db.add(state)
    state.admin_paused = body.paused
    state.reason = body.reason or ("Paused by Orbit." if body.paused else "")
    if body.clear_auto:
        state.auto_paused_until = None
    db.add(AuditLog(user_id=admin.id, action="admin.apply_site", target=f"{site} paused={body.paused}"))
    await db.commit()
    return await _sites(db)


__all__ = ["WorkAuth", "admin_router", "router"]
