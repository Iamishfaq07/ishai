"""What a live session remembers across a dropped connection.

Every WebSocket connection gets a fresh LiveEngine. Without this, a Wi-Fi blip mid-interview wiped the engine's
conversation memory (recent turns, rolling summary, questions asked), so answers to follow-ups lost the thread,
and a mock interview started over at question 1 with its timer reset.

When a connection drops without the session ending, its engine's state is kept here, in process memory only (the
API runs one instance, D12), and handed to the next engine for the same session. It lives no longer than an idle
session does (ORBIT_ABANDONED_SESSION_MIN) and is dropped as soon as the session ends.
"""

import time
from dataclasses import dataclass, field
from typing import Any

from orbit_api.config import get_settings
from orbit_api.live.context_builder import SessionMemory


@dataclass
class MockProgress:
    """A mock interview's place: the questions asked (with the answers so far), how far into the plan, and how
    much of its time has been used."""

    asked: list[Any]
    drill_next: int
    closing: bool
    elapsed_ms: int
    awaiting: bool


@dataclass
class Carryover:
    memory: SessionMemory = field(default_factory=SessionMemory)
    mock: MockProgress | None = None


_store: dict[str, tuple[Carryover, float]] = {}


def _ttl_s() -> float:
    return get_settings().abandoned_session_min * 60


def _prune(now: float) -> None:
    for sid in [sid for sid, (_, expires) in _store.items() if expires <= now]:
        del _store[sid]


def save(session_id: str, carryover: Carryover) -> None:
    now = time.monotonic()
    _prune(now)
    _store[session_id] = (carryover, now + _ttl_s())


def take(session_id: str) -> Carryover | None:
    """The state a dropped connection left behind, once (the new engine owns it from here)."""
    _prune(time.monotonic())
    entry = _store.pop(session_id, None)
    return entry[0] if entry else None


def discard(session_id: str) -> None:
    _store.pop(session_id, None)


def held(session_id: str) -> bool:
    """A dropped connection's state is waiting for this session's next one: a reconnect may be on its way."""
    _prune(time.monotonic())
    return session_id in _store
