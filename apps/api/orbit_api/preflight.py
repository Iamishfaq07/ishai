"""Pre-session checklist (server side): can a live session actually work right now, and if not, what to do.

The desktop adds its own local checks (microphone, system audio, network round trip) around these. Provider
checks are real but cheap and cached: a 3-token DeepSeek call (~$0.000001) at most once a minute, and Deepgram's
free project-listing endpoint (validates the key) at most every five minutes.
"""

import asyncio
import contextlib
import json
import time
from dataclasses import dataclass
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.desktop_updates import _root, github_latest_release, latest_release, parse_version
from orbit_api.entitlements import is_admin, plan_for, usage_this_month
from orbit_api.models import User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMMessage, LLMProvider, LLMRequest
from orbit_api.providers.llm.fallback import FallbackProvider
from orbit_api.ratelimit import limit
from orbit_api.runtime_config import get_effective_config

router = APIRouter(prefix="/v1", tags=["preflight"])
preflight_limit = limit("preflight", rate_per_s=0.2, burst=6)

Status = Literal["ok", "warn", "fail"]
Severity = Literal["blocker", "warning"]
# A failing check here means a live interview can't work: the app disables Start (with a confirmed escape hatch).
# Everything else is advice and never blocks.
BLOCKER_IDS = frozenset({"server", "network", "llm", "stt", "mic", "minutes", "account"})
LLM_TTL_S = 60
STT_TTL_S = 300
LOW_MINUTES = 10


class Check(BaseModel):
    id: str
    label: str
    status: Status
    detail: str
    fix: str | None = None
    latency_ms: int | None = None
    severity: Severity = "warning"


class PreflightOut(BaseModel):
    checks: list[Check]
    ok: bool  # no failing blocker (warnings never block a session)
    blockers: int = 0


def _finish(checks: list[Check]) -> PreflightOut:
    for c in checks:
        c.severity = "blocker" if c.id in BLOCKER_IDS else "warning"
    blockers = sum(c.status == "fail" and c.severity == "blocker" for c in checks)
    return PreflightOut(checks=checks, ok=blockers == 0, blockers=blockers)


@dataclass
class _Cached:
    at: float
    check: Check


_cache: dict[str, _Cached] = {}


async def _cached(key: str, ttl: float, run: Any) -> Check:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit.at < ttl:
        return hit.check
    check: Check = await run()
    _cache[key] = _Cached(time.monotonic(), check)
    return check


async def _ping(llm: LLMProvider) -> int:
    started = time.monotonic()
    await asyncio.wait_for(llm.generate(LLMRequest(messages=[LLMMessage("user", "Reply with OK.")], max_tokens=3,
                                                   request_type="preflight", allow_fallback=False)), timeout=8)
    return int((time.monotonic() - started) * 1000)


async def _llm_check() -> Check:
    llm = get_llm_provider()
    if llm.name == "mock":
        return Check(id="llm", label="AI answers", status="warn", detail="Demo mode: answers are canned examples.",
                     fix="Set DEEPSEEK_API_KEY on the server (or in Settings → Advanced) for real answers.")
    # Ping DeepSeek itself (not through the failover wrapper, which would hide an outage behind the backup).
    primary = llm.primary if isinstance(llm, FallbackProvider) else llm
    backup = llm.fallback if isinstance(llm, FallbackProvider) else None
    try:
        ms = await _ping(primary)
    except (TimeoutError, LLMError) as e:
        code = getattr(e, "code", "timeout")
        if backup is not None:
            try:
                backup_ms = await _ping(backup)
            except (TimeoutError, LLMError):
                pass
            else:
                return Check(id="llm", label="AI answers", status="warn", latency_ms=backup_ms,
                             detail=f"DeepSeek unavailable ({code}); the backup AI is answering ({backup_ms} ms).",
                             fix="Answers still work. Quality may differ slightly until DeepSeek is back.")
        fix = {"http_401": "The DeepSeek API key was rejected — update it in Settings → Advanced.",
               "http_402": "The DeepSeek account is out of credit — top it up.",
               "rate_limited": "DeepSeek is rate-limiting right now — wait a minute and re-check."}.get(
            code, "DeepSeek isn't responding. Re-check in a minute; answers will retry automatically.")
        return Check(id="llm", label="AI answers", status="fail", detail=f"DeepSeek unavailable ({code}).", fix=fix)
    slow = ms > 3000
    return Check(id="llm", label="AI answers", status="warn" if slow else "ok", latency_ms=ms,
                 detail=f"DeepSeek responding ({ms} ms).",
                 fix="The AI is responding slowly right now; answers may take longer." if slow else None)


async def _stt_check() -> Check:
    cfg = get_effective_config()
    choice = cfg.stt_provider if cfg.stt_provider != "auto" else ("deepgram" if cfg.deepgram_api_key else "mock")
    if choice == "mock":
        return Check(id="stt", label="Transcription", status="warn", detail="Demo mode: no real transcription.",
                     fix="Set DEEPGRAM_API_KEY on the server (or in Settings → Advanced).")
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get("https://api.deepgram.com/v1/projects",
                                 headers={"Authorization": f"Token {cfg.deepgram_api_key}"})
    except httpx.HTTPError:
        return Check(id="stt", label="Transcription", status="fail", detail="Deepgram isn't reachable from the server.",
                     fix="Re-check in a minute. If it persists, Deepgram may be having an outage.")
    ms = int((time.monotonic() - started) * 1000)
    if r.status_code in (401, 403):
        return Check(id="stt", label="Transcription", status="fail", detail="The Deepgram API key was rejected.",
                     fix="Update the Deepgram key in Settings → Advanced.")
    if r.status_code == 402:
        return Check(id="stt", label="Transcription", status="fail", detail="The Deepgram account is out of credit.",
                     fix="Add credit to the Deepgram account.")
    if r.status_code >= 400:
        return Check(id="stt", label="Transcription", status="warn",
                     detail=f"Deepgram account check answered {r.status_code}; streaming not verified.",
                     fix="Transcription may still work; re-check in a minute.")
    # The account answering isn't proof the live stream works (model/language/params, websocket egress):
    # open a real streaming socket and close it without sending audio.
    stream_ms, stream_error = await _deepgram_stream_handshake(cfg.deepgram_api_key or "", cfg.deepgram_model)
    if stream_error:
        return Check(id="stt", label="Transcription", status="fail", latency_ms=ms,
                     detail=f"Deepgram account reachable, but live streaming failed ({stream_error}).",
                     fix="Re-check in a minute. If it persists, Deepgram streaming may be down.")
    return Check(id="stt", label="Transcription", status="ok", latency_ms=stream_ms,
                 detail=f"Streaming transcription verified ({stream_ms} ms).")


async def _deepgram_stream_handshake(api_key: str, model: str) -> tuple[int, str | None]:
    """Open Deepgram's streaming endpoint with the live settings and close it straight away (no audio is sent,
    so nothing is transcribed or billed). Returns (ms, error or None)."""
    import websockets
    from websockets.exceptions import InvalidStatus

    from orbit_api.providers.stt.base import STTConfig
    from orbit_api.providers.stt.deepgram import build_url

    started = time.monotonic()
    try:
        async with websockets.connect(build_url(model, STTConfig(language="en")),
                                      additional_headers={"Authorization": f"Token {api_key}"},
                                      open_timeout=6) as ws:
            ms = int((time.monotonic() - started) * 1000)
            with contextlib.suppress(Exception):
                await ws.send(json.dumps({"type": "CloseStream"}))
        return ms, None
    except InvalidStatus as e:
        return int((time.monotonic() - started) * 1000), f"HTTP {e.response.status_code}"
    except (OSError, TimeoutError, websockets.WebSocketException) as e:
        return int((time.monotonic() - started) * 1000), type(e).__name__


async def _latest_version() -> str | None:
    root = _root()
    if root is not None:
        rel = latest_release(root)
        return rel.version if rel else None
    gh = await github_latest_release()
    return gh.version if gh else None


@router.get("/preflight", response_model=PreflightOut, dependencies=[Depends(preflight_limit)])
async def preflight(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
                    app_version: Annotated[str | None, Query(max_length=32)] = None,
                    refresh: bool = False) -> PreflightOut:
    if refresh:
        _cache.clear()
    checks: list[Check] = []
    try:
        await db.execute(text("SELECT 1"))
        checks.append(Check(id="server", label="Orbit server", status="ok", detail="Connected."))
    except Exception:
        checks.append(Check(id="server", label="Orbit server", status="fail", detail="The database isn't reachable.",
                            fix="The server is having trouble — try again in a minute."))

    if get_settings().verification_required and not user.email_verified and not await is_admin(db, user):
        # Paid-provider features are locked until the email is verified, so don't spend provider calls on them.
        checks.append(Check(id="account", label="Email verification", status="fail",
                            detail=f"{user.email} isn't verified yet.",
                            fix="Open the link we emailed you (or resend it from the banner), then re-check."))
        return _finish(checks)

    llm, stt = await asyncio.gather(_cached("llm", LLM_TTL_S, _llm_check), _cached("stt", STT_TTL_S, _stt_check))
    checks += [llm, stt]
    vision = get_llm_provider().supports_vision()
    if vision:
        checks.append(Check(id="vision", label="Screenshots", status="ok", detail="The AI can read screenshots."))
    else:
        checks.append(Check(id="vision", label="Screenshots", status="warn",
                            detail="The configured AI model can't read images.",
                            fix="Use a vision model (deepseek-flash) in Settings → Advanced."))

    plan = await plan_for(db, user.id)
    if plan.live_minutes is None:
        checks.append(Check(id="minutes", label="Live minutes", status="ok", detail=f"Unlimited ({plan.name} plan)."))
    else:
        left = max(plan.live_minutes - await usage_this_month(db, user.id, "live_seconds") / 60, 0)
        status: Status = "fail" if left <= 0 else "warn" if left < LOW_MINUTES else "ok"
        fix = {"fail": "You're out of live minutes for this month.",
               "warn": "Only a few minutes left — a session ends when they run out."}.get(status)
        checks.append(Check(id="minutes", label="Live minutes", status=status,
                            detail=f"{left:.0f} of {plan.live_minutes} minutes left this month.", fix=fix))
    if plan.screenshots is not None:
        used = int(await usage_this_month(db, user.id, "screenshots"))
        left_shots = max(plan.screenshots - used, 0)
        checks.append(Check(id="screenshots", label="Screenshot credits", status="ok" if left_shots else "warn",
                            detail=f"{left_shots} of {plan.screenshots} left this month.",
                            fix=None if left_shots else "No screenshot answers left this month."))

    if app_version and parse_version(app_version):
        latest = await _latest_version()
        if latest is None:  # no update source configured/reachable: don't claim "up to date"
            checks.append(Check(id="app", label="App version", status="ok",
                                detail=f"{app_version} (couldn't check for updates)."))
        elif (parse_version(latest) or (0, 0, 0)) > (parse_version(app_version) or (0, 0, 0)):
            checks.append(Check(id="app", label="App version", status="warn",
                                detail=f"{app_version} (latest {latest}).",
                                fix="An update is available — install it from the setup screen."))
        else:
            checks.append(Check(id="app", label="App version", status="ok", detail=f"{app_version} — up to date."))

    return _finish(checks)
