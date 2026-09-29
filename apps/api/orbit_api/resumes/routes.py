"""Resume maker: build a resume, score it the way ATS software reads it, and improve it one change at a time.

- CRUD: `/v1/resumes` (a few per account). Content and design are validated JSON (resumes/schema.py).
- `POST /v1/resumes/score`: the deterministic ATS report for a draft (resumes/ats.py). Stateless and cheap, so the
  editor re-scores while you type.
- `POST /v1/resumes/import` (text, a LinkedIn profile's text, or a document already in Orbit) and
  `POST /v1/resumes/import-file` (PDF, DOCX or TXT, including LinkedIn's "Save to PDF"): AI reads it into
  structured data. Nothing is saved until the editor creates the resume.
- `POST /v1/resumes/suggest`: AI rewrites, whole-resume ("improve"), for a job post ("tailor"), or one field
  ("focus"). The editor applies them one accepted change at a time.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.models import Document, ProviderRequest, Resume, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse
from orbit_api.providers.llm.pricing import estimate_cost
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes import ai
from orbit_api.resumes.ats import AtsReport, score_resume
from orbit_api.resumes.schema import ResumeData, ResumeDesign

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/resumes", tags=["resumes"])

MAX_RESUMES = 20
MAX_JOB_TEXT = 20_000
MIN_IMPORT_CHARS = 80

score_limit = limit("resume-score", rate_per_s=2, burst=30)
ai_limit = limit("resume-ai", rate_per_s=0.1, burst=6)
ai_user_limit = limit_user("resume-ai-user", rate_per_s=40 / 3600, burst=10)


class ResumeIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    data: ResumeData = Field(default_factory=ResumeData)
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=MAX_JOB_TEXT)


class ResumeOut(ResumeIn):
    id: str
    created_at: datetime
    updated_at: datetime


class ResumeSummary(BaseModel):
    id: str
    title: str
    name: str
    headline: str
    template: str
    score: int
    has_job: bool
    updated_at: datetime


def _load(r: Resume) -> tuple[ResumeData, ResumeDesign]:
    return ResumeData.model_validate(r.data or {}), ResumeDesign.model_validate(r.design or {})


def _out(r: Resume) -> ResumeOut:
    data, design = _load(r)
    return ResumeOut(id=r.id, title=r.title, data=data, design=design, job_text=r.job_text or "",
                     created_at=r.created_at, updated_at=r.updated_at)


async def _owned(db: AsyncSession, resume_id: str, user: User) -> Resume:
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
    return r


@router.get("", response_model=list[ResumeSummary])
async def list_resumes(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> list[ResumeSummary]:
    rows = (await db.scalars(select(Resume).where(Resume.user_id == user.id)
                             .order_by(Resume.updated_at.desc(), Resume.created_at.desc()))).all()
    out = []
    for r in rows:
        data, design = _load(r)
        out.append(ResumeSummary(id=r.id, title=r.title, name=data.basics.name, headline=data.basics.headline,
                                 template=design.template, score=score_resume(data, design, r.job_text or "").score,
                                 has_job=bool((r.job_text or "").strip()), updated_at=r.updated_at))
    return out


@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ResumeOut:
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    r = Resume(user_id=user.id, title=body.title, data=body.data.model_dump(mode="json"),
               design=body.design.model_dump(mode="json"), job_text=body.job_text)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _out(r)


@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: str, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> ResumeOut:
    return _out(await _owned(db, resume_id, user))


@router.put("/{resume_id}", response_model=ResumeOut)
async def update_resume(resume_id: str, body: ResumeIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ResumeOut:
    r = await _owned(db, resume_id, user)
    r.title = body.title
    r.data = body.data.model_dump(mode="json")
    r.design = body.design.model_dump(mode="json")
    r.job_text = body.job_text
    await db.commit()
    await db.refresh(r)
    return _out(r)


@router.delete("/{resume_id}", status_code=204)
async def delete_resume(resume_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await db.delete(await _owned(db, resume_id, user))
    await db.commit()


# ---- ATS score ---------------------------------------------------------------------------------------------


class ScoreIn(BaseModel):
    data: ResumeData
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=MAX_JOB_TEXT)


@router.post("/score", response_model=AtsReport, dependencies=[Depends(score_limit)])
async def score(body: ScoreIn, _: Annotated[User, Depends(current_user)]) -> AtsReport:
    return score_resume(body.data, body.design, body.job_text)


# ---- AI: import and suggestions ----------------------------------------------------------------------------


async def _generate(db: AsyncSession, user: User, req: LLMRequest, what: str) -> LLMResponse:
    llm = get_llm_provider()
    try:
        resp = await llm.generate(req)
    except LLMError as e:
        log.warning("resume %s failed: %s", what, e)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The AI isn't available right now. Try again in a moment.") from e
    db.add(ProviderRequest(user_id=user.id, provider=llm.name, model=resp.model, request_type=req.request_type,
                           input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens,
                           cached_input_tokens=resp.usage.cached_input_tokens,
                           estimated_cost_usd=estimate_cost(resp.model, resp.usage)))
    await db.commit()
    return resp


class ImportIn(BaseModel):
    source: Literal["text", "linkedin", "document"]
    text: str | None = Field(None, max_length=60_000)
    document_id: str | None = Field(None, max_length=36)


class ImportOut(BaseModel):
    data: ResumeData
    title: str


async def _import_text(db: AsyncSession, user: User, text: str, kind: str) -> ImportOut:
    text = text.strip()
    if len(text) < MIN_IMPORT_CHARS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "There isn't enough text to read a resume from. Paste the whole resume or profile.")
    llm = get_llm_provider()
    resp = await _generate(db, user, ai.import_request(text, kind, llm), "import")
    try:
        data = ai.parse_structured(resp.text)
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("resume import unusable: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "The AI couldn't read that resume. Try again, or paste the text instead.") from e
    name = data.basics.name.strip()
    return ImportOut(data=data, title=f"{name}'s resume" if name else "Imported resume")


@router.post("/import", response_model=ImportOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def import_resume(body: ImportIn, user: Annotated[User, Depends(require_verified_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ImportOut:
    if body.source == "document":
        doc = await db.get(Document, body.document_id) if body.document_id else None
        if doc is None or doc.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
        return await _import_text(db, user, doc.source_text or "", "resume")
    return await _import_text(db, user, body.text or "", body.source)


@router.post("/import-file", response_model=ImportOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def import_resume_file(file: Annotated[UploadFile, File()],
                             user: Annotated[User, Depends(require_verified_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> ImportOut:
    """A resume file, or a LinkedIn profile saved as PDF (profile → More → Save to PDF). The file itself isn't
    kept: only the structured result goes back to the editor."""
    max_bytes = get_settings().max_upload_bytes
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Max file size is {max_bytes // 1_048_576} MB.")
    filename = (file.filename or "resume").replace("\\", "/").rsplit("/", 1)[-1][:300]
    try:
        fmt = detect_format(filename, file.content_type, raw[:8])
        text = await asyncio.to_thread(extract_text_isolated, raw, fmt)
    except ParseError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    kind = "linkedin" if "linkedin" in text[:4_000].lower() else "resume"
    return await _import_text(db, user, text, kind)


class SuggestIn(BaseModel):
    data: ResumeData
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=MAX_JOB_TEXT)
    mode: Literal["improve", "tailor"] = "improve"
    focus: str | None = Field(None, max_length=120)


class SuggestOut(BaseModel):
    suggestions: list[ai.Suggestion]


@router.post("/suggest", response_model=SuggestOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def suggest(body: SuggestIn, user: Annotated[User, Depends(require_verified_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> SuggestOut:
    if body.mode == "tailor" and not body.job_text.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add the job post first.")
    fields = ai.editable_fields(body.data)
    if body.focus and body.focus not in fields:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That part of the resume can't be rewritten.")
    if not any(text.strip() for _, text in fields.values()) and body.focus != "basics.summary":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add some experience first, then ask the AI.")
    report = score_resume(body.data, body.design, body.job_text)
    llm = get_llm_provider()
    req = ai.suggest_request(body.data, report, llm, mode=body.mode, job_text=body.job_text, focus=body.focus)
    resp = await _generate(db, user, req, "suggest")
    try:
        suggestions = ai.parse_suggestions(resp, body.data)
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("resume suggestions unusable: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI's answer came back garbled. Try again.") from e
    return SuggestOut(suggestions=suggestions)
