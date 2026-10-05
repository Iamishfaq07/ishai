"""What a live session remembers across a dropped connection.

Every WebSocket connection gets a fresh LiveEngine. Without this, a Wi-Fi blip mid-interview wiped the engine's
conversation memory (recent turns, rolling summary, questions asked), so answers to follow-ups lost the thread,
and a mock interview started over at question 1 with its timer reset.

When a connection drops without the session ending, its engine's state is kept here, in process memory (the API
runs one instance, D12), and handed to the next engine for the same session. It lives no longer than an idle
session does (ORBIT_ABANDONED_SESSION_MIN) and is dropped as soon as the session ends.

Process memory doesn't survive a restart, and every deploy restarts the server mid-session. So the same state is
also kept on the session row as JSON (`to_json` → `sessions.carryover`, written every heartbeat and when the
connection drops, cleared when the session ends), and the next connection reads it back (`from_json`) when there's
nothing in memory. For an account that doesn't store transcripts, the copy on the row leaves out what was said word
for word (the recent turns and the mock answers), as the transcript is.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from orbit_api.config import get_settings
from orbit_api.live.context_builder import AnswerNote, SessionMemory, Turn

log = logging.getLogger(__name__)

FORMAT = 1  # of the JSON on the session row; another version is ignored (the session starts from its summary)


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


# ---- on the session row (survives a restart) ---------------------------------------------------------------------


def to_json(carryover: Carryover, *, transcripts: bool = True) -> dict[str, Any]:
    """The state as JSON for `sessions.carryover`. `transcripts=False`: without the candidate's and interviewer's
    words (recent turns, mock answers); the questions, the summary and the notes on earlier answers stay."""
    m = carryover.memory
    out: dict[str, Any] = {
        "v": FORMAT,
        "memory": {
            "recent": [{"speaker": t.speaker, "text": t.text} for t in m.recent] if transcripts else [],
            "rolling_summary": m.rolling_summary,
            "questions": list(m.questions),
            "last_answer_brief": m.last_answer_brief,
            "answers": [{"question": n.question, "points": list(n.points), "drew_on": list(n.drew_on),
                         "example": n.example} for n in m.answers],
        },
        "mock": None,
    }
    if (p := carryover.mock) is not None:
        out["mock"] = {
            # mock_interviewer._Asked
            "asked": [{"question_id": a.question_id, "text": a.text, "is_follow_up": a.is_follow_up,
                       "answer": list(a.answer) if transcripts else [],
                       "drill": a.drill.model_dump(mode="json") if a.drill is not None else None}
                      for a in p.asked],
            "drill_next": p.drill_next, "closing": p.closing, "elapsed_ms": p.elapsed_ms, "awaiting": p.awaiting,
        }
    return out


def from_json(data: Any) -> Carryover | None:
    """The state saved on the session row, or None: nothing saved, or a shape this version can't read (then the
    session continues from its rolling summary, as before this copy existed)."""
    if not isinstance(data, dict) or data.get("v") != FORMAT:
        return None
    try:
        return _decode(data)
    except Exception:
        log.warning("couldn't read a session's saved live state; continuing without it", exc_info=True)
        return None


def _decode(data: dict[str, Any]) -> Carryover:
    from orbit_api.live.mock_interviewer import DrillItem, _Asked  # it imports this module

    m = data.get("memory") or {}
    memory = SessionMemory(rolling_summary=str(m.get("rolling_summary") or ""),
                           questions=[str(q) for q in m.get("questions") or []],
                           last_answer_brief=str(m.get("last_answer_brief") or ""))
    memory.recent.extend(Turn(t["speaker"], str(t["text"])) for t in m.get("recent") or [])
    memory.answers.extend(AnswerNote(str(n["question"]), tuple(n["points"]), tuple(n["drew_on"]), bool(n["example"]))
                          for n in m.get("answers") or [])
    mock: MockProgress | None = None
    if isinstance(p := data.get("mock"), dict):
        asked = [_Asked(str(a["question_id"]), str(a["text"]), bool(a["is_follow_up"]),
                        answer=[str(x) for x in a.get("answer") or []],
                        drill=DrillItem.model_validate(a["drill"]) if a.get("drill") else None)
                 for a in p.get("asked") or []]
        mock = MockProgress(asked=asked, drill_next=int(p["drill_next"]), closing=bool(p["closing"]),
                            elapsed_ms=int(p["elapsed_ms"]), awaiting=bool(p["awaiting"]))
    return Carryover(memory=memory, mock=mock)
