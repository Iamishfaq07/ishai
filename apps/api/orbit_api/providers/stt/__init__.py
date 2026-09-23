from orbit_api.config import get_settings
from orbit_api.providers.stt.base import STTProvider
from orbit_api.providers.stt.mock import MockSTTProvider


def create_stt_provider() -> STTProvider:
    """A fresh provider per live session (it owns that session's sockets)."""
    s = get_settings()
    choice = s.stt_provider
    if choice == "auto":
        choice = "deepgram" if s.deepgram_api_key else "mock"
    if choice == "deepgram":
        if not s.deepgram_api_key:
            raise RuntimeError("ORBIT_STT_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set")
        from orbit_api.providers.stt.deepgram import DeepgramProvider

        return DeepgramProvider(s.deepgram_api_key.get_secret_value(), s.deepgram_model)
    return MockSTTProvider()
