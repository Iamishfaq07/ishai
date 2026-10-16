import asyncio
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import User
from orbit_api.observability import user_id_var

COOKIE_NAME = "orbit_session"
NOT_ALLOWED = "This Orbit server is private. Ask the owner to add your email."
# OWASP's argon2id baseline (19 MiB, t=2, p=1): ~5x less CPU than the library default, which took ~2 s
# per sign-in on a 0.1-CPU host. Older hashes carry their own parameters, verify fine, and are upgraded
# on the next sign-in (needs_rehash).
_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
# Verified against when the email doesn't exist so login timing doesn't reveal account existence.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


# Hashing is deliberately CPU-heavy: run it off the event loop so a sign-in never stalls live sessions.
async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


def _verify(password: str, hashed: str | None) -> bool:
    try:
        return _hasher.verify(hashed or _DUMMY_HASH, password) and hashed is not None
    except (VerificationError, InvalidHashError):
        return False


async def verify_password(password: str, hashed: str | None) -> bool:
    return await asyncio.to_thread(_verify, password, hashed)


def needs_rehash(hashed: str) -> bool:
    return _hasher.check_needs_rehash(hashed)


def _now() -> int:
    return int(time.time())


def create_access_token(user_id: str, token_version: int = 0, *, idle: bool = False,
                        signed_in_at: int | None = None, sid: str | None = None) -> str:
    """A session JWT. `signed_in_at` (claim `auth`) is when the person actually signed in, carried across renewals so
    the hard cap (ORBIT_JWT_TTL) counts from there. `idle` tokens (web cookies) also expire after
    ORBIT_SESSION_IDLE_HOURS and are renewed while in use (see `current_user`)."""
    s = get_settings()
    now = _now()
    auth_time = signed_in_at or now
    exp = auth_time + s.jwt_ttl_minutes * 60
    if idle:
        exp = min(exp, now + int(s.session_idle_hours * 3600))
    payload: dict[str, Any] = {"sub": user_id, "ver": token_version, "iat": now, "exp": exp, "auth": auth_time,
                               "idle": idle, "jti": uuid.uuid4().hex}
    if sid:
        payload["sid"] = sid  # the signed-in device (auth/devices.py), kept across renewals
    return jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256")


def decode_claims(token: str) -> dict[str, Any] | None:
    try:
        payload: dict[str, Any] = jwt.decode(token, get_settings().jwt_secret.get_secret_value(),
                                             algorithms=["HS256"], options={"require": ["sub", "exp"]})
    except jwt.PyJWTError:
        return None
    if not isinstance(payload.get("sub"), str) or not isinstance(payload.get("ver", 0), int):
        return None
    return payload


def decode_access_token(token: str) -> tuple[str, int] | None:
    """Returns (user_id, token_version) for a valid, unexpired token."""
    claims = decode_claims(token)
    return (claims["sub"], claims.get("ver", 0)) if claims else None


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)


# A web cookie is re-issued at most this often while it's being used.
RENEW_AFTER_S = 15 * 60
SUSPENDED = "account_suspended"


def suspended_detail(user: User) -> dict[str, str]:
    """What a suspended account's owner is told when they sign in or call the API: that it's suspended, and the
    admin's reason. No address of the admin's (they can add a way to reach them to the reason)."""
    reason = " ".join((user.suspended_reason or "").split())
    if reason and not reason.endswith((".", "!", "?")):
        reason += "."
    message = "Your Orbit account is suspended." + (f" Reason: {reason}" if reason else "")
    message += " If you think this is a mistake, get in touch with the Orbit team."
    return {"code": SUSPENDED, "message": message}


async def current_user(request: Request, response: Response,
                       db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    token = token_from_request(request)
    claims = decode_claims(token) if token else None
    user = await db.get(User, claims["sub"]) if claims else None
    # A token minted before the last password reset / sign-out-everywhere is dead.
    if user is None or claims is None or claims.get("ver", 0) != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    # This device signed out from another one (Settings → Security → Devices).
    from orbit_api.auth.devices import check_session

    sid = claims.get("sid") if isinstance(claims.get("sid"), str) else None
    if not await check_session(db, user, sid):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    # Re-checked per request so tightening ORBIT_ALLOWED_EMAILS cuts off existing accounts too.
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    # Suspending also signs the account out everywhere; this catches anything minted in between.
    if user.suspended_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, suspended_detail(user))
    user_id_var.set(user.id)  # correlation id for this request's log lines
    from_cookie = not request.headers.get("authorization", "").lower().startswith("bearer ")
    if from_cookie and claims.get("idle") and _now() - int(claims.get("iat", 0)) >= RENEW_AFTER_S:
        set_session_cookie(response, create_access_token(user.id, user.token_version, idle=True,
                                                         signed_in_at=int(claims.get("auth") or claims["iat"]),
                                                         sid=sid))
    return user


async def optional_user(request: Request, response: Response,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> User | None:
    """The signed-in account, or None, for routes anyone may use (the Contact page). Whatever `current_user` would
    refuse (no token, an old one, a suspended or no-longer-allowed account) is None here: the caller is treated as
    signed out, never told why."""
    if not token_from_request(request):
        return None
    try:
        return await current_user(request, response, db)
    except HTTPException:
        return None


def cookie_policy() -> tuple[bool, Literal["lax", "strict", "none"]]:
    """(secure, samesite). In production the web app reaches the API through its own /api proxy, so the cookie is
    first-party and SameSite=Lax (ORBIT_COOKIE_SAMESITE) keeps it off cross-site requests; always Secure there.
    Locally (same-site over plain http) Lax without Secure."""
    s = get_settings()
    if s.env == "production":
        return True, s.cookie_samesite
    return (True, "none") if s.cookie_samesite == "none" else (False, s.cookie_samesite)


def set_session_cookie(response: Response, token: str) -> None:
    # Our own freshly minted token: read its expiry, no need to re-validate it.
    exp = int(jwt.decode(token, options={"verify_signature": False}).get("exp", 0))
    secure, samesite = cookie_policy()
    max_age = max(0, exp - _now())
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure, samesite=samesite, max_age=max_age,
                        path="/")


# ---- single-use WebSocket tickets --------------------------------------------------------------------
# In-process store: fine for one API instance. Move to Redis (SET NX EX) before scaling horizontally.

TICKET_TTL_S = 60


@dataclass
class _Ticket:
    user_id: str
    session_id: str
    expires_at: float


_tickets: dict[str, _Ticket] = {}


def issue_ticket(user_id: str, session_id: str) -> str:
    now = time.monotonic()
    for k in [k for k, t in _tickets.items() if t.expires_at < now]:
        del _tickets[k]
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = _Ticket(user_id, session_id, now + TICKET_TTL_S)
    return ticket


def redeem_ticket(ticket: str, session_id: str) -> str | None:
    t = _tickets.pop(ticket, None)
    if t is None or t.expires_at < time.monotonic() or t.session_id != session_id:
        return None
    return t.user_id
