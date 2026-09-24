"""Versioned live-session event schemas. Mirror: packages/types/src/events.ts. See docs/PROTOCOL.md."""

import time
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

PROTOCOL_VERSION = 1

Speaker = Literal["interviewer", "candidate", "other"]
AnswerLength = Literal["short", "standard", "detailed"]
# natural / concise / story are the offered styles; the rest are legacy values still stored on older
# sessions (mapped onto the new ones in context_builder).
AnswerStyle = Literal["natural", "concise", "story", "bullets", "star", "technical", "executive"]
# How long to wait after the interviewer stops before auto-answering (finalizer.GRACE_MS).
ResponseTiming = Literal["quick", "balanced", "patient"]
Thinking = Literal["off", "low", "high", "max"]
SessionType = Literal["interview", "meeting", "coding", "assessment", "phone", "mock"]


class QuestionType(StrEnum):
    behavioral = "behavioral"
    technical = "technical"
    coding = "coding"
    system_design = "system_design"
    resume = "resume"
    leadership = "leadership"
    salary = "salary"
    culture = "culture"
    clarification = "clarification"
    follow_up = "follow_up"
    small_talk = "small_talk"
    non_question = "non_question"


class LiveState(StrEnum):
    idle = "idle"
    listening = "listening"
    speech_detected = "speech_detected"
    question_detected = "question_detected"
    generating = "generating"
    streaming = "streaming"
    answer_complete = "answer_complete"
    follow_up_detected = "follow_up_detected"
    stt_reconnecting = "stt_reconnecting"
    ai_reconnecting = "ai_reconnecting"
    error = "error"
    paused = "paused"
    ended = "ended"


class LiveSettings(BaseModel):
    auto_answer: bool = True
    length: AnswerLength = "standard"
    style: AnswerStyle = "natural"
    answer_language: str | None = None
    response_timing: ResponseTiming = "balanced"
    thinking: Thinking = "off"


class LiveSettingsPatch(BaseModel):
    auto_answer: bool | None = None
    length: AnswerLength | None = None
    style: AnswerStyle | None = None
    answer_language: str | None = None
    response_timing: ResponseTiming | None = None
    thinking: Thinking | None = None


class CodeBlock(BaseModel):
    language: str = "text"
    content: str = ""


class LiveAnswer(BaseModel):
    question: str = ""
    type: QuestionType = QuestionType.technical
    direct_answer: str = ""
    talking_points: list[str] = Field(default_factory=list)
    example: str | None = None
    code: CodeBlock | None = None
    time_complexity: str | None = None
    space_complexity: str | None = None
    follow_up: str | None = None
    context_used: list[str] = Field(default_factory=list)
    # Where the answer's personal claims come from: "verified" (the user's own documents), "example" (an
    # illustrative story/details the user must swap for their real experience), "general" (no personal claims).
    grounding: Literal["verified", "example", "general"] | None = None


class Envelope(BaseModel):
    v: int = PROTOCOL_VERSION
    type: str
    seq: int = 0
    ts: int = Field(default_factory=lambda: int(time.time() * 1000))
    data: dict[str, Any] = Field(default_factory=dict)


# ---- client → server payloads -------------------------------------------------------------------------


class AnswerRequest(BaseModel):
    question_text: str | None = Field(None, max_length=4000)


class AnswerPin(BaseModel):
    answer_id: str
    pinned: bool


class ChatMessage(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class SpeakerCorrect(BaseModel):
    turn_id: str
    speaker: Speaker


class DevSimulate(BaseModel):
    fixture: str = Field(pattern=r"^[a-z0-9_]{1,64}$")
    speed: float = Field(1.0, ge=0.5, le=50.0)


CLIENT_EVENT_TYPES = frozenset(
    {
        "session.start",
        "session.pause",
        "session.resume",
        "session.end",
        "answer.request",
        "answer.pin",
        "answer.clear",
        "chat.message",
        "settings.update",
        "speaker.correct",
        "dev.simulate",
    }
)
