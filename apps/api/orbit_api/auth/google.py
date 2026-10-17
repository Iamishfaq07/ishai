"""Continue with Google: authorization-code + PKCE, then the same session cookie as a password sign-in.

No Google script on the page. The browser is sent to Google and comes back here. A verified Google email
that already has an Orbit account is signed into that account (and linked), not given a second one.
"""

import contextlib
import hashlib
import logging
import re
import secrets
import time
from asyncio import to_thread
from base64 import urlsafe_b64encode
from typing import Annotated, Any
from urllib.parse import unquote, urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.auth.security import (
    cookie_policy,
    create_access_token,
    hash_password,
    set_session_cookie,
)
from orbit_api.billing.pricing import request_country
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import AuditLog, User
from orbit_api.ratelimit import client_ip

log = logging.getLogger(__name__)
GOOGLE_COOKIE = "orbit_google"
_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - Google's token endpoint, not a secret
_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
_NEXT = re.compile(r"/[A-Za-z0-9_./~%-]*")


class GoogleDenied(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


def safe_next(raw: str | None) -> str:
    """A path on this site. Anything else (another host, a scheme) becomes the home page."""
    if not raw or not raw.startswith("/") or raw.startswith("//") or "\\" in raw or len(raw) > 4096:
        return "/"
    path = raw.split("?", 1)[0]
    decoded = unquote(path)
    if decoded.startswith("//") or "\\" in decoded or any(ord(c) < 32 for c in raw):
        return "/"
    return raw if _NEXT.fullmatch(path) else "/"


def _local_api(host: str) -> bool:
    """The machine running the API. A Host that only starts with "localhost" is not local."""
    name = host
    if name.startswith("["):
        end = name.find("]")
        name = name[1:end] if end > 1 else name
    elif name.count(":") == 1:
        name = name.split(":", 1)[0]
    return name in {"localhost", "127.0.0.1", "::1"}


def redirect_uri(request: Request) -> str:
    s = get_settings()
    if s.google_redirect_uri:
        return s.google_redirect_uri.strip()
    host = (request.headers.get("host") or "").split(",")[0].strip()
    if _local_api(host):
        raw = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip().lower()
        scheme = raw if raw in {"http", "https"} else "http"
        prefix = "/api" if request.url.path.startswith("/api/") else ""
        return f"{scheme}://{host}{prefix}/v1/auth/google/callback"
    return f"{s.web_url.rstrip('/')}/api/v1/auth/google/callback"


def _login_url(code: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}/login?error={code}"


def _home(path: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}{path}"


def _pack(state: str, verifier: str, nxt: str, uri: str, ref: str | None = None) -> str:
    """The signed state cookie. `ref`: the invite or creator code of the link they came from (billing/referrals.py),
    carried through Google's page to the new account."""
    secret = get_settings().jwt_secret.get_secret_value()
    claims: dict[str, Any] = {"st": state, "cv": verifier, "nx": nxt, "ru": uri, "exp": int(time.time()) + 600}
    if ref:
        claims["rf"] = ref
    return jwt.encode(claims, secret, algorithm="HS256")


def _unpack(token: str) -> dict[str, Any] | None:
    try:
        data: dict[str, Any] = jwt.decode(token, get_settings().jwt_secret.get_secret_value(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if not all(isinstance(data.get(k), str) for k in ("st", "cv", "nx", "ru")):
        return None
    return data


def _set_state(response: Response, token: str) -> None:
    secure, samesite = cookie_policy()
    response.set_cookie(GOOGLE_COOKIE, token, httponly=True, secure=secure, samesite=samesite, max_age=600, path="/")


def _clear_state(response: Response) -> None:
    secure, samesite = cookie_policy()
    response.delete_cookie(GOOGLE_COOKIE, path="/", secure=secure, samesite=samesite, httponly=True)


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return urlsafe_b64encode(digest).rstrip(b"=").decode()


async def fetch_identity(code: str, verifier: str, uri: str) -> dict[str, Any]:
    """Exchange the code and check Google's signed id token. `email_verified` must be true."""
    s = get_settings()
    secret = s.google_client_secret.get_secret_value() if s.google_client_secret else ""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            token = await client.post(
                _TOKEN_URL,
                data={
                    "code": code,
                    "client_id": s.google_client_id,
                    "client_secret": secret,
                    "redirect_uri": uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
            )
        except httpx.HTTPError as err:
            raise GoogleDenied("google") from err
    if token.status_code != 200:
        raise GoogleDenied("google")
    id_token = token.json().get("id_token")
    if not isinstance(id_token, str):
        raise GoogleDenied("google")
    try:
        # PyJWKClient fetches keys synchronously. A thread keeps that off the event loop, with a bounded timeout.
        key = await to_thread(jwt.PyJWKClient(_JWKS_URL, timeout=5).get_signing_key_from_jwt, id_token)
        claims: dict[str, Any] = jwt.decode(
            id_token, key.key, algorithms=["RS256"], audience=s.google_client_id, issuer=_ISSUERS,
        )
    except (jwt.PyJWTError, httpx.HTTPError, TimeoutError, OSError) as err:
        raise GoogleDenied("google") from err
    email = str(claims.get("email") or "").strip().lower()
    sub = str(claims.get("sub") or "")
    verified = claims.get("email_verified") is True or claims.get("email_verified") == "true"
    if not email or "@" not in email or not sub or not verified:
        raise GoogleDenied("unverified")
    name = str(claims.get("name") or "").strip()[:200] or None
    return {"sub": sub[:255], "email": email, "name": name}


async def _find_or_create(db: AsyncSession, request: Request, ident: dict[str, Any],
                          ref: str | None = None) -> tuple[User, bool, bool]:
    """(user, created, claimed). `claimed` is an existing password account whose email was never confirmed:
    Google just proved the inbox, so the old password and every session of it stop working. `ref`: a new account's
    invite or creator code (billing/referrals.py)."""
    s = get_settings()
    if not s.email_allowed(ident["email"]):
        raise GoogleDenied("private")
    by_sub = await db.scalar(select(User).where(User.google_sub == ident["sub"]))
    user = by_sub or await db.scalar(select(User).where(User.email == ident["email"]))
    created = False
    if user is None:
        first_dev = (not s.admin_email and s.env != "production"
                     and not await db.scalar(select(func.count()).select_from(User)))
        approved = not s.approval_required or s.is_admin_email(ident["email"]) or bool(first_dev)
        user = User(
            email=ident["email"],
            name=ident["name"],
            password_hash=await hash_password(secrets.token_urlsafe(48)),
            has_password=False,
            google_sub=ident["sub"],
            email_verified=True,
            approved=approved,
            # Google doesn't say where they apply, so it's where they signed up from (the web app's edge says,
            # through the Worker), as a password sign-up keeps the browser's guess. Settings change it later;
            # signing in again never does.
            country=request_country(request),
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            user = await db.scalar(select(User).where(User.email == ident["email"]))
            if user is None:
                raise GoogleDenied("google") from None
        else:
            created = True
            db.add(AuditLog(user_id=user.id, action="auth.google_register", ip=_ip(request)))
            if not s.is_admin_email(ident["email"]):
                await credits.grant_welcome(db, user, client_ip(request))
                from orbit_api.billing import referrals

                await referrals.attribute_signup(db, user, ref, _ip(request))
    if user.suspended_at is not None:
        db.add(AuditLog(user_id=user.id, action="auth.login_suspended", ip=_ip(request)))
        await db.commit()
        raise GoogleDenied("suspended")
    # Someone else's Google account must not be attached here.
    already = user.google_sub == ident["sub"]
    if user.google_sub and not already:
        raise GoogleDenied("google")
    # The inbox was never confirmed, so whoever set the password never proved they own it. Google just did:
    # the old password stops working and every session of it ends. A confirmed account keeps its password.
    claimed = not created and not already and not user.email_verified
    if claimed:
        user.password_hash = await hash_password(secrets.token_urlsafe(48))
        user.has_password = False
    user.google_sub = ident["sub"]
    user.email_verified = True
    if ident["name"] and not user.name:
        user.name = ident["name"]
    if claimed:
        from orbit_api.auth.accounts import forget_unproven_sign_ins, sign_out_everywhere

        # Passkeys and an authenticator set up before the inbox was proven belong to whoever registered the
        # address: one would still sign in without the password, the other would lock the owner out.
        await forget_unproven_sign_ins(db, user.id)
        db.add(AuditLog(user_id=user.id, action="auth.google_claim", ip=_ip(request)))
        await sign_out_everywhere(db, user)
    elif not created:
        db.add(AuditLog(user_id=user.id, action="auth.google", ip=_ip(request)))
    await db.commit()
    return user, created, claimed


def _ip(request: Request) -> str | None:
    ip = client_ip(request)
    return None if ip == "unknown" else ip


def mount(router: APIRouter) -> None:
    # Imported here: this module is loaded at the bottom of routes, once auth_limit exists.
    from orbit_api.auth.routes import auth_limit

    def over_limit(request: Request) -> RedirectResponse | None:
        """The sign-in limit, answered as a trip back to the sign-in page: the browser is on the API's own address for
        these two routes, so a 429 would leave it on bare JSON."""
        try:
            auth_limit(request)
        except HTTPException:
            response = RedirectResponse(_login_url("busy"), status_code=302)
            _clear_state(response)
            return response
        return None

    @router.get("/google/start")
    async def google_start(request: Request, next: str = "/", ref: str | None = None) -> RedirectResponse:
        from orbit_api.billing import referrals

        if (busy := over_limit(request)) is not None:
            return busy
        if not get_settings().google_enabled:  # a stale link or bookmark: the button isn't shown then
            return RedirectResponse(_login_url("google_off"), status_code=302)
        state = secrets.token_urlsafe(24)
        verifier = secrets.token_urlsafe(64)
        uri = redirect_uri(request)
        nxt = safe_next(next)
        query = urlencode({
            "client_id": get_settings().google_client_id,
            "redirect_uri": uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": _challenge(verifier),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        })
        response = RedirectResponse(f"{_AUTH_URL}?{query}", status_code=302)
        # A link's code: the web app sends it along (else its first-party cookie); a sign-up through Google keeps it.
        code = referrals.normalize(ref or request.cookies.get(referrals.REF_COOKIE))
        _set_state(response, _pack(state, verifier, nxt, uri, code))
        return response

    @router.get("/google/callback")
    async def google_callback(
        request: Request,
        db: Annotated[AsyncSession, Depends(get_db)],
        code: str = "",
        state: str = "",
    ) -> RedirectResponse:
        if (busy := over_limit(request)) is not None:
            return busy
        packed = _unpack(request.cookies.get(GOOGLE_COOKIE, ""))
        mismatch = packed is None or not secrets.compare_digest(packed["st"], state) or not code
        if packed is None or not get_settings().google_enabled or mismatch:
            response = RedirectResponse(_login_url("google"), status_code=302)
            _clear_state(response)
            return response
        try:
            ident = await fetch_identity(code, packed["cv"], packed["ru"])
            from orbit_api.billing.referrals import REF_COOKIE

            ref = packed.get("rf") if isinstance(packed.get("rf"), str) else request.cookies.get(REF_COOKIE)
            user, created, claimed = await _find_or_create(db, request, ident, ref)
            return await _signed_in(db, request, user, created, claimed, packed["nx"])
        except GoogleDenied as denied:
            response = RedirectResponse(_login_url(denied.code), status_code=302)
            _clear_state(response)
            return response
        except Exception:
            # The browser is on the API's own address here: a database error (or anything unexpected) must not
            # leave it on a bare "Internal Server Error" page. What wasn't committed is rolled back (an account is
            # created in one commit, so none is left half made) and the sign-in page says to try again.
            log.exception("google sign-in failed")
            with contextlib.suppress(Exception):
                await db.rollback()
            response = RedirectResponse(_login_url("server"), status_code=302)
            _clear_state(response)
            return response


async def _signed_in(db: AsyncSession, request: Request, user: User, created: bool, claimed: bool,
                     nxt: str) -> RedirectResponse:
    """Where Google's sign-in lands: a session cookie and the page they were going to, or the authenticator step."""
    from orbit_api.auth.devices import start_session
    from orbit_api.auth.two_factor import CHALLENGE_COOKIE, CHALLENGE_TTL_S, challenge_for, enabled

    dest = "/welcome" if created else safe_next(nxt)
    if claimed:
        dest += ("&" if "?" in dest else "?") + "google=claimed"
    response = RedirectResponse(_home(dest), status_code=302)
    if await enabled(db, user.id):
        # Google proved who it is; the authenticator code still comes next. The challenge rides in a short
        # httpOnly cookie, never in the URL, and the sign-in page asks for the code.
        response = RedirectResponse(_home("/login?step=2fa"), status_code=302)
        secure, samesite = cookie_policy()
        response.set_cookie(CHALLENGE_COOKIE, challenge_for(user), max_age=CHALLENGE_TTL_S, httponly=True,
                            secure=secure, samesite=samesite, path="/")
        _clear_state(response)
        return response
    sid = await start_session(db, user, request)
    await db.commit()
    set_session_cookie(response, create_access_token(user.id, user.token_version, idle=True, sid=sid))
    _clear_state(response)
    return response
