"""The AI that Orbit for Business uses, behind a port: writing a job description from a brief, parsing an applicant's
resume, and ranking an applicant against a job with reasons.

The real implementation is `orbit_api.business_ai` (built separately, D83). Until it is present, or when
ORBIT_BUSINESS_AI=fake (tests), the deterministic `FakeBusinessAI` here answers: it never calls a model, so it costs
nothing and always gives the same answer for the same input.

Fairness rules that hold whatever answers:
- `rank_applicant` never receives protected attributes. `professional_only` strips the name, email, phone and
  location before ranking, and the parsed resume has no field for gender, age, photo, religion, caste or marital
  status.
- A ranking is a recommendation. Nothing in Orbit rejects anyone because of it (pipeline.py: a person clicks Reject).
"""

import importlib
import logging
import os
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal, Protocol, cast

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

Met = Literal["yes", "partly", "no"]


class JobBrief(BaseModel):
    title: str
    seniority: str = ""
    location: str = ""
    employment_type: str = ""
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)
    about_company: str = ""
    notes: str = ""
    language: str = "en"


class SuggestedQuestion(BaseModel):
    text: str
    kind: Literal["yes_no", "choice", "short_text", "number"] = "yes_no"
    choices: list[str] | None = None


class JobDraft(BaseModel):
    title: str
    summary: str
    responsibilities: list[str] = Field(default_factory=list)
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)
    description_markdown: str
    suggested_screening_questions: list[SuggestedQuestion] = Field(default_factory=list)


class ExperienceItem(BaseModel):
    title: str = ""
    company: str = ""
    start: str | None = None
    end: str | None = None
    summary: str = ""


class EducationItem(BaseModel):
    degree: str = ""
    school: str = ""
    year: str | None = None


class ParsedResume(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    headline: str | None = None
    total_years: float | None = None
    skills: list[str] = Field(default_factory=list)
    experience: list[ExperienceItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)


class LocationRules(BaseModel):
    workplace: str = "onsite"
    locations: list[str] = Field(default_factory=list)
    allowed_countries: list[str] = Field(default_factory=list)


class JobSpec(BaseModel):
    title: str
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)
    experience_band: str = "mid"
    location_rules: LocationRules = Field(default_factory=LocationRules)


class RequirementMatch(BaseModel):
    requirement: str
    met: Met
    evidence: str | None = None


class Ranking(BaseModel):
    score: int = Field(ge=0, le=100)
    must_haves: list[RequirementMatch] = Field(default_factory=list)
    nice_to_haves: list[RequirementMatch] = Field(default_factory=list)
    summary: str = ""
    cautions: list[str] = Field(default_factory=list)
    model_version: str


class QA(BaseModel):
    question: str
    answer: str


class BusinessAI(Protocol):
    async def write_job_description(self, brief: JobBrief) -> JobDraft: ...

    async def parse_applicant_resume(self, text: str) -> ParsedResume: ...

    async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking: ...


def professional_only(resume: ParsedResume) -> ParsedResume:
    """What ranking may see: the work, skills and education. Who the person is (name, contact, where they live) is
    left out, so it can't sway the score."""
    return resume.model_copy(update={"name": None, "email": None, "phone": None, "location": None})


# ---- the deterministic fake ---------------------------------------------------------------------------------------

FAKE_MODEL_VERSION = "orbit-keywords-1"  # a keyword match, honestly named: no model is called
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"\+?\d[\d ()-]{7,}\d")
_YEARS = re.compile(r"\b(19[89]\d|20[0-4]\d)\s*(?:-|–|—|to)\s*(present|current|now|(?:19[89]\d|20[0-4]\d))", re.I)
_WORD = re.compile(r"[a-z0-9+#.]+")
_STOP = frozenset({"and", "or", "the", "a", "an", "of", "in", "with", "for", "to", "on", "at", "years", "year",
                   "experience", "strong", "good", "knowledge", "skills", "plus", "+", "using", "least"})


def _tokens(text: str) -> set[str]:
    return {w.strip(".") for w in _WORD.findall(text.lower()) if w.strip(".") and w.strip(".") not in _STOP}


def _md_list(items: list[str]) -> str:
    return "\n".join(f"- {x}" for x in items)


class FakeBusinessAI:
    """Same input, same output; no model called. Used in tests and until orbit_api.business_ai is present."""

    async def write_job_description(self, brief: JobBrief) -> JobDraft:
        title = brief.title.strip() or "New role"
        where = f" in {brief.location}" if brief.location.strip() else ""
        level = f"{brief.seniority.strip()} " if brief.seniority.strip() else ""
        summary = f"We're hiring a {level}{title}{where}."
        if brief.about_company.strip():
            summary += f" {brief.about_company.strip()}"
        responsibilities = [f"Own {title.lower()} work end to end, from planning to delivery",
                            "Work closely with the team and stakeholders",
                            "Share what you learn and help others grow"]
        must = [m.strip() for m in brief.must_haves if m.strip()]
        nice = [n.strip() for n in brief.nice_to_haves if n.strip()]
        parts = [summary, "", "### What you'll do", _md_list(responsibilities)]
        if must:
            parts += ["", "### What you need", _md_list(must)]
        if nice:
            parts += ["", "### Nice to have", _md_list(nice)]
        if brief.notes.strip():
            parts += ["", brief.notes.strip()]
        questions = [SuggestedQuestion(text=f"Do you have experience with {m}?", kind="yes_no") for m in must[:3]]
        questions.append(SuggestedQuestion(text="How many years of relevant experience do you have?", kind="number"))
        return JobDraft(title=title, summary=summary, responsibilities=responsibilities, must_haves=must,
                        nice_to_haves=nice, description_markdown="\n".join(parts).strip(),
                        suggested_screening_questions=questions)

    async def parse_applicant_resume(self, text: str) -> ParsedResume:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        email = _EMAIL.search(text)
        phone = _PHONE.search(text)
        name = lines[0][:120] if lines and not _EMAIL.search(lines[0]) and len(lines[0].split()) <= 5 else None
        headline = lines[1][:160] if len(lines) > 1 and not _EMAIL.search(lines[1]) else None
        now = datetime.now(UTC).year
        years = 0.0
        experience: list[ExperienceItem] = []
        for ln in lines:
            m = _YEARS.search(ln)
            if not m:
                continue
            start = int(m.group(1))
            end_raw = m.group(2).lower()
            end = now if end_raw in {"present", "current", "now"} else int(end_raw)
            if end >= start:
                years += end - start
            head = ln[:m.start()].strip(" ,(—-")
            title, _, company = head.partition(",")
            experience.append(ExperienceItem(title=title.strip()[:160], company=company.strip()[:160],
                                             start=str(start), end=m.group(2), summary=""))
        skills: list[str] = []
        capture = False
        for ln in lines:
            if ln.upper().startswith("SKILLS"):
                capture = True
                rest = ln.split(":", 1)[1] if ":" in ln else ""
                skills += [s.strip() for s in rest.split(",") if s.strip()]
                continue
            if capture:
                if ln.isupper() and len(ln) < 40:
                    break
                body = ln.split(":", 1)[1] if ":" in ln else ln
                skills += [s.strip(" -•") for s in body.split(",") if s.strip(" -•")]
        return ParsedResume(name=name, email=email.group(0) if email else None,
                            phone=phone.group(0).strip() if phone else None, headline=headline,
                            total_years=years or None, skills=list(dict.fromkeys(skills))[:40],
                            experience=experience[:12], education=[])

    async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking:
        haystack = " ".join([resume.headline or "", *resume.skills,
                             *(f"{e.title} {e.company} {e.summary}" for e in resume.experience),
                             *(f"{q.question} {q.answer}" for q in answers)])
        have = _tokens(haystack)

        def match(req: str) -> RequirementMatch:
            want = _tokens(req)
            if not want:
                return RequirementMatch(requirement=req, met="no", evidence=None)
            hit = want & have
            if hit == want:
                return RequirementMatch(requirement=req, met="yes", evidence=f"Mentions {', '.join(sorted(hit))}")
            if hit:
                return RequirementMatch(requirement=req, met="partly", evidence=f"Mentions {', '.join(sorted(hit))}")
            return RequirementMatch(requirement=req, met="no", evidence=None)

        must = [match(r) for r in job.must_haves]
        nice = [match(r) for r in job.nice_to_haves]
        weight = {"yes": 1.0, "partly": 0.5, "no": 0.0}
        must_part = sum(weight[m.met] for m in must) / len(must) if must else 1.0
        nice_part = sum(weight[m.met] for m in nice) / len(nice) if nice else 0.5
        score = round(80 * must_part + 20 * nice_part)
        met = sum(1 for m in must if m.met == "yes")
        cautions = [f"No evidence for: {m.requirement}" for m in must if m.met == "no"]
        summary = f"Matches {met}/{len(must)} must-haves." if must else "No must-haves set for this job."
        return Ranking(score=max(0, min(100, score)), must_haves=must, nice_to_haves=nice, summary=summary,
                       cautions=cautions[:5], model_version=FAKE_MODEL_VERSION)


# ---- the real module, when present ---------------------------------------------------------------------------------


class _ModuleAI:
    """orbit_api.business_ai's three functions, with its answers read into this port's models (by field name), so
    the two can evolve without importing each other's classes."""

    def __init__(self, module: Any) -> None:
        self._m = module

    async def _call(self, name: str, *args: Any) -> Any:
        fn = cast(Callable[..., Awaitable[Any]], getattr(self._m, name))
        converted = [self._theirs(a) for a in args]
        out = await fn(*converted)
        return out.model_dump() if isinstance(out, BaseModel) else out

    def _theirs(self, value: Any) -> Any:
        """Our model as theirs when the module has a class of the same name, else as it is."""
        if isinstance(value, list):
            return [self._theirs(v) for v in value]
        if isinstance(value, BaseModel):
            cls = getattr(self._m, type(value).__name__, None)
            if isinstance(cls, type) and issubclass(cls, BaseModel):
                return cls.model_validate(value.model_dump())
            if type(value).__name__ == "QA":
                return value.model_dump()
        return value

    async def write_job_description(self, brief: JobBrief) -> JobDraft:
        return JobDraft.model_validate(await self._call("write_job_description", brief))

    async def parse_applicant_resume(self, text: str) -> ParsedResume:
        return ParsedResume.model_validate(await self._call("parse_applicant_resume", text))

    async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking:
        return Ranking.model_validate(await self._call("rank_applicant", job, professional_only(resume), answers))


_override: BusinessAI | None = None


def set_business_ai(ai: BusinessAI | None) -> None:
    """Tests: answer with this instead (None: back to the default)."""
    global _override
    _override = ai


def get_business_ai() -> BusinessAI:
    if _override is not None:
        return _override
    choice = os.environ.get("ORBIT_BUSINESS_AI", "").strip().lower()
    if choice != "fake" and os.environ.get("ORBIT_ENV", "") != "test":
        try:
            module = importlib.import_module("orbit_api.business_ai")
        except ImportError:
            module = None
        if module is not None and all(hasattr(module, n) for n in
                                      ("write_job_description", "parse_applicant_resume", "rank_applicant")):
            return _ModuleAI(module)
    return FakeBusinessAI()
