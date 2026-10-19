"""The company workspace: creating a company, verifying it, members and invites, the plan, email templates,
notifications, the audit log. Routes are under /v1/business (docs/PROTOCOL.md, "Orbit for Business")."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from orbit_api import ratelimit
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.business import emails, rules
from orbit_api.business.access import CompanyCtx, Ctx, audit, forbidden, lock_company
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.uploads import validate_image
from orbit_api.models import (
    BizApplication,
    BizAudit,
    BizCompany,
    BizInvite,
    BizJob,
    BizMember,
    BizNotification,
    BizTemplate,
    User,
)
from orbit_api.providers.email import OutgoingEmail, mask_email, send_safely

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/business", tags=["business"])
public_router = APIRouter(prefix="/v1/public/business", tags=["business-public"])

MAX_OWNED = 3
INVITE_DAYS = 14
CODE_MINUTES = 30
CODE_TRIES = 5
LOGO_MAX_BYTES = 1024 * 1024
_code_sends = ratelimit.SlidingWindow(rate_per_s=5 / 3600, burst=5)  # work-email codes per company
_dns_checks = ratelimit.SlidingWindow(rate_per_s=30 / 3600, burst=10)
_invites = ratelimit.SlidingWindow(rate_per_s=30 / 3600, burst=20)
_creates = ratelimit.SlidingWindow(rate_per_s=5 / 86400, burst=5)

Size = Literal["1-10", "11-50", "51-200", "201-1000", "1000+"]
RoleIn = Literal["admin", "recruiter", "hiring_manager", "interviewer"]


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


def now() -> datetime:
    return datetime.now(UTC)


def effective_plan(company: BizCompany) -> str:
    """The plan in force: a granted plan whose time ran out is Free again (nothing already open is closed)."""
    until = _aware(company.plan_until)
    if company.plan != "free" and until is not None and until <= now():
        return "free"
    return company.plan if company.plan in rules.PLANS else "free"


def limit_error(limit: str, plan: str) -> HTTPException:
    p = rules.PLANS[plan]
    what = f"{p.jobs} active job{'s' if p.jobs != 1 else ''}" if limit == "jobs" else \
        f"{p.seats} seat{'s' if p.seats != 1 else ''}"
    return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail={
        "code": "biz_limit", "limit": limit, "plan": plan,
        "message": f"The {p.label} plan includes {what}. Upgrade the plan to add more."})


async def seats_used(db: AsyncSession, company_id: str) -> int:
    members = await db.scalar(select(func.count()).select_from(BizMember).where(BizMember.company_id == company_id))
    invites = await db.scalar(select(func.count()).select_from(BizInvite).where(
        BizInvite.company_id == company_id, BizInvite.accepted_at.is_(None), BizInvite.expires_at > now()))
    return int(members or 0) + int(invites or 0)


async def active_jobs(db: AsyncSession, company_id: str) -> int:
    n = await db.scalar(select(func.count()).select_from(BizJob).where(
        BizJob.company_id == company_id, BizJob.status.in_(("open", "paused"))))
    return int(n or 0)


def logo_url(company: BizCompany) -> str | None:
    if not company.logo_type:
        return None
    s = get_settings()
    base = (s.api_public_url or f"{s.web_url.rstrip('/')}/api").rstrip("/")
    return f"{base}/v1/public/business/companies/{company.slug}/logo?v={company.logo_version}"


def careers_url(company: BizCompany) -> str:
    return f"{get_settings().web_url.rstrip('/')}/company/{company.slug}"


# ---- models --------------------------------------------------------------------------------------------------------


class Permissions(BaseModel):
    manage_company: bool
    manage_members: bool
    manage_plan: bool
    manage_jobs: bool
    all_jobs: bool
    move_applicants: bool
    delete_applicants: bool
    view_audit: bool
    scorecards_only: bool


class CompanySummary(BaseModel):
    id: str
    slug: str
    name: str
    logo_url: str | None
    role: str
    verified: bool
    status: str
    plan: str


class InviteSummary(BaseModel):
    id: str
    company_name: str
    role: str
    invited_by: str | None
    expires_at: datetime


class MeOut(BaseModel):
    companies: list[CompanySummary]
    invites: list[InviteSummary]


class CompanyOut(BaseModel):
    id: str
    slug: str
    name: str
    website: str
    domain: str
    logo_url: str | None
    size: str
    country: str
    about: str
    status: str
    suspended_reason: str | None
    verified: bool
    verified_at: datetime | None
    verification_method: str | None
    plan: str
    plan_until: datetime | None
    retention_months: int
    blind_review: bool
    careers_url: str
    created_at: datetime
    role: str
    permissions: Permissions


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    website: str = Field(min_length=3, max_length=300)
    size: Size = "1-10"
    country: str = Field("IN", min_length=2, max_length=2)
    about: str = Field("", max_length=4000)


class CompanyPatch(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    website: str | None = Field(None, min_length=3, max_length=300)
    size: Size | None = None
    country: str | None = Field(None, min_length=2, max_length=2)
    about: str | None = Field(None, max_length=4000)
    retention_months: int | None = Field(None, ge=1, le=48)
    blind_review: bool | None = None


def company_out(c: BizCompany, role: str) -> CompanyOut:
    return CompanyOut(
        id=c.id, slug=c.slug, name=c.name, website=c.website, domain=c.domain, logo_url=logo_url(c), size=c.size,
        country=c.country, about=c.about or "", status=c.status, suspended_reason=c.suspended_reason,
        verified=c.verified_at is not None, verified_at=_aware(c.verified_at),
        verification_method=c.verification_method,
        plan=effective_plan(c), plan_until=_aware(c.plan_until), retention_months=c.retention_months,
        blind_review=c.blind_review, careers_url=careers_url(c), created_at=_aware(c.created_at) or now(), role=role,
        permissions=Permissions(**rules.permissions(role)))


SLUG_TRIES = 5


async def _unique_slug(db: AsyncSession, name: str, taken_by: str | None = None, suffix: str = "") -> str:
    base = rules.slugify(name, 54) + (f"-{suffix}" if suffix else "")
    slug, n = base, 2
    while True:
        owner = await db.scalar(select(BizCompany.id).where(BizCompany.slug == slug))
        if owner is None or owner == taken_by:
            return slug
        slug, n = f"{base}-{n}", n + 1


# ---- the workspace -------------------------------------------------------------------------------------------------


@router.get("/me", response_model=MeOut)
async def me(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)]) -> MeOut:
    rows = (await db.execute(select(BizCompany, BizMember.role).join(BizMember, BizMember.company_id == BizCompany.id)
                             .where(BizMember.user_id == user.id).order_by(BizCompany.name))).all()
    companies = [CompanySummary(id=c.id, slug=c.slug, name=c.name, logo_url=logo_url(c), role=role,
                                verified=c.verified_at is not None, status=c.status, plan=effective_plan(c))
                 for c, role in rows]
    invites: list[InviteSummary] = []
    if user.email_verified:
        pending = (await db.execute(select(BizInvite, BizCompany.name)
                                    .join(BizCompany, BizCompany.id == BizInvite.company_id)
                                    .where(BizInvite.email == user.email.lower(), BizInvite.accepted_at.is_(None),
                                           BizInvite.expires_at > now()))).all()
        for inv, cname in pending:
            inviter = await db.get(User, inv.invited_by) if inv.invited_by else None
            invites.append(InviteSummary(id=inv.id, company_name=cname, role=inv.role,
                                         invited_by=(inviter.name or inviter.email) if inviter else None,
                                         expires_at=_aware(inv.expires_at) or now()))
    return MeOut(companies=companies, invites=invites)


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(body: CompanyIn, user: Annotated[User, Depends(require_verified_email)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> CompanyOut:
    ratelimit.check(_creates, f"biz-create:{user.id}")
    try:
        domain = rules.domain_of(body.website)
    except rules.DomainError as e:
        raise HTTPException(422, str(e)) from e
    owned = await db.scalar(select(func.count()).select_from(BizMember).where(BizMember.user_id == user.id,
                                                                             BizMember.role == "owner"))
    if int(owned or 0) >= MAX_OWNED:
        raise HTTPException(409, f"An account can own up to {MAX_OWNED} companies.")
    website = body.website.strip()
    if "://" not in website:
        website = "https://" + website
    name = rules.one_line(body.name)
    if len(name) < 2:
        raise HTTPException(422, "Add the company's name.")
    slug = await _unique_slug(db, name)
    for attempt in range(SLUG_TRIES):
        company = BizCompany(slug=slug, name=name, website=website[:300],
                             domain=domain, size=body.size, country=body.country.upper(), about=body.about.strip(),
                             dns_token=secrets.token_hex(16), created_by=user.id)
        try:
            async with db.begin_nested():  # another company took the slug at the same moment: try the next one
                db.add(company)
                await db.flush()
            break
        except IntegrityError:
            if attempt == SLUG_TRIES - 1:
                raise HTTPException(409, "Couldn't save the company just now. Try again.") from None
            slug = await _unique_slug(db, name, suffix=secrets.token_hex(2))
    db.add(BizMember(company_id=company.id, user_id=user.id, role="owner"))
    audit(db, company.id, user, "company.created", company.name, domain=domain)
    await db.commit()
    return company_out(company, "owner")


@router.get("/companies/{company_id}", response_model=CompanyOut)
async def get_company(ctx: CompanyCtx) -> CompanyOut:
    return company_out(ctx.company, ctx.role)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
async def update_company(body: CompanyPatch, ctx: CompanyCtx,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> CompanyOut:
    ctx.require("manage_company")
    ctx.writable()
    c = ctx.company
    changed: dict[str, Any] = {}
    if body.website is not None and body.website.strip() != c.website:
        try:
            domain = rules.domain_of(body.website)
        except rules.DomainError as e:
            raise HTTPException(422, str(e)) from e
        website = body.website.strip()
        c.website = (website if "://" in website else "https://" + website)[:300]
        if domain != c.domain:  # a new domain has to be proven again
            open_jobs = await db.scalar(select(func.count()).select_from(BizJob).where(
                BizJob.company_id == c.id, BizJob.status == "open"))
            if open_jobs:
                # Its open jobs were published under the proven domain: they'd stay live, "verified", under the new one.
                raise HTTPException(409, "Pause or close your open jobs before you change the company's website "
                                         "domain. The new domain has to be verified again.")
            c.domain, c.verified_at, c.verification_method = domain, None, None
            c.dns_token = secrets.token_hex(16)
            # A code sent for the old domain must not verify the new one.
            c.email_code_hash = c.email_code_to = c.email_code_until = None
            c.email_code_tries = 0
            changed["domain"] = domain
    if body.name is not None and rules.one_line(body.name) != c.name:
        if len(rules.one_line(body.name)) < 2:
            raise HTTPException(422, "Add the company's name.")
        c.name = rules.one_line(body.name)
        changed["name"] = c.name
    for field in ("size", "about", "retention_months", "blind_review"):
        value = getattr(body, field)
        if value is not None and value != getattr(c, field):
            setattr(c, field, value.strip() if isinstance(value, str) else value)
            changed[field] = value if field != "about" else "(changed)"
    if "retention_months" in changed:
        # Each application keeps the retention it was given when the person applied (the notice said it): the new
        # setting applies to applications made from now on.
        changed["applies_to"] = "new applications"
    if body.country is not None:
        c.country = body.country.upper()
    if changed:
        audit(db, c.id, ctx.user, "company.updated", c.name, **changed)
    await db.commit()
    return company_out(c, ctx.role)


@router.put("/companies/{company_id}/logo", response_model=CompanyOut)
async def put_logo(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)],
                   file: Annotated[UploadFile, File()]) -> CompanyOut:
    ctx.require("manage_company")
    ctx.writable()
    data = await file.read(LOGO_MAX_BYTES + 1)
    if len(data) > LOGO_MAX_BYTES:
        raise HTTPException(413, "The logo can be up to 1 MB.")
    try:
        media = validate_image(data, file.content_type)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    ctx.company.logo, ctx.company.logo_type = data, media
    ctx.company.logo_version = (ctx.company.logo_version or 0) + 1
    audit(db, ctx.company.id, ctx.user, "company.logo", ctx.company.name)
    await db.commit()
    return company_out(ctx.company, ctx.role)


@router.delete("/companies/{company_id}/logo", response_model=CompanyOut)
async def delete_logo(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> CompanyOut:
    ctx.require("manage_company")
    ctx.writable()
    ctx.company.logo, ctx.company.logo_type = None, None
    ctx.company.logo_version = (ctx.company.logo_version or 0) + 1
    await db.commit()
    return company_out(ctx.company, ctx.role)


@public_router.get("/companies/{slug}/logo")
async def public_logo(slug: str, db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    row = (await db.execute(select(BizCompany.logo, BizCompany.logo_type).where(
        BizCompany.slug == slug, BizCompany.status == "active"))).first()
    if row is None or not row[0] or not row[1]:
        raise HTTPException(404, "Not found.")
    return Response(bytes(row[0]), media_type=row[1], headers={"Cache-Control": "public, max-age=86400"})


# ---- verification --------------------------------------------------------------------------------------------------


class DnsOut(BaseModel):
    type: Literal["TXT"] = "TXT"
    host: str
    value: str


class VerificationOut(BaseModel):
    verified: bool
    method: str | None
    domain: str
    blocked_domain: bool
    account_email_matches: bool
    dns: DnsOut
    pending_email: str | None


def dns_value(c: BizCompany) -> str:
    return f"orbit-verify={c.dns_token}"


def _verification(c: BizCompany, user: User) -> VerificationOut:
    pending = c.email_code_to if c.email_code_hash and (_aware(c.email_code_until) or now()) > now() else None
    return VerificationOut(
        verified=c.verified_at is not None, method=c.verification_method, domain=c.domain,
        blocked_domain=rules.blocked_domain(c.domain),
        account_email_matches=user.email_verified and rules.email_matches_domain(user.email, c.domain),
        dns=DnsOut(host=c.domain, value=dns_value(c)), pending_email=mask_email(pending) if pending else None)


def _mark_verified(db: AsyncSession, ctx: Ctx, method: str, **detail: Any) -> None:
    c = ctx.company
    c.verified_at, c.verification_method = now(), method
    c.email_code_hash = c.email_code_to = c.email_code_until = None
    c.email_code_tries = 0
    audit(db, c.id, ctx.user, "company.verified", c.domain, method=method, **detail)


def _refuse_blocked(c: BizCompany) -> None:
    if rules.blocked_domain(c.domain):
        raise HTTPException(422, detail={
            "code": "biz_blocked_domain",
            "message": f"{c.domain} is a free email or hosting domain, so it can't prove a company. Use the company's "
                       "own website domain."})


@router.get("/companies/{company_id}/verification", response_model=VerificationOut)
async def verification(ctx: CompanyCtx) -> VerificationOut:
    return _verification(ctx.company, ctx.user)


@router.post("/companies/{company_id}/verification/account", response_model=VerificationOut)
async def verify_by_account(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> VerificationOut:
    ctx.require("manage_company")
    ctx.writable()
    _refuse_blocked(ctx.company)
    if not (ctx.user.email_verified and rules.email_matches_domain(ctx.user.email, ctx.company.domain)):
        raise HTTPException(422, f"Your Orbit email isn't a verified address at {ctx.company.domain}.")
    _mark_verified(db, ctx, "email", email=mask_email(ctx.user.email))
    await db.commit()
    return _verification(ctx.company, ctx.user)


class WorkEmailIn(BaseModel):
    email: EmailStr


@router.post("/companies/{company_id}/verification/email", response_model=VerificationOut)
async def send_work_email_code(body: WorkEmailIn, ctx: CompanyCtx,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> VerificationOut:
    ctx.require("manage_company")
    ctx.writable()
    _refuse_blocked(ctx.company)
    address = str(body.email).strip().lower()
    if not rules.email_matches_domain(address, ctx.company.domain):
        raise HTTPException(422, f"Use an email address at {ctx.company.domain} itself (not a subdomain). A company "
                                 "whose mail is on a subdomain verifies with a DNS record.")
    ratelimit.check(_code_sends, f"biz-code:{ctx.company.id}", "Too many codes sent. Try again in an hour.")
    code = f"{secrets.randbelow(10**6):06d}"
    c = ctx.company
    c.email_code_to, c.email_code_hash = address, _code_digest(c, address, code)
    c.email_code_until, c.email_code_tries = now() + timedelta(minutes=CODE_MINUTES), 0
    await db.commit()
    await send_safely(OutgoingEmail(
        to=address, subject=f"Your Orbit code to verify {c.name}: {code}",
        text=f"{ctx.actor_name} is verifying {c.name} on Orbit for Business with this address.\n\n"
             f"Code: {code}\n\nIt works for {CODE_MINUTES} minutes. If you didn't expect this, ignore this email: "
             "nothing is verified without the code.",
        footer="Sent by Orbit for Business to check that this company's domain is real."))
    return _verification(c, ctx.user)


def _code_digest(c: BizCompany, address: str, code: str) -> str:
    """A code proves one address at one domain: changing either afterwards leaves it worthless."""
    return rules.digest(f"{c.id}:{c.domain}:{address}:{code}")


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


@router.post("/companies/{company_id}/verification/email/confirm", response_model=VerificationOut)
async def confirm_work_email(body: CodeIn, ctx: CompanyCtx,
                             db: Annotated[AsyncSession, Depends(get_db)]) -> VerificationOut:
    ctx.require("manage_company")
    ctx.writable()
    c = ctx.company
    _refuse_blocked(c)
    if not c.email_code_hash or (_aware(c.email_code_until) or now()) <= now() or c.email_code_tries >= CODE_TRIES:
        raise HTTPException(400, "That code has expired. Send a new one.")
    address = c.email_code_to or ""
    if not rules.email_matches_domain(address, c.domain):
        raise HTTPException(400, "That code has expired. Send a new one.")
    c.email_code_tries += 1
    if not secrets.compare_digest(c.email_code_hash, _code_digest(c, address, body.code.strip())):
        await db.commit()
        raise HTTPException(400, "That code isn't right.")
    _mark_verified(db, ctx, "email", email=mask_email(c.email_code_to or ""))
    await db.commit()
    return _verification(c, ctx.user)


DOH_URL = "https://cloudflare-dns.com/dns-query"


async def txt_records(name: str) -> list[str]:
    """TXT records for `name` over DNS-over-HTTPS (no resolver library needed). [] when there are none or the lookup
    fails."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(DOH_URL, params={"name": name, "type": "TXT"},
                                 headers={"accept": "application/dns-json"})
        answers = r.json().get("Answer") or []
    except (httpx.HTTPError, ValueError):
        log.warning("DNS TXT lookup for %s failed", name)
        return []
    out = []
    for a in answers:
        if a.get("type") == 16 and isinstance(a.get("data"), str):
            out.append("".join(part for part in a["data"].split('"') if part.strip()))
    return out


@router.post("/companies/{company_id}/verification/dns", response_model=VerificationOut)
async def verify_by_dns(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> VerificationOut:
    ctx.require("manage_company")
    ctx.writable()
    _refuse_blocked(ctx.company)
    ratelimit.check(_dns_checks, f"biz-dns:{ctx.company.id}")
    want = dns_value(ctx.company)
    for name in (ctx.company.domain, f"_orbit-verify.{ctx.company.domain}"):
        if any(r.strip() == want for r in await txt_records(name)):
            _mark_verified(db, ctx, "dns", record=name)
            await db.commit()
            return _verification(ctx.company, ctx.user)
    raise HTTPException(422, detail={"code": "biz_dns_missing", "message": (
        f"No TXT record {want} on {ctx.company.domain} yet. DNS changes can take a few minutes to an hour.")})


# ---- members and invites -------------------------------------------------------------------------------------------


class MemberOut(BaseModel):
    id: str
    user_id: str
    name: str | None
    email: str
    role: str
    joined_at: datetime
    you: bool


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    invited_by: str | None
    created_at: datetime
    expires_at: datetime


class MembersOut(BaseModel):
    members: list[MemberOut]
    invites: list[InviteOut]
    seats_used: int
    seats: int


async def _members_out(db: AsyncSession, ctx: Ctx) -> MembersOut:
    rows = (await db.execute(select(BizMember, User).join(User, User.id == BizMember.user_id)
                             .where(BizMember.company_id == ctx.company.id).order_by(BizMember.created_at))).all()
    names = {u.id: (u.name or u.email) for _, u in rows}
    members = [MemberOut(id=m.id, user_id=u.id, name=u.name, email=u.email, role=m.role,
                         joined_at=_aware(m.created_at) or now(), you=u.id == ctx.user.id) for m, u in rows]
    invites = [] if not ctx.can("manage_members") else [
        InviteOut(id=i.id, email=i.email, role=i.role, invited_by=names.get(i.invited_by or ""),
                  created_at=_aware(i.created_at) or now(), expires_at=_aware(i.expires_at) or now())
        for i in (await db.scalars(select(BizInvite).where(
            BizInvite.company_id == ctx.company.id, BizInvite.accepted_at.is_(None), BizInvite.expires_at > now())
            .order_by(BizInvite.created_at))).all()]
    plan = rules.PLANS[effective_plan(ctx.company)]
    return MembersOut(members=members, invites=invites, seats_used=await seats_used(db, ctx.company.id),
                      seats=plan.seats)


@router.get("/companies/{company_id}/members", response_model=MembersOut)
async def list_members(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    return await _members_out(db, ctx)


class InviteIn(BaseModel):
    email: EmailStr
    role: RoleIn


@router.post("/companies/{company_id}/invites", response_model=MembersOut, status_code=201)
async def invite(body: InviteIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    ctx.require("manage_members")
    ctx.writable()
    if body.role == "admin" and ctx.role != "owner":
        raise forbidden("Only the owner can invite admins.")
    email = str(body.email).strip().lower()
    already = await db.scalar(select(BizMember.id).join(User, User.id == BizMember.user_id).where(
        BizMember.company_id == ctx.company.id, func.lower(User.email) == email))
    if already is not None:
        raise HTTPException(409, "They're already a member.")
    ratelimit.check(_invites, f"biz-invite:{ctx.company.id}")
    await lock_company(db, ctx.company.id)  # two invites at once can't both take the last seat
    existing = await db.scalar(select(BizInvite).where(BizInvite.company_id == ctx.company.id, BizInvite.email == email,
                                                      BizInvite.accepted_at.is_(None), BizInvite.expires_at > now()))
    plan = effective_plan(ctx.company)
    if existing is None and await seats_used(db, ctx.company.id) >= rules.PLANS[plan].seats:
        raise limit_error("seats", plan)
    raw = rules.token()
    if existing is not None:  # inviting again sends a fresh link (and the old one stops working)
        existing.token_hash, existing.role = rules.digest(raw), body.role
        existing.expires_at = now() + timedelta(days=INVITE_DAYS)
    else:
        db.add(BizInvite(company_id=ctx.company.id, email=email, role=body.role, token_hash=rules.digest(raw),
                         invited_by=ctx.user.id, expires_at=now() + timedelta(days=INVITE_DAYS)))
    audit(db, ctx.company.id, ctx.user, "member.invited", mask_email(email), role=body.role)
    await db.commit()
    link = f"{get_settings().web_url.rstrip('/')}/business/invite/{raw}"
    await send_safely(OutgoingEmail(
        to=email, subject=f"{ctx.actor_name} invited you to {ctx.company.name} on Orbit for Business",
        text=f"{ctx.actor_name} invited you to join {ctx.company.name}'s hiring team on Orbit for Business as "
             f"{body.role.replace('_', ' ')}.\n\nAccept the invite (it works for {INVITE_DAYS} days):\n{link}\n\n"
             "Sign in or create an Orbit account with this email address to accept. Your own Orbit data (if you use "
             "Orbit to look for jobs) stays private: the company never sees it.",
        reply_to=ctx.user.email, footer="Sent by Orbit for Business on behalf of the person who invited you."))
    return await _members_out(db, ctx)


@router.delete("/companies/{company_id}/invites/{invite_id}", response_model=MembersOut)
async def cancel_invite(invite_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    ctx.require("manage_members")
    ctx.writable()
    inv = await db.get(BizInvite, invite_id)
    if inv is None or inv.company_id != ctx.company.id:
        raise HTTPException(404, "Not found.")
    await db.delete(inv)
    audit(db, ctx.company.id, ctx.user, "member.invite_cancelled", mask_email(inv.email))
    await db.commit()
    return await _members_out(db, ctx)


class InviteLookup(BaseModel):
    company_name: str
    company_logo_url: str | None
    role: str
    email_masked: str
    expired: bool
    accepted: bool


@public_router.get("/invites/{token}", response_model=InviteLookup)
async def lookup_invite(token: str, db: Annotated[AsyncSession, Depends(get_db)]) -> InviteLookup:
    inv = await db.scalar(select(BizInvite).where(BizInvite.token_hash == rules.digest(token)))
    company = await db.get(BizCompany, inv.company_id) if inv is not None else None
    if inv is None or company is None:
        raise HTTPException(404, "This invite link isn't valid. Ask for a new one.")
    return InviteLookup(company_name=company.name, company_logo_url=logo_url(company), role=inv.role,
                        email_masked=mask_email(inv.email), expired=(_aware(inv.expires_at) or now()) <= now(),
                        accepted=inv.accepted_at is not None)


class AcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@router.post("/invites/accept", response_model=CompanySummary)
async def accept_invite(body: AcceptIn, user: Annotated[User, Depends(require_verified_email)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> CompanySummary:
    inv = await db.scalar(select(BizInvite).where(BizInvite.token_hash == rules.digest(body.token)))
    if inv is None or inv.accepted_at is not None or (_aware(inv.expires_at) or now()) <= now():
        raise HTTPException(400, "This invite has expired or was already used. Ask for a new one.")
    if inv.email != user.email.strip().lower():
        raise HTTPException(403, detail={"code": "biz_invite_other_email", "message": (
            f"This invite is for {mask_email(inv.email)}. Sign in with that address to accept it.")})
    company = await db.get(BizCompany, inv.company_id)
    if company is None:
        raise HTTPException(404, "Not found.")
    # Claimed with a conditional UPDATE: of two accepts at once exactly one changes the row (Postgres waits on the
    # row lock, SQLite on its write lock); the other is told the link was used.
    claimed = await db.execute(update(BizInvite).where(BizInvite.id == inv.id, BizInvite.accepted_at.is_(None))
                               .values(accepted_at=now()).execution_options(synchronize_session=False))
    if getattr(claimed, "rowcount", 0) != 1:
        await db.rollback()
        raise HTTPException(400, "This invite has expired or was already used. Ask for a new one.")
    exists = await db.scalar(select(BizMember).where(BizMember.company_id == company.id, BizMember.user_id == user.id))
    if exists is None:
        db.add(BizMember(company_id=company.id, user_id=user.id, role=inv.role))
    audit(db, company.id, user, "member.joined", mask_email(user.email), role=inv.role)
    try:
        await db.commit()
    except IntegrityError as e:  # the same person joined at the same moment (another tab, a double click)
        await db.rollback()
        raise HTTPException(409, detail={"code": "biz_already_member",
                                         "message": "You're already a member of this company."}) from e
    role = exists.role if exists is not None else inv.role
    return CompanySummary(id=company.id, slug=company.slug, name=company.name, logo_url=logo_url(company), role=role,
                          verified=company.verified_at is not None, status=company.status,
                          plan=effective_plan(company))


class RoleChange(BaseModel):
    role: RoleIn


async def _member(db: AsyncSession, ctx: Ctx, member_id: str) -> BizMember:
    m = await db.get(BizMember, member_id)
    if m is None or m.company_id != ctx.company.id:
        raise HTTPException(404, "Not found.")
    return m


@router.patch("/companies/{company_id}/members/{member_id}", response_model=MembersOut)
async def change_role(member_id: str, body: RoleChange, ctx: CompanyCtx,
                      db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    ctx.require("manage_members")
    ctx.writable()
    m = await _member(db, ctx, member_id)
    if m.role == "owner":
        raise HTTPException(409, "The owner's role changes only by transferring ownership.")
    if (body.role == "admin" or m.role == "admin") and ctx.role != "owner":
        raise forbidden("Only the owner can make or change admins.")
    before, m.role = m.role, body.role
    audit(db, ctx.company.id, ctx.user, "member.role", m.user_id, before=before, after=body.role)
    await db.commit()
    return await _members_out(db, ctx)


@router.delete("/companies/{company_id}/members/{member_id}", response_model=MembersOut)
async def remove_member(member_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    ctx.require("manage_members")
    ctx.writable()
    m = await _member(db, ctx, member_id)
    if m.role == "owner":
        raise HTTPException(409, "The owner can't be removed. Transfer ownership first.")
    if m.role == "admin" and ctx.role != "owner":
        raise forbidden("Only the owner can remove an admin.")
    await db.delete(m)
    await drop_from_teams(db, ctx.company.id, m.user_id)
    audit(db, ctx.company.id, ctx.user, "member.removed", m.user_id, role=m.role)
    await db.commit()
    return await _members_out(db, ctx)


class TransferIn(BaseModel):
    member_id: str


@router.post("/companies/{company_id}/transfer", response_model=MembersOut)
async def transfer(body: TransferIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> MembersOut:
    if ctx.role != "owner":
        raise forbidden("Only the owner can transfer ownership.")
    ctx.writable()
    m = await _member(db, ctx, body.member_id)
    if m.id == ctx.member.id:
        raise HTTPException(409, "You're already the owner.")
    m.role, ctx.member.role = "owner", "admin"
    audit(db, ctx.company.id, ctx.user, "company.transferred", m.user_id)
    await db.commit()
    return await _members_out(db, ctx)


@router.post("/companies/{company_id}/leave", status_code=204)
async def leave(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    if ctx.role == "owner":
        raise HTTPException(409, "Transfer ownership before leaving.")
    await db.delete(ctx.member)
    await drop_from_teams(db, ctx.company.id, ctx.user.id)
    audit(db, ctx.company.id, ctx.user, "member.left", ctx.user.id)
    await db.commit()
    return Response(status_code=204)


# ---- plan ----------------------------------------------------------------------------------------------------------


class PlanInfo(BaseModel):
    id: str
    label: str
    jobs: int
    seats: int
    price_inr: int
    price_usd: int
    invite_only: bool


class PlanRequestOut(BaseModel):
    plan: str
    created_at: datetime


class Limits(BaseModel):
    jobs: int
    seats: int


class PlanStatus(BaseModel):
    plan: str
    plan_until: datetime | None
    active_jobs: int
    seats_used: int
    limits: Limits
    plans: list[PlanInfo]
    checkout: Literal["request"] = "request"
    pending_request: PlanRequestOut | None


async def _plan_status(db: AsyncSession, c: BizCompany) -> PlanStatus:
    plan = rules.PLANS[effective_plan(c)]
    pending = PlanRequestOut(plan=c.plan_request, created_at=_aware(c.plan_request_at) or now()) \
        if c.plan_request else None
    return PlanStatus(plan=plan.id, plan_until=_aware(c.plan_until) if plan.id != "free" else None,
                      active_jobs=await active_jobs(db, c.id), seats_used=await seats_used(db, c.id),
                      limits=Limits(jobs=plan.jobs, seats=plan.seats),
                      plans=[PlanInfo(**p.__dict__) for p in rules.PLANS.values()], pending_request=pending)


@router.get("/companies/{company_id}/plan", response_model=PlanStatus)
async def plan_status(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> PlanStatus:
    return await _plan_status(db, ctx.company)


class PlanRequestIn(BaseModel):
    plan: Literal["starter", "growth"]


@router.post("/companies/{company_id}/plan/request", response_model=PlanStatus)
async def request_plan(body: PlanRequestIn, ctx: CompanyCtx,
                       db: Annotated[AsyncSession, Depends(get_db)]) -> PlanStatus:
    ctx.require("manage_plan")
    ctx.writable()
    c = ctx.company
    c.plan_request, c.plan_request_at = body.plan, now()
    audit(db, c.id, ctx.user, "plan.requested", body.plan)
    await db.commit()
    admin = get_settings().admin_email
    if admin:
        await send_safely(OutgoingEmail(
            to=admin, subject=f"Orbit for Business: {c.name} asks for {rules.PLANS[body.plan].label}",
            text=f"{ctx.actor_name} ({ctx.user.email}) asked for the {rules.PLANS[body.plan].label} plan for "
                 f"{c.name} ({c.domain}).\n\nGrant it in the admin console: "
                 f"{get_settings().web_url.rstrip('/')}/admin/business",
            reply_to=ctx.user.email))
    return await _plan_status(db, c)


# ---- templates -----------------------------------------------------------------------------------------------------


class TemplateOut(BaseModel):
    kind: str
    subject: str
    body: str
    is_default: bool
    variables: list[str]


class TemplateIn(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)


@router.get("/companies/{company_id}/templates", response_model=list[TemplateOut])
async def list_templates(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> list[TemplateOut]:
    ctx.require("move_applicants")
    out = []
    for kind in emails.KINDS:
        subject, body, default = await emails.template(db, ctx.company.id, kind)
        out.append(TemplateOut(kind=kind, subject=subject, body=body, is_default=default, variables=emails.VARIABLES))
    return out


@router.put("/companies/{company_id}/templates/{kind}", response_model=TemplateOut)
async def put_template(kind: emails.TemplateKind, body: TemplateIn, ctx: CompanyCtx,
                       db: Annotated[AsyncSession, Depends(get_db)]) -> TemplateOut:
    if not (ctx.can("manage_company") or ctx.role == "recruiter"):
        raise forbidden()
    ctx.writable()
    subject = rules.one_line(body.subject)  # a subject is one line: no CR/LF (or other control characters) in it
    if not subject:
        raise HTTPException(422, "Write a subject.")
    row = await db.scalar(select(BizTemplate).where(BizTemplate.company_id == ctx.company.id, BizTemplate.kind == kind))
    if row is None:
        row = BizTemplate(company_id=ctx.company.id, kind=kind, subject=subject, body=body.body)
        db.add(row)
    else:
        row.subject, row.body = subject, body.body
    audit(db, ctx.company.id, ctx.user, "template.updated", kind)
    await db.commit()
    return TemplateOut(kind=kind, subject=row.subject, body=row.body, is_default=False, variables=emails.VARIABLES)


@router.delete("/companies/{company_id}/templates/{kind}", response_model=TemplateOut)
async def reset_template(kind: emails.TemplateKind, ctx: CompanyCtx,
                         db: Annotated[AsyncSession, Depends(get_db)]) -> TemplateOut:
    if not (ctx.can("manage_company") or ctx.role == "recruiter"):
        raise forbidden()
    ctx.writable()
    row = await db.scalar(select(BizTemplate).where(BizTemplate.company_id == ctx.company.id, BizTemplate.kind == kind))
    if row is not None:
        await db.delete(row)
        await db.commit()
    subject, text, _ = await emails.template(db, ctx.company.id, kind)
    return TemplateOut(kind=kind, subject=subject, body=text, is_default=True, variables=emails.VARIABLES)


# ---- notifications and the audit log -------------------------------------------------------------------------------


class NotificationOut(BaseModel):
    id: str
    company_id: str
    company_name: str
    kind: str
    text: str
    link: str
    read: bool
    created_at: datetime


@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> list[NotificationOut]:
    rows = (await db.execute(
        select(BizNotification, BizCompany.name).join(BizCompany, BizCompany.id == BizNotification.company_id)
        .join(BizMember, (BizMember.company_id == BizNotification.company_id) & (BizMember.user_id == user.id))
        .where(BizNotification.user_id == user.id).order_by(BizNotification.created_at.desc()).limit(100))).all()
    return [NotificationOut(id=n.id, company_id=n.company_id, company_name=cname, kind=n.kind, text=n.text,
                            link=f"/business/app/{n.company_id}/automations" if n.kind == "automation" else (
                                f"/business/app/{n.company_id}/applications/{n.application_id}"
                                if n.application_id else f"/business/app/{n.company_id}"),
                            read=n.read_at is not None, created_at=_aware(n.created_at) or now())
            for n, cname in rows]


class ReadIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=200)


@router.post("/notifications/read", status_code=204)
async def read_notifications(body: ReadIn, user: Annotated[User, Depends(current_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    q = update(BizNotification).where(BizNotification.user_id == user.id, BizNotification.read_at.is_(None))
    if body.ids:
        q = q.where(BizNotification.id.in_(body.ids))
    await db.execute(q.values(read_at=now()))
    await db.commit()
    return Response(status_code=204)


class AuditOut(BaseModel):
    id: str
    actor: str | None
    actor_id: str | None
    action: str
    target: str | None
    detail: dict[str, Any]
    created_at: datetime


@router.get("/companies/{company_id}/audit", response_model=list[AuditOut])
async def audit_log(ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)],
                    before: Annotated[datetime | None, Query()] = None,
                    limit: Annotated[int, Query(ge=1, le=200)] = 100) -> list[AuditOut]:
    ctx.require("view_audit")
    q = select(BizAudit).where(BizAudit.company_id == ctx.company.id)
    if before is not None:
        q = q.where(BizAudit.created_at < before)
    rows = (await db.scalars(q.order_by(BizAudit.created_at.desc()).limit(limit))).all()
    return [AuditOut(id=r.id, actor=r.actor_name, actor_id=r.actor_id, action=r.action, target=r.target,
                     detail=customer_detail(r.detail), created_at=_aware(r.created_at) or now()) for r in rows]


# Kept for Orbit's admins (admin.company_audit): they name the AI model, which customer screens never do (D82).
ADMIN_ONLY_DETAIL = frozenset({"model_version", "ranking_model"})


def customer_detail(detail: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (detail or {}).items() if k not in ADMIN_ONLY_DETAIL}


async def drop_from_teams(db: AsyncSession, company_id: str, user_id: str) -> None:
    """Someone left the company: their id comes off every job's hiring team and every application's interviewers
    (JSON lists), so nothing points at a person who's no longer a member."""
    for job in (await db.scalars(select(BizJob).where(BizJob.company_id == company_id))).all():
        if user_id in (job.hiring_team or []):
            job.hiring_team = [u for u in job.hiring_team if u != user_id]
    for app in (await db.scalars(select(BizApplication).where(BizApplication.company_id == company_id)
                                 .options(load_only(BizApplication.id, BizApplication.interviewers)))).all():
        if user_id in (app.interviewers or []):
            app.interviewers = [u for u in app.interviewers if u != user_id]


async def hand_over_on_account_deletion(db: AsyncSession, user_id: str) -> None:
    """The account is being deleted (auth/accounts.delete_account). Each company it owns passes to its longest-standing
    admin, else its longest-standing member, and the change is logged; a company with nobody else in it is deleted with
    it (its jobs, applicants and log go too: there's no one left to keep them for). Called in the deletion's
    transaction; the membership rows themselves go with the account (ON DELETE CASCADE)."""
    for company_id in (await db.scalars(select(BizMember.company_id).where(BizMember.user_id == user_id))).all():
        await drop_from_teams(db, company_id, user_id)
    owned = (await db.scalars(select(BizMember).where(BizMember.user_id == user_id, BizMember.role == "owner"))).all()
    for own in owned:
        others = (await db.scalars(select(BizMember).where(BizMember.company_id == own.company_id,
                                                           BizMember.user_id != user_id)
                                   .order_by(BizMember.created_at))).all()
        heir = next((m for m in others if m.role == "admin"), others[0] if others else None)
        if heir is None:
            await db.execute(delete(BizCompany).where(BizCompany.id == own.company_id))
            continue
        heir.role = "owner"
        audit(db, own.company_id, None, "company.owner_left", heir.user_id, reason="the owner deleted their account")
