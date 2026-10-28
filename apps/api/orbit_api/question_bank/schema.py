"""The question bank's file format: one JSON file per company guide (`companies/<slug>.json`) and per role pack
(`roles/<slug>.json`), checked here when the API starts and by `python -m orbit_api.question_bank`.

Everything in a file is written by Orbit. A guide's rounds are what candidates commonly report, hedged ("often",
"for some roles"); its questions are Orbit's own practice questions in the style those interviews are known for,
never questions said to be taken from a real interview. The checks below hold the honest framing and the shape the
pages, the mock interviewer and the live copilot rely on.
"""

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

# Which section of a page a question sits in: how you've worked (behavioral), the job itself (role: technical, case
# or functional) and why this company or role (fit: motivation, HR-round questions).
QuestionType = Literal["behavioral", "role", "fit"]
# What kind of answer a question wants: the free warm-up checks an answer by its kind (web lib/warmup/checks.ts).
AnswerKind = Literal["intro", "story", "motivation", "knowledge", "situational", "reflection", "case", "closing"]
# How the companies page groups the guides.
CompanyGroup = Literal["it-services", "india-product", "global-tech", "consulting", "finance", "industry"]
# Where a company is suggested for practice: only in India; first in India, after the rest elsewhere (India's IT
# services firms hire worldwide); or everywhere.
Market = Literal["india", "india-first", "global"]
# How the roles page groups the packs.
RoleGroup = Literal["engineering", "data", "product-design", "business", "core-engineering", "early-career",
                    "public-service"]
# The mock interview a role pack starts (a subset of live/mock_interviewer.py's MockInterviewType and Persona).
MockType = Literal["behavioral", "technical", "system_design", "mixed"]
MockPersona = Literal["recruiter", "hiring_manager", "engineer", "staff_engineer", "executive"]

# Claims the bank never makes: that a question was "asked at" a company or came from a real interview, that
# anything is guaranteed, or where its text came from; and the product rules (no provider name, no evasion claims).
BANNED = (
    # "Leaked questions", "question paper leak" (a memory leak or a leaking pipe is fine).
    (re.compile(r"\bleaked\b|\b(question|interview|paper|test)s?\s+leaks?\b|\bleaks?\s+(of\s+)?(the\s+)?(interview|"
                r"question|paper|test)", re.I), "says questions leaked"),
    (re.compile(r"\b(actual|real|exact|genuine)\s+(interview\s+)?questions?\b", re.I), "claims real questions"),
    (re.compile(r"\bquestions?\s+(that\s+(were|are)\s+)?asked\s+(at|by|in)\b", re.I), "claims questions were asked"),
    (re.compile(r"\b(recently|previously|frequently)\s+asked\b", re.I), "claims questions were asked"),
    # A promise to the candidate (a system's "delivery guarantees" is fine).
    (re.compile(r"\b(we|orbit|this\s+guide)\s+guarantees?\b|\bguaranteed?\s+(a\s+|an\s+|the\s+|your\s+)?(job|offer|"
                r"selection|success|placement|results?|pass|interview)|\bguarantees?\s+(you|your)\b", re.I),
     "promises an outcome"),
    (re.compile(r"\binsider\s+(tips?|knowledge|info|information|questions?|access|secrets?)\b", re.I),
     "claims inside knowledge"),
    (re.compile(r"\bundetectable\b", re.I), "product rule: no evasion claims"),
    (re.compile(r"deep\s*seek", re.I), "product rule: the model provider isn't named"),
    (re.compile(r"glassdoor|leetcode|geeksforgeeks|ambitionbox|prepinsta|indiabix|interviewbit|teamblind|"
                r"\bblind\s+app\b", re.I), "names a question site"),
    # Specific figures the bank doesn't state: pay, head counts.
    (re.compile(r"[₹$€£]\s?\d|\b\d+(\.\d+)?\s?(lpa|lakhs?|crores?|k\s+per\s+(year|month|annum))\b", re.I),
     "states a pay figure"),
    (re.compile(r"\b\d[\d,]*\+?\s+(employees|staff|people\s+work)", re.I), "states a head count"),
)
# Rounds and summaries describe what candidates report, which varies: never as a certainty.
CERTAIN = re.compile(r"\b(always|every candidate|all candidates|without exception)\b", re.I)

SLUG = r"^[a-z0-9]+(-[a-z0-9]+)*$"


def _clean(value: str) -> str:
    if value != value.strip() or "  " in value or "\n" in value:
        raise ValueError("no leading, trailing, doubled spaces or line breaks")
    for pattern, why in BANNED:
        if pattern.search(value):
            raise ValueError(f"{why}: {value!r}")
    return value


def _hedged(value: str) -> str:
    if CERTAIN.search(value):
        raise ValueError(f"states a process as certain: {value!r}")
    return value


Text = Annotated[str, StringConstraints(min_length=2, max_length=240), AfterValidator(_clean)]
Line = Annotated[str, StringConstraints(min_length=2, max_length=240), AfterValidator(_clean),
                 AfterValidator(_hedged)]
Alias = Annotated[str, StringConstraints(min_length=2, max_length=60, pattern=r"^[a-z0-9][a-z0-9 .&'+-]*$"),
                  AfterValidator(_clean)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Question(_Strict):
    # Orbit's own wording; a question ends with "?" or, for a prompt ("Walk me through…"), with ".".
    text: Annotated[str, StringConstraints(min_length=12, max_length=220, pattern=r"[?.]$"), AfterValidator(_clean)]
    type: QuestionType
    kind: AnswerKind
    # What a good answer covers, two to four short points.
    covers: list[Annotated[str, StringConstraints(min_length=3, max_length=160), AfterValidator(_clean)]] = Field(
        min_length=2, max_length=4)


class Source(_Strict):
    """A public page a guide's facts come from (the company's own values or hiring page), never a question site."""
    title: Annotated[str, StringConstraints(min_length=3, max_length=120), AfterValidator(_clean)]
    url: Annotated[str, StringConstraints(max_length=300, pattern=r"^https://[a-z0-9.-]+\.[a-z]{2,}(/\S*)?$"),
                   AfterValidator(_clean)]


class Abroad(_Strict):
    """What candidates outside India report instead (a guide whose rounds are India's campus hiring); a field left
    out is the same as in India."""
    rounds: list[Line] = Field(min_length=2, max_length=8)
    looks_for: list[Text] | None = Field(None, min_length=2, max_length=10)
    questions: list[Question] | None = Field(None, min_length=4, max_length=30)
    tips: list[Text] | None = Field(None, min_length=1, max_length=8)


def _counts(questions: list[Question], minimum: dict[str, int]) -> None:
    for kind, n in minimum.items():
        have = sum(1 for q in questions if q.type == kind)
        if have < n:
            raise ValueError(f"needs at least {n} {kind} questions, has {have}")
    texts = [q.text.lower() for q in questions]
    if len(set(texts)) != len(texts):
        raise ValueError("a question is listed twice")


class _Entry(_Strict):
    slug: Annotated[str, StringConstraints(min_length=2, max_length=60, pattern=SLUG)]
    name: Annotated[str, StringConstraints(min_length=2, max_length=60), AfterValidator(_clean)]
    # Other names it goes by, lower case ("aws" for Amazon): typed ones find the guide.
    aliases: list[Alias] = Field(default_factory=list, max_length=12)
    # Two or three sentences: what the interviews are known for, as candidates report them.
    summary: Annotated[str, StringConstraints(min_length=80, max_length=700), AfterValidator(_clean),
                       AfterValidator(_hedged)]
    # The rounds (or for a role, the stages) candidates commonly report, in order, one short line each.
    rounds: list[Line] = Field(min_length=2, max_length=8)
    # What interviewers listen for: a company's stated values or principles where it publishes them.
    looks_for: list[Text] = Field(min_length=2, max_length=12)
    questions: list[Question] = Field(min_length=10, max_length=40)
    tips: list[Text] = Field(min_length=2, max_length=8)
    sources: list[Source] = Field(default_factory=list, max_length=6)
    # When a person last checked it against public material.
    reviewed: date


class CompanyGuide(_Entry):
    group: CompanyGroup
    market: Market
    abroad: Abroad | None = None
    # A line shown before the summary, for a name people confuse with something else (Tech Mahindra's own "Orbit"
    # portal): what this page is and isn't.
    note: Text | None = None

    @model_validator(mode="after")
    def _enough_of_each(self) -> "CompanyGuide":
        _counts(self.questions, {"behavioral": 3, "role": 3, "fit": 2})
        return self


class RoleMock(_Strict):
    """The mock interview "Practise this role" starts: the Practice page's own settings."""
    interview_type: MockType
    persona: MockPersona


class RolePack(_Entry):
    group: RoleGroup
    mock: RoleMock

    @model_validator(mode="after")
    def _enough_of_each(self) -> "RolePack":
        if len(self.questions) < 12:
            raise ValueError(f"a role pack needs at least 12 questions, has {len(self.questions)}")
        _counts(self.questions, {"behavioral": 3, "role": 6, "fit": 2})
        return self
