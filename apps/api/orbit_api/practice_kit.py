"""AI reviews for two placement-round practice tools: the written English round (an email or a short essay) and
guesstimates (estimate a number out loud, structured).

Both pages do their own instant checks in the browser (word count, greeting and sign-off, the steps of an estimate);
these endpoints add what a rule can't judge: whether the email answers every point, how the language reads, whether
an estimate's assumptions are reasonable and its arithmetic adds up. Nothing is saved. A review never rewrites the
candidate's work wholesale: it quotes their own words and says what to change, so the practice stays theirs.
"""

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.models import User
from orbit_api.ratelimit import limit, limit_user

router = APIRouter(prefix="/v1/practice", tags=["practice kit"])
_ip = limit("practice-kit", rate_per_s=40 / 3600, burst=10)
_user = limit_user("practice-kit-user", rate_per_s=40 / 3600, burst=8)

Short = Annotated[str, Field(max_length=300)]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def _quoted(quote: str, text: str) -> bool:
    """The review may only point at words the candidate wrote: a quote it made up is dropped."""
    q = _norm(quote)
    return len(q) >= 3 and q in _norm(text)


# ---- the written round -------------------------------------------------------------------------------------------

WRITTEN_SYSTEM = """You review a candidate's answer in the written English round of a campus or entry-level hiring
test: either a formal email written to a brief, or a short essay on a topic.

Return ONLY a JSON object:
{"scores": {"content": 0-5, "organisation": 0-5, "language": 0-5, "tone": 0-5},
 "summary": string,
 "covered": [string], "missed": [string],
 "fixes": [{"quote": string, "issue": string, "better": string}],
 "strengths": [string]}

Rules:
- content: for an email, did it do every thing the brief asks (each instruction, each detail to include)? For an
  essay, does it take a clear position, support it with reasons or examples and stay on topic?
- organisation: subject line, greeting, paragraphs, a clear purpose up front, a closing (email); introduction, body
  paragraphs and a conclusion (essay).
- language: grammar, spelling, punctuation, word choice, sentence variety.
- tone: polite and professional for an email (no slang, no SMS spellings, not demanding); measured for an essay.
- covered / missed: for an email, the brief's points it handled and the ones it left out, in a few words each. For an
  essay, missed lists what a strong answer would add (a counter-argument, an example).
- fixes: up to 6, most important first. quote is an EXACT phrase copied from the candidate's text (3 to 25 words);
  issue says what's wrong in under 15 words; better is the corrected phrase only, not a rewrite of the whole answer.
- strengths: 1 to 3 short, specific things done well.
- summary: two sentences, plain and encouraging, saying what would most improve the score.
- Never invent facts about the candidate. Judge only the text given.
"""


class WrittenIn(BaseModel):
    kind: Literal["email", "essay"]
    brief: str = Field(min_length=10, max_length=1500)
    text: str = Field(min_length=20, max_length=6000)


class Scores(BaseModel):
    content: int = Field(ge=0, le=5)
    organisation: int = Field(ge=0, le=5)
    language: int = Field(ge=0, le=5)
    tone: int = Field(ge=0, le=5)


class Fix(BaseModel):
    quote: Short
    issue: Short
    better: Short


class WrittenAI(BaseModel):
    scores: Scores
    summary: str = Field(max_length=600)
    covered: list[Short] = Field(default_factory=list)
    missed: list[Short] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)
    strengths: list[Short] = Field(default_factory=list)


class WrittenOut(WrittenAI):
    total: int  # out of 20
    words: int


@router.post("/written-review", response_model=WrittenOut, dependencies=[Depends(_ip), Depends(_user)])
async def written_review(body: WrittenIn, user: Annotated[User, Depends(require_verified_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> WrittenOut:
    evidence = f"Task: {body.kind}\nBrief:\n{body.brief}\n\nCandidate's answer:\n{body.text}"
    ai = await generate_json(db, user, "written_review", WRITTEN_SYSTEM, evidence, WrittenAI)
    s = ai.scores
    return WrittenOut(scores=s, summary=ai.summary, covered=ai.covered[:8], missed=ai.missed[:8],
                      fixes=[f for f in ai.fixes if _quoted(f.quote, body.text)][:6], strengths=ai.strengths[:3],
                      total=s.content + s.organisation + s.language + s.tone, words=len(body.text.split()))


# ---- guesstimates ------------------------------------------------------------------------------------------------

GUESS_SYSTEM = """You coach a candidate on a guesstimate (an estimation question in consulting, product and analyst
interviews, such as "How many cups of tea are sold in Bengaluru in a day?"). Interviewers judge the reasoning, not
the final number: clarifying the question, a clear way to break it down, sensible stated assumptions, correct
arithmetic and a sanity check.

Return ONLY a JSON object:
{"scores": {"clarify": 0-5, "structure": 0-5, "assumptions": 0-5, "math": 0-5, "sanity": 0-5},
 "summary": string,
 "assumptions": [{"quote": string,
                  "verdict": "reasonable" | "too high" | "too low" | "needs a reason", "note": string}],
 "math_ok": boolean, "math_note": string,
 "missed": [string],
 "follow_ups": [string]}

Rules:
- Judge what the candidate wrote in each step. A step left empty scores 0.
- assumptions: up to 6. quote is an EXACT phrase copied from the candidate's text. verdict compares it with common
  knowledge; when you're unsure of a real figure, say "needs a reason" rather than asserting a number. note: under
  20 words, what a better assumption or justification would look like. Do not state statistics as facts.
- math_ok: whether the calculation follows from the assumptions. math_note: the first error found, or what was
  checked. Recompute the candidate's own multiplications.
- missed: up to 4 segments or factors a strong answer would consider (e.g. "weekday vs weekend demand").
- follow_ups: 2 or 3 questions an interviewer would ask next about this estimate.
- summary: two sentences, plain and encouraging, on what most improves the approach.
"""


class GuessIn(BaseModel):
    question: str = Field(min_length=10, max_length=400)
    clarify: str = Field("", max_length=1500)
    approach: str = Field("", max_length=2000)
    assumptions: str = Field("", max_length=3000)
    calculation: str = Field("", max_length=3000)
    answer: str = Field("", max_length=300)
    sanity: str = Field("", max_length=1500)


class GuessScores(BaseModel):
    clarify: int = Field(ge=0, le=5)
    structure: int = Field(ge=0, le=5)
    assumptions: int = Field(ge=0, le=5)
    math: int = Field(ge=0, le=5)
    sanity: int = Field(ge=0, le=5)


class Assumption(BaseModel):
    quote: Short
    verdict: Literal["reasonable", "too high", "too low", "needs a reason"]
    note: Short


class GuessAI(BaseModel):
    scores: GuessScores
    summary: str = Field(max_length=600)
    assumptions: list[Assumption] = Field(default_factory=list)
    math_ok: bool
    math_note: str = Field("", max_length=400)
    missed: list[Short] = Field(default_factory=list)
    follow_ups: list[Short] = Field(default_factory=list)


class GuessOut(GuessAI):
    total: int  # out of 25


@router.post("/guesstimate-review", response_model=GuessOut, dependencies=[Depends(_ip), Depends(_user)])
async def guesstimate_review(body: GuessIn, user: Annotated[User, Depends(require_verified_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> GuessOut:
    steps = {"Clarifying questions": body.clarify, "Approach (how it breaks down)": body.approach,
             "Assumptions": body.assumptions, "Calculation": body.calculation, "Final answer": body.answer,
             "Sanity check": body.sanity}
    written = "\n\n".join(f"{name}:\n{text.strip() or '(left empty)'}" for name, text in steps.items())
    ai = await generate_json(db, user, "guesstimate_review", GUESS_SYSTEM,
                             f"Question: {body.question}\n\n{written}", GuessAI)
    everything = " ".join(steps.values())
    s = ai.scores
    return GuessOut(scores=s, summary=ai.summary,
                    assumptions=[a for a in ai.assumptions if _quoted(a.quote, everything)][:6],
                    math_ok=ai.math_ok, math_note=ai.math_note, missed=ai.missed[:4], follow_ups=ai.follow_ups[:3],
                    total=s.clarify + s.structure + s.assumptions + s.math + s.sanity)
