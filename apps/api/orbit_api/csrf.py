"""CSRF defence for cookie-authenticated browser requests.

The web app and API are on different sites in production, so the session cookie is `SameSite=None; Secure` —
which means a browser attaches it to requests *any* site triggers (a hidden form post, for instance). CORS
doesn't stop those: it only hides the response. Two checks close the gap for state-changing methods:

1. **Origin.** The request's `Origin` (or, failing that, `Referer`) must be one of the configured frontends
   (`ORBIT_CORS_ORIGINS` + `ORBIT_WEB_URL`). Unknown origins are rejected on every unsafe request, signed in or
   not, so login CSRF is covered too.
2. **Token.** Requests that carry the session cookie must also send `X-CSRF-Token`: an HMAC of the session
   (user id + token version) that the API hands out in auth responses. Another site can't read it (CORS), so it
   can't forge the header — and sending a custom header forces a CORS preflight, which unknown origins fail.

Bearer-token requests (the desktop app, API clients) carry no ambient credential and are exempt. The WebSocket
is protected by single-use tickets, which are themselves minted by a protected POST.
"""

import hashlib
import hmac
from base64 import urlsafe_b64encode
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from orbit_api.auth.security import COOKIE_NAME, decode_access_token
from orbit_api.config import get_settings

HEADER = "X-CSRF-Token"
UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Entry points that run before (or instead of) a valid session: a stale cookie must not block signing in.
# The Origin check still applies to them.
TOKEN_EXEMPT = frozenset({
    "/v1/auth/login", "/v1/auth/register", "/v1/auth/logout",
    "/v1/auth/password-reset/request", "/v1/auth/password-reset/confirm", "/v1/auth/verify-email/confirm",
    "/v1/auth/email-change/confirm",
    # The Contact page works signed out (a visitor whose cookie went stale has no token to send). A message posted in
    # someone's name changes nothing of theirs, and the Origin check still applies.
    "/v1/contact",
})
# Server-to-server callbacks authenticated by their own signatures (e.g. a payment webhook).
FULLY_EXEMPT: frozenset[str] = frozenset({"/v1/billing/webhook"})


def token_for(user_id: str, token_version: int) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    mac = hmac.new(key, f"csrf:{user_id}:{token_version}".encode(), hashlib.sha256).digest()
    return urlsafe_b64encode(mac).decode().rstrip("=")


def _origin_of(url: str | None) -> str | None:
    if not url:
        return None
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower() if parts.scheme and parts.netloc else None


def allowed_origins() -> set[str]:
    s = get_settings()
    out = {o.rstrip("/").lower() for o in s.cors_origins}
    web = _origin_of(s.web_url)
    if web:
        out.add(web)
    return out


def websocket_origin_allowed(origin: str | None) -> bool:
    """Browsers always send Origin on a WebSocket handshake: only our own frontends may open one (defence in depth;
    the single-use ticket, minted by a CSRF-protected POST, is the real credential). No Origin = not a browser."""
    return origin is None or origin.rstrip("/").lower() in allowed_origins()


def _reject(code: str, message: str) -> Response:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=403)


async def csrf_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if (not get_settings().csrf_enabled or request.method not in UNSAFE
            or request.url.path in FULLY_EXEMPT
            or request.headers.get("authorization", "").lower().startswith("bearer ")):
        return await call_next(request)

    origin = request.headers.get("origin")
    origin = origin.lower() if origin and origin != "null" else _origin_of(request.headers.get("referer"))
    cookie = request.cookies.get(COOKIE_NAME)
    if origin is not None and origin not in allowed_origins():
        return _reject("csrf_origin", "This request came from a site that isn't allowed to use Orbit.")
    if cookie and request.url.path not in TOKEN_EXEMPT:
        if origin is None:
            return _reject("csrf_origin", "Missing request origin.")
        claims = decode_access_token(cookie)
        # An invalid/expired cookie isn't a CSRF problem: let the route answer 401 as usual.
        if claims is not None:
            sent = request.headers.get(HEADER, "")
            if not hmac.compare_digest(sent, token_for(*claims)):
                return _reject("csrf_token", "Your session needs refreshing — reload the page and try again.")
    return await call_next(request)
