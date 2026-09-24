"""In-process health of the things Orbit depends on (launch brief §13): LLM providers, speech-to-text, the database
and email. Each call site records outcomes; `snapshot()` turns the recent window into a state.

States: healthy · degraded (some failures or slow) · down (the last few attempts all failed) · unknown (no data).
Only admins see the detail (`GET /v1/admin/providers`); users only ever see friendly summaries (preflight, the
live banner), never provider error bodies.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Literal

HealthState = Literal["healthy", "degraded", "down", "unknown"]

WINDOW = 50  # outcomes kept per dependency
RECENT_S = 15 * 60  # older outcomes don't count
DOWN_AFTER = 3  # consecutive failures
DEGRADED_FAILURE_RATE = 0.2
SLOW_P95_MS = {"llm": 8000, "stt": 3000, "database": 1500, "email": 10000}


@dataclass
class _Outcome:
    ok: bool
    latency_ms: int | None
    at: float
    error: str | None


@dataclass
class DependencyHealth:
    name: str
    kind: str  # llm | stt | database | email
    outcomes: deque[_Outcome] = field(default_factory=lambda: deque(maxlen=WINDOW))
    last_success: float | None = None
    last_failure: float | None = None
    last_error: str | None = None

    def record(self, ok: bool, latency_ms: int | None = None, error: str | None = None) -> None:
        now = time.time()
        self.outcomes.append(_Outcome(ok, latency_ms, now, error))
        if ok:
            self.last_success = now
        else:
            self.last_failure, self.last_error = now, error

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        recent = [o for o in self.outcomes if now - o.at <= RECENT_S]
        latencies = sorted(o.latency_ms for o in recent if o.ok and o.latency_ms is not None)
        p95 = latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))] if latencies else None
        failures = sum(not o.ok for o in recent)
        rate = failures / len(recent) if recent else None
        tail = list(recent)[-DOWN_AFTER:]
        state: HealthState
        if not recent:
            state = "unknown"
        elif len(tail) == DOWN_AFTER and not any(o.ok for o in tail):
            state = "down"
        elif (rate or 0) >= DEGRADED_FAILURE_RATE or (p95 is not None and p95 > SLOW_P95_MS.get(self.kind, 5000)):
            state = "degraded"
        else:
            state = "healthy"
        return {
            "name": self.name, "kind": self.kind, "state": state,
            "last_success": self.last_success, "last_failure": self.last_failure,
            "last_error": self.last_error, "p95_ms": p95,
            "failure_rate": None if rate is None else round(rate, 3), "samples": len(recent),
        }


_registry: dict[str, DependencyHealth] = {}


def dependency(name: str, kind: str) -> DependencyHealth:
    dep = _registry.get(name)
    if dep is None:
        dep = _registry[name] = DependencyHealth(name, kind)
    return dep


def record(name: str, kind: str, ok: bool, latency_ms: int | None = None, error: str | None = None) -> None:
    dependency(name, kind).record(ok, latency_ms, error)


def state_of(name: str) -> HealthState:
    dep = _registry.get(name)
    return dep.snapshot()["state"] if dep else "unknown"


def snapshot() -> list[dict[str, Any]]:
    return [d.snapshot() for d in sorted(_registry.values(), key=lambda d: (d.kind, d.name))]


def reset() -> None:
    """Tests."""
    _registry.clear()
