from functools import lru_cache

from orbit_api.config import get_settings
from orbit_api.providers.llm.base import LLMProvider
from orbit_api.providers.llm.mock import MockLLMProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    s = get_settings()
    choice = s.llm_provider
    if choice == "auto":
        choice = "deepseek" if s.deepseek_api_key else "mock"
    if choice == "deepseek":
        if not s.deepseek_api_key:
            raise RuntimeError("ORBIT_LLM_PROVIDER=deepseek but DEEPSEEK_API_KEY is not set")
        from orbit_api.providers.llm.deepseek import DeepSeekProvider

        return DeepSeekProvider(
            s.deepseek_api_key.get_secret_value(),
            s.deepseek_base_url,
            s.deepseek_model,
            s.deepseek_reasoning_model,
        )
    return MockLLMProvider()


def get_vision_provider() -> LLMProvider | None:
    """A provider that can actually see images, or None. Never fake vision (spec §62)."""
    llm = get_llm_provider()
    return llm if llm.supports_vision() else None
