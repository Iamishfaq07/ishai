"""The job assistant (D85): `POST /v1/business/companies/{cid}/jobs/assist`. A recruiter's few words (or the form
as it is and a short instruction) in; every field of the job editor out, for them to review. Nothing is saved or
published here: the editor fills its form and the recruiter saves and publishes as always.

The work is business_ai.fill_job behind the port (ai_port.get_business_ai().fill_job). It shares the AI writer's
daily limit per company and its usage recording (each model call stored against the company); the answer names no
model or provider.
"""

import html
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import ratelimit
from orbit_api.business import rules, usage
from orbit_api.business.access import CompanyCtx, audit
from orbit_api.business.ai_port import get_business_ai, recording
from orbit_api.business.jobs import EmploymentType, Experience, Period, Question, Stage, Workplace, _drafts
from orbit_api.business_ai.job_facts import CURRENCY_BY_COUNTRY
from orbit_api.business_ai.job_fill import (
    CompanyContext,
    FieldName,
    FillQuestion,
    FillStage,
    JobFields,
    JobFill,
    JobFillRequest,
    Knockout,
)
from orbit_api.db import get_db

router = APIRouter(prefix="/v1/business", tags=["business"])


class AssistCurrent(BaseModel):
    """The editor's form as it is (for a refine). Lenient: a half-filled form is normal here."""

    title: str = Field("", max_length=160)
    description_html: str = Field("", max_length=rules.MAX_DESCRIPTION * 2)
    department: str = Field("", max_length=80)
    locations: list[str] = Field(default_factory=list, max_length=10)
    workplace: Workplace = "onsite"
    allowed_countries: list[str] = Field(default_factory=list, max_length=60)
    employment_type: EmploymentType = "full_time"
    experience: Experience = "mid"
    salary_min: int | None = Field(None, ge=0, le=10**12)
    salary_max: int | None = Field(None, ge=0, le=10**12)
    salary_currency: str = Field("INR", min_length=3, max_length=3)
    salary_period: Period = "year"
    show_salary: bool = True
    must_haves: list[str] = Field(default_factory=list, max_length=15)
    nice_to_haves: list[str] = Field(default_factory=list, max_length=15)
    questions: list[Question] = Field(default_factory=list, max_length=20)
    stages: list[Stage] | None = Field(None, max_length=12)


class AssistIn(BaseModel):
    prompt: str = Field("", max_length=2_000)  # "Senior React developer, Bengaluru hybrid, 18-28 LPA, 5+ years"
    title: str = Field("", max_length=160)
    location: str = Field("", max_length=160)
    salary: str = Field("", max_length=80)
    experience: str = Field("", max_length=60)
    pasted: str = Field("", max_length=12_000)  # an old job post or notes
    current: AssistCurrent | None = None
    instruction: str = Field("", max_length=500)  # a refine ("make it more junior"), with `current`
    language: Literal["auto", "en", "hi"] = "auto"


class AssistOut(BaseModel):
    title: str
    department: str
    locations: list[str]
    workplace: str
    allowed_countries: list[str]
    employment_type: str
    experience: str
    salary_min: int | None
    salary_max: int | None
    salary_currency: str
    salary_period: str
    show_salary: bool
    description_html: str
    must_haves: list[str]
    nice_to_haves: list[str]
    questions: list[dict[str, Any]]
    stages: list[dict[str, Any]] | None  # None: keep the job's stages
    assumptions: list[str]
    inclusive_language_notes: list[str]
    changed_fields: list[FieldName]
    source: Literal["ai", "template"]


def html_to_markdown(raw: str) -> str:
    """The editor's sanitized HTML as the small Markdown business_ai reads and writes (headings, bullets, bold)."""
    t = rules.sanitize_html(raw)
    t = re.sub(r"<h[34]>(.*?)</h[34]>", lambda m: f"\n## {m.group(1)}\n", t, flags=re.S)
    t = re.sub(r"<li>(.*?)</li>", lambda m: f"\n- {m.group(1)}", t, flags=re.S)
    t = re.sub(r"<(?:strong|b)>(.*?)</(?:strong|b)>", r"**\1**", t, flags=re.S)
    t = re.sub(r"<(?:em|i)>(.*?)</(?:em|i)>", r"*\1*", t, flags=re.S)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"</(?:p|ul|ol|blockquote)>", "\n\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(t)).strip()


def _fields(c: AssistCurrent) -> JobFields:
    return JobFields(
        title=c.title.strip(), department=c.department.strip(), locations=c.locations, workplace=c.workplace,
        allowed_countries=c.allowed_countries, employment_type=c.employment_type, experience=c.experience,
        salary_min=c.salary_min, salary_max=c.salary_max, salary_currency=c.salary_currency.upper(),
        salary_period=c.salary_period, show_salary=c.show_salary,
        description_markdown=html_to_markdown(c.description_html), must_haves=c.must_haves,
        nice_to_haves=c.nice_to_haves,
        questions=[FillQuestion(id=q.id, text=q.text, kind=q.kind, choices=q.choices, required=q.required,
                                knockout=Knockout(**q.knockout.model_dump()) if q.knockout else None)
                   for q in c.questions],
        stages=[FillStage(id=s.id, name=s.name, kind=s.kind) for s in c.stages] if c.stages is not None else None)


def _question(q: FillQuestion) -> dict[str, Any]:
    d: dict[str, Any] = {"id": q.id, "text": q.text, "kind": q.kind, "required": q.required,
                         "knockout": {k: v for k, v in q.knockout.model_dump().items() if v is not None}
                         if q.knockout else None}
    if q.kind == "choice":
        d["choices"] = q.choices or []
    return d


def _out(fill: JobFill, current: AssistCurrent | None) -> AssistOut:
    keep_html = current is not None and "description" not in fill.changed_fields
    return AssistOut(
        title=fill.title, department=fill.department, locations=fill.locations, workplace=fill.workplace,
        allowed_countries=fill.allowed_countries, employment_type=fill.employment_type, experience=fill.experience,
        salary_min=fill.salary_min, salary_max=fill.salary_max, salary_currency=fill.salary_currency,
        salary_period=fill.salary_period, show_salary=fill.show_salary,
        description_html=rules.sanitize_html(current.description_html) if keep_html and current is not None
        else rules.markdown_to_html(fill.description_markdown),
        must_haves=fill.must_haves, nice_to_haves=fill.nice_to_haves,
        questions=[_question(q) for q in fill.questions],
        stages=[s.model_dump() for s in fill.stages] if fill.stages is not None else None,
        assumptions=fill.assumptions, inclusive_language_notes=fill.inclusive_language_notes,
        changed_fields=fill.changed_fields, source=fill.source)


@router.post("/companies/{company_id}/jobs/assist", response_model=AssistOut)
async def assist(body: AssistIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> AssistOut:
    ctx.require("manage_jobs")
    ctx.writable()
    refine = bool(body.instruction.strip()) and body.current is not None
    if not refine and not (body.prompt.strip() or body.pasted.strip() or body.title.strip()):
        raise HTTPException(422, "Describe the job in a few words first.")
    ratelimit.check(_drafts, f"biz-draft:{ctx.company.id}", "That's the AI writer's limit for today.")
    company = ctx.company
    request = JobFillRequest(
        description=body.prompt, title=body.title, location=body.location, salary=body.salary,
        experience=body.experience, pasted=body.pasted, instruction=body.instruction if refine else "",
        current=_fields(body.current) if body.current is not None else None, language=body.language,
        company=CompanyContext(name=company.name[:120], about=(company.about or "")[:3_000],
                               country=(company.country or "IN")[:2],
                               default_currency=CURRENCY_BY_COUNTRY.get((company.country or "IN").upper(), "INR")))
    try:
        with recording() as calls:
            out = await get_business_ai().fill_job(request)
    except Exception as e:  # the provider failed in a way fill_job doesn't absorb: say so, nothing was saved
        raise HTTPException(503, "The AI writer isn't available right now. Try again in a minute.") from e
    summary = out.title or (body.current.title if body.current else "") or "New job"
    audit(db, company.id, ctx.user, "job.ai_assist", summary, source=out.source, refine=refine,
          fields=list(out.changed_fields))
    usage.store(db, company.id, ctx.user.id, calls)
    await db.commit()
    return _out(out, body.current)
