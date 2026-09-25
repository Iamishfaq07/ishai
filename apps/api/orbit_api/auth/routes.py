import json
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth import email_tokens
from orbit_api.auth.captcha import public_config as captcha_config
from orbit_api.auth.captcha import require_captcha
from orbit_api.auth.security import (
    COOKIE_NAME,
    NOT_ALLOWED,
    create_access_token,
    current_user,
    hash_password,
    needs_rehash,
    verify_password,
)
from orbit_api.config import get_settings
from orbit_api.csrf import token_for as csrf_token_for
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import TokenBucket, check, limit

router = APIRouter(prefix="/v1/auth", tags=["auth"])
auth_limit = limit("auth", rate_per_s=0.2, burst=10)
email_limit = limit("email", rate_per_s=0.05, burst=5)
# Account creation: a handful per IP per hour. Login is also throttled per target email, so password guessing
# spread over many IPs still hits a wall.
signup_limit = limit("signup", rate_per_s=5 / 3600, burst=5)
_login_by_email = TokenBucket(rate_per_s=10 / 900, burst=10)
_reset_by_email = TokenBucket(rate_per_s=3 / 3600, burst=3)


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
    store_transcripts: bool
    # Always false: screenshots are analysed and discarded, never stored (the old toggle did nothing). Kept in
    # the response so older clients still parse it.
    store_screenshots: bool = False
    # Browser clients send this back as X-CSRF-Token on state-changing requests (see orbit_api/csrf.py). Only
    # present on auth responses; the desktop app (Bearer token) ignores it.
    csrf_token: str | None = None


class AuthOut(BaseModel):
    user: UserOut
    access_token: str


def _user_out(u: User, *, with_csrf: bool = False) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, email_verified=u.email_verified,
                   store_transcripts=u.store_transcripts,
                   csrf_token=csrf_token_for(u.id, u.token_version) if with_csrf else None)


def _cookie_policy() -> tuple[bool, Literal["lax", "none"]]:
    """(secure, samesite). In production the web app and API are usually on different sites
    (e.g. Cloudflare + Render), so the session cookie must be SameSite=None; Secure to be sent
    cross-site. Locally (same-site over http) SameSite=Lax without Secure works."""
    cross_site = get_settings().env == "production"
    return (True, "none") if cross_site else (False, "lax")


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    secure, samesite = _cookie_policy()
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure, samesite=samesite,
                        max_age=s.jwt_ttl_minutes * 60, path="/")


def _clear_cookie(response: Response) -> None:
    # delete_cookie must repeat the attributes the browser stored it with, or it won't be cleared.
    secure, samesite = _cookie_policy()
    response.delete_cookie(COOKIE_NAME, path="/", secure=secure, samesite=samesite, httponly=True)


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


class AuthConfigOut(BaseModel):
    """Public: what the sign-in / sign-up screens need to know before anyone is signed in."""
    captcha: dict[str, str] | None
    email_verification: Literal["required", "off"]


@router.get("/config", response_model=AuthConfigOut)
async def auth_config() -> AuthConfigOut:
    s = get_settings()
    return AuthConfigOut(captcha=captcha_config(),
                         email_verification="required" if s.verification_required else "off")


@router.post("/register", response_model=AuthOut, status_code=201,
             dependencies=[Depends(auth_limit), Depends(signup_limit)])
async def register(body: RegisterIn, request: Request, response: Response,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    email = body.email.lower()
    if not get_settings().email_allowed(email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    await require_captcha(body.captcha_token, _ip(request))
    if await db.scalar(select(func.count()).select_from(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, name=body.name, password_hash=await hash_password(body.password))
    db.add(user)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="auth.register", ip=_ip(request)))
    verify = await email_tokens.issue(db, user.id, "verify_email")
    await db.commit()
    await send_safely(_verification_email(user.email, verify))
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user, with_csrf=True), access_token=token)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def login(body: LoginIn, request: Request, response: Response,
                db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    check(_login_by_email, body.email.lower(),
          "Too many sign-in attempts for this account — try again in a few minutes.")
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if not await verify_password(body.password, user.password_hash if user else None) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    db.add(AuditLog(user_id=user.id, action="auth.login", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user, with_csrf=True), access_token=token)


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
    assert u is not None
    if body.store_transcripts is not None:
        u.store_transcripts = body.store_transcripts
    await db.commit()
    return _user_out(u)


@router.delete("/me", status_code=204)
async def delete_account(request: Request, response: Response, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Deletes the account and, via ON DELETE CASCADE, every document, session and usage row."""
    u = await db.get(User, user.id)
    if u is not None:
        await db.delete(u)
        db.add(AuditLog(user_id=None, action="auth.delete_account", target=user.id, ip=_ip(request)))
        await db.commit()
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


def _reset_email(to: str, token: str) -> OutgoingEmail:
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
async def confirm_verification(body: TokenIn, request: Request,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> UserOut:
    user_id = await email_tokens.consume(db, body.token, "verify_email")
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This verification link is invalid or has expired.")
    user.email_verified = True
    db.add(AuditLog(user_id=user.id, action="auth.verify_email", ip=_ip(request)))
    await db.commit()
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
        background.add_task(send_safely, _reset_email(user.email, token))
    return {"status": "If an account exists for that email, a reset link is on its way."}


@router.post("/password-reset/confirm", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def confirm_password_reset(body: ResetConfirmIn, request: Request, response: Response,
                                 db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    user_id = await email_tokens.consume(db, body.token, "reset_password")
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired.")
    user.password_hash = await hash_password(body.password)
    user.token_version += 1  # every existing session (web + desktop) is signed out
    user.email_verified = True  # they just proved control of the inbox
    db.add(AuditLog(user_id=user.id, action="auth.password_reset", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user, with_csrf=True), access_token=token)


@router.post("/logout-all", status_code=204)
async def logout_everywhere(request: Request, response: Response, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    u = await db.get(User, user.id)
    assert u is not None
    u.token_version += 1
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
    assert u is not None
    if not await verify_password(body.password, u.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password isn't right.")
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


@router.post("/email-change/confirm", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def confirm_email_change(body: TokenIn, request: Request, response: Response,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    row = await email_tokens.consume_row(db, body.token, "change_email")
    user = await db.get(User, row.user_id) if row else None
    if row is None or user is None or not row.new_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired.")
    if await db.scalar(select(func.count()).select_from(User).where(User.email == row.new_email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    old = user.email
    user.email = row.new_email
    user.email_verified = True  # opening the link proves control of the new inbox
    user.token_version += 1  # every other session (web + desktop) signs in again
    db.add(AuditLog(user_id=user.id, action="auth.email_changed", target=old, ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user, with_csrf=True), access_token=token)


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
