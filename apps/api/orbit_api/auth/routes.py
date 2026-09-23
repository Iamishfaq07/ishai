from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import (
    COOKIE_NAME,
    create_access_token,
    current_user,
    hash_password,
    verify_password,
)
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User
from orbit_api.ratelimit import limit

router = APIRouter(prefix="/v1/auth", tags=["auth"])
auth_limit = limit("auth", rate_per_s=0.2, burst=10)


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
    store_transcripts: bool
    store_screenshots: bool


class AuthOut(BaseModel):
    user: UserOut
    access_token: str


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, store_transcripts=u.store_transcripts,
                   store_screenshots=u.store_screenshots)


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=s.env == "production", samesite="lax",
                        max_age=s.jwt_ttl_minutes * 60, path="/")


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/register", response_model=AuthOut, status_code=201, dependencies=[Depends(auth_limit)])
async def register(body: RegisterIn, request: Request, response: Response,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    email = body.email.lower()
    if await db.scalar(select(func.count()).select_from(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="auth.register", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user), access_token=token)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(auth_limit)])
async def login(body: LoginIn, request: Request, response: Response,
                db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    db.add(AuditLog(user_id=user.id, action="auth.login", ip=_ip(request)))
    await db.commit()
    token = create_access_token(user.id)
    _set_cookie(response, token)
    return AuthOut(user=_user_out(user), access_token=token)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> Response:
    response.delete_cookie(COOKIE_NAME, path="/")
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
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response
