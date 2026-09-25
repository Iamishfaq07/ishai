"""Deepgram live streaming STT. One socket per audio channel; the API key never leaves the server.

Unit tests cover message parsing (`parse_message`); the real API is exercised by the opt-in smoke suite
(`RUN_PROVIDER_SMOKE=true uv run pytest tests/smoke`).
"""

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlencode

import websockets
from websockets.exceptions import InvalidStatus

from orbit_api.providers import health
from orbit_api.providers.stt.base import STTConfig, STTProvider, STTSession, TranscriptEvent

log = logging.getLogger(__name__)

KEEPALIVE_S = 4.0
BYTES_PER_MS = 32  # PCM16 mono 16 kHz
MAX_BUFFERED_AUDIO_BYTES = 16_000 * 2 * 5  # 5 s of PCM16 retained while reconnecting
# Handshake rejections that retrying can't fix: invalid stream settings (400, e.g. a language the model doesn't
# support), bad/revoked key (401/403), out of credit (402).
FATAL_HANDSHAKE = {400: "Deepgram rejected the transcription settings (unsupported language?)",
                   401: "the Deepgram API key was rejected", 402: "the Deepgram account is out of credit",
                   403: "the Deepgram API key was rejected"}


def build_url(model: str, cfg: STTConfig) -> str:
    params: list[tuple[str, str]] = [
        ("model", model),
        ("encoding", "linear16"),
        ("sample_rate", str(cfg.sample_rate)),
        ("channels", "1"),
        ("interim_results", "true"),
        ("punctuate", "true"),
        ("smart_format", "true"),
        ("endpointing", "300"),
        ("utterance_end_ms", "1000"),
        ("vad_events", "true"),
    ]
    # Streaming has no `detect_language` (Deepgram answers HTTP 400); nova-3's multilingual mode is
    # `language=multi`, which also handles code-switching mid-sentence.
    params.append(("language", "multi" if cfg.language == "auto" else cfg.language))
    if cfg.diarize:
        params.append(("diarize", "true"))
    if cfg.filler_words:
        params.append(("filler_words", "true"))
    for term in cfg.keyterms[:50]:
        params.append(("keyterm", term))
    return "wss://api.deepgram.com/v1/listen?" + urlencode(params)


def parse_message(msg: dict[str, Any]) -> TranscriptEvent | None:
    mtype = msg.get("type")
    if mtype == "Results":
        alt = ((msg.get("channel") or {}).get("alternatives") or [{}])[0]
        text = (alt.get("transcript") or "").strip()
        start = int(float(msg.get("start", 0)) * 1000)
        end = start + int(float(msg.get("duration", 0)) * 1000)
        words = alt.get("words") or []
        speaker = words[0].get("speaker") if words and "speaker" in words[0] else None
        is_final = bool(msg.get("is_final"))
        if not text and not msg.get("speech_final"):
            return None
        return TranscriptEvent(
            kind="final" if is_final else "partial",
            text=text,
            start_ms=start,
            end_ms=end,
            endpoint=bool(msg.get("speech_final")),
            speaker_hint=speaker,
        )
    if mtype == "SpeechStarted":
        return TranscriptEvent(kind="speech_started")
    if mtype == "UtteranceEnd":
        return TranscriptEvent(kind="utterance_end", endpoint=True)
    return None


class DeepgramSession(STTSession):
    def __init__(self, api_key: str, model: str, cfg: STTConfig) -> None:
        self._url = build_url(model, cfg)
        self._headers = {"Authorization": f"Token {api_key}"}
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self._ws: Any = None
        self._closed = False
        self._backlog: list[bytes] = []
        self._runner: asyncio.Task[None] | None = None
        self._connected = asyncio.Event()
        self.state = "connecting"
        # Deepgram timestamps count audio received on the CURRENT socket, so each reconnect restarts them at 0.
        # Shift every event by the audio that went to earlier sockets to keep one continuous session timeline
        # (what transcripts and latency are measured against).
        self._audio_ms_total = 0.0  # all audio passed to send_audio
        self._offset_ms = 0.0

    async def connect(self) -> None:
        """Start the socket and wait (bounded) for the handshake. Returns either way — audio is backlogged while
        it's pending — but `state` says what actually happened: connected, still connecting/reconnecting, or down.
        Callers must read it rather than assume success."""
        self._runner = asyncio.create_task(self._run())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._connected.wait(), timeout=5)

    async def _run(self) -> None:
        backoff = 0.25
        while not self._closed:
            attempt_at = time.monotonic()
            try:
                async with websockets.connect(
                    self._url, additional_headers=self._headers, open_timeout=5, max_size=2**20
                ) as ws:
                    self._ws = ws
                    self.state = "connected"
                    health.record("deepgram", "stt", True, int((time.monotonic() - attempt_at) * 1000))
                    self._connected.set()
                    await self._queue.put(TranscriptEvent(kind="status", status="connected"))
                    backoff = 0.25
                    self._start_socket_timeline()
                    for chunk in self._backlog:
                        await ws.send(chunk)
                    self._backlog.clear()
                    keepalive = asyncio.create_task(self._keepalive(ws))
                    try:
                        async for raw in ws:
                            if isinstance(raw, bytes):
                                continue
                            ev = parse_message(json.loads(raw))
                            if ev:
                                await self._queue.put(self.shift(ev))
                    finally:
                        keepalive.cancel()
                        self._ws = None
            except asyncio.CancelledError:
                raise
            except InvalidStatus as e:
                code = e.response.status_code
                health.record("deepgram", "stt", False, error=f"http_{code}")
                if code in FATAL_HANDSHAKE:
                    log.error("deepgram handshake rejected (%s); not retrying", code)
                    self.state = "down"
                    self._connected.set()  # unblock connect(); the session is down, not pending
                    await self._queue.put(TranscriptEvent(kind="status", status="down",
                                                          text=FATAL_HANDSHAKE[code]))
                    break
                log.warning("deepgram handshake failed: HTTP %s", code)
            except Exception as e:
                health.record("deepgram", "stt", False, error=type(e).__name__)
                log.warning("deepgram socket error: %s", type(e).__name__)
            if self._closed:
                break
            self._connected.clear()
            self.state = "reconnecting"
            await self._queue.put(TranscriptEvent(kind="status", status="reconnecting"))
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 5.0)
        await self._queue.put(None)

    def _start_socket_timeline(self) -> None:
        """A new socket's audio starts with the backlog, so its t=0 is where the backlog begins."""
        self._offset_ms = self._audio_ms_total - sum(len(c) for c in self._backlog) / BYTES_PER_MS

    def shift(self, ev: TranscriptEvent) -> TranscriptEvent:
        if ev.kind in ("partial", "final") and self._offset_ms:
            ev.start_ms += int(self._offset_ms)
            ev.end_ms += int(self._offset_ms)
        return ev

    async def _keepalive(self, ws: Any) -> None:
        while True:
            await asyncio.sleep(KEEPALIVE_S)
            await ws.send(json.dumps({"type": "KeepAlive"}))

    async def send_audio(self, pcm16: bytes) -> None:
        self._audio_ms_total += len(pcm16) / BYTES_PER_MS
        ws = self._ws
        if ws is None:
            self._backlog.append(pcm16)
            while sum(map(len, self._backlog)) > MAX_BUFFERED_AUDIO_BYTES:
                self._backlog.pop(0)
            return
        try:
            await ws.send(pcm16)
        except Exception:
            self._backlog.append(pcm16)

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        while True:
            ev = await self._queue.get()
            if ev is None:
                return
            yield ev

    async def close(self) -> None:
        self._closed = True
        ws = self._ws
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.send(json.dumps({"type": "CloseStream"}))
                await ws.close()
        if self._runner:
            self._runner.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._runner
        await self._queue.put(None)


class DeepgramProvider(STTProvider):
    name = "deepgram"
    provides_endpoints = True

    def __init__(self, api_key: str, model: str) -> None:
        super().__init__()
        self._key = api_key
        self._model = model

    async def _open(self, config: STTConfig) -> STTSession:
        session = DeepgramSession(self._key, self._model, config)
        await session.connect()
        return session
