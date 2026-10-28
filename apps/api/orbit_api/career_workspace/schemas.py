"""Version-one contracts for the four personal workspaces."""
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

Text = Annotated[str, Field(max_length=500)]
Number = Annotated[float, Field(ge=0, le=100)]
Dimension = Literal["match", "level", "fresh", "interest", "pay", "place", "growth"]
Round = Literal["aptitude", "coding", "gd", "technical", "hr"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SkillEvidence(Contract):
    at: Annotated[str, Field(min_length=10, max_length=40)]
    score: Annotated[float, Field(ge=1, le=5)]
    kind: Literal["practice", "self", "interview"]
    note: Text

    @field_validator("at")
    @classmethod
    def valid_timestamp(cls, value: str) -> str:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class SkillRecord(Contract):
    skill: Annotated[str, Field(min_length=1, max_length=200)]
    evidence: Annotated[list[SkillEvidence], Field(max_length=30)]


class Marks(Contract):
    cgpa: Number | None
    tenth: Number | None
    twelfth: Number | None
    backlogs: Number | None
    branch: Text


class Drive(Contract):
    id: Text
    company: Text
    role: Text
    date: Text
    ctc: Text
    minCgpa: Number | None
    min10: Number | None
    min12: Number | None
    maxBacklogs: Number | None
    branches: Text
    rounds: list[Round]
    status: Literal["upcoming", "applied", "shortlisted", "selected", "not-selected", "skipped"]
    done: list[Round]


class Campus(Contract):
    marks: Marks
    drives: Annotated[list[Drive], Field(max_length=300)]


class Priority(Contract):
    resumeId: str | None = None
    weights: dict[Dimension, Annotated[float, Field(ge=0, le=5)]]
    ratings: dict[str, dict[Dimension, Annotated[float, Field(ge=1, le=5)] | None]]
    breakers: Annotated[list[Text], Field(max_length=20)] = []


class Project(Contract):
    initial: Annotated[str, Field(max_length=5000)]
    revision: Annotated[str, Field(max_length=5000)]
    reflection: Annotated[str, Field(max_length=3000)]
    checks: Annotated[list[Text], Field(max_length=20)]


class Projects(Contract):
    work: dict[Literal["data", "backend", "support"], Project]


class TransitionRequirement(Contract):
    id: Annotated[str, Field(min_length=1, max_length=80)]
    requirement: Annotated[str, Field(min_length=1, max_length=300)]
    evidence: Annotated[str, Field(max_length=2000)]
    nextAction: Annotated[str, Field(max_length=500)]
    due: Annotated[str, Field(max_length=10)]
    state: Literal["missing", "practising", "demonstrated"]

    @model_validator(mode="after")
    def checked_evidence(self) -> "TransitionRequirement":
        if self.state == "demonstrated" and not self.evidence.strip():
            raise ValueError("Record supporting evidence before marking it demonstrated")
        if self.due:
            date.fromisoformat(self.due)
        return self


class Transition(Contract):
    currentRole: Annotated[str, Field(max_length=160)]
    targetRole: Annotated[str, Field(max_length=160)]
    motivation: Annotated[str, Field(max_length=1000)]
    requirements: Annotated[list[TransitionRequirement], Field(max_length=50)]

    @model_validator(mode="after")
    def unique_requirements(self) -> "Transition":
        if len({r.id for r in self.requirements}) != len(self.requirements):
            raise ValueError("Each requirement needs a unique identity")
        return self


class StarDraft(Contract):
    question: Annotated[str, Field(max_length=400)]
    answer: Annotated[str, Field(max_length=20000)]


class BulletDraft(Contract):
    did: Annotated[str, Field(max_length=2000)]
    result: Annotated[str, Field(max_length=2000)]
    measure: Annotated[str, Field(max_length=1000)]
    pasted: Annotated[str, Field(max_length=4000)] = ""


class GapDraft(Contract):
    reason: Literal["study", "exam", "health", "family", "parent", "layoff", "relocation", "venture", "personal"]
    from_: Annotated[str, Field(alias="from", max_length=100)]
    to: Annotated[str, Field(max_length=100)]
    during: Annotated[str, Field(max_length=2000)]
    role: Annotated[str, Field(max_length=200)]


CONTRACTS: dict[str, TypeAdapter[Any]] = {
    "readiness": TypeAdapter(Annotated[list[SkillRecord], Field(max_length=300)]),
    "campus": TypeAdapter(Campus), "priority": TypeAdapter(Priority), "projects": TypeAdapter(Projects),
    "transition": TypeAdapter(Transition),
    "tool_star": TypeAdapter(StarDraft), "tool_bullets": TypeAdapter(BulletDraft), "tool_gap": TypeAdapter(GapDraft),
}
