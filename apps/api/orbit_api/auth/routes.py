import json
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.auth import email_tokens
from orbit_api.auth.accounts import delete_account as delete_account_and_data
from orbit_api.auth.accounts import sign_out_everywhere as _sign_out_everywhere
from orbit_api.auth.captcha import public_config as captcha_config
from orbit_api.auth.captcha import require_captcha
from orbit_api.auth.security import (
    COOKIE_NAME,
    NOT_ALLOWED,
    cookie_policy,
    create_access_token,
    current_user,
    hash_password,
    needs_rehash,
    set_session_cookie,
    suspended_detail,
    verify_password,
)
from orbit_api.config import get_settings
from orbit_api.csrf import token_for as csrf_token_for
from orbit_api.db import get_db
from orbit_api.entitlements import awaiting_approval
from orbit_api.models import AuditLog, User
from orbit_api.providers.email import OutgoingEmail, can_deliver, send_safely
from orbit_api.ratelimit import TokenBucket, blocked, check, client_ip, client_network, failed, limit

router = APIRouter(prefix="/v1/auth", tags=["auth"])
auth_limit = limit("auth", rate_per_s=0.2, burst=10)
email_limit = limit("email", rate_per_s=0.05, burst=5)
# Account creation: a handful per IP per hour. Login is also throttled per target email, so password guessing
# spread over many IPs still hits a wall.
signup_limit = limit("signup", rate_per_s=5 / 3600, burst=5)
# Wrong passwords only (a correct one never counts): per account from one network, and per account overall (a
# guess spread over many networks). Someone else's failures from another network can't lock the owner out, and the
# overall cap is high enough that it takes a sustained, distributed attack to reach it.
_login_fail_here = TokenBucket(rate_per_s=10 / 900, burst=10)
_login_fail_anywhere = TokenBucket(rate_per_s=60 / 900, burst=60)
_reset_by_email = TokenBucket(rate_per_s=3 / 3600, burst=3)
# "You already have an account" notices: sign-up attempts with a taken address can't flood its owner's inbox.
_signup_notice_by_email = TokenBucket(rate_per_s=3 / 3600, burst=3)


# The most common long passwords: length alone lets these through.
_COMMON = frozenset("""
password123 password1234 password12345 1234567890 12345678910 0123456789 qwertyuiop qwertyuiop1 1q2w3e4r5t
iloveyou123 iloveyou12 abcdefghij abcdefghijk 1234567890a a1234567890 passw0rd123 password!! welcome123 welcome1234
letmein123 adminadmin admin12345 administrator 1111111111 0000000000 9876543210 qazwsxedcrfv zaq12wsxcde
football123 baseball123 sunshine123 princess123 dragon1234 monkey1234 trustno1234 superman123 starwars123
""".split())


def password_problem(password: str, email: str = "") -> str | None:
    """Why a new password is too easy to guess, or None."""
    p = password.lower()
    if p in _COMMON or len(set(p)) < 4:
        return "That password is too easy to guess. Use a longer phrase or a mix of words, numbers and symbols."
    local = email.lower().split("@", 1)[0]
    if len(local) >= 4 and local in p:
        return "Don't use your email address in your password."
    return None


def _check_password(password: str, email: str = "") -> None:
    problem = password_problem(password, email)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)


# Wrong current passwords on a signed-in account (email change, password change, delete): a stolen session can't
# be used to guess the password.
_password_fail_by_user = TokenBucket(rate_per_s=5 / 3600, burst=5)


async def _recheck_password(user: User, password: str) -> None:
    if blocked(_password_fail_by_user, user.id):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong passwords. Try again later.")
    if not await verify_password(password, user.password_hash):
        failed(_password_fail_by_user, user.id)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password isn't right.")


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    name: str | None = Field(None, max_length=200)
    captcha_token: str | None = Field(None, max_length=4096)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None
    email_verified: bool
    # Signed up while sign-up approval was on and not approved (or granted a plan) yet: the app shows a banner.
    approval_pending: bool = False
    store_transcripts: bool
    # Always false: screenshots are analysed and discarded, never stored (the old toggle did nothing). Kept in
    # the response so older clients still parse it.
    store_screenshots: bool = False
    # Browser clients send this back as X-CSRF-Token on state-changing requests (see orbit_api/csrf.py). Only
    # present on auth responses; the desktop app (Bearer token) ignores it.
    csrf_token: str | None = None


class AuthOut(BaseModel):
    user: UserOut
    # Bearer token for the desktop app (kept in the OS keychain). Left out for the web app, whose session lives only
    # in the httpOnly cookie, so script on the page (an XSS) can never read a long-lived credential.
    access_token: str | None = None


def _user_out(u: User, *, with_csrf: bool = False) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, email_verified=u.email_verified,
                   approval_pending=awaiting_approval(u), store_transcripts=u.store_transcripts,
                   csrf_token=csrf_token_for(u.id, u.token_version) if with_csrf else None)


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def _auth_out(request: Request, response: Response, user: User) -> AuthOut:
    """Sign `user` in. The web app gets only a short-lived, self-renewing httpOnly cookie; other callers (the
    desktop app) get a Bearer token for the keychain, valid until the hard cap, and the same token as a cookie."""
    from_web = request.headers.get("origin", "").rstrip("/").lower() == _origin(get_settings().web_url)
    token = create_access_token(user.id, user.token_version, idle=from_web)
    set_session_cookie(response, token)
    return AuthOut(user=_user_out(user, with_csrf=True), access_token=None if from_web else token)


def _clear_cookie(response: Response) -> None:
    # delete_cookie must repeat the attributes the browser stored it with, or it won't be cleared.
    secure, samesite = cookie_policy()
    response.delete_cookie(COOKIE_NAME, path="/", secure=secure, samesite=samesite, httponly=True)


def _ip(request: Request) -> str | None:
    ip = client_ip(request)
    return None if ip == "unknown" else ip


class AuthConfigOut(BaseModel):
    """Public: what the sign-in / sign-up screens need to know before anyone is signed in."""
    captcha: dict[str, str] | None
    email_verification: Literal["required", "off"]


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    s = get_settings()
    return AuthConfigOut(captcha=captcha_config(),
                         email_verification="required" if s.verification_required else "off")


class RegisterPendingOut(BaseModel):
    """Sign-up when the inbox must be proven: the same answer whether or not the email already has an account."""
    status: Literal["verify_email"] = "verify_email"
    email: str


def _inbox_first() -> bool:
    """Sign-up waits for the emailed link (and never reveals whether the address is taken) whenever verification
    is required and mail can actually be delivered. Otherwise (verification off, or an admin-only deploy with no
    SMTP) it signs straight in, as nobody else can sign up there anyway."""
    return get_settings().verification_required and can_deliver()


@router.post("/register", response_model=AuthOut | RegisterPendingOut, status_code=201,
             dependencies=[Depends(auth_limit), Depends(signup_limit)])
async def register(body: RegisterIn, request: Request, response: Response, background: BackgroundTasks,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut | RegisterPendingOut:
    email = body.email.lower()
    if not get_settings().email_allowed(email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    _check_password(body.password, email)
    await require_captcha(body.captcha_token, _ip(request))
    existing = await db.scalar(select(User).where(User.email == email))
    if not _inbox_first():
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
        user = await _create_user(db, request, email, body)
        await send_safely(_verification_email(user.email, await _verify_token(db, user)))
        _alert_admin_if_waiting(user, background)
        return _auth_out(request, response, user)

    # No account enumeration: new or taken, the caller sees the same 202 and every email goes out after the
    # response. Both paths run one argon2 operation, so timing doesn't tell them apart either.
    response.status_code = status.HTTP_202_ACCEPTED
    pending = RegisterPendingOut(email=email)
    if existing is None:
        try:
            user = await _create_user(db, request, email, body)
            token = await _verify_token(db, user)
        except IntegrityError:  # a simultaneous sign-up for the same address won: same answer, no 500
            await db.rollback()
            return pending
        background.add_task(send_safely, _verification_email(email, token))
    elif await verify_password(body.password, existing.password_hash) and not existing.email_verified:
        # The owner signing up again before verifying: a fresh link, unless one went out moments ago.
        if not await email_tokens.recently_issued(db, existing.id, "verify_email"):
            background.add_task(send_safely, _verification_email(email, await _verify_token(db, existing)))
    elif _signup_notice_by_email.allow(email):  # someone else, or already verified: tell the owner
        background.add_task(send_safely, _already_registered_email(email))
    return pending


async def _create_user(db: AsyncSession, request: Request, email: str, body: RegisterIn) -> User:
    s = get_settings()
    # With sign-up approval on, a new account waits for the admin. The admin never waits, and neither does the
    # very first account of a dev server without ORBIT_ADMIN_EMAIL (it stands in as admin there).
    first_dev_user = (not s.admin_email and s.env != "production"
                      and not await db.scalar(select(func.count()).select_from(User)))
    approved = not s.approval_required or s.is_admin_email(email) or bool(first_dev_user)
    user = User(email=email, name=body.name, password_hash=await hash_password(body.password), approved=approved)
    db.add(user)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="auth.register", ip=_ip(request)))
    # The welcome credits (1 resume-AI credit, 20 interview minutes): one account per network, capped a day.
    if not s.is_admin_email(email):
        await credits.grant_welcome(db, user, client_ip(request))
    return user


async def _verify_token(db: AsyncSession, user: User) -> str:
    token = await email_tokens.issue(db, user.id, "verify_email")
    await db.commit()
    return token


@router.post("/login", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def login(body: LoginIn, request: Request, response: Response,
                db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    email = body.email.lower()
    here = f"{email}|{client_network(request)}"
    if blocked(_login_fail_here, here) or blocked(_login_fail_anywhere, email):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Too many wrong passwords for this account — try again in a few minutes.")
    user = await db.scalar(select(User).where(User.email == email))
    if not await verify_password(body.password, user.password_hash if user else None) or user is None:
        failed(_login_fail_here, here)
        failed(_login_fail_anywhere, email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    if user.suspended_at is not None:  # said only to someone who knows the password: no account enumeration
        db.add(AuditLog(user_id=user.id, action="auth.login_suspended", ip=_ip(request)))
        await db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, suspended_detail(user))
    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    db.add(AuditLog(user_id=user.id, action="auth.login", ip=_ip(request)))
    await db.commit()
    return _auth_out(request, response, user)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> Response:
    _clear_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return _user_out(user, with_csrf=True)


class PrivacyIn(BaseModel):
    store_transcripts: bool | None = None
    # Accepted from older clients and ignored: screenshots are never stored (see UserOut).
    store_screenshots: bool | None = None


@router.patch("/me/privacy", response_model=UserOut)
async def update_privacy(body: PrivacyIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> UserOut:
    u = await db.get(User, user.id)
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    if body.store_transcripts is not None:
        u.store_transcripts = body.store_transcripts
    await db.commit()
    return _user_out(u)


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=256)


@router.delete("/me", status_code=204)
async def delete_account(body: DeleteAccountIn, request: Request, response: Response,
                         user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Deletes the account and, via ON DELETE CASCADE, every document, session and usage row. Asks for the password
    again (a session left open somewhere can't delete it), and never deletes the admin account: whoever registered
    its email next would be the admin."""
    u = await db.get(User, user.id)
    if u is not None:
        if get_settings().is_admin_email(u.email):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "The admin account can't be deleted from the app.")
        await _recheck_password(u, body.password)
        # Live work stops first; payments, credit entries and the audit trail stay without personal data
        # (auth/accounts.py, shared with the admin's delete).
        await delete_account_and_data(db, u, AuditLog(user_id=None, action="auth.delete_account", target=user.id))
    _clear_cookie(response)
    response.status_code = 204
    return response


# ---- email verification & password reset ---------------------------------------------------------------


def _link(path: str, token: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}{path}?token={token}"


def _verification_email(to: str, token: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Verify your Orbit email",
        text=(
            "Confirm this is your email address for Orbit:\n\n"
            f"{_link('/verify-email', token)}\n\n"
            "The link expires in 48 hours. If you didn't create an Orbit account, ignore this email."
        ),
    )


def _alert_admin_if_waiting(user: User, background: BackgroundTasks) -> None:
    """Tell the admin a new account is waiting for access, once it's a real one: at sign-up, or where email
    verification is required, when the inbox is proven (so a typo'd or throwaway address never reaches them)."""
    s = get_settings()
    if not (awaiting_approval(user) and s.admin_email) or s.is_admin_email(user.email):
        return
    if s.verification_required and not user.email_verified:
        return
    web = s.web_url.rstrip("/")
    name = " ".join((user.name or "").split())[:80]  # one line: a name can't carry a message of its own
    who = f"{name} ({user.email})" if name else user.email
    background.add_task(send_safely, OutgoingEmail(
        to=s.admin_email,
        subject=f"New Orbit sign-up: {user.email}",
        text=(
            f"{who} just signed up for Orbit and is waiting for access.\n\n"
            f"Give them access, for example Unlimited for 2 hours: {web}/admin/users\n\n"
            "Until you do, they can sign in but can't start sessions or use the AI."
        ),
    ))


def _already_registered_email(to: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="You already have an Orbit account",
        text=(
            "Someone tried to create an Orbit account with this email, but it already has one.\n\n"
            f"If that was you, sign in at {get_settings().web_url.rstrip('/')}/login — or, if you've forgotten your "
            f"password, reset it at {get_settings().web_url.rstrip('/')}/forgot-password.\n\n"
            "If it wasn't you, you can ignore this email: nothing about your account has changed."
        ),
    )


def reset_email(to: str, token: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Reset your Orbit password",
        text=(
            "Someone asked to reset the password for your Orbit account.\n\n"
            f"{_link('/reset-password', token)}\n\n"
            "The link expires in 1 hour and works once. If this wasn't you, ignore this email — "
            "your password won't change."
        ),
    )


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ResetRequestIn(BaseModel):
    email: EmailStr
    captcha_token: str | None = Field(None, max_length=4096)


class ResetConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=10, max_length=256)


@router.post("/verify-email/request", status_code=202, dependencies=[Depends(email_limit)])
async def request_verification(user: Annotated[User, Depends(current_user)],
                               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    if user.email_verified:
        return {"status": "already_verified"}
    if await email_tokens.recently_issued(db, user.id, "verify_email"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "We just sent one — check your inbox.")
    token = await email_tokens.issue(db, user.id, "verify_email")
    await db.commit()
    await send_safely(_verification_email(user.email, token))
    return {"status": "sent"}


@router.post("/verify-email/confirm", response_model=UserOut)
async def confirm_verification(body: TokenIn, request: Request, background: BackgroundTasks,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> UserOut:
    user_id = await email_tokens.consume(db, body.token, "verify_email")
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This verification link is invalid or has expired.")
    newly = not user.email_verified
    user.email_verified = True
    db.add(AuditLog(user_id=user.id, action="auth.verify_email", ip=_ip(request)))
    await db.commit()
    if newly:  # where verification is required, the admin hears about a sign-up once its inbox is proven
        _alert_admin_if_waiting(user, background)
    return _user_out(user)


@router.post("/password-reset/request", status_code=202, dependencies=[Depends(email_limit)])
async def request_password_reset(body: ResetRequestIn, request: Request, background: BackgroundTasks,
                                 db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    """Always 202 with the same body, whether or not the account exists (no account enumeration).
    The email is sent after the response so SMTP latency can't reveal existence via timing either."""
    await require_captcha(body.captcha_token, _ip(request))
    check(_reset_by_email, body.email.lower(), "Too many reset requests for this email — try again later.")
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if user is not None and not await email_tokens.recently_issued(db, user.id, "reset_password"):
        token = await email_tokens.issue(db, user.id, "reset_password")
        db.add(AuditLog(user_id=user.id, action="auth.password_reset_request", ip=_ip(request)))
        await db.commit()
        background.add_task(send_safely, reset_email(user.email, token))
    return {"status": "If an account exists for that email, a reset link is on its way."}


@router.post("/password-reset/confirm", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def confirm_password_reset(body: ResetConfirmIn, request: Request, response: Response,
                                 background: BackgroundTasks,
                                 db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    user_id = await email_tokens.consume(db, body.token, "reset_password")
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired.")
    if user.suspended_at is not None:  # nothing changes, and no session: the link stays usable once unsuspended
        raise HTTPException(status.HTTP_403_FORBIDDEN, suspended_detail(user))
    newly_verified = not user.email_verified
    _check_password(body.password, user.email)
    user.password_hash = await hash_password(body.password)
    await _sign_out_everywhere(db, user)  # every session, live socket and unused link
    user.email_verified = True  # they just proved control of the inbox
    db.add(AuditLog(user_id=user.id, action="auth.password_reset", ip=_ip(request)))
    await db.commit()
    if newly_verified:  # the reset proved the inbox first: the admin hears about the sign-up now
        _alert_admin_if_waiting(user, background)
    return _auth_out(request, response, user)


@router.post("/logout-all", status_code=204)
async def logout_everywhere(request: Request, response: Response, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    u = await db.get(User, user.id)
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    await _sign_out_everywhere(db, u)
    db.add(AuditLog(user_id=u.id, action="auth.logout_all", ip=_ip(request)))
    await db.commit()
    _clear_cookie(response)
    response.status_code = 204
    return response


# ---- email change (brief §43) -----------------------------------------------------------------------------


class EmailChangeIn(BaseModel):
    new_email: EmailStr
    password: str = Field(max_length=256)


email_change_limit = limit("email-change", rate_per_s=3 / 3600, burst=3)


def _email_change_email(to: str, token: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Confirm your new Orbit email",
        text=(
            "Confirm that this is the new email address for your Orbit account:\n\n"
            f"{_link('/confirm-email-change', token)}\n\n"
            "The link expires in 24 hours and works once. If you didn't ask for this, ignore this email."
        ),
    )


def _email_change_notice(to: str, new_email: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Your Orbit email is being changed",
        text=(
            f"Someone signed in to your Orbit account asked to change its email to {new_email}.\n\n"
            "Nothing changes until the new address is confirmed. If this wasn't you, change your password now — "
            "that signs out every device."
        ),
    )


@router.post("/me/email", status_code=202, dependencies=[Depends(email_change_limit)])
async def request_email_change(body: EmailChangeIn, request: Request, user: Annotated[User, Depends(current_user)],
                               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    """Re-authenticates with the password, then emails a single-use confirmation link to the NEW address (and a
    heads-up to the old one). The email only changes when the link is opened."""
    new_email = body.new_email.lower()
    u = await db.get(User, user.id)
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    if get_settings().is_admin_email(u.email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "The admin account's email is set by ORBIT_ADMIN_EMAIL on the server; change it there.")
    await _recheck_password(u, body.password)
    if new_email == u.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That's already your email.")
    if not get_settings().email_allowed(new_email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    if await db.scalar(select(func.count()).select_from(User).where(User.email == new_email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    token = await email_tokens.issue(db, u.id, "change_email", new_email=new_email)
    db.add(AuditLog(user_id=u.id, action="auth.email_change_request", ip=_ip(request)))
    await db.commit()
    await send_safely(_email_change_email(new_email, token))
    await send_safely(_email_change_notice(u.email, new_email))
    return {"status": "sent"}


class EmailChangedOut(BaseModel):
    email: str


@router.post("/email-change/confirm", response_model=EmailChangedOut, dependencies=[Depends(auth_limit)])
async def confirm_email_change(body: TokenIn, request: Request, response: Response,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> EmailChangedOut:
    """Changes the email. It signs nobody in: whoever opens the link (maybe not the account's owner, if the link was
    passed on) signs in with the password as usual."""
    row = await email_tokens.consume_row(db, body.token, "change_email")
    user = await db.get(User, row.user_id) if row else None
    if row is None or user is None or not row.new_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired.")
    if await db.scalar(select(func.count()).select_from(User).where(User.email == row.new_email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    old = user.email
    user.email = row.new_email
    user.email_verified = True  # opening the link proves control of the new inbox
    await _sign_out_everywhere(db, user)  # every session signs in again, with the new address
    db.add(AuditLog(user_id=user.id, action="auth.email_changed", target=old, ip=_ip(request)))
    await db.commit()
    _clear_cookie(response)
    return EmailChangedOut(email=user.email)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


@router.post("/me/password", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def change_password(body: PasswordChangeIn, request: Request, response: Response,
                          user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    """A new password, with the current one: every other device (and any live session) is signed out; this one
    stays signed in."""
    u = await db.get(User, user.id)
    if u is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    await _recheck_password(u, body.current_password)
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a password you haven't used here.")
    _check_password(body.new_password, u.email)
    u.password_hash = await hash_password(body.new_password)
    await _sign_out_everywhere(db, u)
    db.add(AuditLog(user_id=u.id, action="auth.password_change", ip=_ip(request)))
    await db.commit()
    return _auth_out(request, response, u)


# ---- data export (brief §42) ------------------------------------------------------------------------------

export_limit = limit("export", rate_per_s=5 / 3600, burst=3)


@router.get("/me/export", dependencies=[Depends(export_limit)])
async def export_my_data(user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Everything Orbit stores about the account, as one JSON file (profile, documents, workspaces, sessions with
    transcripts/questions/answers/reports, usage, security log). Secrets and derived search data are left out."""
    from orbit_api.auth.export import build_export

    data = await build_export(db, user.id)
    stamp = data["exported_at"][:10]
    return Response(content=json.dumps(data, ensure_ascii=False, indent=1, default=str),
                    media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="orbit-export-{stamp}.json"'})
