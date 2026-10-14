from typing import Annotated

from pydantic import BaseModel, Field

DIMENSIONS = ("problem_framing", "technical_depth", "scalability", "edge_case_rigor", "communication_clarity")
Score = Annotated[int, Field(strict=True, ge=1, le=5)]
Line = Annotated[str, Field(min_length=1, max_length=600)]


class CareerContext(BaseModel):
    role: str = Field("", max_length=120)
    company: str = Field("", max_length=120)
    interview_stage: str = Field("Technical interview", max_length=80)
    tech_stack: list[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=30)
    key_requirements: list[Annotated[str, Field(max_length=400)]] = Field(default_factory=list, max_length=20)


class DepthScores(BaseModel):
    problem_framing: Score | None = None
    technical_depth: Score | None = None
    scalability: Score | None = None
    edge_case_rigor: Score | None = None
    communication_clarity: Score | None = None


class RetryEvaluation(BaseModel):
    score: Score
    clarity_score: Score
    feedback: Line
    ideal_answer: str = Field(min_length=1, max_length=3000)
    missing_points: list[Line] = Field(max_length=8)
    dimensions: DepthScores


class FollowUpDefense(BaseModel):
    question: Line
    answer: Line


class DefenseCard(BaseModel):
    spofs: list[Line] = Field(min_length=1, max_length=6)
    bottlenecks: list[Line] = Field(min_length=1, max_length=6)
    trade_offs: list[Line] = Field(min_length=1, max_length=6)
    follow_ups: list[FollowUpDefense] = Field(min_length=3, max_length=3)
