"""Google's Indexing API for job pages: URL_UPDATED when a job is published or changed, URL_DELETED when it closes.

Google allows the Indexing API only for pages with JobPosting (or BroadcastEvent) markup, which is what these are.
Off unless ORBIT_GOOGLE_INDEXING_SA_JSON holds a service account's JSON key whose `client_email` is an Owner of the
site's property in Search Console. Each ping is a durable background job (jobs.py), so a slow or failing Google never
holds up publishing; a failure is retried and then logged. Nothing is queued when it's off.
"""

import json
import logging
import time
from typing import Any

import httpx
import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs
from orbit_api.config import get_settings

log = logging.getLogger(__name__)

KIND = "biz_indexing"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - an address, not a secret
PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish"
SCOPE = "https://www.googleapis.com/auth/indexing"
_token: tuple[str, float] | None = None  # (access token, expires at)


def service_account() -> dict[str, Any] | None:
    raw = get_settings().google_indexing_sa_json
    if raw is None or not raw.get_secret_value().strip():
        return None
    try:
        info = json.loads(raw.get_secret_value())
    except ValueError:
        log.error("ORBIT_GOOGLE_INDEXING_SA_JSON is not valid JSON; the Indexing API is off")
        return None
    if not isinstance(info, dict) or not info.get("client_email") or not info.get("private_key"):
        log.error("ORBIT_GOOGLE_INDEXING_SA_JSON lacks client_email or private_key; the Indexing API is off")
        return None
    return info


def enabled() -> bool:
    return service_account() is not None


async def notify(db: AsyncSession, url: str, deleted: bool) -> None:
    """Queue a ping in the caller's transaction (one per URL: the latest state wins)."""
    if not enabled():
        return
    await jobs.enqueue(db, KIND, {"url": url, "type": "URL_DELETED" if deleted else "URL_UPDATED"},
                       dedupe_key=f"{KIND}:{url}"[:128])


async def _access_token(info: dict[str, Any]) -> str:
    global _token
    if _token is not None and _token[1] > time.time() + 60:
        return _token[0]
    issued = int(time.time())
    assertion = jwt.encode({"iss": info["client_email"], "scope": SCOPE, "aud": info.get("token_uri") or TOKEN_URL,
                            "iat": issued, "exp": issued + 3600}, info["private_key"], algorithm="RS256")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(info.get("token_uri") or TOKEN_URL, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    r.raise_for_status()
    body = r.json()
    _token = (str(body["access_token"]), time.time() + float(body.get("expires_in", 3600)))
    return _token[0]


async def publish(url: str, kind: str) -> None:
    info = service_account()
    if info is None:
        return
    token = await _access_token(info)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(PUBLISH_URL, json={"url": url, "type": kind},
                              headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        raise RuntimeError(f"Indexing API answered {r.status_code}: {r.text[:300]}")
    log.info("indexing api: %s %s", kind, url)


@jobs.handler(KIND)
async def _run(payload: dict[str, Any]) -> None:
    await publish(str(payload["url"]), str(payload["type"]))
