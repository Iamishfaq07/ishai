"""Version-one contracts for the four personal workspaces."""
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

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


CONTRACTS: dict[str, TypeAdapter[Any]] = {
    "readiness": TypeAdapter(Annotated[list[SkillRecord], Field(max_length=300)]),
    "campus": TypeAdapter(Campus), "priority": TypeAdapter(Priority), "projects": TypeAdapter(Projects),
}
