"""The practice queue: spaced repetition for interview answers.

Every review (live interview or mock) grades each question. A question answered weakly (3/5 or lower, or not
answered) becomes a card that comes back on a schedule until it's answered well several times in a row: 1 day after a
weak answer, then 3, 7 and 21 days after each good one (4/5 or better); after four good answers in a row it's
learnt and leaves the queue. Retrying it (a drill asks the exact text) is matched by the question's words, so the
history is simply every review that graded it. Nothing is stored beyond the reviews themselves.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from orbit_api.live.mock_interviewer import WEAK_SCORE, DrillItem, bare_question

# Days until a card is due again, by how many good answers in a row it ended on (0: the last one was weak).
INTERVALS_DAYS = (1, 3, 7, 21)
MAX_DRILL = 5  # questions in one "Practise what's due" round
MAX_DRILL_FOLLOW_UPS = 2


@dataclass
class Attempt:
    at: datetime
    score: int | None
    feedback: str
    session_id: str


@dataclass
class Card:
    question: str
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def last(self) -> Attempt:
        return self.attempts[-1]

    def due_at(self) -> datetime | None:
        """When it's due, or None when it isn't a card at all (never weak) or it's learnt."""
        if not any(_weak(a.score) for a in self.attempts):
            return None
        streak = 0
        for a in reversed(self.attempts):
            if _weak(a.score):
                break
            streak += 1
        if streak >= len(INTERVALS_DAYS):
            return None
        return self.last.at + timedelta(days=INTERVALS_DAYS[streak])

    def learnt(self) -> bool:
        return any(_weak(a.score) for a in self.attempts) and self.due_at() is None


def _weak(score: int | None) -> bool:
    return score is None or score <= WEAK_SCORE


def question_key(text: str) -> str:
    """The question's words, so "Tell me about yourself." and "tell me about yourself?" are one card."""
    return " ".join(re.findall(r"[a-z0-9']+", bare_question(text).lower()))


def build_cards(reviews: Iterable[tuple[str, datetime, Sequence[Any]]]) -> list[Card]:
    """From (session id, when, review items) in any order: one card per question, attempts oldest first."""
    cards: dict[str, Card] = {}
    for session_id, at, items in sorted(reviews, key=lambda r: _aware(r[1])):
        for item in items:
            if not isinstance(item, dict):
                continue
            question = bare_question(str(item.get("question") or ""))
            key = question_key(question)
            if not key:
                continue
            score = item.get("score")
            score = score if isinstance(score, int) and not isinstance(score, bool) else None
            card = cards.setdefault(key, Card(question[:400]))
            card.attempts.append(Attempt(_aware(at), score, str(item.get("feedback") or "").strip()[:400],
                                         session_id))
    return list(cards.values())


def queue(cards: Sequence[Card], now: datetime) -> tuple[list[Card], list[Card], int]:
    """(due now, most overdue and weakest first; coming up later, soonest first; how many are learnt)."""
    now = _aware(now)
    scheduled = [(c, d) for c in cards if (d := c.due_at()) is not None]
    due = sorted((c for c, d in scheduled if d <= now),
                 key=lambda c: (c.last.score or 0, c.due_at() or now))
    later = sorted((c for c, d in scheduled if d > now), key=lambda c: c.due_at() or now)
    return due, later, sum(1 for c in cards if c.learnt())


def drill(due: Sequence[Card]) -> list[DrillItem]:
    """A practice round on what's due: each question as last asked, the first few with a follow-up on what the
    latest review said was missing."""
    return [DrillItem(question=c.question, kind="retry", follow_up=n < MAX_DRILL_FOLLOW_UPS,
                      feedback=c.last.feedback or None)
            for n, c in enumerate(due[:MAX_DRILL])]


def _aware(t: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=UTC)
