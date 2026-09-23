import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import User

COOKIE_NAME = "orbit_session"
_hasher = PasswordHasher()
# Verified against when the email doesn't exist so login timing doesn't reveal account existence.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str | None) -> bool:
    try:
        return _hasher.verify(hashed or _DUMMY_HASH, password) and hashed is not None
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: str) -> str:
    s = get_settings()
    now = int(time.time())
    payload = {"sub": user_id, "iat": now, "exp": now + s.jwt_ttl_minutes * 60, "jti": uuid.uuid4().hex}
    return jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256")


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret.get_secret_value(), algorithms=["HS256"],
                             options={"require": ["sub", "exp"]})
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)


async def current_user(request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    token = token_from_request(request)
    user_id = decode_access_token(token) if token else None
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


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
