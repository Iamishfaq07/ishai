"""Debrief a real interview: the candidate's own notes become questions asked, promises to keep, what to prepare next
and story-bank drafts, all for them to review.

Pattern from open-source job-search agents (career-ops' interview story bank, ai-job-search reusing earlier-round
feedback; docs/PERSONAL_WORKFLOW_RESEARCH_2026_10.md). Orbit already debriefs practice sessions (career/routes.py);
this is the employer round. Nothing is saved here: the web app saves a story through the story bank and notes
through the round history only when the candidate chooses to. Facts come only from the notes; no outcome is
predicted.
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.documents.uploads import sanitize_text
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import JobInterviewRound, User
from orbit_api.ratelimit import limit, limit_user
from orbit_api.stories.routes import COMPETENCIES

router = APIRouter(prefix="/v1/jobs/tracker", tags=["interview debrief"])
_ip = limit("interview-debrief", rate_per_s=20 / 3600, burst=6)
_user = limit_user("interview-debrief-user", rate_per_s=20 / 3600, burst=5)

SYSTEM = """You help a candidate debrief a real job interview from their own notes.

Return ONLY a JSON object:
{"questions": [{"question": string, "kind": "behavioral"|"technical"|"role"|"company"|"other",
   "went": "strong"|"okay"|"weak"|"unsure"}],
 "promises": [string], "focus": [string], "thank_you_points": [string],
 "stories": [{"title": string, "situation": string, "task": string, "action": string, "result": string,
   "competencies": [string]}]}

Rules:
- questions: every question the notes say was asked, in the interviewer's words where the notes give them. "went" is
  the candidate's own sense from the notes; "unsure" when they don't say.
- promises: things the candidate said they would send or do (a portfolio link, references, a follow-up answer).
- focus: up to 5 concrete things to prepare before the next round, from weak or unsure answers and topics raised.
- thank_you_points: up to 3 specific moments from the conversation worth mentioning in a thank-you note.
- stories: up to 2 STAR stories, only for examples the candidate actually told. First person, plain words, no
  buzzwords. competencies: 1-3 of: leadership, teamwork, conflict, failure, ownership, impact, ambiguity, customer,
  influence, learning, technical, deadline.
- Use ONLY facts in the notes. Never invent questions, numbers, names or outcomes; where a story detail is missing,
  write a short bracketed prompt such as [the result]. Never predict whether the candidate will advance.
- Empty lists are fine.
"""


def _cut(items: Any, most: int) -> Any:
    return items[:most] if isinstance(items, list) else items


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=400)
    kind: Literal["behavioral", "technical", "role", "company", "other"] = "other"
    went: Literal["strong", "okay", "weak", "unsure"] = "unsure"


class StoryDraft(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    situation: str = Field("", max_length=1200)
    task: str = Field("", max_length=1200)
    action: str = Field(min_length=1, max_length=1200)
    result: str = Field("", max_length=1200)
    competencies: list[str] = Field(default_factory=list)

    @field_validator("competencies", mode="before")
    @classmethod
    def _known(cls, v: Any) -> list[str]:
        return [c for c in (str(x).strip().lower() for x in (v or [])) if c in COMPETENCIES][:3]


class Debrief(BaseModel):
    questions: list[Question] = Field(default_factory=list)
    promises: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)
    focus: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)
    thank_you_points: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list)
    stories: list[StoryDraft] = Field(default_factory=list)

    @field_validator("questions", mode="before")
    @classmethod
    def _q(cls, v: Any) -> Any:
        return _cut(v, 15)

    @field_validator("promises", "focus", mode="before")
    @classmethod
    def _five(cls, v: Any) -> Any:
        return _cut(v, 5)

    @field_validator("thank_you_points", mode="before")
    @classmethod
    def _three(cls, v: Any) -> Any:
        return _cut(v, 3)

    @field_validator("stories", mode="before")
    @classmethod
    def _two(cls, v: Any) -> Any:
        return _cut(v, 2)


class DebriefIn(BaseModel):
    notes: str = Field(min_length=40, max_length=8000)
    round_id: str | None = Field(None, max_length=36)


@router.post("/{entry_id}/debrief", response_model=Debrief, dependencies=[Depends(_ip), Depends(_user)])
async def debrief(entry_id: str, body: DebriefIn, user: Annotated[User, Depends(require_verified_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> Debrief:
    job = await owned(db, user, entry_id)
    label = "Interview"
    if body.round_id:
        row = await db.get(JobInterviewRound, body.round_id)
        if row is None or row.user_id != user.id or row.application_id != job.id:
            raise HTTPException(404, "That interview round isn't on this job.")
        label = row.label or label
    evidence = (f"Role: {job.title}\nCompany: {job.company}\nRound: {label}\n"
                f"Candidate's notes:\n{sanitize_text(body.notes)}")
    return await generate_json(db, user, "interview_debrief", SYSTEM, evidence, Debrief)
