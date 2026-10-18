"""The Business AI's inputs and outputs (pydantic v2). Every string and list is bounded, so a model answer or a hostile
resume can't grow a record without limit."""

from typing import Literal

from pydantic import BaseModel, Field

QuestionKind = Literal["yes_no", "choice", "short_text", "number"]
Met = Literal["yes", "partly", "no"]


# ---- job description writer ----------------------------------------------------------------------------------


class JobBrief(BaseModel):
    """What a recruiter types: the facts the description may use, and nothing else."""

    title: str = Field(..., min_length=1, max_length=160)
    seniority: str | None = Field(None, max_length=60)
    location: str | None = Field(None, max_length=160)
    employment_type: str | None = Field(None, max_length=60)
    must_haves: list[str] = Field(default_factory=list, max_length=20)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=20)
    about_company: str = Field("", max_length=3_000)
    notes: str = Field("", max_length=3_000)
    language: str = Field("en", max_length=10)  # "en", "hi" (any BCP 47 code; en and hi are tested)


class ScreeningQuestion(BaseModel):
    text: str = Field(..., max_length=300)
    kind: QuestionKind
    choices: list[str] | None = Field(None, max_length=10)


class JobDraft(BaseModel):
    title: str = Field(..., max_length=160)
    summary: str = Field(..., max_length=1_500)
    responsibilities: list[str] = Field(default_factory=list, max_length=15)
    must_haves: list[str] = Field(default_factory=list, max_length=20)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=20)
    description_markdown: str = Field(..., max_length=12_000)
    suggested_screening_questions: list[ScreeningQuestion] = Field(default_factory=list, max_length=8)
    # What the inclusive-language check changed or removed, for the recruiter to see ("'rockstar' → 'skilled'").
    # Additive to the agreed interface; empty when nothing was changed.
    inclusive_language_notes: list[str] = Field(default_factory=list, max_length=30)
    # "ai", or "template" when the model was unavailable and the draft is the brief laid out (additive, like the notes).
    source: Literal["ai", "template"] = "ai"


# ---- resume parsing ------------------------------------------------------------------------------------------


class Experience(BaseModel):
    title: str = Field("", max_length=160)
    company: str = Field("", max_length=160)
    start: str | None = Field(None, max_length=40)
    end: str | None = Field(None, max_length=40)
    summary: str = Field("", max_length=1_500)


class Education(BaseModel):
    degree: str = Field("", max_length=160)
    school: str = Field("", max_length=160)
    year: str | None = Field(None, max_length=40)


class ParsedResume(BaseModel):
    name: str | None = Field(None, max_length=120)
    email: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=40)
    location: str | None = Field(None, max_length=160)
    headline: str | None = Field(None, max_length=200)
    total_years: float | None = Field(None, ge=0, le=60)
    skills: list[str] = Field(default_factory=list, max_length=80)
    experience: list[Experience] = Field(default_factory=list, max_length=20)
    education: list[Education] = Field(default_factory=list, max_length=10)


# ---- ranking -------------------------------------------------------------------------------------------------


class JobSpec(BaseModel):
    title: str = Field(..., max_length=160)
    must_haves: list[str] = Field(default_factory=list, max_length=20)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=20)
    experience_band: str | None = Field(None, max_length=60)  # "3-5 years", "5+ years", "fresher"
    location_rules: str | None = Field(None, max_length=300)  # "Onsite Pune; must be authorised to work in India"


class ScreeningAnswer(BaseModel):
    question: str = Field(..., max_length=300)
    answer: str = Field("", max_length=3_000)


class RequirementMatch(BaseModel):
    requirement: str = Field(..., max_length=300)
    met: Met
    # A quote from the (redacted) resume or the answers, checked against them server-side; None when there's none.
    evidence: str | None = Field(None, max_length=400)


class Ranking(BaseModel):
    score: int = Field(..., ge=0, le=100)
    must_haves: list[RequirementMatch] = Field(default_factory=list)
    nice_to_haves: list[RequirementMatch] = Field(default_factory=list)
    summary: str = Field(..., max_length=1_200)
    cautions: list[str] = Field(default_factory=list, max_length=12)
    model_version: str = Field(..., max_length=120)  # audit data: prompt + scoring version + model id
