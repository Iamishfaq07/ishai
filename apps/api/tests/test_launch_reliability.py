"""Launch reliability: the STT status the UI sees is the provider's real connection state (no premature "ok")."""

import asyncio
from collections.abc import AsyncIterator

from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import SessionState, STTConfig, STTProvider, STTSession, TranscriptEvent
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink


class FakeSession(STTSession):
    def __init__(self, state: SessionState) -> None:
        self.state = state
        self._q: asyncio.Queue[TranscriptEvent | None] = asyncio.Queue()

    async def send_audio(self, pcm16: bytes) -> None:
        return None

    async def events(self) -> AsyncIterator[TranscriptEvent]:
        while (ev := await self._q.get()) is not None:
            yield ev

    async def emit(self, status: str, text: str = "") -> None:
        self.state = status if status != "connected" else "connected"  # type: ignore[assignment]
        await self._q.put(TranscriptEvent("status", text, status=status))

    async def close(self) -> None:
        await self._q.put(None)


class FakeNetworkedSTT(STTProvider):
    """Stands in for Deepgram: sessions come back in whatever state the handshake reached."""

    name = "deepgram"
    provides_endpoints = True

    def __init__(self, *states: SessionState) -> None:
        super().__init__()
        self._states = list(states)
        self.sessions: list[FakeSession] = []

    async def _open(self, config: STTConfig) -> STTSession:
        s = FakeSession(self._states.pop(0))
        self.sessions.append(s)
        return s


async def _start(stt: FakeNetworkedSTT) -> tuple[LiveEngine, Sink]:
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True), LiveSettings(),
                     send=sink, llm=MockLLMProvider(), stt=stt, index=SessionIndex([]))
    await eng.start()
    return eng, sink


def _stt_states(sink: Sink) -> list[str]:
    return [p["state"] for p in sink.of("provider.status") if p["provider"] == "stt"]


async def test_stt_is_not_reported_ok_until_both_sockets_are_connected() -> None:
    stt = FakeNetworkedSTT("connected", "connecting")  # system socket still handshaking when start() returns
    eng, sink = await _start(stt)
    assert _stt_states(sink) == ["connecting"]  # never "ok" first
    await stt.sessions[1].emit("connected")
    await asyncio.sleep(0.05)
    assert _stt_states(sink) == ["connecting", "ok"]
    await eng.end()


async def test_stt_ready_immediately_when_handshakes_finished() -> None:
    eng, sink = await _start(FakeNetworkedSTT("connected", "connected"))
    assert _stt_states(sink) == ["connecting", "ok"]
    await eng.end()


async def test_rejected_handshake_reports_down_not_ok() -> None:
    stt = FakeNetworkedSTT("connected", "down")
    eng, sink = await _start(stt)
    assert "ok" not in _stt_states(sink) and _stt_states(sink)[-1] == "down"
    await eng.end()


async def test_reconnect_is_reported_and_clears() -> None:
    stt = FakeNetworkedSTT("connected", "connected")
    eng, sink = await _start(stt)
    await stt.sessions[0].emit("reconnecting")
    await asyncio.sleep(0.05)
    assert _stt_states(sink)[-1] == "reconnecting" and eng.state.value == "stt_reconnecting"
    await stt.sessions[0].emit("connected")
    await asyncio.sleep(0.05)
    assert _stt_states(sink)[-1] == "ok" and eng.state.value == "listening"
    # duplicate "connected" events don't spam the client
    await stt.sessions[1].emit("connected")
    await asyncio.sleep(0.05)
    assert _stt_states(sink).count("ok") == 2
    await eng.end()


async def test_mock_stt_stays_mock_after_its_connected_events() -> None:
    """The mock provider's scripted "connected" events mustn't turn "mock" into "ok" (that hid the dev simulator)."""
    from orbit_api.providers.stt.mock import MockSTTProvider

    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True), LiveSettings(),
                     send=sink, llm=MockLLMProvider(), stt=MockSTTProvider(), index=SessionIndex([]))
    await eng.start()
    await asyncio.sleep(0.1)
    assert _stt_states(sink) == ["mock"]
    await eng.end()
