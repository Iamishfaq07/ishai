"""Sign in from the iOS app: a Google or Apple identity token, checked here, then the same Bearer session a password
sign-in gives (including the authenticator step when it's on).

The app does the provider's own sign-in sheet and sends us the signed token it got. We check the signature, issuer,
audience and nonce, then find or create the account exactly as the web "Continue with Google" does (a verified email
that already has an account signs into it and links; nothing else is attached silently).
"""

import logging
from asyncio import to_thread
from typing import Annotated, Any, NoReturn

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth import google
from orbit_api.auth.google import GoogleDenied
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import User

log = logging.getLogger(__name__)

_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUER = "https://appleid.apple.com"
_apple_jwks = jwt.PyJWKClient(_APPLE_JWKS_URL, timeout=5, lifespan=3600)


class GoogleNativeIn(BaseModel):
    id_token: str = Field(min_length=20, max_length=8192)
    nonce: str = Field(min_length=16, max_length=256)
    ref: str | None = Field(None, max_length=64)


class AppleNativeIn(BaseModel):
    identity_token: str = Field(min_length=20, max_length=8192)
    nonce: str = Field(min_length=16, max_length=256)
    # Apple gives the name only on the first authorisation, and only to the app, never inside the token.
    name: str | None = Field(None, max_length=200)
    ref: str | None = Field(None, max_length=64)


async def verify_apple_token(identity_token: str, nonce: str) -> dict[str, Any]:
    """Check a Sign in with Apple identity token. The email may be missing after the first sign-in (Apple's choice),
    in which case the caller finds the account by `sub` alone."""
    bundle = (get_settings().apple_bundle_id or "").strip()
    try:
        key = await to_thread(_apple_jwks.get_signing_key_from_jwt, identity_token)
        claims: dict[str, Any] = jwt.decode(identity_token, key.key, algorithms=["RS256"], audience=bundle,
                                            issuer=_APPLE_ISSUER)
    except (jwt.PyJWTError, OSError, TimeoutError) as err:
        raise GoogleDenied("apple") from err
    if not google.nonce_matches(claims.get("nonce"), nonce):
        raise GoogleDenied("apple")
    sub = str(claims.get("sub") or "")
    if not sub:
        raise GoogleDenied("apple")
    email = str(claims.get("email") or "").strip().lower()
    verified = claims.get("email_verified") is True or claims.get("email_verified") == "true"
    if email and not verified:
        raise GoogleDenied("unverified")
    return {"sub": sub[:255], "email": email, "name": None}


def _refuse(provider: str, denied: GoogleDenied) -> NoReturn:
    if denied.code == "suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended.")
    if denied.code == "private":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Orbit isn't open to this email address.")
    if denied.code == "unverified":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Your {provider} account has no verified email address.")
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Couldn't sign in with {provider}. Please try again.")


def mount(router: APIRouter) -> None:
    from orbit_api.auth.routes import AuthOut, _auth_out, auth_limit
    from orbit_api.auth.two_factor import TwoFactorChallenge, challenge_for, enabled

    async def finish(request: Request, response: Response, db: AsyncSession, user: User,
                     ) -> AuthOut | TwoFactorChallenge:
        if await enabled(db, user.id):  # the provider proved who it is; the authenticator code still comes next
            return TwoFactorChallenge(challenge=challenge_for(user))
        return await _auth_out(request, response, user, db)

    @router.post("/google/native", response_model=AuthOut | TwoFactorChallenge, dependencies=[Depends(auth_limit)])
    async def google_native(body: GoogleNativeIn, request: Request, response: Response,
                            db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut | TwoFactorChallenge:
        audiences = get_settings().google_native_audiences
        if not audiences:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Google sign-in is not available.")
        try:
            ident = await google.verify_id_token(body.id_token, audiences, body.nonce)
            from orbit_api.billing.referrals import normalize

            user, _, _ = await google._find_or_create(db, request, ident, normalize(body.ref))
        except GoogleDenied as denied:
            _refuse("Google", denied)
        return await finish(request, response, db, user)

    @router.post("/apple", response_model=AuthOut | TwoFactorChallenge, dependencies=[Depends(auth_limit)])
    async def apple_native(body: AppleNativeIn, request: Request, response: Response,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut | TwoFactorChallenge:
        if not get_settings().apple_enabled:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sign in with Apple is not available.")
        try:
            ident = await verify_apple_token(body.identity_token, body.nonce)
            if not ident["email"]:
                known = await db.scalar(select(User).where(User.apple_sub == ident["sub"]))
                if known is None:
                    raise GoogleDenied("unverified")
                ident["email"] = known.email
            ident["name"] = (body.name or "").strip()[:200] or None
            from orbit_api.billing.referrals import normalize

            user, _, _ = await google._find_or_create(db, request, ident, normalize(body.ref),
                                                      column="apple_sub", audit="auth.apple")
        except GoogleDenied as denied:
            _refuse("Apple", denied)
        return await finish(request, response, db, user)
