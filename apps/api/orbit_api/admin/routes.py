"""Admin-only advanced settings: rotate provider API keys / models in-app.

Access is limited to the admin: ORBIT_ADMIN_EMAIL (required in production; in development/test the first
registered user stands in when it's unset).
Secret values are never returned in plaintext (only a "set" flag); they're stored encrypted via
ORBIT_CONFIG_SECRET and applied to live providers immediately after saving.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.live.metrics import summarize
from orbit_api.models import AppConfig, LiveSessionRow, User
from orbit_api.runtime_config import (
    EDITABLE_KEYS,
    ConfigSecretMissing,
    encrypt_secret,
    get_effective_config,
    refresh,
    secrets_editable,
    validate_value,
)

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def require_admin(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    if not await is_admin(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


class ConfigOut(BaseModel):
    secrets_editable: bool  # false when ORBIT_CONFIG_SECRET isn't set (keys can't be stored in-app)
    llm_provider: str
    stt_provider: str
    deepseek_base_url: str
    deepseek_model: str
    deepseek_reasoning_model: str
    deepgram_model: str
    deepseek_api_key_set: bool  # masked — plaintext is never returned
    deepgram_api_key_set: bool


class ConfigIn(BaseModel):
    llm_provider: str | None = None
    stt_provider: str | None = None
    deepseek_base_url: str | None = Field(None, max_length=300)
    deepseek_model: str | None = Field(None, max_length=100)
    deepseek_reasoning_model: str | None = Field(None, max_length=100)
    deepgram_model: str | None = Field(None, max_length=100)
    # Secrets: a non-empty value stores/rotates the key; an empty string clears the override
    # (falls back to the environment). Omit the field to leave it unchanged.
    deepseek_api_key: str | None = None
    deepgram_api_key: str | None = None


def _snapshot() -> ConfigOut:
    cfg = get_effective_config()
    return ConfigOut(
        secrets_editable=secrets_editable(),
        llm_provider=cfg.llm_provider,
        stt_provider=cfg.stt_provider,
        deepseek_base_url=cfg.deepseek_base_url,
        deepseek_model=cfg.deepseek_model,
        deepseek_reasoning_model=cfg.deepseek_reasoning_model,
        deepgram_model=cfg.deepgram_model,
        deepseek_api_key_set=bool(cfg.deepseek_api_key),
        deepgram_api_key_set=bool(cfg.deepgram_api_key),
    )


@router.get("/config", response_model=ConfigOut)
async def get_config(_: Annotated[User, Depends(require_admin)]) -> ConfigOut:
    return _snapshot()


async def _upsert(db: AsyncSession, key: str, value: str | None, is_secret: bool) -> None:
    row = await db.get(AppConfig, key)
    if value is None:  # clear override
        if row is not None:
            await db.delete(row)
        return
    if row is None:
        db.add(AppConfig(key=key, value=value, is_secret=is_secret))
    else:
        row.value = value
        row.is_secret = is_secret


@router.put("/config", response_model=ConfigOut)
async def update_config(body: ConfigIn, _: Annotated[User, Depends(require_admin)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ConfigOut:
    fields = body.model_dump(exclude_unset=True)
    for key, raw in fields.items():
        if key not in EDITABLE_KEYS:
            continue
        is_secret = EDITABLE_KEYS[key]
        if is_secret:
            # "" clears the override; anything else is encrypted and stored.
            if raw is None or raw == "":
                await _upsert(db, key, None, True)
            else:
                try:
                    await _upsert(db, key, encrypt_secret(raw), True)
                except ConfigSecretMissing as e:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        else:
            if raw is None or raw == "":
                await _upsert(db, key, None, False)
            else:
                try:
                    await _upsert(db, key, validate_value(key, str(raw)), False)
                except ValueError as e:
                    raise HTTPException(422, str(e)) from e
    await db.commit()
    await refresh(db)
    return _snapshot()


class AdminStatus(BaseModel):
    is_admin: bool


@router.get("/status", response_model=AdminStatus)
async def admin_status(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AdminStatus:
    """Cheap check so the UI can decide whether to show Advanced settings (no 403 noise)."""
    return AdminStatus(is_admin=await is_admin(db, user))


class LatencyOut(BaseModel):
    days: int
    sessions: int
    # metric → {n, p50, p95, p99} in ms (see orbit_api/live/metrics.py for what each metric measures)
    metrics: dict[str, dict[str, int]]


@router.get("/latency", response_model=LatencyOut)
async def latency(_: Annotated[User, Depends(require_admin)], db: Annotated[AsyncSession, Depends(get_db)],
                  days: Annotated[int, Query(ge=1, le=90)] = 7) -> LatencyOut:
    """Live-latency percentiles across recent sessions (diagnostics; timings only)."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (await db.scalars(select(LiveSessionRow.metrics).where(
        LiveSessionRow.created_at >= since, LiveSessionRow.metrics.is_not(None)))).all()
    return LatencyOut(days=days, sessions=len(rows), metrics=summarize(r for r in rows if r))
