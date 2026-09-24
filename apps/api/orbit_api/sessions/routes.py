import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs
from orbit_api.auth.security import TICKET_TTL_S, current_user, issue_ticket, redeem_ticket
from orbit_api.config import get_settings
from orbit_api.db import get_db, sessionmaker
from orbit_api.entitlements import live_minutes_remaining, plan_for, usage_this_month
from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import (
    CLIENT_EVENT_TYPES,
    AnswerLength,
    AnswerStyle,
    LiveSettings,
    SessionType,
)
from orbit_api.models import (
    Answer,
    Document,
    DocumentChunk,
    LiveSessionRow,
    Question,
    SessionDocument,
    SessionSummary,
    SessionTurn,
    UsageEvent,
    User,
)
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMImage
from orbit_api.providers.stt import create_stt_provider
from orbit_api.ratelimit import limit
from orbit_api.retrieval.index import IndexedChunk, SessionIndex
from orbit_api.sessions.recorder import DbRecorder, upsert_usage
from orbit_api.sessions.report import generate_report

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["sessions"])

session_limit = limit("session", rate_per_s=0.2, burst=10)
review_limit = limit("review", rate_per_s=0.05, burst=3)  # each review is one sizeable LLM call

MAX_WS_TEXT_BYTES = 64 * 1024
MAX_WS_AUDIO_BYTES = 64 * 1024
# Each live socket runs two STT streams on the shared key. One socket per session (a newer connection,
# e.g. rejoining from another device, takes over) and a small per-user cap on distinct live sessions.
MAX_LIVE_SESSIONS_PER_USER = 2
CLOSE_REPLACED = 4010
CLOSE_TOO_MANY = 4029
# In-process like the ticket store: fine for one API instance.
_live_sockets: dict[str, dict[str, WebSocket]] = {}
# The engine behind each live socket, so HTTP uploads (screenshots) can feed the running session.
_live_engines: dict[str, LiveEngine] = {}
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
_teardowns: set[asyncio.Task[None]] = set()  # strong refs so an in-flight teardown isn't garbage-collected
LOW_MINUTES_WARNING_S = 5 * 60
ReportStatus = Literal["pending", "ready", "failed"] | None


class SessionIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    type: SessionType = "interview"
    role: str | None = Field(None, max_length=300)
    language: str = Field("en", max_length=16)
    answer_language: str | None = Field(None, max_length=16)
    length: AnswerLength = "standard"
    style: AnswerStyle = "natural"
    auto_answer: bool = True
    document_ids: list[str] = Field(default_factory=list, max_length=20)


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
        report_status=report_status,
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


@router.post("/sessions", response_model=SessionOut, status_code=201, dependencies=[Depends(session_limit)])
async def create_session(body: SessionIn, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    remaining = await live_minutes_remaining(db, user.id)
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "You've used this month's live minutes.")
    if body.document_ids:
        owned = (await db.scalars(select(Document.id).where(Document.id.in_(body.document_ids),
                                                            Document.user_id == user.id))).all()
        if len(set(owned)) != len(set(body.document_ids)):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    row = LiveSessionRow(user_id=user.id, **body.model_dump(exclude={"document_ids"}))
    db.add(row)
    await db.flush()
    for doc_id in dict.fromkeys(body.document_ids):
        db.add(SessionDocument(session_id=row.id, document_id=doc_id))
    await db.commit()
    return await _session_out(db, row)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> list[SessionOut]:
    rows = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user.id)
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
    return SessionDetail(
        session=session_out,
        turns=[{"id": t.id, "speaker": t.speaker, "text": t.text, "start_ms": t.start_ms, "end_ms": t.end_ms}
               for t in turns],
        questions=[{"id": q.id, "text": q.text, "type": q.type, "is_follow_up": q.is_follow_up,
                    "source": q.source, "created_at": q.created_at.isoformat()} for q in questions],
        answers=[{"id": a.id, "question_id": a.question_id, "content": a.content, "model": a.model,
                  "first_token_ms": a.first_token_ms, "total_ms": a.total_ms} for a in answers],
        summary=summary.content if summary else None,
    )


@router.post("/sessions/{session_id}/end", response_model=SessionOut)
async def end_session(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> SessionOut:
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        row.status = "ended"
        row.ended_at = datetime.now(UTC)
        # Durable report job, deduped per session: a live connection ending at the same moment re-arms the
        # same job instead of adding a second LLM call.
        await jobs.enqueue(db, "report", {"session_id": row.id}, jobs.report_key(row.id))
        await db.commit()
    return await _session_out(db, row)


@router.post("/sessions/{session_id}/review", dependencies=[Depends(review_limit)])
async def review_session(session_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """(Re)generate the post-session report + review scorecard for an ended session."""
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "End the session first — reviews cover finished sessions.")
    try:
        report = await asyncio.wait_for(generate_report(row.id), timeout=90)
    except TimeoutError as e:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "The review took too long — try again.") from e
    if not report.get("review"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't generate a review for this session.")
    return report


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    row = await _owned(db, session_id, user)
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


@router.post("/sessions/{session_id}/live-ticket")
async def live_ticket(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await _owned(db, session_id, user)
    if row.status == "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "Session has ended")
    # Enforce the monthly live-minute quota here (not just at session create) so reconnects can't stream
    # unlimited after the cap is hit.
    remaining = await live_minutes_remaining(db, user.id)
    if remaining is not None and remaining <= 0:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "You've used this month's live minutes.")
    return {"ticket": issue_ticket(user.id, session_id), "expires_in": TICKET_TTL_S}


def _image_type(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


@router.post("/sessions/{session_id}/screenshots", status_code=202, dependencies=[Depends(session_limit)])
async def upload_screenshot(session_id: str, image: Annotated[UploadFile, File()],
                            user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    """Answer what a screenshot shows; the answer streams over the session's live socket. The image is only
    sent to the model — never stored."""
    await _owned(db, session_id, user)
    engine = _live_engines.get(session_id)
    if engine is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start or rejoin the live session to analyse screenshots.")
    if not get_llm_provider().supports_vision():
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "The configured AI model can't read images.")
    plan = await plan_for(db, user.id)
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
    plan = await plan_for(db, user.id)
    return {
        "plan": plan.name,
        "live_minutes_used": round(await usage_this_month(db, user.id, "live_seconds") / 60, 1),
        "live_minutes_limit": plan.live_minutes,
        "screenshots_used": int(await usage_this_month(db, user.id, "screenshots")),
        "screenshots_limit": plan.screenshots,
    }


# ---- live WebSocket ---------------------------------------------------------------------------------------


async def _load_index(db: AsyncSession, session_id: str) -> tuple[SessionIndex, list[str]]:
    rows = (await db.execute(
        select(DocumentChunk, Document.kind)
        .join(Document, Document.id == DocumentChunk.document_id)
        .join(SessionDocument, SessionDocument.document_id == Document.id)
        .where(SessionDocument.session_id == session_id)
        .order_by(Document.created_at, DocumentChunk.ordinal)  # keep resume order: most recent role first
    )).all()
    chunks = [IndexedChunk(c.id, kind, c.category, c.label, c.text, c.verified, c.embedding or [])
              for c, kind in rows]
    # skills from resume/JD become STT key terms (custom vocabulary)
    keyterms = [c.text for c in chunks if c.category == "skill" and len(c.text) < 40][:30]
    return SessionIndex(chunks), keyterms


async def drain_teardowns(timeout_s: float = 15) -> None:
    """On shutdown: let in-flight live-session teardowns finish writing before the DB goes away."""
    if _teardowns:
        await asyncio.wait(set(_teardowns), timeout=timeout_s)


async def _commit_live_seconds(user_id: str, session_id: str, usage_key: str, seconds: int) -> float | None:
    """Commit this connection's running live time (idempotent upsert) and return the user's remaining
    live seconds this month across ALL their sessions (None = unlimited)."""
    async with sessionmaker()() as db:
        await upsert_usage(db, UsageEvent(user_id=user_id, session_id=session_id, metric="live_seconds",
                                          quantity=seconds, idempotency_key=usage_key,
                                          created_at=datetime.now(UTC)))
        await db.commit()
        remaining = await live_minutes_remaining(db, user_id)
    return None if remaining is None else remaining * 60


async def _meter_live_minutes(ws: WebSocket, engine: LiveEngine, user_id: str, session_id: str,
                              usage_key: str, limit_ending: asyncio.Event) -> None:
    """Server-side live-minute enforcement. Usage is committed every heartbeat (so a crash loses at most one
    interval), the client is warned when little time is left, and at the limit the session ends gracefully.
    With several concurrent sessions each sees the others' committed time, so any overshoot is bounded by
    one heartbeat per session."""
    heartbeat = get_settings().live_heartbeat_s
    warned = False
    while True:
        try:
            remaining_s = await _commit_live_seconds(user_id, session_id, usage_key, engine.now_ms() // 1000)
        except Exception:
            # Fail open for this beat (never cut a live interview off on a DB blip), but loudly; the final
            # usage is still written durably by the recorder at teardown.
            log.exception("live-minute heartbeat failed for session %s", session_id)
            await asyncio.sleep(heartbeat)
            continue
        if remaining_s is None:
            await asyncio.sleep(heartbeat)
            continue
        if remaining_s <= 0:
            log.info("session %s: live-minute limit reached; ending", session_id)
            limit_ending.set()
            await engine.send("usage.status", {"minutes_remaining": 0, "limit_reached": True})
            await engine.end(final=True)
            with contextlib.suppress(Exception):
                await ws.close(code=4003, reason="live minutes exhausted")
            return
        if remaining_s <= LOW_MINUTES_WARNING_S and not warned:
            warned = True
            await engine.send("usage.status", {"minutes_remaining": round(remaining_s / 60, 1),
                                               "limit_reached": False})
        # Wake exactly at the limit when it falls before the next beat.
        await asyncio.sleep(max(1.0, min(heartbeat, remaining_s)))


@router.websocket("/sessions/{session_id}/live")
async def live(ws: WebSocket, session_id: str, ticket: str = "") -> None:
    user_id = redeem_ticket(ticket, session_id)
    if user_id is None:
        await ws.close(code=4001, reason="invalid or expired ticket")
        return
    async with sessionmaker()() as db:
        row = await db.get(LiveSessionRow, session_id)
        user = await db.get(User, user_id)
        if row is None or user is None or row.user_id != user_id:
            await ws.close(code=4004, reason="session not found")
            return
        if row.status == "ended":
            await ws.close(code=4009, reason="session has ended")
            return
        remaining = await live_minutes_remaining(db, user_id)
        if remaining is not None and remaining <= 0:
            await ws.close(code=4003, reason="live minutes exhausted")
            return
        index, keyterms = await _load_index(db, session_id)
        row.status = "live"
        row.started_at = row.started_at or datetime.now(UTC)
        await db.commit()
        profile = SessionProfile(
            session_id=row.id, session_type=row.type,  # type: ignore[arg-type]
            role=row.role, language=row.language, answer_language=row.answer_language or row.language,
            keyterms=keyterms, dev_mode=get_settings().env != "production",
        )
        settings = LiveSettings(auto_answer=row.auto_answer, length=row.length,
                                style=row.style)
        store_transcripts = user.store_transcripts

    mine = _live_sockets.setdefault(user_id, {})
    if session_id not in mine and len(mine) >= MAX_LIVE_SESSIONS_PER_USER:
        await ws.close(code=CLOSE_TOO_MANY, reason="too many live sessions; end one first")
        return
    previous = mine.get(session_id)
    mine[session_id] = ws
    if previous is not None:
        with contextlib.suppress(Exception):
            await previous.close(code=CLOSE_REPLACED, reason="session opened in another window")
    try:
        await ws.accept()
    except Exception:
        if mine.get(session_id) is ws:
            del mine[session_id]
        raise
    send_lock = asyncio.Lock()

    async def send(msg: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send_text(json.dumps(msg, separators=(",", ":")))

    # One live_seconds row per connection, keyed so heartbeats and the final write all set the same row.
    usage_key = f"live:{uuid.uuid4()}"
    recorder = DbRecorder(session_id, user_id, store_transcripts=store_transcripts, usage_key=usage_key)
    engine = LiveEngine(profile, settings, send=send, llm=get_llm_provider(), stt=create_stt_provider(),
                        index=index, recorder=recorder)
    _live_engines[session_id] = engine
    explicit_end = False
    limit_ending = asyncio.Event()
    meter = asyncio.create_task(_meter_live_minutes(ws, engine, user_id, session_id, usage_key, limit_ending))
    try:
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
            except json.JSONDecodeError:
                await engine.send("error", {"code": "bad_json", "message": "invalid JSON"})
                continue
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
        if _live_engines.get(session_id) is engine:
            del _live_engines[session_id]

        async def teardown() -> None:
            if not limit_ending.is_set():
                meter.cancel()  # else let it finish ending the session (report enqueue included)
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await meter
            await engine.end(final=explicit_end)
            await recorder.close()
            with contextlib.suppress(Exception):
                await ws.close()

        # Its own task, shielded: if the server cancels this handler (shutdown, or a test client that cancels on
        # disconnect), usage, transcript and report writes still complete instead of dying mid-write.
        task = asyncio.create_task(teardown())
        _teardowns.add(task)
        task.add_done_callback(_teardowns.discard)
        await asyncio.shield(task)
