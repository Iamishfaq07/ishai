"""Speaking feedback from the transcript: pace, filler words, talk time and answer length.

Pure arithmetic on the candidate's own transcript turns (no model call, nothing sent anywhere). The mic channel is
transcribed with Deepgram's `filler_words` on, so "um"/"uh" survive into the text; other fillers ("you know",
"sort of") are counted from the words themselves. Thresholds follow common speech-coaching guidance: a comfortable
conversational pace is roughly 120-160 words per minute, and a few fillers a minute go unnoticed.
"""

import re
from collections import Counter
from collections.abc import Sequence
from typing import Any, Protocol

# Multi-word fillers first so "you know" isn't also counted as two words of something else.
FILLER_PHRASES = ("you know", "i mean", "sort of", "kind of")
FILLER_WORDS = ("um", "umm", "uh", "uhm", "erm", "er", "ah", "hmm", "basically", "literally")
_PHRASE_RE = re.compile(r"\b(" + "|".join(re.escape(p) for p in FILLER_PHRASES) + r")\b", re.IGNORECASE)
_WORD_RE = re.compile(r"\b(" + "|".join(FILLER_WORDS) + r")\b", re.IGNORECASE)
_WORDS = re.compile(r"[A-Za-z0-9']+")

SLOW_WPM, FAST_WPM = 110, 170
MANY_FILLERS_PER_MIN = 4.0
LONG_ANSWER_WORDS = 300  # ~2 minutes spoken
MIN_SPEAKING_S = 20  # below this there isn't enough speech to say anything useful


class TurnLike(Protocol):
    speaker: str
    text: str
    start_ms: int
    end_ms: int


def count_fillers(text: str) -> Counter[str]:
    found: Counter[str] = Counter(m.group(1).lower() for m in _PHRASE_RE.finditer(text))
    found.update(m.group(1).lower() for m in _WORD_RE.finditer(_PHRASE_RE.sub(" ", text)))
    return found


def _seconds(t: TurnLike) -> float:
    return max(0, t.end_ms - t.start_ms) / 1000


def delivery_stats(turns: Sequence[TurnLike], answers: Sequence[str] = ()) -> dict[str, Any] | None:
    """`answers`: the candidate's answer to each question (for answer length), if paired. None = too little speech."""
    mine = [t for t in turns if t.speaker == "candidate" and t.text.strip()]
    others = [t for t in turns if t.speaker != "candidate" and t.text.strip()]
    speaking_s = sum(_seconds(t) for t in mine)
    if speaking_s < MIN_SPEAKING_S:
        return None
    words = sum(len(_WORDS.findall(t.text)) for t in mine)
    fillers: Counter[str] = Counter()
    for t in mine:
        fillers.update(count_fillers(t.text))
    minutes = speaking_s / 60
    wpm = round(words / minutes) if minutes else 0
    filler_total = sum(fillers.values())
    fillers_per_min = round(filler_total / minutes, 1) if minutes else 0.0
    others_s = sum(_seconds(t) for t in others)
    talk_share = round(speaking_s / (speaking_s + others_s), 2) if speaking_s + others_s else None
    answer_words = [len(_WORDS.findall(a)) for a in answers if a.strip()]

    tips: list[str] = []
    if wpm > FAST_WPM:
        tips.append(f"You spoke at about {wpm} words a minute — slow down a little and pause between points.")
    elif wpm < SLOW_WPM:
        tips.append(f"About {wpm} words a minute is on the slow side — tighter sentences will sound more confident.")
    if fillers_per_min > MANY_FILLERS_PER_MIN:
        top = ", ".join(f"“{w}”" for w, _ in fillers.most_common(2))
        tips.append(f"{fillers_per_min} filler words a minute (mostly {top}) — a short silent pause works better.")
    if answer_words and max(answer_words) > LONG_ANSWER_WORDS:
        tips.append("Some answers ran past two minutes — lead with the point, then one example.")
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
        "answers": len(answer_words),
        "average_answer_words": round(sum(answer_words) / len(answer_words)) if answer_words else None,
        "longest_answer_words": max(answer_words) if answer_words else None,
        "tips": tips,
    }
