"""Runtime-editable configuration.

Some settings — provider API keys, models, the base URL — can be changed by the admin in-app
without a redeploy (spec: advanced settings). Overrides live in the ``app_config`` table; secret
values are encrypted at rest with ``ORBIT_CONFIG_SECRET``. Everything falls back to the environment
(``Settings``) when there's no override.

The effective values are cached in memory and refreshed at startup and whenever the admin saves,
so the hot path (``get_llm_provider`` / ``create_stt_provider``) stays synchronous.
"""

import base64
import hashlib
import logging
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings

log = logging.getLogger(__name__)

# key -> is_secret. Only these keys may be written through the admin API.
EDITABLE_KEYS: dict[str, bool] = {
    "llm_provider": False,
    "stt_provider": False,
    "deepseek_api_key": True,
    "deepseek_base_url": False,
    "deepseek_model": False,
    "deepseek_reasoning_model": False,
    "deepgram_api_key": True,
    "deepgram_model": False,
}

_PROVIDER_CHOICES: dict[str, set[str]] = {
    "llm_provider": {"auto", "deepseek", "mock"},
    "stt_provider": {"auto", "deepgram", "mock"},
}

# Decrypted overrides, populated by refresh(). None until first load.
_overrides: dict[str, str] | None = None


class ConfigSecretMissing(RuntimeError):
    """Raised when a secret override is requested but ORBIT_CONFIG_SECRET isn't set."""


@dataclass(frozen=True)
class EffectiveConfig:
    llm_provider: str
    stt_provider: str
    deepseek_api_key: str | None
    deepseek_base_url: str
    deepseek_model: str
    deepseek_reasoning_model: str
    deepgram_api_key: str | None
    deepgram_model: str


def _fernet() -> Fernet | None:
    secret = get_settings().config_secret
    if not secret:
        return None
    # A stable 32-byte Fernet key derived from the configured secret.
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.get_secret_value().encode()).digest())
    return Fernet(key)


def secrets_editable() -> bool:
    """True when secret overrides can be stored (ORBIT_CONFIG_SECRET is set)."""
    return _fernet() is not None


def encrypt_secret(plaintext: str) -> str:
    f = _fernet()
    if f is None:
        raise ConfigSecretMissing("ORBIT_CONFIG_SECRET must be set to store API keys in-app")
    return f.encrypt(plaintext.encode()).decode()


def _decrypt_secret(token: str) -> str | None:
    f = _fernet()
    if f is None:
        return None
    try:
        return f.decrypt(token.encode()).decode()
    except InvalidToken:
        # Secret rotated or DB tampered — ignore the override rather than crash the app.
        log.warning("stored config secret could not be decrypted; ignoring override")
        return None


def validate_value(key: str, value: str) -> str:
    if key in _PROVIDER_CHOICES and value not in _PROVIDER_CHOICES[key]:
        raise ValueError(f"{key} must be one of {sorted(_PROVIDER_CHOICES[key])}")
    return value


async def refresh(db: AsyncSession) -> None:
    """Reload overrides from the DB into the in-memory cache and drop cached providers."""
    from orbit_api.models import AppConfig

    rows = (await db.scalars(select(AppConfig))).all()
    resolved: dict[str, str] = {}
    for row in rows:
        if row.key not in EDITABLE_KEYS or row.value is None:
            continue
        value = _decrypt_secret(row.value) if row.is_secret else row.value
        if value is not None:
            resolved[row.key] = value
    global _overrides
    _overrides = resolved
    _reset_providers()


def _current() -> dict[str, str]:
    return _overrides or {}


def get_effective_config() -> EffectiveConfig:
    s = get_settings()
    o = _current()

    def val(key: str, default: str) -> str:
        return o.get(key, default)

    def secret(key: str, default: str | None) -> str | None:
        return o.get(key) or default

    ds_default = s.deepseek_api_key.get_secret_value() if s.deepseek_api_key else None
    dg_default = s.deepgram_api_key.get_secret_value() if s.deepgram_api_key else None
    return EffectiveConfig(
        llm_provider=val("llm_provider", s.llm_provider),
        stt_provider=val("stt_provider", s.stt_provider),
        deepseek_api_key=secret("deepseek_api_key", ds_default),
        deepseek_base_url=val("deepseek_base_url", s.deepseek_base_url),
        deepseek_model=val("deepseek_model", s.deepseek_model),
        deepseek_reasoning_model=val("deepseek_reasoning_model", s.deepseek_reasoning_model),
        deepgram_api_key=secret("deepgram_api_key", dg_default),
        deepgram_model=val("deepgram_model", s.deepgram_model),
    )


def _reset_providers() -> None:
    from orbit_api.providers.llm import get_llm_provider

    get_llm_provider.cache_clear()
