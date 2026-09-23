from functools import lru_cache

from orbit_api.providers.llm.base import LLMProvider
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.runtime_config import get_effective_config


@lru_cache
def get_llm_provider() -> LLMProvider:
    cfg = get_effective_config()
    choice = cfg.llm_provider
    if choice == "auto":
        choice = "deepseek" if cfg.deepseek_api_key else "mock"
    if choice == "deepseek":
        if not cfg.deepseek_api_key:
            raise RuntimeError("LLM provider is deepseek but no DeepSeek API key is set")
        from orbit_api.providers.llm.deepseek import DeepSeekProvider

        return DeepSeekProvider(
            cfg.deepseek_api_key,
            cfg.deepseek_base_url,
            cfg.deepseek_model,
            cfg.deepseek_reasoning_model,
        )
    return MockLLMProvider()


def get_vision_provider() -> LLMProvider | None:
    """A provider that can actually see images, or None. Never fake vision (spec §62)."""
    llm = get_llm_provider()
    return llm if llm.supports_vision() else None
