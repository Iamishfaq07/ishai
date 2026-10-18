"""Speaking feedback from the transcript: pace, filler words, talk time and answer length.

Pure arithmetic on the candidate's own transcript turns (no model call, nothing sent anywhere). The mic channel is
transcribed with Deepgram's `filler_words` on, so "um"/"uh" survive into the text; other fillers ("you know",
"sort of") are counted from the words themselves. Thresholds follow common speech-coaching guidance: a comfortable
conversational pace is roughly 120-160 words per minute, and a few fillers a minute go unnoticed.
"""

import re
from collections import Counter
from collections.abc import Sequence
from itertools import pairwise
from typing import Any, Protocol

from orbit_api.live.multilingual import fold, words

# Multi-word fillers first so "you know" isn't also counted as two words of something else.
FILLER_PHRASES = ("you know", "i mean", "sort of", "kind of")
FILLER_WORDS = ("um", "umm", "uh", "uhm", "erm", "er", "ah", "hmm", "basically", "literally")
# A Hinglish (Latin script) or Hindi (Devanagari) round's own fillers, on top of the English ones (people mix).
HINGLISH_FILLERS = ("matlab", "yaani", "yani", "achha", "accha", "acha")
HINDI_FILLERS = ("मतलब", "यानी", "अच्छा")
_PHRASE_RE = re.compile(r"\b(" + "|".join(re.escape(p) for p in FILLER_PHRASES) + r")\b", re.IGNORECASE)
_WORD_RE = re.compile(r"\b(" + "|".join(FILLER_WORDS) + r")\b", re.IGNORECASE)
_HINGLISH_RE = re.compile(r"\b(" + "|".join(HINGLISH_FILLERS) + r")\b", re.IGNORECASE)
# Devanagari vowel signs aren't word characters to `\b`, so the edges are spelled out: no word or Devanagari
# character on either side.
_HINDI_RE = re.compile(r"(?<![\wऀ-ॿ])(" + "|".join(HINDI_FILLERS) + r")(?![\wऀ-ॿ])")
_WORDS = re.compile(r"[A-Za-z0-9']+")

SLOW_WPM, FAST_WPM = 110, 170
MANY_FILLERS_PER_MIN = 4.0
LONG_ANSWER_WORDS = 300  # ~2 minutes spoken
MIN_SPEAKING_S = 20  # below this there isn't enough speech to say anything useful
LONG_PAUSE_S = 3.0  # a silence this long inside one answer (between two of the candidate's own lines)
SLOW_START_S = 6.0  # median time from the end of a question to the candidate's first words
MAX_START_S = 30.0  # longer gaps are someone stepping away or a muted mic, not thinking time


class TurnLike(Protocol):
    speaker: str
    text: str
    start_ms: int
    end_ms: int


def count_fillers(text: str, language: str = "en") -> Counter[str]:
    """Filler words and phrases in `text`; a Hindi or Hinglish round's own ("matlab", "यानी") as well as English's."""
    found: Counter[str] = Counter(m.group(1).lower() for m in _PHRASE_RE.finditer(text))
    found.update(m.group(1).lower() for m in _WORD_RE.finditer(_PHRASE_RE.sub(" ", text)))
    if language in ("hi", "hinglish"):
        found.update(m.group(1).lower() for m in _HINGLISH_RE.finditer(text))
        found.update(m.group(1) for m in _HINDI_RE.finditer(text))
    return found


MIN_ANSWER_SPEAKING_S = 5  # one answer: less than this isn't enough speech for a pace


def answer_speaking(turns: Sequence[TurnLike], *, language: str = "en") -> dict[str, Any] | None:
    """One answer's speaking stats from its own transcript lines: pace, fillers, and the long silences inside it
    (3 s or more between two of its lines). None when the lines carry no timings or there's too little speech."""
    mine = sorted((t for t in turns if t.speaker == "candidate" and t.text.strip()), key=lambda t: t.start_ms)
    speaking_s = sum(_seconds(t) for t in mine)
    if speaking_s < MIN_ANSWER_SPEAKING_S:
        return None
    count = _count_any if language == "hi" else _count_words
    words = sum(count(t.text) for t in mine)
    fillers: Counter[str] = Counter()
    for t in mine:
        fillers.update(count_fillers(t.text, language))
    pauses = sum(1 for prev, cur in pairwise(mine) if (cur.start_ms - prev.end_ms) / 1000 >= LONG_PAUSE_S)
    return {
        "speaking_seconds": round(speaking_s),
        "words_per_minute": round(words / (speaking_s / 60)),
        "fillers": sum(fillers.values()),
        "top_fillers": [w for w, _ in fillers.most_common(3)],
        "long_pauses": pauses,
    }


def _seconds(t: TurnLike) -> float:
    return max(0, t.end_ms - t.start_ms) / 1000


def delivery_stats(turns: Sequence[TurnLike], answers: Sequence[str] = (), *,
                   english: bool = True, language: str = "en") -> dict[str, Any] | None:
    """`answers`: the candidate's answer to each question (for answer length), if paired. None = too little speech.
    `english=False` (a live session in another language): words are counted in any script, and the pace and filler
    tips, whose thresholds and filler words are English, are left out. `language`: a mock round's practice language
    ("hi" counts Devanagari words; "hi" and "hinglish" count their own fillers too)."""
    count = _count_words if english and language != "hi" else _count_any
    mine = [t for t in turns if t.speaker == "candidate" and t.text.strip()]
    others = [t for t in turns if t.speaker != "candidate" and t.text.strip()]
    speaking_s = sum(_seconds(t) for t in mine)
    if speaking_s < MIN_SPEAKING_S:
        return None
    words = sum(count(t.text) for t in mine)
    fillers: Counter[str] = Counter()
    for t in mine:
        fillers.update(count_fillers(t.text, language))
    minutes = speaking_s / 60
    wpm = round(words / minutes) if minutes else 0
    filler_total = sum(fillers.values())
    fillers_per_min = round(filler_total / minutes, 1) if minutes else 0.0
    others_s = sum(_seconds(t) for t in others)
    talk_share = round(speaking_s / (speaking_s + others_s), 2) if speaking_s + others_s else None
    pauses, starts = _pauses_and_starts(turns)
    answer_words = [count(a) for a in answers if a.strip()]

    tips: list[str] = []
    # Pace and filler tips only in English: their thresholds and filler words are English ones.
    if english and wpm > FAST_WPM:
        tips.append(f"You spoke at about {wpm} words a minute — slow down a little and pause between points.")
    elif english and wpm < SLOW_WPM:
        tips.append(f"About {wpm} words a minute is on the slow side — shorter sentences keep the listener with you.")
    if english and fillers_per_min > MANY_FILLERS_PER_MIN:
        top = ", ".join(f"“{w}”" for w, _ in fillers.most_common(2))
        tips.append(f"{fillers_per_min} filler words a minute (mostly {top}) — a short silent pause works better.")
    if answer_words and max(answer_words) > LONG_ANSWER_WORDS:
        tips.append("Some answers ran past two minutes — lead with the point, then one example.")
    median_start = _median(starts)
    if median_start is not None and median_start > SLOW_START_S:
        tips.append(f"You usually started about {median_start:.0f} s after a question. Thinking is fine; a short "
                    "opener (\"Let me think about a good example\") fills the silence.")
    if talk_share is not None and talk_share > 0.8 and others:
        tips.append("You did most of the talking — leave room for the interviewer's follow-ups.")
    return {
        "speaking_seconds": round(speaking_s),
        "words": words,
        "words_per_minute": wpm,
        "fillers_total": filler_total,
        "fillers_per_minute": fillers_per_min,
        "top_fillers": [{"word": w, "count": c} for w, c in fillers.most_common(5)],
        "talk_share": talk_share,
        "long_pauses": pauses,
        "median_start_seconds": round(median_start, 1) if median_start is not None else None,
        "answers": len(answer_words),
        "average_answer_words": round(sum(answer_words) / len(answer_words)) if answer_words else None,
        "longest_answer_words": max(answer_words) if answer_words else None,
        "tips": tips,
    }


def _count_words(text: str) -> int:
    return len(_WORDS.findall(text))


def _count_any(text: str) -> int:
    return len(words(fold(text)))


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    v = sorted(values)
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2


def _pauses_and_starts(turns: Sequence[TurnLike]) -> tuple[int, list[float]]:
    """Long silences inside the candidate's own speech (two of their lines in a row, nobody else between, 3 s or
    more apart), and how long each answer took to start after the interviewer stopped. From the transcript's
    timings only: approximate, and nothing about why."""
    ordered = sorted((t for t in turns if t.text.strip()), key=lambda t: t.start_ms)
    pauses = 0
    starts: list[float] = []
    for prev, cur in pairwise(ordered):
        gap = (cur.start_ms - prev.end_ms) / 1000
        if cur.speaker == "candidate" and prev.speaker == "candidate" and gap >= LONG_PAUSE_S:
            pauses += 1
        elif cur.speaker == "candidate" and prev.speaker == "interviewer" and 0 <= gap <= MAX_START_S:
            starts.append(gap)
    return pauses, starts
