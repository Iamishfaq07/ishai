"""Text-to-speech for the mock interviewer's natural voice: Deepgram Aura, streamed as MP3.

Deepgram is already the speech-to-text vendor, so this adds no new processor of personal data. Only the
interviewer's question text is sent, never anything the candidate said.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from typing import Protocol

import httpx

log = logging.getLogger(__name__)

SPEAK_URL = "https://api.deepgram.com/v1/speak"


class TTSProvider(Protocol):
    name: str

    def stream(self, text: str, model: str, speed: float = 1.0) -> AsyncGenerator[bytes, None]: ...


class TTSError(Exception):
    """The provider refused or failed before any audio came back."""


# One connection to Deepgram kept open (D76): a new HTTPS connection per sentence cost a TCP and TLS handshake each
# time, most of a second from India, on every line the interviewer says. Per event loop (tests run several).
_shared: dict[int, httpx.AsyncClient] = {}


def _client() -> httpx.AsyncClient:
    loop = id(asyncio.get_running_loop())
    client = _shared.get(loop)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0), http2=False,
                                   limits=httpx.Limits(max_keepalive_connections=8, keepalive_expiry=50))
        _shared.clear()  # an earlier loop's client is no use here
        _shared[loop] = client
    return client


class DeepgramTTS:
    name = "deepgram"

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self._transport = transport

    async def stream(self, text: str, model: str, speed: float = 1.0) -> AsyncGenerator[bytes, None]:
        """`speed`: Deepgram's speaking-rate multiplier (it keeps the prosody natural); 1 sends nothing extra."""
        params: dict[str, str] = {"model": model, "encoding": "mp3"}
        if speed != 1.0:
            params["speed"] = f"{speed:g}"
        # Tests bring their own transport (and so their own client); one generator either way, so closing it closes
        # the provider's response at once.
        own = (httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0), transport=self._transport)
               if self._transport is not None else None)
        client = own or _client()
        started = False
        try:
            for attempt in (1, 2):
                try:
                    async with client.stream("POST", SPEAK_URL, params=params, json={"text": text},
                                             headers={"Authorization": f"Token {self._key}"}) as response:
                        if response.status_code != 200:
                            await response.aread()
                            raise TTSError(f"deepgram speak returned {response.status_code}")
                        async for chunk in response.aiter_bytes():
                            if chunk:
                                started = True
                                yield chunk
                    return
                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as err:
                    # A kept-open connection the provider had already closed: once more, on a new one.
                    if started or attempt == 2:
                        raise
                    log.info("voice: %s on a kept-open connection; trying again", type(err).__name__)
        finally:
            if own is not None:
                await own.aclose()


def get_tts_provider() -> TTSProvider | None:
    """The configured provider, or None (no key, or turned off): the client then uses the device's voice."""
    from orbit_api.config import get_settings
    from orbit_api.runtime_config import get_effective_config

    if not get_settings().natural_voice:
        return None
    key = get_effective_config().deepgram_api_key
    return DeepgramTTS(key) if key else None
