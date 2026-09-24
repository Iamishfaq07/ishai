from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth import email_tokens
from orbit_api.auth.security import (
    COOKIE_NAME,
    NOT_ALLOWED,
    create_access_token,
    current_user,
    hash_password,
    verify_password,
)
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User
from orbit_api.providers.email import OutgoingEmail, send_safely
from orbit_api.ratelimit import limit

router = APIRouter(prefix="/v1/auth", tags=["auth"])
auth_limit = limit("auth", rate_per_s=0.2, burst=10)
email_limit = limit("email", rate_per_s=0.05, burst=5)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    name: str | None = Field(None, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None
    email_verified: bool
    store_transcripts: bool
    store_screenshots: bool


class AuthOut(BaseModel):
    user: UserOut
    access_token: str


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, email_verified=u.email_verified,
                   store_transcripts=u.store_transcripts,
                   store_screenshots=u.store_screenshots)


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


@router.post("/register", response_model=AuthOut, status_code=201, dependencies=[Depends(auth_limit)])
async def register(body: RegisterIn, request: Request, response: Response,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    email = body.email.lower()
    if not get_settings().email_allowed(email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    if await db.scalar(select(func.count()).select_from(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="auth.register", ip=_ip(request)))
    verify = await email_tokens.issue(db, user.id, "verify_email")
    await db.commit()
    await send_safely(_verification_email(user.email, verify))
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user), access_token=token)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def login(body: LoginIn, request: Request, response: Response,
                db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    db.add(AuditLog(user_id=user.id, action="auth.login", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user), access_token=token)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> Response:
    _clear_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return _user_out(user)


class PrivacyIn(BaseModel):
    store_transcripts: bool | None = None
    store_screenshots: bool | None = None


@router.patch("/me/privacy", response_model=UserOut)
async def update_privacy(body: PrivacyIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> UserOut:
    u = await db.get(User, user.id)
    assert u is not None
    if body.store_transcripts is not None:
        u.store_transcripts = body.store_transcripts
    if body.store_screenshots is not None:
        u.store_screenshots = body.store_screenshots
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
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # every existing session (web + desktop) is signed out
    user.email_verified = True  # they just proved control of the inbox
    db.add(AuditLog(user_id=user.id, action="auth.password_reset", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id, user.token_version)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user), access_token=token)


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
