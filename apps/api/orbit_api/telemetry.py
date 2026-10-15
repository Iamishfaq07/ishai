"""`GET /v1/public/engineering-telemetry`: the few live-latency numbers the Technical details page shows, open to
anyone. Only aggregates of timings Orbit already keeps per session (live/metrics.py), never anything about a person
or what was said, and nothing at all until enough sessions have been measured that no one session shows through.
Cached for five minutes, so a busy page costs one query per five minutes."""

import time
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db import get_db
from orbit_api.live.metrics import summarize
from orbit_api.models import LiveSessionRow

router = APIRouter(prefix="/v1/public", tags=["public"])

WINDOW_DAYS = 7
MIN_SESSIONS = 5  # below this the numbers would describe a handful of people's sessions: shown as unknown
CACHE_S = 300
_STARTED = time.monotonic()
_cache: tuple[float, "TelemetryOut"] | None = None


class Percentiles(BaseModel):
    p50_ms: int
    p95_ms: int
    samples: int


class TelemetryOut(BaseModel):
    window_days: int
    sessions: int
    # Interviewer stops → question recognised, and question → first word of the answer (the two halves of the wait).
    question_detected: Percentiles | None
    first_word: Percentiles | None
    # Since the API last started (each deploy restarts it): an honest "up for", not a made-up uptime percentage.
    up_for_s: int
    measured_at: datetime


def _pct(metrics: dict[str, dict[str, int]], name: str) -> Percentiles | None:
    m = metrics.get(name)
    return Percentiles(p50_ms=m["p50"], p95_ms=m["p95"], samples=m["n"]) if m and m["n"] else None


async def telemetry(db: AsyncSession, now: float | None = None) -> TelemetryOut:
    global _cache
    now = time.monotonic() if now is None else now
    if _cache is not None and now - _cache[0] < CACHE_S:
        return _cache[1].model_copy(update={"up_for_s": int(now - _STARTED)})
    since = datetime.now(UTC) - timedelta(days=WINDOW_DAYS)
    rows = [r for r in (await db.scalars(select(LiveSessionRow.metrics).where(
        LiveSessionRow.created_at >= since, LiveSessionRow.metrics.is_not(None)))).all() if r]
    enough = len(rows) >= MIN_SESSIONS
    metrics: dict[str, Any] = summarize(rows) if enough else {}
    out = TelemetryOut(window_days=WINDOW_DAYS, sessions=len(rows) if enough else 0,
                       question_detected=_pct(metrics, "question_after_speech"),
                       first_word=_pct(metrics, "first_token_after_question"),
                       up_for_s=int(now - _STARTED), measured_at=datetime.now(UTC))
    _cache = (now, out)
    return out


def reset_cache() -> None:
    global _cache
    _cache = None


@router.get("/engineering-telemetry", response_model=TelemetryOut)
async def engineering_telemetry(response: Response, db: Annotated[AsyncSession, Depends(get_db)]) -> TelemetryOut:
    """Rolling 7-day live latency (p50/p95) and how long the API has been up. Public; cached five minutes."""
    response.headers["Cache-Control"] = f"public, max-age={CACHE_S}"
    return await telemetry(db)
