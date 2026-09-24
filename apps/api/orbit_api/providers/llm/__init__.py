import json
from functools import lru_cache

from orbit_api.config import get_settings
from orbit_api.providers.llm.base import LLMProvider
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.runtime_config import get_effective_config


@lru_cache
def get_llm_provider() -> LLMProvider:
    cfg = get_effective_config()
    s = get_settings()
    choice = cfg.llm_provider
    if choice == "auto":
        choice = "deepseek" if cfg.deepseek_api_key else "mock"
    if choice == "deepseek":
        if not cfg.deepseek_api_key:
            raise RuntimeError("LLM provider is deepseek but no DeepSeek API key is set")
        from orbit_api.providers.llm.deepseek import DeepSeekProvider
        from orbit_api.providers.llm.fallback import FallbackProvider

        primary = DeepSeekProvider(
            cfg.deepseek_api_key,
            cfg.deepseek_base_url,
            cfg.deepseek_model,
            cfg.deepseek_reasoning_model,
        )
        return FallbackProvider(primary, get_backup_provider(), first_token_timeout_s=s.llm_first_token_timeout_s)
    return MockLLMProvider()


def get_backup_provider() -> LLMProvider | None:
    """The configured OpenAI-compatible backup, or None (ORBIT_FALLBACK_LLM_* unset)."""
    s = get_settings()
    if not (s.fallback_llm_base_url and s.fallback_llm_api_key and s.fallback_llm_model):
        return None
    from orbit_api.providers.llm.openai_compat import OpenAICompatibleProvider

    extra = json.loads(s.fallback_llm_extra_json) if s.fallback_llm_extra_json else None
    return OpenAICompatibleProvider(s.fallback_llm_name, s.fallback_llm_api_key.get_secret_value(),
                                    s.fallback_llm_base_url, s.fallback_llm_model, vision=s.fallback_llm_vision,
                                    extra=extra)


def get_vision_provider() -> LLMProvider | None:
    """A provider that can actually see images, or None. Never fake vision (spec §62)."""
    llm = get_llm_provider()
    return llm if llm.supports_vision() else None
