"""Offline STT: ignores audio and can replay transcript fixtures word-by-word (partials → final)."""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from orbit_api.live.events import Speaker
from orbit_api.providers.stt.base import STTConfig, STTProvider, STTSession, TranscriptEvent

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures"


class MockSTTSession(STTSession):
    def __init__(self) -> None:
        self._queue: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()
        self.audio_bytes = 0

    async def send_audio(self, pcm16: bytes) -> None:
        self.audio_bytes += len(pcm16)

    async def emit(self, ev: TranscriptEvent) -> None:
        await self._queue.put(ev)

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        await self._queue.put(TranscriptEvent(kind="status", status="connected"))
        while True:
            ev = await self._queue.get()
            if ev is None:
                return
            yield ev

    async def close(self) -> None:
        await self._queue.put(None)


class MockSTTProvider(STTProvider):
    name = "mock"

    async def _open(self, config: STTConfig) -> STTSession:
        return MockSTTSession()


@dataclass
class FixtureTurn:
    speaker: Speaker
    text: str
    pause_ms: int = 400  # silence before this turn


def load_fixture(name: str) -> list[FixtureTurn]:
    path = (FIXTURE_DIR / f"{name}.json").resolve()
    if path.parent != FIXTURE_DIR.resolve() or not path.is_file():
        raise FileNotFoundError(name)
    data = json.loads(path.read_text(encoding="utf-8"))
    return [FixtureTurn(t["speaker"], t["text"], t.get("pause_ms", 400)) for t in data["turns"]]


async def replay(
    turns: list[FixtureTurn], *, word_ms: int = 60, speed: float = 1.0
) -> AsyncIterator[tuple[Speaker, TranscriptEvent]]:
    """Yields (speaker, event) as a live STT stream would: growing partials, then an endpointed final."""
    clock = 0
    for turn in turns:
        await asyncio.sleep(turn.pause_ms / 1000 / speed)
        clock += turn.pause_ms
        start = clock
        words = turn.text.split()
        for i in range(1, len(words)):
            await asyncio.sleep(word_ms / 1000 / speed)
            clock += word_ms
            yield turn.speaker, TranscriptEvent("partial", " ".join(words[:i]), start, clock)
        await asyncio.sleep(word_ms / 1000 / speed)
        clock += word_ms
        yield turn.speaker, TranscriptEvent("final", turn.text, start, clock, endpoint=True)
