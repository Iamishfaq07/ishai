import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import defer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits, jobs
from orbit_api.answers.routes import MAX_ANSWERS, answer_text
from orbit_api.answers.routes import index_chunk as answer_chunk
from orbit_api.auth.guards import require_verified_user
from orbit_api.auth.security import TICKET_TTL_S, current_user, issue_ticket, redeem_ticket
from orbit_api.config import get_settings
from orbit_api.csrf import websocket_origin_allowed
from orbit_api.db import get_db, sessionmaker
from orbit_api.entitlements import (
    Plan,
    minutes_metric,
    minutes_remaining,
    plan_for,
    usage_pool,
    usage_this_month,
)
from orbit_api.live import carryover
from orbit_api.live.context_builder import SessionMemory
from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import (
    CLIENT_EVENT_TYPES,
    AnswerLength,
    AnswerStyle,
    LiveSettings,
    SessionType,
)
from orbit_api.live.keyterms import extract_keyterms
from orbit_api.live.mock_interviewer import MockConfig, drill_plan, retry_plan
from orbit_api.models import (
    Answer,
    AuditLog,
    Document,
    DocumentChunk,
    LiveSessionRow,
    Question,
    SavedAnswer,
    SessionDocument,
    SessionSummary,
    SessionTurn,
    Story,
    UsageEvent,
    User,
    Workspace,
)
from orbit_api.observability import request_id_var, session_id_var, user_id_var
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMImage
from orbit_api.providers.stt import create_stt_provider
from orbit_api.ratelimit import limit, limit_user
from orbit_api.retrieval.embeddings import get_embedder
from orbit_api.retrieval.index import IndexedChunk, SessionIndex, chunk_body
from orbit_api.sessions import companion, practice_queue
from orbit_api.sessions.feedback import learned_preferences, session_feedback
from orbit_api.sessions.recorder import DbRecorder, InterviewTime, upsert_usage
from orbit_api.sessions.report import generate_report
from orbit_api.stories.routes import MAX_STORIES, index_chunk, story_text
from orbit_api.workspaces.routes import owned_workspace, workspace_document_ids

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["sessions"])

session_limit = limit("session", rate_per_s=0.2, burst=10)
review_limit = limit("review", rate_per_s=0.05, burst=3)  # each review is one sizeable LLM call
# Per account, on top of the per-IP limits: paid-provider work can't be multiplied by rotating IPs.
session_user_limit = limit_user("session-user", rate_per_s=30 / 3600, burst=10)
ticket_user_limit = limit_user("ticket-user", rate_per_s=120 / 3600, burst=20)  # reconnects need headroom
screenshot_user_limit = limit_user("screenshot-user", rate_per_s=0.1, burst=10)
review_user_limit = limit_user("review-user", rate_per_s=10 / 3600, burst=3)

MAX_WS_TEXT_BYTES = 64 * 1024
MAX_WS_AUDIO_BYTES = 64 * 1024
# Each live socket runs two STT streams and an LLM on the shared keys. One socket per session (a newer connection,
# e.g. rejoining from another device, takes over) and one live session per account: a second interview would
# double the paid audio/LLM spend, and nobody sits two interviews at once. The ticket endpoint answers
# `409 live_session_active` (naming the running session) before anything is spent; the socket check is a backstop.
MAX_LIVE_SESSIONS_PER_USER = 1
LIVE_SESSION_ACTIVE = "live_session_active"
CLOSE_REPLACED = 4010
CLOSE_TOO_MANY = 4029
# In-process like the ticket store: fine for one API instance.
_live_sockets: dict[str, dict[str, WebSocket]] = {}
# The engine behind each live socket, so HTTP uploads (screenshots) can feed the running session.
_live_engines: dict[str, LiveEngine] = {}
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
_teardowns: set[asyncio.Task[None]] = set()  # strong refs so an in-flight teardown isn't garbage-collected
LOW_MINUTES_WARNING_S = 5 * 60
METER_STOP_S = 5.0  # a closing connection waits this long for the minute meter's beat in progress
_OUT_OF_MINUTES = {False: "You've used this month's live minutes.", True: "You've used this month's mock minutes."}
# Credit plans: live and mock share one balance, and it doesn't refill; a pack adds more.
OUT_OF_CREDITS = "You're out of interview minutes. Buy a pack to keep going."


def _out_of_minutes(plan: Plan, mock: bool) -> str:
    return OUT_OF_CREDITS if plan.credits else _OUT_OF_MINUTES[mock]
SESSION_TIME_LIMIT = "session_time_limit"
SESSION_ENDED = "session_ended"  # a live ticket for a session that has ended: it can't be reopened
ReportStatus = Literal["pending", "ready", "failed"] | None


class SessionIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    type: SessionType = "interview"
    role: str | None = Field(None, max_length=300)
    language: str = Field("en", max_length=16)
    answer_language: str | None = Field(None, max_length=16)
    length: AnswerLength = "auto"  # sized per question; clients from before "auto" always send one of the others
    style: AnswerStyle = "natural"
    auto_answer: bool = True
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    # Started from a saved setup: recorded on the session, and its documents are used when none are given.
    workspace_id: str | None = Field(None, max_length=36)
    # Mock interviews only (type "mock"): what the AI interviewer asks and for how long.
    mock: MockConfig | None = None
    # The candidate's standing instructions for answers; from a saved setup's notes when not given.
    instructions: str | None = Field(None, max_length=1000)

    # Orbit is English only: older clients and saved setups may still send another language, so it's pinned here.
    @field_validator("language")
    @classmethod
    def _english(cls, _: str) -> str:
        return "en"

    @field_validator("answer_language")
    @classmethod
    def _no_answer_language(cls, _: str | None) -> None:
        return None


class SessionOut(BaseModel):
    id: str
    title: str
    type: str
    role: str | None
    language: str
    answer_language: str | None
    length: str
    style: str
    auto_answer: bool
    status: str
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int
    question_count: int = 0
    document_ids: list[str] = Field(default_factory=list)
    # Ended sessions: "pending" while the report job runs, "ready" once written, "failed" if it gave up.
    report_status: Literal["pending", "ready", "failed"] | None = None
    workspace_id: str | None = None
    instructions: str | None = None


class SessionDetail(BaseModel):
    session: SessionOut
    turns: list[dict[str, Any]]
    questions: list[dict[str, Any]]
    answers: list[dict[str, Any]]
    summary: dict[str, Any] | None


async def _owned(db: AsyncSession, session_id: str, user: User) -> LiveSessionRow:
    row = await db.get(LiveSessionRow, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return row


def _to_out(row: LiveSessionRow, question_count: int, doc_ids: list[str],
            report_status: ReportStatus = None) -> SessionOut:
    return SessionOut(
        id=row.id, title=row.title, type=row.type, role=row.role, language=row.language,
        answer_language=row.answer_language, length=row.length, style=row.style, auto_answer=row.auto_answer,
        status=row.status, created_at=row.created_at, started_at=row.started_at, ended_at=row.ended_at,
        duration_seconds=row.duration_s, question_count=question_count, document_ids=doc_ids,
        report_status=report_status, workspace_id=row.workspace_id, instructions=row.instructions,
    )


async def _report_statuses(db: AsyncSession, rows: Sequence[LiveSessionRow]) -> dict[str, ReportStatus]:
    ended = [r.id for r in rows if r.status == "ended"]
    if not ended:
        return {}
    have = set((await db.scalars(select(SessionSummary.session_id)
                                 .where(SessionSummary.session_id.in_(ended)))).all())
    js = await jobs.job_status(db, [jobs.report_key(sid) for sid in ended])
    out: dict[str, ReportStatus] = {}
    for sid in ended:
        job = js.get(jobs.report_key(sid))
        out[sid] = ("pending" if job in ("queued", "running") else "ready" if sid in have
                    else "failed" if job == "failed" else None)
    return out


async def _session_out(db: AsyncSession, row: LiveSessionRow) -> SessionOut:
    qcount = await db.scalar(select(func.count()).select_from(Question).where(Question.session_id == row.id))
    doc_ids = (await db.scalars(select(SessionDocument.document_id)
                                .where(SessionDocument.session_id == row.id))).all()
    return _to_out(row, int(qcount or 0), list(doc_ids), (await _report_statuses(db, [row])).get(row.id))


@router.post("/sessions", response_model=SessionOut, status_code=201,
             dependencies=[Depends(session_limit), Depends(session_user_limit)])
async def create_session(body: SessionIn, user: Annotated[User, Depends(require_verified_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    plan = await plan_for(db, user.id)
    if body.type == "mock" and not plan.has("mock"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "feature_unavailable", "message": "Mock interviews aren't included in your plan."})
    remaining = await minutes_remaining(db, user.id, body.type)
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, _out_of_minutes(plan, body.type == "mock"))
    document_ids = list(body.document_ids)
    if body.workspace_id:
        ws = await owned_workspace(db, body.workspace_id, user)
        ws.last_used_at = datetime.now(UTC)
        if not document_ids:
            document_ids = await workspace_document_ids(db, ws.id)
        if body.instructions is None and ws.notes:
            body.instructions = ws.notes[:1000]
    if document_ids:
        owned = (await db.scalars(select(Document.id).where(Document.id.in_(document_ids),
                                                            Document.user_id == user.id))).all()
        if len(set(owned)) != len(set(document_ids)):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    row = LiveSessionRow(user_id=user.id, **body.model_dump(exclude={"document_ids", "mock"}),
                         mock_config=(body.mock or MockConfig()).model_dump() if body.type == "mock" else None)
    db.add(row)
    await db.flush()
    for doc_id in dict.fromkeys(document_ids):
        db.add(SessionDocument(session_id=row.id, document_id=doc_id))
    await db.commit()
    return await _session_out(db, row)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> list[SessionOut]:
    rows = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user.id)
                             .options(defer(LiveSessionRow.rolling_summary), defer(LiveSessionRow.metrics),
                                      defer(LiveSessionRow.mock_config), defer(LiveSessionRow.carryover))
                             .order_by(LiveSessionRow.created_at.desc()).limit(200))).all()
    ids = [r.id for r in rows]
    if not ids:
        return []
    # Two grouped queries for the whole page instead of two per row.
    counts: dict[str, int] = {
        sid: int(n) for sid, n in (await db.execute(
            select(Question.session_id, func.count()).where(Question.session_id.in_(ids))
            .group_by(Question.session_id))).all()
    }
    docs: dict[str, list[str]] = {}
    for sid, did in (await db.execute(select(SessionDocument.session_id, SessionDocument.document_id)
                                      .where(SessionDocument.session_id.in_(ids)))).all():
        docs.setdefault(sid, []).append(did)
    reports = await _report_statuses(db, rows)
    return [_to_out(r, counts.get(r.id, 0), docs.get(r.id, []), reports.get(r.id)) for r in rows]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> SessionDetail:
    row = await _owned(db, session_id, user)
    # Status before summary: the report job may finish in between, and "ready" must imply a summary.
    session_out = await _session_out(db, row)
    turns = (await db.scalars(select(SessionTurn).where(SessionTurn.session_id == row.id)
                              .order_by(SessionTurn.created_at, SessionTurn.start_ms))).all()
    questions = (await db.scalars(select(Question).where(Question.session_id == row.id)
                                  .order_by(Question.created_at))).all()
    answers = (await db.scalars(select(Answer).where(Answer.session_id == row.id, Answer.status == "completed")
                                .order_by(Answer.created_at))).all()
    summary = await db.scalar(select(SessionSummary).where(SessionSummary.session_id == row.id))
    ratings = await session_feedback(db, row.id)
    return SessionDetail(
        session=session_out,
        turns=[{"id": t.id, "speaker": t.speaker, "text": t.text, "start_ms": t.start_ms, "end_ms": t.end_ms}
               for t in turns],
        questions=[{"id": q.id, "text": q.text, "type": q.type, "is_follow_up": q.is_follow_up,
                    "source": q.source, "created_at": q.created_at.isoformat()} for q in questions],
        answers=[{"id": a.id, "question_id": a.question_id, "content": a.content, "model": a.model,
                  "first_token_ms": a.first_token_ms, "total_ms": a.total_ms, "feedback": ratings.get(a.id)}
                 for a in answers],
        summary=summary.content if summary else None,
    )


async def stop_user_live(user_id: str) -> None:
    """Every live session this account is streaming, and any phone following one: after "sign out everywhere" or a
    password reset, a stolen session mustn't keep listening (and spending the owner's minutes)."""
    for session_id in list(_live_sockets.get(user_id, {})):
        await stop_live(user_id, session_id)
    companion.stop_user_sharing(user_id)  # every code, including for sessions not live yet


async def stop_live(user_id: str, session_id: str) -> None:
    """Ended or deleted from elsewhere (another window, the web app, "end it and use this one", deleting it or the
    account) while a socket is still streaming: stop that engine for real — it tells its client `session.ended`
    and records usage — and close the socket, so it stops spending STT/LLM and frees the account's one live slot.
    A dropped connection's saved state goes too: nothing should reconnect to it."""
    engine = _live_engines.get(session_id)
    socket = _live_sockets.get(user_id, {}).get(session_id)
    if engine is not None:
        await engine.end(final=True)
    carryover.discard(session_id)
    if socket is not None:
        with contextlib.suppress(Exception):
            await socket.close(code=4009, reason="session has ended")


@router.post("/sessions/{session_id}/end", response_model=SessionOut)
async def end_session(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    row = await _owned(db, session_id, user)
    await stop_live(user.id, session_id)
    if row.status != "ended":
        row.status = "ended"
        row.ended_at = datetime.now(UTC)
        row.carryover = None  # a dropped connection's saved state: nothing will continue it
        # Durable report job, deduped per session: a live connection ending at the same moment re-arms the
        # same job instead of adding a second LLM call.
        await jobs.enqueue(db, "report", {"session_id": row.id}, jobs.report_key(row.id))
        await db.commit()
    companion.stop_sharing(row.id)
    return await _session_out(db, row)


@router.post("/sessions/{session_id}/report/retry", response_model=SessionOut,
             dependencies=[Depends(review_limit), Depends(review_user_limit)])
async def retry_report(session_id: str, user: Annotated[User, Depends(require_verified_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    """Re-queue a failed (or missing) session report. A report already pending or ready is left alone."""
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "The report is written when the session ends.")
    current = (await _report_statuses(db, [row])).get(row.id)
    if current not in ("pending", "ready"):
        await jobs.enqueue(db, "report", {"session_id": row.id}, jobs.report_key(row.id))
        await db.commit()
    companion.stop_sharing(row.id)
    return await _session_out(db, row)


@router.delete("/sessions/{session_id}/transcript", status_code=204)
async def delete_transcript(session_id: str, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """Delete what was said (transcript turns and detected questions) but keep the session, its answers and
    report. Refused while the session is live, so a running recorder doesn't immediately re-create rows."""
    row = await _owned(db, session_id, user)
    if session_id in _live_engines:
        raise HTTPException(status.HTTP_409_CONFLICT, "End the live session first.")
    await db.execute(delete(SessionTurn).where(SessionTurn.session_id == row.id))
    await db.execute(delete(Question).where(Question.session_id == row.id))
    # A dropped connection's saved state holds recent turns and questions too.
    row.carryover = None
    carryover.discard(row.id)
    db.add(AuditLog(user_id=user.id, action="session.delete_transcript", target=row.id))
    await db.commit()
    return Response(status_code=204)


@router.post("/sessions/{session_id}/review", dependencies=[Depends(review_limit), Depends(review_user_limit)])
async def review_session(session_id: str, user: Annotated[User, Depends(require_verified_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """(Re)generate the post-session report + review scorecard for an ended session. A failed attempt leaves the
    stored report (and its review) as it was."""
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "End the session first — reviews cover finished sessions.")
    heard = await db.scalar(select(func.count()).select_from(SessionTurn).where(SessionTurn.session_id == row.id))
    asked = await db.scalar(select(func.count()).select_from(Question).where(Question.session_id == row.id))
    if not heard and not asked:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing was captured in this session (no speech, no "
                                                      "questions), so there's nothing to review.")
    try:
        report = await asyncio.wait_for(generate_report(row.id), timeout=90)
    except TimeoutError as e:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "The review took too long — try again.") from e
    if not report.get("review"):
        stored = await db.scalar(select(SessionSummary.content).where(SessionSummary.session_id == row.id))
        kept = " Your earlier review is unchanged." if isinstance(stored, dict) and stored.get("review") else ""
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Couldn't generate a review for this session.{kept}")
    return report


class DrillIn(BaseModel):
    # One question of the review (1-based), asked again on its own ("Try this one again"); none: the weak ones.
    question: int | None = Field(None, ge=1, le=100)


@router.post("/sessions/{session_id}/drill", response_model=SessionOut, status_code=201,
             dependencies=[Depends(session_limit), Depends(session_user_limit)])
async def drill_session(session_id: str, user: Annotated[User, Depends(require_verified_user)],
                        db: Annotated[AsyncSession, Depends(get_db)], body: DrillIn | None = None) -> SessionOut:
    """Re-drill (spec §33): a new mock session that asks this session's weak questions again (from its review),
    or one question of it (`question`), with the same documents, role and interviewer settings."""
    row = await _owned(db, session_id, user)
    summary = await db.scalar(select(SessionSummary).where(SessionSummary.session_id == row.id))
    review = (summary.content or {}).get("review") if summary else None
    items = review.get("items") if isinstance(review, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "no_review", "message": "Generate the review first; the drill is built from it."})
    if body is not None and body.question is not None:
        if body.question > len(items) or not isinstance(items[body.question - 1], dict):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That question isn't in this session's review.")
        plan = retry_plan(items[body.question - 1])
        if not plan:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That question isn't in this session's review.")
    else:
        plan = drill_plan(items)
    if not plan:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "nothing_to_drill", "message": "Nothing to drill: every question scored 4 or higher."})
    base = MockConfig.model_validate(row.mock_config) if row.mock_config else MockConfig()
    mock = base.model_copy(update={"drill": plan, "source_session_id": row.id,
                                   "duration_minutes": min(60, max(5, 4 * len(plan)))})
    doc_ids = list((await db.scalars(select(SessionDocument.document_id)
                                     .where(SessionDocument.session_id == row.id))).all())
    title = row.title.removeprefix("Drill: ")
    new = SessionIn(title=f"Drill: {title}"[:300], type="mock", role=row.role, language=row.language,
                    answer_language=row.answer_language, document_ids=doc_ids, mock=mock)
    return await create_session(new, user, db)


# ---- the practice queue (spaced repetition over every review: sessions/practice_queue.py) ---------------------

MAX_QUEUE_SESSIONS = 300  # the newest reviewed sessions a queue is built from


class QueueItemOut(BaseModel):
    question: str
    last_score: int | None
    attempts: int
    last_practised_at: datetime
    due_at: datetime
    session_id: str


class PracticeQueueOut(BaseModel):
    due: list[QueueItemOut]
    # Coming back later: how many, and when the next one is due.
    upcoming: int
    next_due_at: datetime | None
    learnt: int


async def _cards(db: AsyncSession, user: User) -> list[practice_queue.Card]:
    rows = (await db.execute(
        select(LiveSessionRow.id, LiveSessionRow.ended_at, LiveSessionRow.created_at, LiveSessionRow.mock_config,
               SessionSummary.content)
        .join(SessionSummary, SessionSummary.session_id == LiveSessionRow.id)
        .where(LiveSessionRow.user_id == user.id)
        .order_by(LiveSessionRow.created_at.desc()).limit(MAX_QUEUE_SESSIONS))).all()
    reviews = []
    for sid, ended_at, created_at, mock_config, content in rows:
        if isinstance(mock_config, dict) and mock_config.get("negotiation"):
            continue  # a recruiter's lines aren't questions to rehearse
        review = (content or {}).get("review")
        items = review.get("items") if isinstance(review, dict) else None
        if isinstance(items, list) and items:
            reviews.append((sid, ended_at or created_at, items))
    return practice_queue.build_cards(reviews)


def _queue_item(card: practice_queue.Card) -> QueueItemOut:
    due = card.due_at()
    assert due is not None
    return QueueItemOut(question=card.question, last_score=card.last.score, attempts=len(card.attempts),
                        last_practised_at=card.last.at, due_at=due, session_id=card.last.session_id)


@router.get("/practice/queue", response_model=PracticeQueueOut)
async def practice_queue_get(user: Annotated[User, Depends(current_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> PracticeQueueOut:
    """Questions answered weakly in any review, due again on a spaced schedule until answered well."""
    due, later, learnt = practice_queue.queue(await _cards(db, user), datetime.now(UTC))
    return PracticeQueueOut(due=[_queue_item(c) for c in due], upcoming=len(later),
                            next_due_at=later[0].due_at() if later else None, learnt=learnt)


@router.post("/practice/queue/drill", response_model=SessionOut, status_code=201,
             dependencies=[Depends(session_limit), Depends(session_user_limit)])
async def practice_queue_drill(user: Annotated[User, Depends(require_verified_user)],
                               db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    """A mock round on what's due now (the most overdue and weakest first, up to five)."""
    due, _, _ = practice_queue.queue(await _cards(db, user), datetime.now(UTC))
    plan = practice_queue.drill(due)
    if not plan:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "nothing_due", "message": "Nothing is due for practice right now."})
    mock = MockConfig(drill=plan, duration_minutes=min(60, max(5, 4 * len(plan))))
    body = SessionIn(title="Practice queue", type="mock", mock=mock)
    return await create_session(body, user, db)


def _strip_nul(v: Any) -> Any:
    """Postgres can't store U+0000 in text: dropped from live client events before anything records them."""
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, list):
        return [_strip_nul(x) for x in v]
    if isinstance(v, dict):
        return {_strip_nul(k): _strip_nul(x) for k, x in v.items()}
    return v


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    row = await _owned(db, session_id, user)
    # Live right now: stop it first, as End does. Deleting under a running engine left STT and the LLM running
    # (and metered) with every write failing against the deleted row, and the account's live slot taken.
    await stop_live(user.id, session_id)
    companion.stop_sharing(session_id)  # its phone code goes with it, as on End
    await db.delete(row)
    await db.commit()


@router.get("/sessions/{session_id}/export.md", response_class=PlainTextResponse)
async def export_markdown(session_id: str, user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> str:
    detail = await get_session(session_id, user, db)
    s = detail.session
    lines = [f"# {s.title}", "", f"- Type: {s.type}", f"- Role: {s.role or '—'}",
             f"- Date: {s.created_at:%Y-%m-%d %H:%M} UTC", f"- Duration: {s.duration_seconds // 60} min", ""]
    if detail.summary:
        lines += ["## Summary", "", str(detail.summary.get("summary") or ""), ""]
    lines += ["## Questions", ""] + [f"- {q['text']}" for q in detail.questions] + ["", "## Transcript", ""]
    for t in detail.turns:
        mm, ss = divmod(t["start_ms"] // 1000, 60)
        lines.append(f"**{mm:02d}:{ss:02d} {t['speaker'].title()}** — {t['text']}")
    return "\n".join(lines) + "\n"


@router.post("/sessions/{session_id}/live-ticket", dependencies=[Depends(ticket_user_limit)])
async def live_ticket(session_id: str, user: Annotated[User, Depends(require_verified_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await _owned(db, session_id, user)
    if row.status == "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": SESSION_ENDED, "message": "Session has ended"})
    other = next((sid for sid in _live_sockets.get(user.id, {}) if sid != session_id), None)
    if other is not None and len(_live_sockets.get(user.id, {})) >= MAX_LIVE_SESSIONS_PER_USER:
        running = await db.get(LiveSessionRow, other)
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": LIVE_SESSION_ACTIVE, "session_id": other, "title": running.title if running else None,
            "message": f"You already have a live session running ({running.title if running else 'another window'})."
                       " End it first — or end it here and use this one.",
        })
    # Enforce the monthly quota here (not just at session create) so reconnects can't stream unlimited after
    # the cap is hit — and the per-session ceiling, so a session that already ran its maximum can't reopen.
    remaining = await minutes_remaining(db, user.id, row.type)
    plan = await plan_for(db, user.id)
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, _out_of_minutes(plan, row.type == "mock"))
    if (row.duration_s or 0) >= plan.max_session_minutes * 60:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": SESSION_TIME_LIMIT,
            "message": f"This session reached the {plan.max_session_minutes}-minute limit. Start a new one."})
    return {"ticket": issue_ticket(user.id, session_id), "expires_in": TICKET_TTL_S}


def _image_type(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


@router.post("/sessions/{session_id}/screenshots", status_code=202,
             dependencies=[Depends(session_limit), Depends(screenshot_user_limit)])
async def upload_screenshot(session_id: str, image: Annotated[UploadFile, File()],
                            user: Annotated[User, Depends(require_verified_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    """Answer what a screenshot shows; the answer streams over the session's live socket. The image is only
    sent to the model — never stored."""
    await _owned(db, session_id, user)
    engine = _live_engines.get(session_id)
    if engine is None or engine.ended:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start or rejoin the live session to analyse screenshots.")
    if not get_llm_provider().supports_vision():
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "The configured AI model can't read images.")
    plan = await plan_for(db, user.id)
    if not plan.has("vision"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
            "code": "feature_unavailable", "message": "Screenshot answers aren't included in your plan."})
    if plan.screenshots is not None and await usage_this_month(db, user.id, "screenshots") >= plan.screenshots:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "You've used this month's screenshots.")
    data = await image.read(MAX_SCREENSHOT_BYTES + 1)
    if len(data) > MAX_SCREENSHOT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Screenshot is too large (max 8 MB).")
    media_type = _image_type(data[:8])
    if media_type is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Screenshot must be a PNG or JPEG image.")
    # Internal metric only: the user's screenshot credit ("screenshots") is spent by the engine when the
    # answer is actually delivered.
    db.add(UsageEvent(user_id=user.id, session_id=session_id, metric="screenshot_attempts", quantity=1))
    await db.commit()
    return {"screenshot_id": await engine.answer_screenshot(LLMImage(data, media_type))}


@router.get("/usage")
async def usage(user: Annotated[User, Depends(current_user)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """Legacy summary (older clients). New clients read GET /v1/entitlements."""
    plan = await plan_for(db, user.id)
    live_limit: int | None
    if plan.credits:
        granted_s, used_s = await credits.interview_seconds(db, user.id)
        live_used, live_limit = round(used_s / 60, 1), round(granted_s / 60)
    else:
        live_used = round(await usage_this_month(db, user.id, "live_seconds", usage_pool(plan)) / 60, 1)
        live_limit = plan.live_minutes
    return {
        "plan": plan.name,
        "live_minutes_used": live_used,
        "live_minutes_limit": live_limit,
        "screenshots_used": int(await usage_this_month(db, user.id, "screenshots")),
        "screenshots_limit": plan.screenshots,
    }


# ---- live WebSocket ---------------------------------------------------------------------------------------


async def _session_company(db: AsyncSession, row: LiveSessionRow) -> str | None:
    """Who the interview is with, when the session knows: the saved setup it started from, or the mock setup."""
    if row.workspace_id:
        ws = await db.get(Workspace, row.workspace_id)
        if ws is not None and ws.user_id == row.user_id and (ws.company or "").strip():
            return (ws.company or "").strip()[:120]
    mock = row.mock_config or {}
    negotiation = mock.get("negotiation")
    company = negotiation.get("company") if isinstance(negotiation, dict) else mock.get("company")
    return company.strip()[:120] if isinstance(company, str) and company.strip() else None


async def _load_index(db: AsyncSession, session_id: str,
                      user_id: str) -> tuple[SessionIndex, list[IndexedChunk]]:
    rows = (await db.execute(
        select(DocumentChunk, Document.kind, Document.title)
        .join(Document, Document.id == DocumentChunk.document_id)
        .join(SessionDocument, SessionDocument.document_id == Document.id)
        .where(SessionDocument.session_id == session_id)
        .order_by(Document.created_at, DocumentChunk.ordinal)  # keep resume order: most recent role first
    )).all()
    embedder = get_embedder()
    stale = [c for c, _, _ in rows if c.embedding_model != embedder.model_id] if embedder.ready else []
    if stale:
        # Vectors from another embedder (or the legacy full-text hash) are recomputed once and saved back.
        vectors = await asyncio.to_thread(
            lambda: [embedder.embed(chunk_body(c.category, c.text)) for c in stale])
        for c, v in zip(stale, vectors, strict=True):
            c.embedding, c.embedding_model = v, embedder.model_id
        await db.commit()
    current = embedder.ready
    chunks = [IndexedChunk(c.id, kind, c.category, c.label, c.text, c.verified,
                           (c.embedding or []) if current and c.embedding_model == embedder.model_id else [],
                           doc_title=title or "")
              for c, kind, title in rows]
    # The story bank goes with the user into every session, as verified facts for behavioral answers.
    stories = (await db.scalars(select(Story).where(Story.user_id == user_id)
                                .order_by(Story.updated_at.desc()).limit(MAX_STORIES))).all()
    unembedded = [st for st in stories if st.embedding_model != embedder.model_id] if current else []
    if unembedded:
        vectors = await asyncio.to_thread(lambda: [embedder.embed(story_text(st)) for st in unembedded])
        for st, v in zip(unembedded, vectors, strict=True):
            st.embedding, st.embedding_model = v, embedder.model_id
        await db.commit()
    chunks += [index_chunk(st, (st.embedding or []) if current and st.embedding_model == embedder.model_id else [])
               for st in stories]
    # So does the answer bank: the user's own prepared answers, which the copilot starts from when a question
    # comes up again (live/context_builder.retrieve).
    saved = (await db.scalars(select(SavedAnswer).where(SavedAnswer.user_id == user_id)
                              .order_by(SavedAnswer.updated_at.desc()).limit(MAX_ANSWERS))).all()
    unembedded_answers = [a for a in saved if a.embedding_model != embedder.model_id] if current else []
    if unembedded_answers:
        vectors = await asyncio.to_thread(lambda: [embedder.embed(answer_text(a)) for a in unembedded_answers])
        for a, v in zip(unembedded_answers, vectors, strict=True):
            a.embedding, a.embedding_model = v, embedder.model_id
        await db.commit()
    chunks += [answer_chunk(a, (a.embedding or []) if current and a.embedding_model == embedder.model_id else [])
               for a in saved]
    return SessionIndex(chunks), chunks


async def _not_live(session_id: str, status_: str, started_at: datetime | None) -> None:
    """A connection refused or failed before it got going: the session goes back to how it was (unless something
    else, an End, has changed it since), instead of showing "live" with nothing running."""
    if status_ == "live":
        return  # a reconnect: it was live (dropped) before this connection, and still is
    try:
        async with sessionmaker()() as db:
            await db.execute(update(LiveSessionRow)
                             .where(LiveSessionRow.id == session_id, LiveSessionRow.status == "live")
                             .values(status=status_, started_at=started_at))
            await db.commit()
    except Exception:
        log.exception("couldn't reset session %s after a failed start", session_id)


async def drain_teardowns(timeout_s: float = 15) -> None:
    """On shutdown: let in-flight live-session teardowns finish writing before the DB goes away."""
    if _teardowns:
        await asyncio.wait(set(_teardowns), timeout=timeout_s)


async def _commit_live_seconds(user_id: str, session_id: str, minutes: InterviewTime, seconds: int,
                               session_type: str = "interview") -> float | None:
    """Commit this connection's running time (idempotent upsert) and return the user's remaining seconds for this
    kind of session, across ALL their sessions (None = unlimited). The time goes to the balance of the plan the
    account was on: when that changed since the last beat (a grant started or ran out), the time so far stays on the
    old balance and from here on it's metered on the new one (InterviewTime.switch)."""
    async with sessionmaker()() as db:
        plan = await plan_for(db, user_id)
        pool = usage_pool(plan)
        minutes.pool = minutes.pool or pool
        await upsert_usage(db, minutes.event(user_id, session_id, seconds))
        try:
            await db.commit()
        except IntegrityError:
            # The session ended while this beat ran (the client's session.end): the recorder's final write inserted
            # the row first, with the whole connection's time.
            await db.rollback()
        if pool != minutes.pool:
            minutes.switch(pool, seconds)
        remaining = await minutes_remaining(db, user_id, session_type, plan)
    return None if remaining is None else remaining * 60


async def _meter_live_minutes(ws: WebSocket, engine: LiveEngine, user_id: str, session_id: str,
                              minutes: InterviewTime, limit_ending: asyncio.Event, *, session_type: str = "interview",
                              prior_session_s: int = 0, max_session_s: int | None = None,
                              stop: asyncio.Event | None = None,
                              keep: Callable[[], Awaitable[None]] | None = None) -> None:
    """Server-side enforcement of two limits: the monthly allowance (live or mock minutes) and the per-session
    ceiling (plan.max_session_minutes, including earlier connections of this session). Usage is committed every
    heartbeat (a crash loses at most one interval), the client is warned 5 minutes before either limit with
    `usage.status {reason}`, and at a limit the session ends gracefully: transcript and usage are written and the
    report is queued, exactly like a normal end. One live session per account bounds any overshoot to one
    heartbeat. `keep` runs on each beat too: it saves the conversation so far on the session row.

    `stop`: the connection has closed. The meter finishes the beat in progress and returns, rather than being
    cancelled: a beat cut off mid-query could leave its connection holding a lock (SQLite) or half a transaction, and
    the recorder's final usage write must come after the last beat's (both set the same row)."""
    heartbeat = get_settings().live_heartbeat_s
    stop = stop or asyncio.Event()
    warned: set[str] = set()
    while not engine.ended and not stop.is_set():
        now_s = engine.now_ms() // 1000
        row = minutes.row
        try:
            month_s = await _commit_live_seconds(user_id, session_id, minutes, now_s, session_type)
        except Exception:
            # Fail open for this beat (never cut a live interview off on a DB blip), but loudly; the final
            # usage is still written durably by the recorder at teardown.
            log.exception("live-minute heartbeat failed for session %s", session_id)
            await _beat(engine, heartbeat, stop)
            continue
        if minutes.row != row:
            warned.discard("monthly")  # the plan changed: the new balance's low-minutes warning is news
        if keep is not None:
            await keep()
        session_s = None if max_session_s is None else max_session_s - (prior_session_s + now_s)
        limits = [(r, s) for r, s in (("monthly", month_s), ("session", session_s)) if s is not None]
        if not limits:
            await _beat(engine, heartbeat, stop)
            continue
        reason, remaining_s = min(limits, key=lambda x: x[1])
        if remaining_s <= 0:
            log.info("session %s: %s limit reached; ending", session_id, reason)
            limit_ending.set()
            await engine.send("usage.status", {"minutes_remaining": 0, "limit_reached": True, "reason": reason})
            await engine.end(final=True)
            with contextlib.suppress(Exception):
                await ws.close(code=4003, reason="session time limit reached" if reason == "session"
                               else "live minutes exhausted")
            return
        if remaining_s <= LOW_MINUTES_WARNING_S and reason not in warned:
            warned.add(reason)
            await engine.send("usage.status", {"minutes_remaining": round(remaining_s / 60, 1),
                                               "limit_reached": False, "reason": reason})
        # Wake exactly at the limit when it falls before the next beat.
        await _beat(engine, max(1.0, min(heartbeat, remaining_s)), stop)
    if stop.is_set():
        return  # the connection closed: its teardown ends the engine
    # The engine ended without this connection closing: a mock round that ran its course (End and the limits close
    # the socket themselves). Metering stops here (the recorder wrote the final usage at the end), and the socket
    # closes once the client has `session.ended`, so it stops streaming audio and the account's live slot frees up.
    await engine.wait_ended()
    with contextlib.suppress(Exception):
        await ws.close(code=4009, reason="session has ended")


async def _beat(engine: LiveEngine, seconds: float, stop: asyncio.Event) -> None:
    """Sleep until the next heartbeat, or until the engine ends or the meter is stopped (whichever is first)."""
    waits = {asyncio.ensure_future(engine.wait_ended()), asyncio.ensure_future(stop.wait())}
    try:
        await asyncio.wait(waits, timeout=seconds, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for w in waits:
            w.cancel()


async def _save_carryover(session_id: str, state: dict[str, Any]) -> None:
    """A live session's state onto its row (live/carryover.py), unless the session has ended since: then there's
    nothing to continue, and ending cleared it."""
    async with sessionmaker()() as db:
        await db.execute(update(LiveSessionRow)
                         .where(LiveSessionRow.id == session_id, LiveSessionRow.status != "ended")
                         .values(carryover=state))
        await db.commit()


@router.websocket("/sessions/{session_id}/live")
async def live(ws: WebSocket, session_id: str, ticket: str = "") -> None:
    if not websocket_origin_allowed(ws.headers.get("origin")):  # before redeeming: a hostile page can't burn it
        await ws.close(code=1008, reason="origin not allowed")
        return
    user_id = redeem_ticket(ticket, session_id)
    # Correlation ids for every log line of this live session (tasks created below inherit them).
    session_id_var.set(session_id)
    user_id_var.set(user_id)
    request_id_var.set(f"ws-{uuid.uuid4().hex[:12]}")
    if user_id is None:
        await ws.close(code=4001, reason="invalid or expired ticket")
        return
    async with sessionmaker()() as db:
        row = await db.get(LiveSessionRow, session_id)
        user = await db.get(User, user_id)
        if row is None or user is None or row.user_id != user_id:
            await ws.close(code=4004, reason="session not found")
            return
        if user.suspended_at is not None:  # a ticket minted just before the admin suspended the account
            await ws.close(code=4001, reason="account suspended")
            return
        if row.status == "ended":
            await ws.close(code=4009, reason="session has ended")
            return
        remaining = await minutes_remaining(db, user_id, row.type)
        plan = await plan_for(db, user_id)
        # Time this session already had, from the usage every connection commits each heartbeat (not only the
        # duration a closed connection adds at teardown): reopening it in a second window can't reset the cap.
        metered_s = await db.scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
            UsageEvent.session_id == session_id, UsageEvent.metric.in_(("live_seconds", "mock_seconds"))))
        prior_session_s = max(row.duration_s or 0, int(metered_s or 0))
        if (remaining is not None and remaining <= 0) or prior_session_s >= plan.max_session_minutes * 60:
            await ws.close(code=4003, reason="live minutes exhausted" if remaining is not None and remaining <= 0
                           else "session time limit reached")
            return
        index, chunks = await _load_index(db, session_id, user_id)
        company = await _session_company(db, row)
        # The resume's skills, tech names from the documents, the company: words a general STT model mishears.
        keyterms = extract_keyterms(chunks, company=company, role=row.role)
        before = (row.status, row.started_at)  # put back if this connection never gets going
        row.status = "live"
        row.started_at = row.started_at or datetime.now(UTC)
        await db.commit()
        profile = SessionProfile(
            session_id=row.id, session_type=row.type,  # type: ignore[arg-type]
            role=row.role, language="en", answer_language="en",  # English only (older rows may say otherwise)
            keyterms=keyterms, dev_mode=get_settings().env != "production",
            mock=MockConfig.model_validate(row.mock_config) if row.mock_config else None,
            allow_fallback=plan.has("provider_fallback"),
            features=frozenset(f for f in ("system_design", "advanced_coding") if plan.has(f)),
            instructions=(row.instructions or "").strip() or None,
            learned=await learned_preferences(db, user_id),
            company=company,
        )
        settings = LiveSettings(auto_answer=row.auto_answer, length=row.length,
                                style=row.style)
        store_transcripts = user.store_transcripts
        saved_summary = row.rolling_summary or ""
        saved_state = row.carryover

    mine = _live_sockets.setdefault(user_id, {})
    if session_id not in mine and len(mine) >= MAX_LIVE_SESSIONS_PER_USER:
        await _not_live(session_id, *before)
        await ws.close(code=CLOSE_TOO_MANY, reason="too many live sessions; end one first")
        return
    send_lock = asyncio.Lock()

    async def send(msg: dict[str, Any]) -> None:
        companion.publish(session_id, msg)  # phones first: they keep following even if this socket just dropped
        async with send_lock:
            await ws.send_text(json.dumps(msg, separators=(",", ":")))

    # One live_seconds row per connection (one more each time the plan changes mid-session), keyed so heartbeats and
    # the final write all set the same row, and charged to the balance of the plan it's on.
    minutes = InterviewTime(f"live:{uuid.uuid4()}", minutes_metric(profile.session_type), pool=usage_pool(plan))
    recorder = DbRecorder(session_id, user_id, store_transcripts=store_transcripts, minutes=minutes)
    # A reconnect picks up the conversation where it was: from the engine still attached (a second window took
    # over) or the state the dropped one left (live/carryover.py). After a server restart (every deploy) that's gone
    # from memory: the copy saved on the session row, else (a row from before that copy existed) the saved summary.
    attached = _live_engines.get(session_id)
    dropped = carryover.take(session_id) if attached is None else None
    carryover.discard(session_id)
    resume = attached.carryover() if attached is not None else dropped
    if resume is None:
        resume = carryover.from_json(saved_state)
    if resume is None and saved_summary:
        resume = carryover.Carryover(memory=SessionMemory(rolling_summary=saved_summary))
    # Built before the socket takes the account's live slot: a provider that can't be created (no Deepgram key,
    # say) used to leave the socket registered, so every later session got 409 live_session_active, and the row
    # stuck at "live". Now the session is put back as it was, its saved state kept for the next try.
    try:
        engine = LiveEngine(profile, settings, send=send, llm=get_llm_provider(), stt=create_stt_provider(),
                            index=index, recorder=recorder, resume=resume)
    except Exception:
        log.exception("live session %s couldn't start", session_id)
        if dropped is not None:
            carryover.save(session_id, dropped)
        await recorder.close()
        await _not_live(session_id, *before)
        with contextlib.suppress(Exception):
            await ws.close(code=1011, reason="the live session couldn't start")
        return
    previous = mine.get(session_id)
    mine[session_id] = ws
    _live_engines[session_id] = engine
    explicit_end = False
    limit_ending = asyncio.Event()
    stop_metering = asyncio.Event()
    kept = saved_state

    async def keep(*, dropping: bool = False) -> None:
        """The conversation so far onto the session row (when it changed): every heartbeat, and when the connection
        drops. Only while this connection has the session; a newer one that took over keeps its own."""
        nonlocal kept
        if _live_engines.get(session_id) is not (None if dropping else engine):
            return  # another connection has the session now
        state = carryover.to_json(engine.carryover(), transcripts=store_transcripts)
        if state == kept:
            return
        try:
            await _save_carryover(session_id, state)
            kept = state
        except Exception:
            log.warning("couldn't save the live state of session %s", session_id, exc_info=True)

    meter = asyncio.create_task(_meter_live_minutes(
        ws, engine, user_id, session_id, minutes, limit_ending, session_type=profile.session_type,
        prior_session_s=prior_session_s, max_session_s=plan.max_session_minutes * 60, stop=stop_metering,
        keep=keep))
    try:
        if previous is not None:
            with contextlib.suppress(Exception):
                await previous.close(code=CLOSE_REPLACED, reason="session opened in another window")
        await ws.accept()
        await engine.start()
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if (data := msg.get("bytes")) is not None:
                if len(data) <= MAX_WS_AUDIO_BYTES:
                    await engine.handle_audio(data)
                continue
            text = msg.get("text")
            if text is None or len(text) > MAX_WS_TEXT_BYTES:
                continue
            try:
                event = json.loads(text)
            except (json.JSONDecodeError, RecursionError):
                await engine.send("error", {"code": "bad_json", "message": "invalid JSON"})
                continue
            if "\\u0000" in text:
                event = _strip_nul(event)
            if not isinstance(event, dict) or event.get("type") not in CLIENT_EVENT_TYPES:
                await engine.send("error", {"code": "unknown_event", "message": "unknown event type"})
                continue
            await engine.handle_client(event)
            if event["type"] == "session.end":
                explicit_end = True
                break
    except WebSocketDisconnect:
        pass
    finally:
        if mine.get(session_id) is ws:
            del mine[session_id]
            if not mine:
                _live_sockets.pop(user_id, None)
        left_open = False
        if _live_engines.get(session_id) is engine:
            del _live_engines[session_id]
            # Dropped without ending: the next connection continues this conversation. (A newer engine that
            # took over already has it.) Ended any other way (End elsewhere, a deletion, a finished mock round),
            # there's nothing to continue.
            if explicit_end or limit_ending.is_set() or engine.ended:
                carryover.discard(session_id)
            else:
                carryover.save(session_id, engine.carryover())
                left_open = True

        async def teardown() -> None:
            # At a limit the meter is ending the session itself: it's let finish (report enqueue included). Else it
            # finishes the beat in progress and returns; cancelled only if that hangs (a database that doesn't answer).
            if not limit_ending.is_set():
                stop_metering.set()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await (meter if limit_ending.is_set() else asyncio.wait_for(meter, METER_STOP_S))
            await engine.end(final=explicit_end)
            await recorder.close()
            if left_open:  # and on the row, with its last turns: the copy in memory doesn't survive a restart
                await keep(dropping=True)
            with contextlib.suppress(Exception):
                await ws.close()

        # Its own task, shielded: if the server cancels this handler (shutdown, or a test client that cancels on
        # disconnect), usage, transcript and report writes still complete instead of dying mid-write.
        task = asyncio.create_task(teardown())
        _teardowns.add(task)
        task.add_done_callback(_teardowns.discard)
        await asyncio.shield(task)
