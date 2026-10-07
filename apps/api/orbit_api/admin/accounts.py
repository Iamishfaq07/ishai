"""Admin: one account in full, and what the admin may do to it beyond access and credits (admin/routes.py).

- `GET /v1/admin/users/export`: the list, filtered, searched and sorted as on screen, as a CSV file.
- `GET /v1/admin/users/{id}`: everything about one account: profile, wallet, the full credit ledger, sessions, documents
  and resumes, Jobs AI, payments, its own security events, and every admin action taken on it.
- `PATCH /v1/admin/users/{id}`: name, "email verified", and the admin's private notes.
- `POST /v1/admin/users/{id}/credits/remove`: take resume credits and/or interview minutes away, with a reason. A
  balance never goes below zero: asking for more than is left takes what's there (and says so). "Set to zero" takes it
  all. Each removal is a ledger entry carrying the reason, so the account's history explains it.
- `POST /v1/admin/users/bulk-credits`: give the same credits to up to 100 accounts at once.
- `POST /v1/admin/users/{id}/suspend` · `/unsuspend`: a suspended account can't sign in or use the API
  (auth/security.current_user), its live sessions stop and every device is signed out; its owner is told why.
- `POST /v1/admin/users/{id}/sign-out`: sign the account out everywhere (auth/accounts.sign_out_everywhere).
- `POST /v1/admin/users/{id}/password-reset`: email the account the usual reset link.
- `DELETE /v1/admin/users/{id}`: delete the account, after typing its email (auth/accounts.delete_account, the same
  function the owner's own delete uses). Payments stay, without the account (docs/DECISIONS.md D45).

None of the destructive ones work on the admin account or on the acting admin. Every change writes an AuditLog row
whose target starts with the account's id (so the account's page can list them) and, for a delete, its email.
"""

import asyncio
import csv
import io
import math
from datetime import UTC, datetime, timedelta
from itertools import batched
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.admin.routes import (
    GIVEN,
    REMOVED,
    AdminNote,
    AdminUser,
    UserFilter,
    UserSort,
    admin_rows,
    credit_amount,
    credit_text,
    require_admin,
    users_query,
)
from orbit_api.auth import email_tokens
from orbit_api.auth.accounts import delete_account, end_live_sessions, sign_out_everywhere, stop_account_live
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.models import (
    AuditLog,
    CreditEntry,
    Document,
    JobApplication,
    JobFitCheck,
    JobSearchProfile,
    LiveSessionRow,
    Payment,
    Resume,
    Story,
    UsageEvent,
    User,
    Workspace,
)
from orbit_api.providers.email import OutgoingEmail, can_deliver, send_safely

router = APIRouter(prefix="/v1/admin", tags=["admin"])

EXPORT_MAX = 20_000
LEDGER_MAX = 500
# One adjustment at a time decides from the balance it read: two at once can't both take the same credits (one API
# instance, docs/DECISIONS.md D12).
_adjust_lock = asyncio.Lock()


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _one_line(text: str | None) -> str:
    return " ".join((text or "").split())


async def _account(db: AsyncSession, user_id: str) -> User:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return u


async def _is_admin_account(db: AsyncSession, u: User) -> bool:
    """The admin account, or the admin's address before it's verified: neither may be suspended, deleted or zeroed
    (whoever registered the address next would be the admin)."""
    return await is_admin(db, u) or get_settings().is_admin_email(u.email)


async def _guard(db: AsyncSession, u: User, admin: User, verb: str) -> None:
    if u.id == admin.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"You can't {verb} your own account.")
    if await _is_admin_account(db, u):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"That's the admin account: you can't {verb} it.")


# ---- the list as CSV -------------------------------------------------------------------------------------------

_CSV_COLUMNS = ("id", "email", "name", "joined", "email_verified", "access", "plan", "grant_until", "suspended",
                "resume_credits_left", "interview_minutes_left", "resume_given", "resume_used", "resume_removed",
                "interview_minutes_given", "interview_minutes_removed", "live_minutes_used", "mock_minutes_used",
                "sessions", "paid_inr", "packs", "last_active")


def _cell(value: Any) -> Any:
    """A spreadsheet must not run a name like "=HYPERLINK(...)" as a formula: text starting with = + - @ or a tab is
    prefixed with a quote. Numbers are left as numbers."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return _aware(value).isoformat(timespec="seconds")
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv_row(r: AdminUser) -> list[Any]:
    u = r.usage
    return [_cell(v) for v in (
        r.id, r.email, r.name, r.created_at, "yes" if r.email_verified else "no", r.access, r.plan_label,
        r.grant_until, r.suspended_at, r.resume_credits, r.interview_minutes_left, u.resume_given, u.resume_used,
        u.resume_removed, u.interview_minutes_given, u.interview_minutes_removed, u.live_minutes_used,
        u.mock_minutes_used, u.sessions, u.paid_inr, u.packs, u.last_active)]


@router.get("/users/export")
async def export_users(admin: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                       only: UserFilter = "all",
                       q: Annotated[str | None, Query(max_length=120)] = None,
                       sort: UserSort = "created",
                       order: Literal["asc", "desc"] = "desc") -> Response:
    """The accounts the list shows (same filter, search and order, every page), one row each, as CSV (UTF-8 with a
    BOM, so Excel reads names right). At most 20,000 rows."""
    users = list((await db.scalars(users_query(only, q, sort, order).limit(EXPORT_MAX))).all())
    rows: list[AdminUser] = []
    for chunk in batched(users, 500):
        rows += await admin_rows(db, chunk)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    writer.writerows(_csv_row(r) for r in rows)
    db.add(AuditLog(user_id=admin.id, action="admin.users.export",
                    target=f"{len(rows)} accounts · {only}{f' · {_one_line(q)}' if q and q.strip() else ''}"))
    await db.commit()
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="orbit-accounts-{stamp}.csv"',
                             "Cache-Control": "no-store"})


# ---- one account in full ---------------------------------------------------------------------------------------


class LedgerItem(BaseModel):
    id: str
    at: datetime
    kind: Literal["resume", "interview_seconds"]
    amount: int  # signed: resume credits, or interview seconds
    reason: str  # welcome | purchase | admin | admin_remove | resume_ai
    text: str
    amount_text: str
    note: str | None
    payment_id: str | None


class SessionItem(BaseModel):
    """A session's kind, state and minutes: never its title or anything said in it (the account's own content)."""
    id: str
    type: str
    status: str
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    minutes: float  # interview minutes it used


class PaymentItem(BaseModel):
    id: str
    pack: str
    amount_inr: int
    status: str
    utr: str | None
    reference: str
    resume_credits: int
    interview_minutes: int
    created_at: datetime
    submitted_at: datetime | None
    decided_at: datetime | None
    note: str | None


class AuditItem(BaseModel):
    id: str
    at: datetime
    action: str
    actor_id: str | None  # who acted (the admin, for admin.* actions)
    actor_email: str | None
    target: str | None
    subject_id: str | None = None  # the account an admin action was about
    subject_email: str | None = None  # None once that account is deleted (a delete's target keeps the email)
    ip: str | None = None


class ContentCounts(BaseModel):
    documents: int
    documents_by_kind: dict[str, int]
    resumes: int  # built in Resume AI
    stories: int
    workspaces: int
    sessions: int
    sessions_open: int  # not ended yet
    job_profile: bool  # Jobs AI has a search profile
    jobs_tracked: int
    jobs_by_status: dict[str, int]
    fit_checks: int
    fit_checks_30d: int


class UserDetailOut(BaseModel):
    user: AdminUser
    admin_note: str | None
    is_you: bool
    is_admin_account: bool  # the admin account: nothing destructive applies
    counts: ContentCounts
    ledger: list[LedgerItem]
    sessions: list[SessionItem]
    payments: list[PaymentItem]
    admin_actions: list[AuditItem]  # what an admin did to this account, newest first
    events: list[AuditItem]  # the account's own security events: sign-ins, password changes, ...


async def _count(db: AsyncSession, model: Any, *where: Any) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


async def _counts(db: AsyncSession, uid: str) -> ContentCounts:
    month_ago = datetime.now(UTC) - timedelta(days=30)
    by_kind = {k: int(n) for k, n in (await db.execute(
        select(Document.kind, func.count()).where(Document.user_id == uid).group_by(Document.kind))).all()}
    by_status = {s: int(n) for s, n in (await db.execute(
        select(JobApplication.status, func.count()).where(JobApplication.user_id == uid)
        .group_by(JobApplication.status))).all()}
    return ContentCounts(
        documents=sum(by_kind.values()), documents_by_kind=by_kind,
        resumes=await _count(db, Resume, Resume.user_id == uid),
        stories=await _count(db, Story, Story.user_id == uid),
        workspaces=await _count(db, Workspace, Workspace.user_id == uid),
        sessions=await _count(db, LiveSessionRow, LiveSessionRow.user_id == uid),
        sessions_open=await _count(db, LiveSessionRow, LiveSessionRow.user_id == uid,
                                   LiveSessionRow.status != "ended"),
        job_profile=await db.get(JobSearchProfile, uid) is not None,
        jobs_tracked=sum(by_status.values()), jobs_by_status=by_status,
        fit_checks=await _count(db, JobFitCheck, JobFitCheck.user_id == uid),
        fit_checks_30d=await _count(db, JobFitCheck, JobFitCheck.user_id == uid, JobFitCheck.created_at >= month_ago))


def _first_token(target: str | None) -> str | None:
    head = (target or "").split(" ", 1)[0]
    return head if len(head) == 36 else None


async def audit_items(db: AsyncSession, rows: list[AuditLog]) -> list[AuditItem]:
    """Audit rows with the emails of who acted and who it was about, in three lookups for the lot. A payment
    decision's target starts with the payment's id: it's about the account that paid (none once that's deleted)."""
    heads = {r.id: _first_token(r.target) for r in rows}
    paid = {heads[r.id] for r in rows if r.action.startswith("admin.payment.") and heads[r.id]}
    payer = {pid: uid for pid, uid in (await db.execute(
        select(Payment.id, Payment.user_id).where(Payment.id.in_(paid)))).all()} if paid else {}
    subjects = {r.id: payer.get(heads[r.id] or "") if r.action.startswith("admin.payment.") else heads[r.id]
                for r in rows}
    ids = {r.user_id for r in rows if r.user_id} | {s for s in subjects.values() if s}
    emails = {uid: email for uid, email in (await db.execute(
        select(User.id, User.email).where(User.id.in_(ids)))).all()} if ids else {}
    out = []
    for r in rows:
        subject = subjects[r.id]
        out.append(AuditItem(id=r.id, at=_aware(r.created_at), action=r.action, actor_id=r.user_id,
                             actor_email=emails.get(r.user_id) if r.user_id else None, target=r.target,
                             subject_id=subject, subject_email=emails.get(subject) if subject else None, ip=r.ip))
    return out


def about_account(user_id: str, payment_ids: list[str]) -> Any:
    """Admin actions on an account: their target starts with its id (or one of its payments' ids)."""
    def starts(prefix: str) -> Any:
        escaped = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return AuditLog.target.like(f"{escaped}%", escape="\\")

    return or_(starts(user_id), *(starts(pid) for pid in payment_ids))


async def _detail(db: AsyncSession, u: User, admin: User) -> UserDetailOut:
    row = (await admin_rows(db, [u]))[0]
    ledger = [LedgerItem(id=e.id, at=_aware(e.created_at), kind="resume" if e.kind == "resume" else "interview_seconds",
                         amount=e.amount, reason=e.reason, text=credit_text(e), amount_text=credit_amount(e),
                         note=e.note, payment_id=e.payment_id)
              for e in (await db.scalars(select(CreditEntry).where(CreditEntry.user_id == u.id)
                                         .order_by(CreditEntry.created_at.desc()).limit(LEDGER_MAX))).all()]
    used = {sid: float(total or 0) for sid, total in (await db.execute(
        select(UsageEvent.session_id, func.sum(UsageEvent.quantity))
        .where(UsageEvent.user_id == u.id, UsageEvent.metric.in_(credits.INTERVIEW_METRICS))
        .group_by(UsageEvent.session_id))).all()}
    sessions = [SessionItem(id=s.id, type=s.type, status=s.status, created_at=_aware(s.created_at),
                            started_at=_aware(s.started_at) if s.started_at else None,
                            ended_at=_aware(s.ended_at) if s.ended_at else None,
                            minutes=round(used.get(s.id, 0.0) / 60, 1))
                for s in (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == u.id)
                                           .order_by(LiveSessionRow.created_at.desc()).limit(100))).all()]
    pays = list((await db.scalars(select(Payment).where(Payment.user_id == u.id)
                                  .order_by(Payment.created_at.desc()).limit(100))).all())
    payments = [PaymentItem(id=p.id, pack=p.plan, amount_inr=p.amount_inr, status=p.status, utr=p.utr,
                            reference=p.reference, resume_credits=p.resume_credits,
                            interview_minutes=p.interview_minutes, created_at=_aware(p.created_at),
                            submitted_at=_aware(p.submitted_at) if p.submitted_at else None,
                            decided_at=_aware(p.decided_at) if p.decided_at else None, note=p.note) for p in pays]
    actions = list((await db.scalars(select(AuditLog).where(
        AuditLog.action.like("admin.%"), about_account(u.id, [p.id for p in pays]))
        .order_by(AuditLog.created_at.desc()).limit(100))).all())
    events = list((await db.scalars(select(AuditLog).where(AuditLog.user_id == u.id)
                                    .order_by(AuditLog.created_at.desc()).limit(50))).all())
    return UserDetailOut(user=row, admin_note=u.admin_note, is_you=u.id == admin.id,
                         is_admin_account=await _is_admin_account(db, u), counts=await _counts(db, u.id),
                         ledger=ledger, sessions=sessions, payments=payments,
                         admin_actions=await audit_items(db, actions), events=await audit_items(db, events))


@router.get("/users/{user_id}", response_model=UserDetailOut)
async def user_detail(user_id: str, admin: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> UserDetailOut:
    return await _detail(db, await _account(db, user_id), admin)


class UserPatch(BaseModel):
    """Leave a field out to keep it. An empty name clears it."""
    name: str | None = Field(None, max_length=200)
    email_verified: bool | None = None
    admin_note: str | None = Field(None, max_length=4000)  # private: never shown to the account's owner


@router.patch("/users/{user_id}", response_model=UserDetailOut)
async def update_user(user_id: str, body: UserPatch, admin: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> UserDetailOut:
    u = await _account(db, user_id)
    fields = body.model_dump(exclude_unset=True)
    changed: list[str] = []
    if "name" in fields:
        u.name = _one_line(body.name) or None
        changed.append("name")
    if "email_verified" in fields and body.email_verified is not None:
        # The admin account counts as admin only once its address is verified: un-verifying it would lock you out.
        if await _is_admin_account(db, u):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "That's the admin account: its email is verified by signing in with it.")
        u.email_verified = body.email_verified
        changed.append("verified" if body.email_verified else "unverified")
    if "admin_note" in fields:
        u.admin_note = (body.admin_note or "").strip() or None
        changed.append("note")
    if not changed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to change.")
    db.add(AuditLog(user_id=admin.id, action="admin.user.update", target=f"{u.id} {','.join(changed)}"))
    await db.commit()
    await db.refresh(u)
    return await _detail(db, u, admin)


# ---- credits: take away, and give to many --------------------------------------------------------------------


class RemoveCreditsIn(BaseModel):
    resume: int = Field(0, ge=0, le=100_000)
    interview_minutes: int = Field(0, ge=0, le=100_000)
    # "Set to zero": take whatever is left of that balance.
    all_resume: bool = False
    all_interview: bool = False
    reason: str = Field(min_length=3, max_length=300)  # shown in the account's history


class RemoveCreditsOut(BaseModel):
    user: AdminUser
    removed_resume: int
    removed_interview_minutes: float
    clamped: bool  # more was asked for than was left: what was there was taken, and that balance is now zero
    message: str


def _plural(n: float, word: str) -> str:
    return f"{n:g} {word}{'' if n == 1 else 's'}"


@router.post("/users/{user_id}/credits/remove", response_model=RemoveCreditsOut)
async def remove_credits(user_id: str, body: RemoveCreditsIn, admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> RemoveCreditsOut:
    """Take resume credits and/or interview minutes away. Never below zero: asking for more than is left takes what
    is there, and the answer says so (`clamped`)."""
    reason = _one_line(body.reason)
    if len(reason) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say why: it goes in the account's history.")
    if not (body.resume or body.interview_minutes or body.all_resume or body.all_interview):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Choose how many resume credits or interview minutes to remove.")
    async with _adjust_lock:
        u = await _account(db, user_id)
        await _guard(db, u, admin, "remove credits from")
        resume_left = await credits.resume_balance(db, u.id)
        granted, used = await credits.interview_seconds(db, u.id)
        seconds_left = math.ceil(max(granted - used, 0.0))  # rounded up, so "all" leaves exactly nothing
        take_resume = resume_left if body.all_resume else min(body.resume, resume_left)
        take_seconds = seconds_left if body.all_interview else min(body.interview_minutes * 60, seconds_left)
        notes: list[str] = []
        if not body.all_resume and body.resume > resume_left:
            notes.append(f"Only {_plural(resume_left, 'resume credit')} {'was' if resume_left == 1 else 'were'} left, "
                         "so that's what was removed")
        if not body.all_interview and body.interview_minutes * 60 > seconds_left:
            left = round(seconds_left / 60, 1)
            notes.append(f"Only {_plural(left, 'interview minute')} {'was' if left == 1 else 'were'} left, "
                         "so that's what was removed")
        if not (take_resume or take_seconds):
            raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to remove: that balance is already zero.")
        if take_resume:
            credits.add(db, u.id, "resume", -take_resume, REMOVED).note = reason
        if take_seconds:
            credits.add(db, u.id, "interview_seconds", -take_seconds, REMOVED).note = reason
        db.add(AuditLog(user_id=admin.id, action="admin.credits.remove",
                        target=f"{u.id} resume-{take_resume} interview-{round(take_seconds / 60, 1):g}m {reason}"))
        await db.commit()
    minutes = round(take_seconds / 60, 1)
    done = " and ".join(p for p in (_plural(take_resume, "resume credit") if take_resume else "",
                                    _plural(minutes, "interview minute") if take_seconds else "") if p)
    message = f"Removed {done}." + "".join(f" {n}; the balance is now zero." for n in notes)
    return RemoveCreditsOut(user=(await admin_rows(db, [u]))[0], removed_resume=take_resume,
                            removed_interview_minutes=minutes, clamped=bool(notes), message=message)


UserId = Annotated[str, StringConstraints(min_length=1, max_length=36)]


class BulkCreditsIn(BaseModel):
    user_ids: list[UserId] = Field(min_length=1, max_length=100)
    resume: int = Field(0, ge=0, le=1_000)
    interview_minutes: int = Field(0, ge=0, le=6_000)
    note: AdminNote = None


class Skipped(BaseModel):
    id: str
    why: str


class BulkCreditsOut(BaseModel):
    given: int
    skipped: list[Skipped]


@router.post("/users/bulk-credits", response_model=BulkCreditsOut)
async def bulk_credits(body: BulkCreditsIn, admin: Annotated[User, Depends(require_admin)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> BulkCreditsOut:
    """The same resume credits and/or interview minutes for each of up to 100 accounts (the admin account, which
    never needs them, is skipped). One ledger entry and one audit entry per account."""
    if not (body.resume or body.interview_minutes):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add some resume credits or interview minutes.")
    note = _one_line(body.note) or None
    wanted = list(dict.fromkeys(body.user_ids))
    found = {u.id: u for u in (await db.scalars(select(User).where(User.id.in_(wanted)))).all()}
    skipped: list[Skipped] = []
    given = 0
    for uid in wanted:
        u = found.get(uid)
        if u is None:
            skipped.append(Skipped(id=uid, why="not found"))
            continue
        if await _is_admin_account(db, u):
            skipped.append(Skipped(id=uid, why="the admin account"))
            continue
        if body.resume:
            credits.add(db, u.id, "resume", body.resume, GIVEN).note = note
        if body.interview_minutes:
            credits.add(db, u.id, "interview_seconds", body.interview_minutes * 60, GIVEN).note = note
        db.add(AuditLog(user_id=admin.id, action="admin.credits",
                        target=f"{u.id} resume+{body.resume} interview+{body.interview_minutes}m (bulk)"))
        given += 1
    await db.commit()
    return BulkCreditsOut(given=given, skipped=skipped)


# ---- suspend, sign out, reset, delete --------------------------------------------------------------------------


class SuspendIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)  # the account's owner is shown it


@router.post("/users/{user_id}/suspend", response_model=AdminUser)
async def suspend_user(user_id: str, body: SuspendIn, background: BackgroundTasks,
                       admin: Annotated[User, Depends(require_admin)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    """The account can't sign in or use the API until unsuspended. Its live sessions stop and every device is signed
    out now; its owner is emailed the reason, and shown it when they try to sign in."""
    reason = _one_line(body.reason)
    if len(reason) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say why: they're shown the reason.")
    u = await _account(db, user_id)
    await _guard(db, u, admin, "suspend")
    first = u.suspended_at is None
    u.suspended_at = u.suspended_at or datetime.now(UTC)
    u.suspended_reason = reason
    db.add(AuditLog(user_id=admin.id, action="admin.user.suspend", target=f"{u.id} {reason}"))
    # Committed before anything stops, so nothing can start or reconnect in between (every request and the live
    # socket check it), and with no write held open while the live sessions write their last usage.
    await db.commit()
    await end_live_sessions(db, u.id)
    await sign_out_everywhere(db, u)
    await db.commit()
    await db.refresh(u)
    if first:
        background.add_task(send_safely, OutgoingEmail(
            to=u.email, subject="Your Orbit account is suspended",
            text=(f"Your Orbit account has been suspended, so you can't sign in for now.\n\nReason: {reason}\n\n"
                  "If you think this is a mistake, get in touch with the Orbit team.")))
    return (await admin_rows(db, [u]))[0]


@router.post("/users/{user_id}/unsuspend", response_model=AdminUser)
async def unsuspend_user(user_id: str, background: BackgroundTasks, admin: Annotated[User, Depends(require_admin)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    """Signing in works again (the password is unchanged). An account that isn't suspended is left as it is."""
    u = await _account(db, user_id)
    if u.suspended_at is None:
        return (await admin_rows(db, [u]))[0]
    u.suspended_at, u.suspended_reason = None, None
    db.add(AuditLog(user_id=admin.id, action="admin.user.unsuspend", target=u.id))
    await db.commit()
    await db.refresh(u)
    background.add_task(send_safely, OutgoingEmail(
        to=u.email, subject="Your Orbit account is active again",
        text=f"Your Orbit account is no longer suspended. Sign in: {get_settings().web_url.rstrip('/')}/login"))
    return (await admin_rows(db, [u]))[0]


@router.post("/users/{user_id}/sign-out", response_model=AdminUser)
async def sign_out_user(user_id: str, admin: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> AdminUser:
    """Every device signs in again (web, desktop, the phone following a session), live sessions stop, and unused
    emailed links stop working. The password doesn't change. (Your own account: Settings → Sign out everywhere.)"""
    u = await _account(db, user_id)
    await _guard(db, u, admin, "sign out")
    await stop_account_live(db, u.id)  # first, with no write held open while they write their last usage
    await sign_out_everywhere(db, u)
    db.add(AuditLog(user_id=admin.id, action="admin.user.sign_out", target=u.id))
    await db.commit()
    await db.refresh(u)
    return (await admin_rows(db, [u]))[0]


class ResetSentOut(BaseModel):
    status: Literal["sent"] = "sent"
    message: str


@router.post("/users/{user_id}/password-reset", response_model=ResetSentOut, status_code=202)
async def send_password_reset(user_id: str, background: BackgroundTasks,
                              admin: Annotated[User, Depends(require_admin)],
                              db: Annotated[AsyncSession, Depends(get_db)]) -> ResetSentOut:
    """The same email as "Forgot password": a link that works once, for an hour. Nothing changes until it's used."""
    from orbit_api.auth.routes import reset_email

    u = await _account(db, user_id)
    if not can_deliver():
        raise HTTPException(status.HTTP_409_CONFLICT, "This server can't send email (no SMTP), so the link would "
                                                      "never arrive.")
    if await email_tokens.recently_issued(db, u.id, "reset_password"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "A reset link went to them moments ago.")
    token = await email_tokens.issue(db, u.id, "reset_password")
    db.add(AuditLog(user_id=admin.id, action="admin.user.password_reset", target=u.id))
    await db.commit()
    background.add_task(send_safely, reset_email(u.email, token))
    return ResetSentOut(message=f"A reset link is on its way to {u.email}. It works once, for an hour.")


class DeleteIn(BaseModel):
    confirm_email: str = Field(min_length=3, max_length=320)  # typed by the admin: must be the account's email


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, body: DeleteIn, admin: Annotated[User, Depends(require_admin)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Deletes the account and everything in it, after stopping its live sessions (auth/accounts.delete_account).
    Its approved payments stay on the books without it, so the revenue history is unchanged. The audit entry keeps
    the email."""
    u = await _account(db, user_id)
    await _guard(db, u, admin, "delete")
    if body.confirm_email.strip().lower() != u.email.strip().lower():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type the account's email exactly to delete it.")
    await delete_account(db, u, AuditLog(user_id=admin.id, action="admin.user.delete", target=f"{u.id} {u.email}"))
    return Response(status_code=204)
