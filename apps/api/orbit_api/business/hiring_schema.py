"""A human-readable, bounded contract shared by plans, interviews, evidence and candidate tasks."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from orbit_api.business_ai.fairness import asks_protected, discriminatory
from orbit_api.documents.uploads import sanitize_text

Id = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_-]+$")]
Line = Annotated[str, Field(min_length=1, max_length=600)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Criterion(Contract):
    id: Id
    name: str = Field(min_length=2, max_length=120)
    stage_id: str = Field(min_length=1, max_length=16)
    question: str = Field(min_length=12, max_length=800)
    probe: str = Field("", max_length=600)
    strong: str = Field(min_length=10, max_length=500)
    weak: str = Field(min_length=10, max_length=500)
    minutes: int = Field(8, ge=2, le=30)

    @model_validator(mode="after")
    def fair_questions(self) -> "Criterion":
        if any(discriminatory(sanitize_text(s)) or asks_protected(sanitize_text(s)) for s in
               (self.name, self.question, self.probe, self.strong, self.weak)):
            raise ValueError("Assess job-related evidence, not personal or protected characteristics.")
        return self


class WorkSampleSpec(Contract):
    title: str = Field(min_length=5, max_length=140)
    brief: str = Field(min_length=40, max_length=6000)
    change_request: str = Field(min_length=20, max_length=2500)
    time_box_min: int = Field(25, ge=10, le=120)
    required: bool = False
    candidate_guidance: str = Field("You may use tools. Explain your own decisions and disclose assistance.",
                                    min_length=10, max_length=1200)

    @model_validator(mode="after")
    def job_related(self) -> "WorkSampleSpec":
        if any(discriminatory(sanitize_text(s)) or asks_protected(sanitize_text(s)) for s in
               (self.title, self.brief, self.change_request, self.candidate_guidance)):
            raise ValueError("Use a job-related work sample without personal screening questions.")
        return self


class HiringPlan(Contract):
    criteria: list[Criterion] = Field(min_length=1, max_length=12)
    independent_feedback: bool = True
    candidate_intro: str = Field("We use a consistent interview plan. You can ask for clarification or adjustments.",
                                  min_length=10, max_length=1600)
    work_sample: WorkSampleSpec | None = None
    response_target_days: int = Field(3, ge=1, le=30)

    @model_validator(mode="after")
    def unique_ids(self) -> "HiringPlan":
        if len({c.id for c in self.criteria}) != len(self.criteria):
            raise ValueError("Each criterion needs a different identifier.")
        return self


class PlanIn(Contract):
    base_revision: int = Field(ge=0)
    plan: HiringPlan


class EvidenceRating(Contract):
    criterion_id: Id
    score: Annotated[int, Field(strict=True, ge=1, le=4)] | None = None
    observation: str = Field("", max_length=1800)
    source: Literal["interview", "resume", "work_sample"] = "interview"
    quote: str = Field("", max_length=1200)


class FeedbackIn(Contract):
    base_revision: int = Field(ge=0)
    plan_revision: int = Field(ge=1)
    stage_id: str = Field(min_length=1, max_length=16)
    ratings: list[EvidenceRating] = Field(default_factory=list, max_length=12)
    recommendation: Literal["hire", "hold", "no_hire"] = "hold"
    summary: str = Field("", max_length=3000)
    submit: bool = False


class SampleAnswer(Contract):
    base_revision: int = Field(ge=1)
    response: str = Field(min_length=40, max_length=20_000)
    explanation: str = Field(min_length=30, max_length=6000)
    assistance: Literal["none", "documentation", "ai", "collaboration"]


class DecisionIn(Contract):
    outcome: Literal["advance", "hold", "hire", "no_hire"]
    rationale: str = Field(min_length=30, max_length=5000)
    base_evidence_version: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]+$")
    acknowledge_gaps: bool = False


class ClarificationIn(Contract):
    message: str = Field(min_length=10, max_length=2000)
