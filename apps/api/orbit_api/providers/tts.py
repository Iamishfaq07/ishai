"""Text-to-speech for the mock interviewer's natural voice: Deepgram Aura, streamed as MP3.

Deepgram is already the speech-to-text vendor, so this adds no new processor of personal data. Only the
interviewer's question text is sent, never anything the candidate said.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

import httpx

SPEAK_URL = "https://api.deepgram.com/v1/speak"


class TTSProvider(Protocol):
    name: str

    def stream(self, text: str, model: str, speed: float = 1.0) -> AsyncIterator[bytes]: ...


class TTSError(Exception):
    """The provider refused or failed before any audio came back."""


class DeepgramTTS:
    name = "deepgram"

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self._transport = transport

    async def stream(self, text: str, model: str, speed: float = 1.0) -> AsyncIterator[bytes]:
        """`speed`: Deepgram's speaking-rate multiplier (it keeps the prosody natural); 1 sends nothing extra."""
        timeout = httpx.Timeout(15.0, connect=5.0)
        params: dict[str, str] = {"model": model, "encoding": "mp3"}
        if speed != 1.0:
            params["speed"] = f"{speed:g}"
        async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
            async with client.stream("POST", SPEAK_URL, params=params,
                                     headers={"Authorization": f"Token {self._key}"},
                                     json={"text": text}) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise TTSError(f"deepgram speak returned {response.status_code}")
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk


def get_tts_provider() -> TTSProvider | None:
    """The configured provider, or None (no key, or turned off): the client then uses the device's voice."""
    from orbit_api.config import get_settings
    from orbit_api.runtime_config import get_effective_config

    if not get_settings().natural_voice:
        return None
    key = get_effective_config().deepgram_api_key
    return DeepgramTTS(key) if key else None
