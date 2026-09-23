import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    User,
)
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.stt import create_stt_provider
from orbit_api.retrieval.index import IndexedChunk, SessionIndex
from orbit_api.sessions.recorder import DbRecorder
from orbit_api.sessions.report import generate_report

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["sessions"])

MAX_WS_TEXT_BYTES = 64 * 1024
MAX_WS_AUDIO_BYTES = 64 * 1024


class SessionIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    type: SessionType = "interview"
    role: str | None = Field(None, max_length=300)
    language: str = Field("en", max_length=16)
    answer_language: str | None = Field(None, max_length=16)
    length: AnswerLength = "standard"
    style: AnswerStyle = "bullets"
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


async def _session_out(db: AsyncSession, row: LiveSessionRow) -> SessionOut:
    qcount = await db.scalar(select(func.count()).select_from(Question).where(Question.session_id == row.id))
    doc_ids = (await db.scalars(select(SessionDocument.document_id)
                                .where(SessionDocument.session_id == row.id))).all()
    return SessionOut(
        id=row.id, title=row.title, type=row.type, role=row.role, language=row.language,
        answer_language=row.answer_language, length=row.length, style=row.style, auto_answer=row.auto_answer,
        status=row.status, created_at=row.created_at, started_at=row.started_at, ended_at=row.ended_at,
        duration_seconds=row.duration_s, question_count=int(qcount or 0), document_ids=list(doc_ids),
    )


@router.post("/sessions", response_model=SessionOut, status_code=201)
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
    return [await _session_out(db, r) for r in rows]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> SessionDetail:
    row = await _owned(db, session_id, user)
    turns = (await db.scalars(select(SessionTurn).where(SessionTurn.session_id == row.id)
                              .order_by(SessionTurn.start_ms))).all()
    questions = (await db.scalars(select(Question).where(Question.session_id == row.id)
                                  .order_by(Question.created_at))).all()
    answers = (await db.scalars(select(Answer).where(Answer.session_id == row.id, Answer.status == "completed")
                                .order_by(Answer.created_at))).all()
    summary = await db.scalar(select(SessionSummary).where(SessionSummary.session_id == row.id))
    return SessionDetail(
        session=await _session_out(db, row),
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
                      db: Annotated[AsyncSession, Depends(get_db)], background: BackgroundTasks) -> SessionOut:
    row = await _owned(db, session_id, user)
    if row.status != "ended":
        row.status = "ended"
        row.ended_at = datetime.now(UTC)
        await db.commit()
        background.add_task(generate_report, row.id)
    return await _session_out(db, row)


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
    return {"ticket": issue_ticket(user.id, session_id), "expires_in": TICKET_TTL_S}


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

    await ws.accept()
    send_lock = asyncio.Lock()

    async def send(msg: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send_text(json.dumps(msg, separators=(",", ":")))

    recorder = DbRecorder(session_id, user_id, store_transcripts=store_transcripts)
    engine = LiveEngine(profile, settings, send=send, llm=get_llm_provider(), stt=create_stt_provider(),
                        index=index, recorder=recorder)
    explicit_end = False
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
        await engine.end(final=explicit_end)
        await recorder.close()
        with contextlib.suppress(Exception):
            await ws.close()
