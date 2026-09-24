"""Bot check for sign-up and password reset, behind a provider-neutral interface.

Clients learn what to render from `GET /v1/auth/config` (`captcha: {provider, site_key}` or null) and send the
widget's response token as `captcha_token`. Only Cloudflare Turnstile is implemented; another provider plugs in by
adding a verifier here. Off when no provider is configured; CAPTCHA_ENABLED=false bypasses it outside production.
"""

import logging

import httpx
from fastapi import HTTPException, status

from orbit_api.config import get_settings

log = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
CAPTCHA_FAILED = "captcha_failed"


def public_config() -> dict[str, str] | None:
    s = get_settings()
    if not s.captcha_active:
        return None
    return {"provider": s.captcha_provider, "site_key": s.turnstile_site_key or ""}


async def _verify_turnstile(token: str, ip: str | None) -> bool:
    s = get_settings()
    secret = s.turnstile_secret_key.get_secret_value() if s.turnstile_secret_key else ""
    data = {"secret": secret, "response": token}
    if ip:
        data["remoteip"] = ip
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=data)
        body = resp.json()
    except (httpx.HTTPError, ValueError):
        # Fail closed: an outage at the CAPTCHA provider must not open sign-up to bots. Logged loudly.
        log.exception("turnstile verification request failed")
        return False
    if not body.get("success"):
        log.info("turnstile rejected token: %s", body.get("error-codes"))
    return bool(body.get("success"))


async def require_captcha(token: str | None, ip: str | None) -> None:
    s = get_settings()
    if not s.captcha_active:
        return
    ok = bool(token) and s.captcha_provider == "turnstile" and await _verify_turnstile(token or "", ip)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail={"code": CAPTCHA_FAILED, "message": "Please complete the check and try again."})
