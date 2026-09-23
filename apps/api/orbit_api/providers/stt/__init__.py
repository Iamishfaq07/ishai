from orbit_api.providers.stt.base import STTProvider
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.runtime_config import get_effective_config


def create_stt_provider() -> STTProvider:
    """A fresh provider per live session (it owns that session's sockets)."""
    cfg = get_effective_config()
    choice = cfg.stt_provider
    if choice == "auto":
        choice = "deepgram" if cfg.deepgram_api_key else "mock"
    if choice == "deepgram":
        if not cfg.deepgram_api_key:
            raise RuntimeError("STT provider is deepgram but no Deepgram API key is set")
        from orbit_api.providers.stt.deepgram import DeepgramProvider

        return DeepgramProvider(cfg.deepgram_api_key, cfg.deepgram_model)
    return MockSTTProvider()
