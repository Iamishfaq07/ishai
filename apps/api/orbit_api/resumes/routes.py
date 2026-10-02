"""Resume maker: build a resume, score it the way ATS software reads it, and improve it one change at a time.

- CRUD: `/v1/resumes` (a few per account). Content and design are validated JSON (resumes/schema.py).
- `POST /v1/resumes/score`: the deterministic ATS report for a draft (resumes/ats.py). Stateless and cheap, so the
  editor re-scores while you type.
- `POST /v1/resumes/import` (text, a LinkedIn profile's text, or a document already in Orbit) and
  `POST /v1/resumes/import-file` (PDF, DOCX or TXT, including LinkedIn's "Save to PDF"): AI reads it into
  structured data. Nothing is saved until the editor creates the resume.
- `POST /v1/resumes/suggest`: AI rewrites, whole-resume ("improve"), for a job post ("tailor"), or one field
  ("focus"). The editor applies them one accepted change at a time.
- `POST /v1/resumes/cover-letter`: an AI cover letter from the resume and job post, grounded the same way; the
  editor saves it with the resume. `POST /v1/resumes/cover-letter/docx` downloads it as a Word file.
- Without a plan that includes resume AI, each AI action spends a resume credit (resumes/allowance.py); with none
  left they answer `402 upgrade_required`. `GET /v1/resumes/allowance` says what's left. There's no signed-out
  resume maker: it's part of the Orbit account.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.models import Document, ProviderRequest, Resume, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse
from orbit_api.providers.llm.pricing import estimate_cost
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes import ai, fixes
from orbit_api.resumes.allowance import Allowance, AllowanceOut, allowance_for
from orbit_api.resumes.ats import AtsReport, score_resume
from orbit_api.resumes.claims import ground_import
from orbit_api.resumes.docx_export import letter_docx, resume_docx
from orbit_api.resumes.schema import ResumeData, ResumeDesign

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/resumes", tags=["resumes"])

MAX_RESUMES = 20
MAX_JOB_TEXT = 20_000
MIN_IMPORT_CHARS = 80

score_limit = limit("resume-score", rate_per_s=2, burst=30)
ai_limit = limit("resume-ai", rate_per_s=0.1, burst=6)
ai_user_limit = limit_user("resume-ai-user", rate_per_s=40 / 3600, burst=10)
list_limit = limit_user("resume-list", rate_per_s=1, burst=20)  # each call scores every saved resume
score_user_limit = limit_user("resume-score-user", rate_per_s=3, burst=40)


class ResumeIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    data: ResumeData = Field(default_factory=ResumeData)
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=MAX_JOB_TEXT)
    # Left out (None) by clients that don't edit it, so saving the resume never wipes the letter.
    cover_letter: str | None = Field(None, max_length=ai.MAX_LETTER_CHARS)


class ResumeOut(ResumeIn):
    id: str
    cover_letter: str = ""
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
                     cover_letter=r.cover_letter or "", created_at=r.created_at, updated_at=r.updated_at)


async def _owned(db: AsyncSession, resume_id: str, user: User) -> Resume:
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
    return r


@router.get("", response_model=list[ResumeSummary], dependencies=[Depends(list_limit)])
async def list_resumes(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> list[ResumeSummary]:
    rows = (await db.scalars(select(Resume).where(Resume.user_id == user.id)
                             .order_by(Resume.updated_at.desc(), Resume.created_at.desc()))).all()
    loaded = [(r, *_load(r), r.job_text or "") for r in rows]
    # Scoring is CPU work (keyword matching, every check), once per resume: off the event loop, so a long list
    # doesn't stall every other request (live sessions included).
    scores = await asyncio.to_thread(lambda: [score_resume(data, design, job).score for _, data, design, job in loaded])
    return [ResumeSummary(id=r.id, title=r.title, name=data.basics.name, headline=data.basics.headline,
                          template=design.template, score=score, has_job=bool(job.strip()), updated_at=r.updated_at)
            for (r, data, design, job), score in zip(loaded, scores, strict=True)]


# Before "/{resume_id}", which would otherwise take "allowance" for an id.
@router.get("/allowance", response_model=AllowanceOut)
async def my_allowance(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> AllowanceOut:
    """Whether the AI is unlimited on this plan, or how many resume credits are left (and what a pack costs)."""
    return await (await allowance_for(db, user)).status()


@router.post("", response_model=ResumeOut, status_code=201)
async def create_resume(body: ResumeIn, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ResumeOut:
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    r = Resume(user_id=user.id, title=body.title, data=body.data.model_dump(mode="json"),
               design=body.design.model_dump(mode="json"), job_text=body.job_text, cover_letter=body.cover_letter or "")
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
    if body.cover_letter is not None:
        r.cover_letter = body.cover_letter
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


@router.post("/score", response_model=AtsReport, dependencies=[Depends(score_limit), Depends(score_user_limit)])
async def score(body: ScoreIn, _: Annotated[User, Depends(current_user)]) -> AtsReport:
    return await asyncio.to_thread(score_resume, body.data, body.design, body.job_text)  # CPU work: off the loop


# ---- Word export --------------------------------------------------------------------------------------------

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class DocxIn(BaseModel):
    data: ResumeData
    design: ResumeDesign = Field(default_factory=ResumeDesign)


@router.post("/docx", dependencies=[Depends(score_limit)],
             responses={200: {"content": {DOCX_TYPE: {}}, "description": "The resume as a Word file."}})
async def export_docx(body: DocxIn, _: Annotated[User, Depends(current_user)]) -> Response:
    """The resume the editor shows right now (saved or not) as a .docx; nothing is stored."""
    content = await asyncio.to_thread(resume_docx, body.data, body.design)
    return Response(content, media_type=DOCX_TYPE, headers={"Cache-Control": "no-store"})


# ---- AI: import and suggestions ----------------------------------------------------------------------------


async def account_allowance(user: Annotated[User, Depends(require_verified_email)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Allowance:
    return await allowance_for(db, user)


async def _spend[T](allowance: Allowance, work: Awaitable[T]) -> T:
    """Runs an AI request, giving the credit back if it fails: an outage or a garbled answer mustn't spend it."""
    try:
        return await work
    except Exception:
        await allowance.release()
        raise


async def _generate(db: AsyncSession, user: User | None, req: LLMRequest, what: str,
                    allowance: Allowance) -> LLMResponse:
    await allowance.claim()  # 402 once the free use is spent
    llm = get_llm_provider()
    try:
        resp = await llm.generate(req)
    except LLMError as e:
        log.warning("resume %s failed: %s", what, e)
        await allowance.release()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The AI isn't available right now. Try again in a moment.") from e
    db.add(ProviderRequest(user_id=user.id if user else None, provider=llm.name, model=resp.model,
                           request_type=req.request_type,
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


async def _import_text(db: AsyncSession, user: User | None, text: str, kind: str, allowance: Allowance) -> ImportOut:
    text = text.strip()
    if len(text) < MIN_IMPORT_CHARS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "There isn't enough text to read a resume from. Paste the whole resume or profile.")
    llm = get_llm_provider()
    resp = await _generate(db, user, ai.import_request(text, kind, llm), "import", allowance)
    try:
        data = ai.parse_structured(resp.text)
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("resume import unusable: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "The AI couldn't read that resume. Try again, or paste the text instead.") from e
    # What the model saw (it got MAX_SOURCE_CHARS), checked off the event loop: a long source and hundreds of lines
    # are seconds of regex work.
    data, removed = await asyncio.to_thread(ground_import, data, text[:ai.MAX_SOURCE_CHARS])
    if removed:
        log.info("resume import: removed %s", "; ".join(removed))
    name = data.basics.name.strip()
    return ImportOut(data=data, title=f"{name}'s resume" if name else "Imported resume")


@router.post("/import", response_model=ImportOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def import_resume(body: ImportIn, user: Annotated[User, Depends(require_verified_email)],
                        db: Annotated[AsyncSession, Depends(get_db)],
                        allowance: Annotated[Allowance, Depends(account_allowance)]) -> ImportOut:
    if body.source == "document":
        doc = await db.get(Document, body.document_id) if body.document_id else None
        if doc is None or doc.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
        return await _spend(allowance, _import_text(db, user, doc.source_text or "", "resume", allowance))
    return await _spend(allowance, _import_text(db, user, body.text or "", body.source, allowance))


async def _import_upload(db: AsyncSession, user: User | None, file: UploadFile, allowance: Allowance) -> ImportOut:
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
    return await _spend(allowance, _import_text(db, user, text, kind, allowance))


@router.post("/import-file", response_model=ImportOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def import_resume_file(file: Annotated[UploadFile, File()],
                             user: Annotated[User, Depends(require_verified_email)],
                             db: Annotated[AsyncSession, Depends(get_db)],
                             allowance: Annotated[Allowance, Depends(account_allowance)]) -> ImportOut:
    return await _import_upload(db, user, file, allowance)


# ---- cover letter ------------------------------------------------------------------------------------------


class CoverLetterIn(BaseModel):
    data: ResumeData
    job_text: str = Field("", max_length=MAX_JOB_TEXT)


class CoverLetterOut(BaseModel):
    text: str


async def _cover_letter(db: AsyncSession, user: User | None, body: CoverLetterIn,
                        allowance: Allowance) -> CoverLetterOut:
    """A cover letter from what the resume says and what the job post asks for; nothing is invented."""
    d = body.data
    if not (d.basics.name.strip() and (d.experience or d.projects or d.basics.summary.strip())):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Add your name and some experience first: the letter is written from your resume.")
    resp = await _generate(db, user, ai.cover_letter_request(d, body.job_text), "cover letter", allowance)
    try:
        return CoverLetterOut(text=ai.parse_cover_letter(resp.text, d, body.job_text))
    except ValueError as e:
        log.warning("cover letter unusable: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI couldn't write the letter. Try again.") from e


@router.post("/cover-letter", response_model=CoverLetterOut,
             dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def cover_letter(body: CoverLetterIn, user: Annotated[User, Depends(require_verified_email)],
                       db: Annotated[AsyncSession, Depends(get_db)],
                       allowance: Annotated[Allowance, Depends(account_allowance)]) -> CoverLetterOut:
    return await _spend(allowance, _cover_letter(db, user, body, allowance))


class LetterDocxIn(BaseModel):
    text: str = Field(min_length=1, max_length=ai.MAX_LETTER_CHARS)
    data: ResumeData = Field(default_factory=ResumeData)
    design: ResumeDesign = Field(default_factory=ResumeDesign)


class SuggestIn(BaseModel):
    data: ResumeData
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=MAX_JOB_TEXT)
    mode: Literal["improve", "tailor"] = "improve"
    focus: str | None = Field(None, max_length=120)
    check: str | None = Field(None, max_length=40)  # the ATS check to fix, by id


class SuggestOut(BaseModel):
    suggestions: list[fixes.Suggestion]
    # The free AI use is spent: these are only the fixes worked out without the AI; upgrading adds the AI's.
    upgrade_required: bool = False


SKILL_CHECKS = frozenset({"has_skills", "skills_count"})


async def _suggest(db: AsyncSession, user: User | None, body: SuggestIn, allowance: Allowance) -> SuggestOut:
    """Fixes for the resume, whichever the problem is. Skills and dates are worked out on the server with no AI call
    (instant, nothing invented, and free on every plan); wording, missing bullets and numbers come from the model,
    checked against the resume. `check` names one ATS problem to fix; without it you get the best fixes across the
    whole resume. Once the free AI use is spent, the AI-free fixes still come back, marked `upgrade_required`."""
    if body.mode == "tailor" and not body.job_text.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add the job post first.")
    d = body.data
    fields = ai.editable_fields(d)
    if body.focus and body.focus not in fields:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That part of the resume can't be rewritten.")
    report = await asyncio.to_thread(score_resume, d, body.design, body.job_text)
    if body.check and body.check not in {c.id for c in report.checks}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown check.")
    check = body.check
    mechanical: list[fixes.Suggestion] = []
    if not body.focus and check in (None, "keywords", "dates", *SKILL_CHECKS):
        if check != "dates":
            mechanical += fixes.skill_suggestions(d, report, body.job_text)
        if check in (None, "dates"):
            mechanical += fixes.date_suggestions(d)
    if not body.focus and check in (None, "tech_names"):
        mechanical += fixes.casing_suggestions(d)
    need_model = check not in ("dates", "tech_names", *SKILL_CHECKS) or bool(body.focus)
    ai_ok = await allowance.can_spend()
    used_ai = False  # something the AI wrote is in `mechanical`, so the free use was worth spending
    if check in SKILL_CHECKS and not body.focus and fixes.skills_needed(d) > sum(
            len(s.after.split(", ")) for s in mechanical if s.kind == "add_skill" and s.confirm is None):
        if not ai_ok:
            if not mechanical:
                raise allowance.exhausted()
            return SuggestOut(suggestions=mechanical, upgrade_required=True)
        # Not enough the resume proves or the job asks for: ask the model what the role usually needs.
        resp = await _generate(db, user, ai.skills_request(d, get_llm_provider(), fixes.skills_needed(d)), "skills",
                               allowance)
        try:
            idea = ai.parse_skill_ideas(resp, d, [x for s in mechanical for x in s.after.split(", ")])
        except (ValueError, json.JSONDecodeError) as e:
            log.warning("resume skill ideas unusable: %s", e)
            idea = None
        if idea:
            mechanical.append(idea)
            used_ai = True
    if not need_model:
        if not mechanical:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to add here: this part looks fine.")
        if not used_ai:
            await allowance.release()
        return SuggestOut(suggestions=mechanical)
    rewrite = any(t.strip() for _, t in fields.values()) or bool(ai.addable_roles(d)) or body.focus == "basics.summary"
    if not rewrite:
        if mechanical:
            return SuggestOut(suggestions=mechanical)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Add some experience first, then ask the AI.")
    if not ai_ok:
        if mechanical:  # the fixes that need no AI are still good
            return SuggestOut(suggestions=mechanical, upgrade_required=True)
        raise allowance.exhausted()
    llm = get_llm_provider()
    req = ai.suggest_request(d, report, llm, mode=body.mode, job_text=body.job_text, focus=body.focus, check=check)
    try:
        resp = await _generate(db, user, req, "suggest", allowance)
        suggestions = ai.parse_suggestions(resp, d, focus=body.focus)
    except HTTPException as e:
        if mechanical:  # the AI is down (or the free use just went), but the mechanical fixes are still good
            if not used_ai:
                await allowance.release()
            spent = e.status_code == status.HTTP_402_PAYMENT_REQUIRED
            return SuggestOut(suggestions=mechanical, upgrade_required=spent)
        raise
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("resume suggestions unusable: %s", e)
        if mechanical:
            if not used_ai:
                await allowance.release()
            return SuggestOut(suggestions=mechanical)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI's answer came back garbled. Try again.") from e
    return SuggestOut(suggestions=[*mechanical, *suggestions])


@router.post("/suggest", response_model=SuggestOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def suggest(body: SuggestIn, user: Annotated[User, Depends(require_verified_email)],
                  db: Annotated[AsyncSession, Depends(get_db)],
                  allowance: Annotated[Allowance, Depends(account_allowance)]) -> SuggestOut:
    return await _spend(allowance, _suggest(db, user, body, allowance))


@router.post("/cover-letter/docx", dependencies=[Depends(score_limit)],
             responses={200: {"content": {DOCX_TYPE: {}}, "description": "The cover letter as a Word file."}})
async def cover_letter_docx(body: LetterDocxIn, _: Annotated[User, Depends(current_user)]) -> Response:
    content = await asyncio.to_thread(letter_docx, body.text, body.data, body.design)
    return Response(content, media_type=DOCX_TYPE, headers={"Cache-Control": "no-store"})
