"""Passkeys (Settings → Security): sign in with the phone's or laptop's own unlock (fingerprint, face, PIN) instead
of a password. WebAuthn, via py_webauthn.

- Orbit keeps only each passkey's public key; the private key stays in the device or password manager.
- The relying party is the web app's own host (ORBIT_WEB_URL), so a passkey works only on Orbit's real site: a
  look-alike domain can't use it. That makes it phishing-resistant, and it needs the device unlock (user
  verification), so a passkey sign-in doesn't also ask for the authenticator code.
- Every challenge is random, single use (deleted when used) and lasts five minutes; only its SHA-256 is stored.
- Adding one asks for the password again (accounts that have one), like turning on two-step sign-in.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from orbit_api.auth.alerts import alert
from orbit_api.auth.devices import device_label
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import NOT_ALLOWED, current_user, suspended_detail
from orbit_api.auth.two_factor import SetupIn, _confirm_password
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, PasskeyChallenge, User, UserPasskey
from orbit_api.ratelimit import limit, limit_user

router = APIRouter(prefix="/v1/auth", tags=["auth"])
CHALLENGE_TTL = timedelta(minutes=5)
MAX_PASSKEYS = 10
RP_NAME = "Orbit"
settings_limit = Depends(limit_user("auth-passkeys", rate_per_s=1, burst=20))
login_limit = Depends(limit("auth-passkey-login", rate_per_s=0.5, burst=20))
_BAD = (WebAuthnException, ValueError, KeyError, TypeError)


def relying_party() -> tuple[str, str]:
    """(RP ID, origin): the web app's host and its exact origin."""
    parts = urlsplit(get_settings().web_url)
    return (parts.hostname or "localhost").lower(), f"{parts.scheme}://{parts.netloc}".lower()


def _hash(challenge: bytes) -> str:
    return hashlib.sha256(challenge).hexdigest()


async def _new_challenge(db: AsyncSession, purpose: Literal["register", "login"], user_id: str | None) -> bytes:
    now = datetime.now(UTC)
    await db.execute(delete(PasskeyChallenge).where(PasskeyChallenge.expires_at < now))
    challenge = secrets.token_bytes(32)
    db.add(PasskeyChallenge(challenge_hash=_hash(challenge), purpose=purpose, user_id=user_id,
                            expires_at=now + CHALLENGE_TTL))
    await db.commit()
    return challenge


def _client_challenge(credential: dict[str, Any]) -> bytes:
    """The challenge the browser signed, read from its clientDataJSON (verified against ours afterwards)."""
    client_data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
    return base64url_to_bytes(str(client_data["challenge"]))


async def _use_challenge(db: AsyncSession, challenge: bytes, purpose: str, user_id: str | None) -> bool:
    """Spend a challenge: true once, for one that's ours, unexpired, for this purpose (and this account)."""
    query = delete(PasskeyChallenge).where(PasskeyChallenge.challenge_hash == _hash(challenge),
                                           PasskeyChallenge.purpose == purpose,
                                           PasskeyChallenge.expires_at >= datetime.now(UTC))
    if user_id is not None:
        query = query.where(PasskeyChallenge.user_id == user_id)
    spent = await db.execute(query)
    await db.commit()
    return bool(getattr(spent, "rowcount", 0) == 1)


# ---- adding and managing passkeys ---------------------------------------------------------------------------------


class PasskeyOut(BaseModel):
    id: str
    name: str
    backed_up: bool
    created_at: datetime
    last_used_at: datetime | None


def _out(p: UserPasskey) -> PasskeyOut:
    return PasskeyOut(id=p.id, name=p.name, backed_up=p.backed_up, created_at=p.created_at,
                      last_used_at=p.last_used_at)


async def _mine(db: AsyncSession, user: User) -> list[UserPasskey]:
    return list((await db.scalars(select(UserPasskey).where(UserPasskey.user_id == user.id)
                                  .order_by(UserPasskey.created_at))).all())


@router.get("/passkeys", response_model=list[PasskeyOut], dependencies=[settings_limit])
async def list_passkeys(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> list[PasskeyOut]:
    return [_out(p) for p in await _mine(db, user)]


class OptionsOut(BaseModel):
    """PublicKeyCredentialCreationOptions / RequestOptions as JSON: binary fields base64url, for the browser."""

    options: dict[str, Any]


@router.post("/passkeys/options", response_model=OptionsOut, dependencies=[settings_limit])
async def registration_options(body: SetupIn, request: Request,
                               user: Annotated[User, Depends(require_verified_email)],
                               db: Annotated[AsyncSession, Depends(get_db)]) -> OptionsOut:
    """Start adding a passkey: the password again (when the account has one; else a recent sign-in), then what the
    browser asks for."""
    await _confirm_password(request, user, body.password)
    existing = await _mine(db, user)
    if len(existing) >= MAX_PASSKEYS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You have {MAX_PASSKEYS} passkeys. Remove one first.")
    rp_id, _ = relying_party()
    options = generate_registration_options(
        rp_id=rp_id, rp_name=RP_NAME, user_id=user.id.encode(), user_name=user.email,
        user_display_name=user.name or user.email, challenge=await _new_challenge(db, "register", user.id),
        timeout=int(CHALLENGE_TTL.total_seconds() * 1000),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED),
        # Not the same device twice: the browser says so instead of making a duplicate.
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(p.credential_id))
                             for p in existing],
    )
    return OptionsOut(options=json.loads(options_to_json(options)))


class RegisterIn(BaseModel):
    credential: dict[str, Any]
    name: str = Field("", max_length=60)


def _transports(credential: dict[str, Any]) -> list[str]:
    allowed = {t.value for t in AuthenticatorTransport}
    raw = credential.get("response", {}).get("transports") or []
    return [t for t in raw if isinstance(t, str) and t in allowed][:8]


@router.post("/passkeys", response_model=PasskeyOut, status_code=status.HTTP_201_CREATED,
             dependencies=[settings_limit])
async def add_passkey(body: RegisterIn, request: Request, background: BackgroundTasks,
                      user: Annotated[User, Depends(require_verified_email)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> PasskeyOut:
    """Finish adding a passkey with what the browser made."""
    from orbit_api.auth.routes import _ip

    rp_id, origin = relying_party()
    try:
        challenge = _client_challenge(body.credential)
    except _BAD as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That passkey couldn't be read. Try again.") from err
    if not await _use_challenge(db, challenge, "register", user.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That took too long. Start again.")
    try:
        verified = verify_registration_response(credential=body.credential, expected_challenge=challenge,
                                                expected_rp_id=rp_id, expected_origin=origin,
                                                require_user_verification=True)
    except _BAD as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That passkey couldn't be checked. Try again.") from err
    count = int(await db.scalar(select(func.count()).select_from(UserPasskey)
                                .where(UserPasskey.user_id == user.id)) or 0)
    if count >= MAX_PASSKEYS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You have {MAX_PASSKEYS} passkeys. Remove one first.")
    name = body.name.strip() or device_label(request.headers.get("user-agent", ""))[1] or "Passkey"
    passkey = UserPasskey(user_id=user.id, credential_id=bytes_to_base64url(verified.credential_id),
                          public_key=verified.credential_public_key, sign_count=verified.sign_count,
                          transports=_transports(body.credential), name=name[:60],
                          backed_up=bool(verified.credential_backed_up))
    db.add(passkey)
    db.add(AuditLog(user_id=user.id, action="auth.passkey_added", ip=_ip(request)))
    try:
        await db.commit()
    except IntegrityError as err:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That passkey is already added.") from err
    await db.refresh(passkey)
    alert(background, user, "auth.passkey_added", request)
    return _out(passkey)


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


async def _own(db: AsyncSession, user: User, passkey_id: str) -> UserPasskey:
    p = await db.get(UserPasskey, passkey_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such passkey")
    return p


@router.patch("/passkeys/{passkey_id}", response_model=PasskeyOut, dependencies=[settings_limit])
async def rename_passkey(passkey_id: str, body: RenameIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> PasskeyOut:
    p = await _own(db, user, passkey_id)
    p.name = body.name.strip()[:60] or p.name
    await db.commit()
    return _out(p)


@router.delete("/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[settings_limit])
async def remove_passkey(passkey_id: str, request: Request, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Remove a passkey. It also should be deleted from the device; Orbit can't do that part."""
    from orbit_api.auth.routes import _ip

    await db.delete(await _own(db, user, passkey_id))
    db.add(AuditLog(user_id=user.id, action="auth.passkey_removed", ip=_ip(request)))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- signing in ---------------------------------------------------------------------------------------------------


@router.post("/login/passkey/options", response_model=OptionsOut, dependencies=[login_limit])
async def login_options(db: Annotated[AsyncSession, Depends(get_db)]) -> OptionsOut:
    """Start a passkey sign-in. No email needed: the device offers the passkeys it has for Orbit."""
    rp_id, _ = relying_party()
    options = generate_authentication_options(rp_id=rp_id, challenge=await _new_challenge(db, "login", None),
                                              timeout=int(CHALLENGE_TTL.total_seconds() * 1000),
                                              user_verification=UserVerificationRequirement.REQUIRED)
    return OptionsOut(options=json.loads(options_to_json(options)))


class PasskeyLoginIn(BaseModel):
    credential: dict[str, Any]


NOT_RECOGNISED = "That passkey isn't one Orbit knows. Sign in another way, then add it in Settings."


@router.post("/login/passkey", dependencies=[login_limit])
async def login_with_passkey(body: PasskeyLoginIn, request: Request, response: Response,
                             db: Annotated[AsyncSession, Depends(get_db)]) -> Any:
    from orbit_api.auth.routes import _auth_out, _ip

    rp_id, origin = relying_party()
    try:
        challenge = _client_challenge(body.credential)
        credential_id = str(body.credential["id"])
    except _BAD as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That passkey couldn't be read. Try again.") from err
    if not await _use_challenge(db, challenge, "login", None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That sign-in timed out. Start again.")
    passkey = await db.scalar(select(UserPasskey).where(UserPasskey.credential_id == credential_id))
    user = await db.get(User, passkey.user_id) if passkey else None
    if passkey is None or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_RECOGNISED)
    try:
        verified = verify_authentication_response(
            credential=body.credential, expected_challenge=challenge, expected_rp_id=rp_id, expected_origin=origin,
            credential_public_key=passkey.public_key, credential_current_sign_count=passkey.sign_count,
            require_user_verification=True)
    except _BAD as err:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That passkey didn't check out. Try again.") from err
    # The user handle the device returned must be this account's (it is, unless something's very wrong).
    handle = body.credential.get("response", {}).get("userHandle")
    if handle and base64url_to_bytes(str(handle)) != user.id.encode():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_RECOGNISED)
    if not get_settings().email_allowed(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ALLOWED)
    if user.suspended_at is not None:
        db.add(AuditLog(user_id=user.id, action="auth.login_suspended", ip=_ip(request)))
        await db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, suspended_detail(user))
    passkey.sign_count = verified.new_sign_count
    passkey.backed_up = bool(verified.credential_backed_up)
    passkey.last_used_at = datetime.now(UTC)
    db.add(AuditLog(user_id=user.id, action="auth.login_passkey", ip=_ip(request)))
    await db.commit()
    return await _auth_out(request, response, user, db)
