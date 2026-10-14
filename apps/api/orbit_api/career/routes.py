import asyncio
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_user
from orbit_api.auth.security import current_user
from orbit_api.career.schema import DIMENSIONS, CareerContext, DefenseCard, RetryEvaluation
from orbit_api.career.service import generate_json
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.documents.routes import _check_quota, _ingest
from orbit_api.documents.uploads import MAX_UPLOAD_BYTES, sanitize_text, validate_image
from orbit_api.entitlements import minutes_remaining, plan_for, usage_this_month
from orbit_api.job_portal.routes import _full_text, _job_text, _listing, _resume_for, _track
from orbit_api.live.events import SpokenWalkthrough
from orbit_api.live.mock_interviewer import DrillItem, MockConfig
from orbit_api.models import (
    Answer,
    CareerPreparation,
    DebriefAttempt,
    Document,
    JobSearchProfile,
    Question,
    Resume,
    SessionSummary,
    SessionTurn,
    UsageEvent,
    User,
)
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMImage, LLMMessage
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes import interview_prep
from orbit_api.resumes.allowance import allowance_for
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.routes import MAX_RESUMES, SuggestIn, _generate, _spend, _suggest
from orbit_api.resumes.schema import ResumeData, ResumeDesign
from orbit_api.sessions.report import pair_questions_with_answers
from orbit_api.sessions.routes import SessionIn, SessionOut, _owned, create_session
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1", tags=["career studio"])
ai_ip = limit("career-ai", rate_per_s=20 / 3600, burst=6)
ai_user = limit_user("career-ai-user", rate_per_s=20 / 3600, burst=5)
read_user = limit_user("career-read", rate_per_s=1, burst=30)


class FullPrepIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


class FullPrepOut(BaseModel):
    resume_id: str
    document_id: str
    practice_link: str
    coding_link: str
    context: CareerContext
    cached: bool = False


def _prep_out(run: CareerPreparation, cached: bool = False) -> FullPrepOut:
    context = CareerContext.model_validate(run.context or {})
    params = {"role": context.role, "company": context.company, "interview_stage": context.interview_stage,
              "jd": run.document_id or "", "resume_document_id": run.resume_document_id or ""}
    import json

    params["tech_stack"] = json.dumps(context.tech_stack)
    params["key_requirements"] = json.dumps(context.key_requirements)
    query = urlencode(params)
    return FullPrepOut(resume_id=run.resume_id or "", document_id=run.document_id or "",
                       practice_link=f"/mock?preset=tech15&{query}", coding_link=f"/start?type=coding&{query}",
                       context=context, cached=cached)


async def _document(db: AsyncSession, user: User, kind: str, title: str, text: str) -> Document:
    text = sanitize_text(text)
    found = await db.scalar(select(Document).where(Document.user_id == user.id, Document.kind == kind,
                                                   Document.source_text == text, Document.status == "ready").limit(1))
    if found is not None:
        return found
    await _check_quota(db, user)
    doc = Document(user_id=user.id, kind=kind, title=title[:300], size_bytes=len(text.encode()))
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, text)
    return doc


@router.post("/jobs/listings/{listing_id}/full-prep", response_model=FullPrepOut,
             dependencies=[Depends(ai_ip), Depends(ai_user)])
async def full_prep(listing_id: str, body: FullPrepIn, user: Annotated[User, Depends(require_verified_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> FullPrepOut:
    listing = await _listing(db, listing_id)
    profile = await db.get(JobSearchProfile, user.id)
    source = await _resume_for(db, user, profile, body.resume_id)
    if source is None:
        raise HTTPException(422, "Create a resume in Resume AI first, then launch full prep.")
    uid, source_id, source_revision = user.id, source.id, source.revision
    query = select(CareerPreparation).where(CareerPreparation.user_id == uid,
        CareerPreparation.listing_id == listing_id, CareerPreparation.source_resume_id == source_id,
        CareerPreparation.source_revision == source_revision)
    run = await db.scalar(query)
    if run is not None:
        if (run.status == "ready" and run.resume_id and run.document_id and run.resume_document_id
                and (run.context or {}).get("job_hash") == listing.text_hash):
            return _prep_out(run, cached=True)
        created = run.created_at.replace(tzinfo=UTC) if run.created_at.tzinfo is None else run.created_at
        if run.status == "running" and created > datetime.now(UTC) - timedelta(minutes=10):
            raise HTTPException(409, "Preparation is already running. Please retry in a moment.")
        await db.delete(run)
        await db.flush()
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == uid))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(409, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    allowance = await allowance_for(db, user)
    if not await allowance.can_spend():
        raise allowance.exhausted()
    run = CareerPreparation(user_id=uid, listing_id=listing_id, source_resume_id=source_id,
                             source_revision=source_revision)
    db.add(run)
    try:
        await db.commit()  # Reserve before calling the paid provider; a duplicate cannot charge a second credit.
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(409, "Preparation is already running. Please retry in a moment.") from e
    run_id = run.id
    try:
        text, _note = await _full_text(db, listing)
        job = _job_text(listing, text)
        required = re.compile(r"experience|require|responsib|design|build|develop|maintain|proficien", re.I)
        requirements = [line.strip(" -*•")[:250] for line in text.splitlines()
                        if len(line.strip()) >= 25 and required.search(line)]
        context = CareerContext(role=listing.title[:120], company=listing.company[:120],
                                 tech_stack=[str(s)[:80] for s in listing.keywords[:12]],
                                 key_requirements=requirements[:5] or
                                 ([listing.snippet[:250]] if listing.snippet else []))
        data = ResumeData.model_validate(source.data)
        design = ResumeDesign.model_validate(source.design)
        suggestions = await _spend(allowance, _suggest(db, user, SuggestIn(data=data, design=design,
                                                      job_text=job, mode="tailor"), allowance, strict_ai=True))
        jd = await _document(db, user, "job_description", f"{listing.title} — {listing.company}", job)
        cv = await _document(db, user, "resume", source.title, resume_text(data.visible()))
        copied = Resume(user_id=uid, title=f"{source.title} · {listing.company}"[:160], data=source.data,
                         design=source.design, job_text=job, cover_letter="", prep_context=context.model_dump(),
                         pending_suggestions=[s.model_dump(mode="json") for s in suggestions.suggestions])
        db.add(copied)
        await db.flush()
        entry = await _track(db, user, listing)
        entry.resume_id, entry.document_id = copied.id, jd.id
        run.resume_id, run.document_id, run.resume_document_id = copied.id, jd.id, cv.id
        run.context, run.status = {**context.model_dump(), "job_hash": listing.text_hash}, "ready"
        prepared = _prep_out(run)
        copied.prep_context = {**context.model_dump(), "practice_link": prepared.practice_link,
                               "coding_link": prepared.coding_link}
        await db.commit()
        return _prep_out(run)
    except Exception:
        await allowance.release()
        await db.rollback()
        await db.execute(delete(CareerPreparation).where(CareerPreparation.id == run_id))
        await db.commit()
        raise


class GrillIn(BaseModel):
    data: ResumeData | None = None  # The editor's current text, including edits not yet autosaved.
    context: CareerContext = Field(default_factory=CareerContext)


@router.post("/resumes/{resume_id}/grill", response_model=SessionOut,
             dependencies=[Depends(ai_ip), Depends(ai_user)])
async def grill_resume(resume_id: str, body: GrillIn, user: Annotated[User, Depends(require_verified_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    resume = await db.get(Resume, resume_id)
    if resume is None or resume.user_id != user.id:
        raise HTTPException(404, "Resume not found")
    plan = await plan_for(db, user.id)
    remaining = await minutes_remaining(db, user.id, "mock")
    if not plan.has("mock") or (remaining is not None and remaining <= 0):
        raise HTTPException(402, "Add interview minutes before starting a resume drill.")
    data = (body.data or ResumeData.model_validate(resume.data)).visible()
    if not data.experience and not data.projects:
        raise HTTPException(422, "Add a role or project first so the drill can probe your real claims.")
    llm = get_llm_provider()
    req = interview_prep.questions_request(data, resume.job_text or "", llm)
    req.messages[0] = LLMMessage("system", req.messages[0].content +
        "\nThis is a five-minute adversarial resume defense. Prioritize claimed metrics, measurement baselines, "
        "personal ownership, architectural decisions and failure cases. Ask concrete evidence-based questions.")
    allowance = await allowance_for(db, user)

    async def launch() -> SessionOut:
        response = await _generate(db, user, req, "resume drill", allowance)
        try:
            prep = interview_prep.parse_questions(response.text, data, resume.job_text or "")
            questions = prep.questions[:4]
        except ValueError as e:
            raise HTTPException(502, "The AI couldn't prepare grounded questions. Please retry.") from e
        if not questions:
            raise HTTPException(502, "The AI couldn't prepare grounded questions. Please retry.")
        doc = await _document(db, user, "resume", f"Resume defense — {resume.title}", resume_text(data))
        config = MockConfig(duration_minutes=5, difficulty="hard", persona="staff_engineer", interview_type="mixed",
            drill=[DrillItem(question=q.question[:400], kind="prep", follow_up=True, feedback=q.defend[:400] or None)
                   for q in questions])
        context = body.context.model_dump()
        context["role"] = context["role"] or prep.role or data.basics.headline
        return await create_session(SessionIn(title=f"Grill my resume — {resume.title}"[:300], type="mock",
            document_ids=[doc.id], mock=config, auto_answer=False, **context), user, db)

    return await _spend(allowance, launch())


@router.get("/sessions/{session_id}/debrief", dependencies=[Depends(read_user)])
async def debrief(session_id: str, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await _owned(db, session_id, user)
    questions = (await db.scalars(select(Question).where(Question.session_id == row.id)
                                  .order_by(Question.created_at, Question.id))).all()
    turns = (await db.scalars(select(SessionTurn).where(SessionTurn.session_id == row.id))).all()
    pairs = pair_questions_with_answers(questions, turns)
    summary = await db.scalar(select(SessionSummary).where(SessionSummary.session_id == row.id))
    review = ((summary.content or {}).get("review") or {}) if summary else {}
    reviews: list[dict[str, Any]] = review.get("items") or []
    attempts = (await db.scalars(select(DebriefAttempt).join(Question, Question.id == DebriefAttempt.question_id)
                                .where(Question.session_id == row.id, DebriefAttempt.user_id == user.id)
                                .order_by(DebriefAttempt.created_at))).all()
    by_turn = {t.id: t for t in turns}
    answers = (await db.scalars(select(Answer).where(Answer.session_id == row.id, Answer.status == "completed")
                               .order_by(Answer.created_at))).all()
    ideal = {a.question_id: a.content or {} for a in answers}
    items: list[dict[str, Any]] = []
    for i, (q, pair) in enumerate(zip(questions, pairs, strict=True)):
        item: dict[str, Any] | None = next((r for r in reviews if r.get("question_id") == q.id), None)
        if item is None:
            item = next((r for r in reviews if not r.get("question_id") and r.get("question") == q.text), {})
        turn = by_turn.get(q.turn_id or "")
        origin = row.started_at or row.created_at
        elapsed = max(0, int((q.created_at - origin).total_seconds() * 1000))
        items.append({"question_id": q.id, "index": i + 1, "time_ms": turn.start_ms if turn else elapsed,
                      "question": q.text, "transcript": pair.answer,
                      "ideal_answer": item.get("better") or ideal.get(q.id, {}).get("direct_answer") or "",
                      "ideal_code": (ideal.get(q.id, {}).get("code") or {}).get("content"),
                      "score": item.get("score"), "feedback": item.get("feedback") or "",
                      "missing_points": item.get("missing_points") or [], "delivery_score": item.get("delivery_score"),
                      "clarity_score": item.get("clarity_score"), "dimensions": item.get("dimensions") or {},
                      "attempts": [{"id": a.id, "answer": a.answer, "created_at": a.created_at.isoformat(),
                                    **a.result} for a in attempts if a.question_id == q.id]})
    radar: dict[str, float | None] = {}
    for dimension in DIMENSIONS:
        latest = [r["attempts"][-1]["dimensions"] if r["attempts"] else r["dimensions"] for r in items]
        values = [float(scores[dimension]) for scores in latest if scores.get(dimension) is not None]
        radar[dimension] = round(sum(values) / len(values), 2) if values else None
    return {"session_id": row.id, "status": row.status, "items": items, "radar": radar,
            "review_ready": bool(review), "score_basis": "Transcript and answer timing; vocal tone is not assessed."}


class RetryIn(BaseModel):
    answer: str = Field(min_length=10, max_length=20_000)


@router.post("/sessions/{session_id}/debrief/{question_id}/retry", dependencies=[Depends(ai_ip), Depends(ai_user)])
async def retry_debrief(session_id: str, question_id: str, body: RetryIn,
                        user: Annotated[User, Depends(require_verified_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        raise HTTPException(409, "End the session before retrying a debrief question.")
    question = await db.get(Question, question_id)
    if question is None or question.session_id != row.id:
        raise HTTPException(404, "Question not found")
    result = await generate_json(db, user, "debrief_retry",
        "Grade this retry fairly. Return JSON: score and clarity_score (integers 1-5), feedback, ideal_answer, "
        "missing_points (list), dimensions (problem_framing, technical_depth, scalability, edge_case_rigor, "
        "communication_clarity: each 1-5 or null when irrelevant). Score only the submitted answer. "
        "Do not manufacture a higher score because it is a retry.",
        f"Question: {question.text}\nSubmitted answer or code:\n{sanitize_text(body.answer)}", RetryEvaluation)
    attempt = DebriefAttempt(user_id=user.id, question_id=question.id,
                             answer=sanitize_text(body.answer) if user.store_transcripts else "",
                             result=result.model_dump())
    db.add(attempt)
    await db.commit()
    return {"id": attempt.id, "answer": body.answer, "created_at": attempt.created_at.isoformat(),
            **result.model_dump()}


class CompleteWalkthrough(SpokenWalkthrough):
    intuition: str = Field(min_length=1, max_length=500)
    commentary: list[Annotated[str, Field(min_length=1, max_length=350)]] = Field(min_length=3, max_length=3)
    complexity_defense: str = Field(min_length=1, max_length=600)


@router.post("/sessions/{session_id}/answers/{answer_id}/walkthrough", response_model=CompleteWalkthrough,
             dependencies=[Depends(ai_ip), Depends(ai_user)])
async def walkthrough(session_id: str, answer_id: str, user: Annotated[User, Depends(require_verified_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> CompleteWalkthrough:
    await _owned(db, session_id, user)
    answer = await db.get(Answer, answer_id)
    if answer is None or answer.session_id != session_id:
        raise HTTPException(404, "Answer not found")
    content = answer.content or {}
    code = (content.get("code") or {}).get("content")
    if answer.status != "completed" or not code:
        raise HTTPException(409, "Wait for a completed coding answer.")
    try:
        return CompleteWalkthrough.model_validate(content.get("walkthrough"))
    except ValueError:
        pass
    result = await generate_json(db, user, "spoken_walkthrough",
        "Write a roughly 30-second spoken explanation of this exact solution, about 75-90 words total. "
        "Return JSON: intuition (one sentence before typing), commentary (exactly three short sentences "
        "spoken while writing, each explaining WHY a specific step is needed), complexity_defense "
        "(a crisp defense of time and auxiliary space costs). Do not change the solution or invent constraints.",
        f"Question: {content.get('question', '')}\nSolution:\n{code[:30_000]}", CompleteWalkthrough)
    answer.content = {**content, "walkthrough": result.model_dump()}
    await db.commit()
    return result


class DefenseIn(BaseModel):
    notes: str = Field(min_length=20, max_length=30_000)


async def _defense(session_id: str, notes: str, images: list[LLMImage], user: User, db: AsyncSession) -> DefenseCard:
    await _owned(db, session_id, user)
    if images and not get_llm_provider().supports_vision():
        raise HTTPException(501, "This AI model cannot read images. Upload architecture notes instead.")
    plan = await plan_for(db, user.id)
    if not plan.has("vision"):
        raise HTTPException(403, "Architecture critique is unavailable on your plan.")
    await lock_account(db, user.id)
    if plan.screenshots is not None and await usage_this_month(db, user.id, "screenshots") >= plan.screenshots:
        raise HTTPException(402, "You've used this month's analysis allowance.")
    usage = UsageEvent(user_id=user.id, session_id=session_id, metric="screenshots", quantity=1)
    db.add(usage)
    await db.commit()
    usage_id = usage.id
    try:
        return await generate_json(db, user, "defense_critique",
            "Review the supplied architecture diagram or notes. Return JSON: spofs (list), bottlenecks (list), "
            "trade_offs (list), follow_ups (exactly three objects with question and answer). "
            "Give concrete failure scenarios, data flow and scaling limits, and crisp defensible answers. "
            "State uncertainty when the evidence omits a detail; never invent a vulnerability.",
            notes, DefenseCard, images)
    except Exception:
        await db.rollback()
        await db.execute(delete(UsageEvent).where(UsageEvent.id == usage_id))
        await db.commit()
        raise


@router.post("/sessions/{session_id}/defense", response_model=DefenseCard,
             dependencies=[Depends(ai_ip), Depends(ai_user)])
async def defense_notes(session_id: str, body: DefenseIn, user: Annotated[User, Depends(require_verified_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> DefenseCard:
    return await _defense(session_id, sanitize_text(body.notes), [], user, db)


@router.post("/sessions/{session_id}/defense-file", response_model=DefenseCard,
             dependencies=[Depends(ai_ip), Depends(ai_user)])
async def defense_file(session_id: str, file: Annotated[UploadFile, File()],
                       user: Annotated[User, Depends(require_verified_user)],
                       db: Annotated[AsyncSession, Depends(get_db)],
                       notes: Annotated[str, Form(max_length=5000)] = "") -> DefenseCard:
    await _owned(db, session_id, user)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Upload is too large (max 5 MB).")
    try:
        if data.startswith((b"\x89PNG", b"\xff\xd8\xff")):
            mime = await asyncio.to_thread(validate_image, data, file.content_type)
            return await _defense(session_id, sanitize_text(notes), [LLMImage(data, mime)], user, db)
        fmt = detect_format(file.filename or "notes.txt", file.content_type, data[:8])
        text = await asyncio.to_thread(extract_text_isolated, data, fmt)
    except (ParseError, ValueError) as e:
        raise HTTPException(422, str(e)) from e
    return await _defense(session_id, sanitize_text(f"{notes}\n{text[:30_000]}"), [], user, db)
