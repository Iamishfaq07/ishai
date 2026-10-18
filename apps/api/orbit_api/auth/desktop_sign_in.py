"""Continue with Google from the desktop app (D81): RFC 8252 loopback redirect + PKCE, on top of the web's Google flow.

The app makes a PKCE verifier, a state and a one-shot listener on 127.0.0.1, and opens the system browser at
`/v1/auth/google/start?desktop_port=..&desktop_challenge=..&desktop_state=..`. Those ride through Google's page in the
signed state cookie. When Google comes back, the API doesn't set a web session: it mints a short, single-use code bound
to the challenge and sends the browser to `http://127.0.0.1:<port>/callback?code=..&state=..` (or `?error=..`). The app
trades the code and its verifier at POST /v1/auth/desktop/exchange for the same answer an email/password sign-in gets
(a token for the keychain, or the two-step challenge).

- The browser only ever goes to 127.0.0.1 on a port from 1024-65535: never a host from the request.
- Codes live 60 s, work once (a wrong verifier spends it too), and are kept only as SHA-256 hashes, in process memory
  like the live WebSocket tickets (security.py): one API instance (config.api_replicas), and a deploy in the middle of
  a sign-in only means pressing the button again.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from base64 import urlsafe_b64encode
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db import get_db
from orbit_api.models import AuditLog, User

CODE_TTL_S = 60
MIN_PORT, MAX_PORT = 1024, 65535
_CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")  # base64url(SHA-256), unpadded
_STATE = re.compile(r"[A-Za-z0-9_-]{16,128}")
_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}")  # RFC 7636 §4.1
EXPIRED = "That sign-in expired or was already used. Press Continue with Google again."


@dataclass(frozen=True)
class Desktop:
    """Where a desktop sign-in returns to: the app's loopback port, its PKCE challenge, and its state."""

    port: int
    challenge: str
    state: str


def parse(port: str | None, challenge: str | None, state: str | None) -> Desktop | None:
    """The desktop parameters of a start request, or None if they're absent or anything is off (bad port, a
    challenge that isn't an S256 one, a state of the wrong shape): such a start is treated as the web's."""
    if port is None or challenge is None or state is None:
        return None
    if not port.isascii() or not port.isdigit() or len(port) > 5:
        return None
    number = int(port)
    if not MIN_PORT <= number <= MAX_PORT or not _CHALLENGE.fullmatch(challenge) or not _STATE.fullmatch(state):
        return None
    return Desktop(number, challenge, state)


def requested(port: str | None, challenge: str | None, state: str | None) -> bool:
    return port is not None or challenge is not None or state is not None


def claims(desktop: Desktop) -> dict[str, str | int]:
    return {"dp": desktop.port, "dc": desktop.challenge, "ds": desktop.state}


def from_claims(data: Mapping[str, object]) -> Desktop | None:
    port, challenge, state = data.get("dp"), data.get("dc"), data.get("ds")
    if not isinstance(port, int) or not isinstance(challenge, str) or not isinstance(state, str):
        return None
    return parse(str(port), challenge, state)


def loopback(desktop: Desktop, **params: str) -> str:
    """The app's listener. Always 127.0.0.1 (RFC 8252 §7.3: not "localhost", which a hosts file can point elsewhere)."""
    query = urlencode({**params, "state": desktop.state})
    return f"http://127.0.0.1:{desktop.port}/callback?{query}"


def s256(verifier: str) -> str:
    return urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


# ---- single-use codes ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Grant:
    user_id: str
    token_version: int
    challenge: str
    expires_at: float


_grants: dict[str, _Grant] = {}


def _clock() -> float:
    return time.monotonic()


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def mint(user: User, desktop: Desktop) -> str:
    now = _clock()
    for key in [k for k, g in _grants.items() if g.expires_at < now]:
        del _grants[key]
    code = secrets.token_urlsafe(32)
    _grants[_hash(code)] = _Grant(user.id, user.token_version, desktop.challenge, now + CODE_TTL_S)
    return code


def redeem(code: str, verifier: str) -> _Grant | None:
    """The code's grant if it's known, unexpired and `verifier` matches its challenge. Spent either way."""
    grant = _grants.pop(_hash(code), None)
    if grant is None or grant.expires_at < _clock():
        return None
    return grant if hmac.compare_digest(s256(verifier), grant.challenge) else None


def forget_all() -> None:
    """Tests."""
    _grants.clear()


# ---- the exchange --------------------------------------------------------------------------------------------------


class ExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    verifier: str = Field(min_length=43, max_length=128, pattern=_VERIFIER.pattern)


def mount(router: APIRouter) -> None:
    from orbit_api.auth.routes import AuthOut, auth_limit
    from orbit_api.auth.two_factor import TwoFactorChallenge

    @router.post("/desktop/exchange", response_model=AuthOut | TwoFactorChallenge,
                 dependencies=[Depends(auth_limit)])
    async def desktop_exchange(body: ExchangeIn, request: Request, response: Response,
                               db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut | TwoFactorChallenge:
        """Trade the loopback code and the PKCE verifier for the desktop's sign-in (as POST /v1/auth/login answers)."""
        from orbit_api.auth.routes import _auth_out, _ip
        from orbit_api.auth.security import NOT_ALLOWED, suspended_detail
        from orbit_api.auth.two_factor import challenge_for
        from orbit_api.auth.two_factor import enabled as two_factor_enabled
        from orbit_api.config import get_settings

        grant = redeem(body.code, body.verifier)
        user = await db.get(User, grant.user_id) if grant else None
        # "Sign out everywhere" (or a claimed account) between Google and here: this code is from before it.
        if grant is None or user is None or user.token_version != grant.token_version:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, EXPIRED)
        if not get_settings().email_allowed(user.email):
            raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
        if user.suspended_at is not None:
            db.add(AuditLog(user_id=user.id, action="auth.login_suspended", ip=_ip(request)))
            await db.commit()
            raise HTTPException(status.HTTP_403_FORBIDDEN, suspended_detail(user))
        if await two_factor_enabled(db, user.id):
            # As after Google on the web and after a password: the authenticator code comes next.
            return TwoFactorChallenge(challenge=challenge_for(user))
        db.add(AuditLog(user_id=user.id, action="auth.google_desktop", ip=_ip(request)))
        await db.commit()
        return await _auth_out(request, response, user, db)
