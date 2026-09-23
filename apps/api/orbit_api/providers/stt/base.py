from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal

TranscriptKind = Literal["partial", "final", "speech_started", "utterance_end", "status"]


@dataclass(frozen=True)
class STTConfig:
    language: str = "en"
    sample_rate: int = 16_000
    keyterms: list[str] = field(default_factory=list)  # custom vocabulary (skills, company names)
    diarize: bool = False  # only useful on a mixed channel


@dataclass
class TranscriptEvent:
    kind: TranscriptKind
    text: str = ""
    start_ms: int = 0
    end_ms: int = 0
    endpoint: bool = False  # provider believes the utterance ended (speech_final / utterance end)
    speaker_hint: int | None = None  # diarization index on mixed channels
    status: str | None = None  # connected | reconnecting | down (kind == "status")


class STTSession(ABC):
    @abstractmethod
    async def send_audio(self, pcm16: bytes) -> None: ...

    @abstractmethod
    def events(self) -> AsyncIterator[TranscriptEvent]: ...

    @abstractmethod
    async def close(self) -> None: ...


class STTProvider(ABC):
    name: str

    def __init__(self) -> None:
        self._sessions: list[STTSession] = []

    @abstractmethod
    async def _open(self, config: STTConfig) -> STTSession: ...

    async def start(self, config: STTConfig) -> STTSession:
        session = await self._open(config)
        self._sessions.append(session)
        return session

    async def stop(self) -> None:
        for s in self._sessions:
            await s.close()
        self._sessions.clear()
