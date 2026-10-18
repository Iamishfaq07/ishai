"""Two-step sign-in (Settings → Security): a code from an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 s)
after the password, or after Google. Ten single-use recovery codes for a lost phone.

- The shared secret is stored encrypted (ORBIT_CONFIG_SECRET; a key derived from the JWT secret outside production).
- A code is accepted for the current 30 s step and one either side, and never twice (the last used step is kept).
- Recovery codes are random (40 bits each) and stored only as SHA-256 hashes; each works once.
- Signing in with the second step on: the password (or Google) gives a 5-minute challenge, not a session; the code
  turns the challenge into a session. Google's redirect carries the challenge in a short httpOnly cookie, never in
  the URL. Wrong codes are throttled per account.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.parse import quote

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.alerts import alert
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user, decode_claims, drop_cookie, token_from_request, verify_password
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User, UserTwoFactor
from orbit_api.ratelimit import TokenBucket, attempt, limit, limit_user, succeeded
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/auth", tags=["auth"])
STEP_S = 30
DIGITS = 6
WINDOW = 1  # steps either side of now
RECOVERY_CODES = 10
CHALLENGE_TTL_S = 300
CHALLENGE_COOKIE = "orbit_2fa"
ISSUER = "Orbit"
_wrong_codes = TokenBucket(rate_per_s=5 / 900, burst=5)  # 5 wrong codes per account per 15 min
_wrong_setting_codes = TokenBucket(rate_per_s=5 / 900, burst=5)  # the same, to turn it off or get new codes
settings_limit = Depends(limit_user("auth-2fa", rate_per_s=1, burst=10))
# The code step per network too, like the password step (auth_limit): the per-account throttle alone let one network
# work through many accounts' challenges at full speed.
code_ip_limit = Depends(limit("auth-2fa-code", rate_per_s=0.2, burst=10))


# ---- TOTP ---------------------------------------------------------------------------------------------------------


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret_b32: str) -> bytes:
    return base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8), casefold=True)


def code_at(secret_b32: str, step: int) -> str:
    digest = hmac.new(_key(secret_b32), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def matching_step(secret_b32: str, code: str, now: float | None = None, after_step: int = -1) -> int | None:
    """The step `code` belongs to (now, or one either side), if it's later than `after_step` (no replays)."""
    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) != DIGITS:
        return None
    current = int((now if now is not None else time.time()) // STEP_S)
    for step in range(current - WINDOW, current + WINDOW + 1):
        if step > after_step and hmac.compare_digest(code_at(secret_b32, step), code):
            return step
    return None


def otpauth_uri(secret_b32: str, email: str) -> str:
    label = quote(f"{ISSUER}:{email}")
    return f"otpauth://totp/{label}?secret={secret_b32}&issuer={ISSUER}&digits={DIGITS}&period={STEP_S}"


# ---- storage ------------------------------------------------------------------------------------------------------


def _fernet() -> Fernet:
    s = get_settings()
    source = s.config_secret.get_secret_value() if s.config_secret else "2fa:" + s.jwt_secret.get_secret_value()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest()))


def _seal(secret_b32: str) -> str:
    return _fernet().encrypt(secret_b32.encode()).decode()


def _open(sealed: str) -> str | None:
    try:
        return _fernet().decrypt(sealed.encode()).decode()
    except InvalidToken:
        return None


def _hash(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().lower().encode()).hexdigest()


def new_recovery_codes() -> list[str]:
    out = []
    for _ in range(RECOVERY_CODES):
        raw = base64.b32encode(secrets.token_bytes(5)).decode().lower()
        out.append(f"{raw[:4]}-{raw[4:]}")
    return out


async def enabled(db: AsyncSession, user_id: str) -> bool:
    row = await db.get(UserTwoFactor, user_id)
    return row is not None and row.enabled_at is not None


async def check_code(db: AsyncSession, row: UserTwoFactor, code: str) -> bool:
    """A current authenticator code (not one used before) or an unused recovery code; uses it up either way."""
    secret = _open(row.secret_enc)
    if secret is None:
        return False
    step = matching_step(secret, code, after_step=row.last_step if row.last_step is not None else -1)
    if step is not None:
        row.last_step = step
        return True
    hashed = _hash(code)
    left = list(row.recovery_hashes or [])
    if hashed in left:
        left.remove(hashed)
        row.recovery_hashes = left
        return True
    return False


# ---- the sign-in challenge ----------------------------------------------------------------------------------------


def _challenge_key() -> bytes:
    # Not the session key: a challenge must never pass for a session token (and security.decode_claims refuses any
    # token carrying "purpose" too).
    secret = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(secret, b"orbit 2fa challenge", hashlib.sha256).digest()


def challenge_for(user: User) -> str:
    now = int(time.time())
    payload = {"sub": user.id, "ver": user.token_version, "purpose": "2fa", "iat": now, "exp": now + CHALLENGE_TTL_S}
    return jwt.encode(payload, _challenge_key(), algorithm="HS256")


def read_challenge(token: str) -> dict[str, Any] | None:
    try:
        claims: dict[str, Any] = jwt.decode(token, _challenge_key(), algorithms=["HS256"],
                                            options={"require": ["sub", "exp", "purpose"]})
    except jwt.PyJWTError:
        return None
    return claims if claims.get("purpose") == "2fa" else None


class TwoFactorChallenge(BaseModel):
    """Login answer when the account has the second step on: no session yet, only this."""

    two_factor_required: bool = True
    challenge: str


class SecondStepIn(BaseModel):
    challenge: str | None = Field(None, max_length=2000)  # absent after Google: it's in the httpOnly cookie
    code: str = Field(min_length=6, max_length=20)


@router.post("/login/2fa", dependencies=[code_ip_limit])
async def second_step(body: SecondStepIn, request: Request, response: Response,
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    """Finish signing in with a code from the authenticator app (or a recovery code)."""
    from orbit_api.auth.routes import _auth_out, _ip

    claims = read_challenge(body.challenge or request.cookies.get(CHALLENGE_COOKIE, ""))
    user = await db.get(User, claims["sub"]) if claims else None
    if user is None or claims is None or claims.get("ver", 0) != user.token_version or user.suspended_at:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That sign-in timed out. Start again.")
    # The token is taken before the code is checked (and given back if it's right): wrong codes sent all at once
    # can't each pass a check made before the first of them is counted.
    if not attempt(_wrong_codes, user.id):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong codes. Try again in 15 minutes.")
    # One code check at a time per account, so the same code (or recovery code) sent twice at once is used once.
    await lock_account(db, user.id)
    row = await db.get(UserTwoFactor, user.id)
    if row is None or row.enabled_at is None or not await check_code(db, row, body.code):
        await db.commit()  # a used recovery code stays used even when the rest fails
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code didn't work. Check the time on your phone.")
    succeeded(_wrong_codes, user.id)
    db.add(AuditLog(user_id=user.id, action="auth.login_2fa", ip=_ip(request)))
    await db.commit()
    drop_cookie(response, request, CHALLENGE_COOKIE)
    return await _auth_out(request, response, user, db)


# ---- settings -----------------------------------------------------------------------------------------------------


class StatusOut(BaseModel):
    enabled: bool
    recovery_left: int
    enabled_at: datetime | None


@router.get("/2fa", response_model=StatusOut, dependencies=[settings_limit])
async def two_factor_status(user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> StatusOut:
    row = await db.get(UserTwoFactor, user.id)
    on = row is not None and row.enabled_at is not None
    return StatusOut(enabled=on, recovery_left=len(row.recovery_hashes or []) if on and row else 0,
                     enabled_at=row.enabled_at if on and row else None)


class SetupIn(BaseModel):
    password: str = Field("", max_length=256)


class SetupOut(BaseModel):
    secret: str
    otpauth_uri: str


RECENT_SIGN_IN_S = 15 * 60
SIGN_IN_AGAIN = "For your security, sign out and sign in with Google again, then do this within 15 minutes."


async def _confirm_password(request: Request, user: User, password: str) -> None:
    """The password again, for an account that has one. One made with Google has only a random hash nobody knows
    (`has_password` false; the web app asks for nothing), so a recent sign-in stands in for it: a session left open
    or stolen can't add a way in (a passkey skips this step and outlives "sign out everywhere") or lock the owner
    out with an authenticator they don't have."""
    if user.has_password:
        if not await verify_password(password, user.password_hash):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "That password isn't right.")
        return
    require_recent_sign_in(request)


def require_recent_sign_in(request: Request) -> None:
    """403 unless this request's session signed in within RECENT_SIGN_IN_S (the `auth` claim, kept across renewals):
    what an account without a password (made with Google) shows instead of typing one."""
    claims = decode_claims(token_from_request(request) or "") or {}
    signed_in = int(claims.get("auth") or claims.get("iat") or 0)
    if time.time() - signed_in > RECENT_SIGN_IN_S:
        raise HTTPException(status.HTTP_403_FORBIDDEN, SIGN_IN_AGAIN)


@router.post("/2fa/setup", response_model=SetupOut, dependencies=[settings_limit])
async def setup(body: SetupIn, request: Request, user: Annotated[User, Depends(require_verified_email)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> SetupOut:
    """Start (or restart) setting up: a new secret for the app, not on until a code from it is entered."""
    await _confirm_password(request, user, body.password)
    row = await db.get(UserTwoFactor, user.id)
    if row is not None and row.enabled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step sign-in is already on. Turn it off first.")
    secret = new_secret()
    if row is None:
        db.add(UserTwoFactor(user_id=user.id, secret_enc=_seal(secret)))
    else:
        row.secret_enc, row.last_step, row.recovery_hashes = _seal(secret), None, None
    await db.commit()
    return SetupOut(secret=secret, otpauth_uri=otpauth_uri(secret, user.email))


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class CodesOut(BaseModel):
    recovery_codes: list[str]


@router.post("/2fa/enable", response_model=CodesOut, dependencies=[settings_limit])
async def enable(body: CodeIn, request: Request, background: BackgroundTasks,
                 user: Annotated[User, Depends(require_verified_email)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> CodesOut:
    """Turn it on with a first code from the app; the recovery codes are shown this once."""
    from orbit_api.auth.routes import _ip

    row = await db.get(UserTwoFactor, user.id)
    secret = _open(row.secret_enc) if row else None
    if row is None or secret is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the setup first.")
    if row.enabled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step sign-in is already on.")
    step = matching_step(secret, body.code)
    if step is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't work. Check the time on your phone.")
    codes = new_recovery_codes()
    row.enabled_at, row.last_step, row.recovery_hashes = datetime.now(UTC), step, [_hash(c) for c in codes]
    db.add(AuditLog(user_id=user.id, action="auth.2fa_on", ip=_ip(request)))
    await db.commit()
    alert(background, user, "auth.2fa_on", request)
    return CodesOut(recovery_codes=codes)


async def _settings_code(db: AsyncSession, user: User, code: str) -> UserTwoFactor:
    """The account's second step, once `code` checks out (it's used up). Wrong codes are throttled as at sign-in, so a
    session left open can't guess its way to turning it off; counted apart from sign-in's, so it can't use those up
    to block the owner either."""
    if not attempt(_wrong_setting_codes, user.id):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many wrong codes. Try again in 15 minutes.")
    await lock_account(db, user.id)
    row = await db.get(UserTwoFactor, user.id)
    if row is None or row.enabled_at is None or not await check_code(db, row, code):
        await db.commit()  # a used recovery code stays used
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't work.")
    succeeded(_wrong_setting_codes, user.id)
    return row


@router.post("/2fa/recovery-codes", response_model=CodesOut, dependencies=[settings_limit])
async def regenerate(body: CodeIn, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> CodesOut:
    """New recovery codes (the old ones stop working), with a current code."""
    row = await _settings_code(db, user, body.code)
    codes = new_recovery_codes()
    row.recovery_hashes = [_hash(c) for c in codes]
    await db.commit()
    return CodesOut(recovery_codes=codes)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT, dependencies=[settings_limit])
async def disable(body: CodeIn, request: Request, background: BackgroundTasks,
                  user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Turn it off, with a current code or a recovery code."""
    from orbit_api.auth.routes import _ip

    row = await _settings_code(db, user, body.code)
    await db.delete(row)
    db.add(AuditLog(user_id=user.id, action="auth.2fa_off", ip=_ip(request)))
    await db.commit()
    alert(background, user, "auth.2fa_off", request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
