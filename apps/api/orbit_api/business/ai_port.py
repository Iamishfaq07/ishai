"""The AI that Orbit for Business uses, behind a port: writing a job description from a brief, parsing an applicant's
resume, and ranking an applicant against a job with reasons.

The real implementation is `orbit_api.business_ai` (D83), adapted by `ModuleAI`. In tests, or with
ORBIT_BUSINESS_AI=fake, the deterministic `FakeBusinessAI` here answers: it never calls a model, so it costs nothing
and always gives the same answer for the same input.

Fairness rules that hold whatever answers:
- No protected attribute reaches the ranking. business_ai redacts the parse itself (redact_for_ranking: name,
  contact, gender, age, marital status, religion, caste, origin, health, photo references, the location line); the
  fake gets `professional_only` (no name, contact or location). The parsed resume has no field for any of them.
- A ranking is a recommendation. Nothing in Orbit rejects anyone because of it (pipeline.py: a person clicks Reject).
- `Ranking.model_version` names the model: audit data, kept in the company's audit log and the Orbit admin's view,
  never in what a company's members see (pipeline.py shows "basic match" for a keyword-only ranking instead).
"""

import contextlib
import importlib
import logging
import os
import re
import time
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from orbit_api.business_ai.job_fill import JobFill, JobFillRequest
from orbit_api.business_ai.job_fill import fill_job as _fill_job

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
    # Coded words the writer replaced, for the recruiter to see; "template": the model couldn't be reached and the
    # draft is the brief laid out.
    inclusive_language_notes: list[str] = Field(default_factory=list)
    source: Literal["ai", "template"] = "ai"


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
    summary: str | None = None
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

    async def fill_job(self, request: JobFillRequest) -> JobFill: ...


def professional_only(resume: ParsedResume) -> ParsedResume:
    """What ranking may see: the work, skills and education. Who the person is (name, contact, where they live) is
    left out, so it can't sway the score."""
    return resume.model_copy(update={"name": None, "email": None, "phone": None, "location": None})


# ---- the deterministic fake ---------------------------------------------------------------------------------------

FAKE_MODEL_VERSION = "fake-v1+deterministic-only"  # a keyword match: no model is called
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

    async def fill_job(self, request: JobFillRequest) -> JobFill:
        # The assistant's own deterministic reading (business_ai.job_fill, pure): no model, same answer every time.
        return await _fill_job(request, use_model=False)

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


# ---- the real module (orbit_api.business_ai, D83) ------------------------------------------------------------------

EXPERIENCE_YEARS = {"entry": "0-1 years", "junior": "1-3 years", "mid": "3-5 years", "senior": "5+ years",
                    "lead": "8+ years"}


def location_text(rules: LocationRules) -> str:
    """The job's location rules in the words business_ai reads ("Remote; open to applicants in IN, AE")."""
    places = ", ".join(rules.locations[:5])
    if rules.workplace == "remote":
        who = ", ".join(rules.allowed_countries) if rules.allowed_countries else "anywhere"
        return f"Remote; open to applicants in {who}"[:300]
    mode = "Hybrid" if rules.workplace == "hybrid" else "Onsite"
    return f"{mode} {places}".strip()[:300]


@dataclass
class UsageRecord:
    provider: str
    model: str
    request_type: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    latency_ms: int
    ok: bool


_recording: ContextVar[list[UsageRecord] | None] = ContextVar("business_ai_usage", default=None)


@contextlib.contextmanager
def recording() -> Iterator[list[UsageRecord]]:
    """Every model call business_ai makes inside this block, for the caller to store against the company
    (provider_requests.company_id). business_ai itself writes nothing: it's a pure module."""
    calls: list[UsageRecord] = []
    token = _recording.set(calls)
    try:
        yield calls
    finally:
        _recording.reset(token)


class _RecordingLLM:
    """The app's LLM provider, noting each call's usage in the current `recording()` block."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def generate(self, request: Any) -> Any:
        started = time.monotonic()
        ok, model, usage = False, "", None
        try:
            resp = await self._inner.generate(request)
            ok, model, usage = True, resp.model, resp.usage
            return resp
        finally:
            calls = _recording.get()
            if calls is not None:
                calls.append(UsageRecord(
                    provider=str(getattr(self._inner, "name", "llm")), model=str(model or ""),
                    request_type=str(getattr(request, "request_type", "") or "business_ai")[:32],
                    input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
                    output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
                    cached_input_tokens=int(getattr(usage, "cached_input_tokens", 0) or 0),
                    latency_ms=int((time.monotonic() - started) * 1000), ok=ok))


class ModuleAI:
    """orbit_api.business_ai behind this port: its models built field by field from ours, its answers read back
    into ours. Its functions never raise for a model failure (each has a deterministic path)."""

    def __init__(self, module: Any) -> None:
        self._m = module
        llm = importlib.import_module(f"{module.__name__}.llm")
        original = llm.provider
        if not getattr(original, "_orbit_recording", False):
            def provider() -> Any:
                return _RecordingLLM(original())

            provider._orbit_recording = True  # type: ignore[attr-defined]
            setattr(llm, "provider", provider)  # noqa: B010 - business_ai.llm.provider is its seam

    async def write_job_description(self, brief: JobBrief) -> JobDraft:
        theirs = self._m.JobBrief(title=brief.title, seniority=brief.seniority or None,
                                  location=brief.location or None, employment_type=brief.employment_type or None,
                                  must_haves=brief.must_haves, nice_to_haves=brief.nice_to_haves,
                                  about_company=brief.about_company, notes=brief.notes, language=brief.language)
        out = await self._m.write_job_description(theirs)
        return JobDraft.model_validate(out.model_dump())

    async def fill_job(self, request: JobFillRequest) -> JobFill:
        out = await self._m.fill_job(request)
        return JobFill.model_validate(out.model_dump())

    async def parse_applicant_resume(self, text: str) -> ParsedResume:
        out = await self._m.parse_applicant_resume(text)
        return ParsedResume.model_validate(out.model_dump())

    async def rank_applicant(self, job: JobSpec, resume: ParsedResume, answers: list[QA]) -> Ranking:
        # business_ai redacts the parse itself (redact_for_ranking) and needs the name to strip it from the text, so it
        # gets the whole parse; nothing protected reaches its model or its matcher (D83).
        spec = self._m.JobSpec(title=job.title, must_haves=job.must_haves, nice_to_haves=job.nice_to_haves,
                               experience_band=EXPERIENCE_YEARS.get(job.experience_band, job.experience_band),
                               location_rules=location_text(job.location_rules))
        theirs = self._m.ParsedResume.model_validate(resume.model_dump())
        qa = [self._m.ScreeningAnswer(question=a.question[:300], answer=a.answer[:3000]) for a in answers]
        out = await self._m.rank_applicant(spec, theirs, qa)
        return Ranking.model_validate(out.model_dump())


def basic_match(model_version: str | None) -> bool:
    """The ranking is keyword matching alone (the model was unavailable, or the fake): shown as "basic match"."""
    return bool(model_version) and str(model_version).endswith("deterministic-only")


_override: BusinessAI | None = None
_module_ai: ModuleAI | None = None


def set_business_ai(ai: BusinessAI | None) -> None:
    """Tests: answer with this instead (None: back to the default)."""
    global _override
    _override = ai


def get_business_ai() -> BusinessAI:
    """orbit_api.business_ai, except in tests or with ORBIT_BUSINESS_AI=fake (the deterministic fake here)."""
    global _module_ai
    if _override is not None:
        return _override
    if os.environ.get("ORBIT_BUSINESS_AI", "").strip().lower() == "fake" or os.environ.get("ORBIT_ENV") == "test":
        return FakeBusinessAI()
    if _module_ai is None:
        _module_ai = ModuleAI(importlib.import_module("orbit_api.business_ai"))
    return _module_ai
