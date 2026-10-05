"""Persists live-session events off the hot path: the engine enqueues, a single worker writes in order.

Nothing is dropped on a transient DB failure. Each write is retried with backoff; a write that still fails
goes to the `failed_writes` dead-letter table, and if even that is unreachable, to a local spool file. Both
are replayed at startup (`replay_failed_writes`). Retries are safe: rows have fixed primary keys (a
duplicate insert means an earlier attempt landed) and metered usage is upserted on its idempotency key.
"""

import asyncio
import contextlib
import json
import logging
import os
import tempfile
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db import Base, sessionmaker
from orbit_api.jobs import enqueue_now, report_key
from orbit_api.live.events import Speaker
from orbit_api.live.metrics import merge as merge_metrics
from orbit_api.models import (
    Answer,
    FailedWrite,
    LiveSessionRow,
    ProviderRequest,
    Question,
    SessionTurn,
    UsageEvent,
)
from orbit_api.providers.llm.base import Usage
from orbit_api.providers.llm.pricing import estimate_cost

log = logging.getLogger(__name__)

WRITE_ATTEMPTS = 5
BACKOFF_S = 0.25  # doubles per attempt: 0.25, 0.5, 1, 2 s
FAILED_WRITE_KEEP_DAYS = 30  # a dead letter still failing this long is given up on (it holds transcript text)
_MODELS: dict[str, type[Base]] = {m.__name__: m for m in (Answer, ProviderRequest, Question, SessionTurn,
                                                           UsageEvent)}


def spool_path() -> Path:
    return Path(os.environ.get("ORBIT_SPOOL_DIR") or tempfile.gettempdir()) / "orbit-failed-writes.jsonl"


def _to_payload(obj: Base) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        value = getattr(obj, col.key, None)
        out[col.key] = value.isoformat() if isinstance(value, datetime) else value
    return out


def _from_payload(kind: str, payload: dict[str, Any]) -> Base:
    model = _MODELS[kind]
    values = dict(payload)
    for col in model.__table__.columns:
        if isinstance(col.type, DateTime) and isinstance(values.get(col.key), str):
            values[col.key] = datetime.fromisoformat(values[col.key])
    return model(**values)


async def upsert_usage(db: AsyncSession, event: UsageEvent) -> None:
    """Insert, or for a keyed event set the quantity to the latest absolute value (heartbeats report the
    connection's running total, so re-sending one can never double-count)."""
    if event.idempotency_key:
        existing = await db.scalar(select(UsageEvent).where(UsageEvent.idempotency_key == event.idempotency_key))
        if existing is not None:
            existing.quantity = max(existing.quantity, event.quantity)
            existing.pool = existing.pool or event.pool
            return
    db.add(event)


@dataclass
class InterviewTime:
    """One live connection's interview time (`live_seconds` or `mock_seconds`), as one usage row per balance it drew
    on. The heartbeat and the final write at teardown both set the current row to the time since it began (upserted
    on its key, so a repeat never double-counts). When the account's plan changes mid-session (a grant starts or runs
    out), the heartbeat leaves that row where it is and `switch`es: the time from then on goes to a new row, under the
    new plan's pool. So time on a Pro grant never comes out of the credits once the grant ends, nor the reverse."""

    key: str | None  # the connection's, "live:<uuid>"; its later rows are "<key>:2", "<key>:3"… (None: unkeyed)
    metric: str = "live_seconds"
    pool: str | None = None  # entitlements.usage_pool of the plan the current row draws on
    row: int = 1
    since_s: int = 0  # connection time at which the current row began

    @property
    def row_key(self) -> str | None:
        return self.key if self.key is None or self.row == 1 else f"{self.key}:{self.row}"

    def event(self, user_id: str, session_id: str, seconds: float) -> UsageEvent:
        """The current row, `seconds` into the connection."""
        return UsageEvent(user_id=user_id, session_id=session_id, metric=self.metric,
                          quantity=max(seconds - self.since_s, 0), idempotency_key=self.row_key, pool=self.pool,
                          created_at=datetime.now(UTC))

    def switch(self, pool: str, seconds: int) -> None:
        """From `seconds` on, the time goes to a new row on `pool`."""
        self.pool, self.row, self.since_s = pool, self.row + 1, seconds


async def write_once(obj: Base) -> None:
    async with sessionmaker()() as db:
        if isinstance(obj, UsageEvent):
            await upsert_usage(db, obj)
        else:
            # add(), not merge(): every row has a fresh PK and is written once, so merge's pre-INSERT SELECT
            # is pure overhead on the live recording hot path.
            db.add(obj)
        await db.commit()


async def _with_retries(fn: Callable[[], Awaitable[None]], what: str) -> bool:
    for attempt in range(WRITE_ATTEMPTS):
        try:
            await fn()
            return True
        except Exception as e:
            if attempt == WRITE_ATTEMPTS - 1:
                log.error("recorder: %s failed after %d attempts: %s", what, WRITE_ATTEMPTS, type(e).__name__)
                return False
            await asyncio.sleep(BACKOFF_S * 2**attempt)
    return False


@dataclass(frozen=True)
class _QuestionText:
    qid: str
    text: str


async def _update_question_text(change: _QuestionText) -> None:
    for attempt in range(WRITE_ATTEMPTS):
        try:
            async with sessionmaker()() as db:
                await db.execute(update(Question).where(Question.id == change.qid).values(text=change.text))
                await db.commit()
            return
        except Exception as e:
            if attempt == WRITE_ATTEMPTS - 1:
                log.error("recorder: question text update failed (%s)", type(e).__name__)
            else:
                await asyncio.sleep(BACKOFF_S * 2**attempt)


async def write_durably(obj: Base) -> bool:
    """Write with retries; on final failure dead-letter it. Returns False only if it was dead-lettered."""
    if getattr(obj, "id", "") is None:
        obj.id = str(uuid.uuid4())  # type: ignore[attr-defined]  # fix the PK up front so retries can't duplicate
    payload = _to_payload(obj)
    kind = type(obj).__name__
    error = ""
    for attempt in range(WRITE_ATTEMPTS):
        try:
            await write_once(_from_payload(kind, payload))  # fresh instance: a failed session taints the old
            return True
        except IntegrityError as e:
            if isinstance(obj, UsageEvent) and obj.idempotency_key:
                # a concurrent insert of the same key won the race: retry becomes an update
                error = str(e)
                continue
            return True  # duplicate primary key: an earlier attempt's commit landed
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
        if attempt < WRITE_ATTEMPTS - 1:
            await asyncio.sleep(BACKOFF_S * 2**attempt)
    log.error("recorder: %s write failed %d times; dead-lettering (%s)", kind, WRITE_ATTEMPTS, error[:300])
    await _dead_letter(kind, payload, error)
    return False


async def _dead_letter(kind: str, payload: dict[str, Any], error: str) -> None:
    try:
        async with sessionmaker()() as db:
            db.add(FailedWrite(kind=kind, payload=payload, error=error[:4000]))
            await db.commit()
        return
    except Exception:
        log.exception("recorder: dead-letter table unavailable; spooling to disk")
    try:
        with spool_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": kind, "payload": payload, "error": error[:4000]}) + "\n")
    except Exception:
        # Last resort. Metadata only: payloads can hold transcript text, which must not reach logs.
        log.critical("recorder: LOST %s write for session %s (no DB, no spool)", kind, payload.get("session_id"))


async def replay_failed_writes() -> int:
    """Re-apply dead-lettered and spooled writes (called at startup). Returns how many landed."""
    done = 0
    path = spool_path()
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
        path.unlink()
        for line in lines:
            with contextlib.suppress(Exception):
                item = json.loads(line)
                if await write_durably(_from_payload(item["kind"], item["payload"])):
                    done += 1
    async with sessionmaker()() as db:
        # Dead letters hold transcript text: anything already replayed, or still failing after 30 days, goes.
        await db.execute(delete(FailedWrite).where(
            FailedWrite.replayed_at.is_not(None)
            | (FailedWrite.created_at < datetime.now(UTC) - timedelta(days=FAILED_WRITE_KEEP_DAYS))))
        await db.commit()
        pending = (await db.scalars(select(FailedWrite).where(FailedWrite.replayed_at.is_(None))
                                    .order_by(FailedWrite.created_at).limit(1000))).all()
    for fw in pending:
        try:
            if fw.kind not in _MODELS:
                raise KeyError(fw.kind)
            await write_once(_from_payload(fw.kind, fw.payload))
        except IntegrityError:
            pass  # already written
        except Exception:
            log.warning("replay of failed write %s still failing", fw.id)
            continue
        async with sessionmaker()() as db:
            # Written (or its session is gone): the copy of the transcript in the dead letter isn't needed.
            await db.execute(delete(FailedWrite).where(FailedWrite.id == fw.id))
            await db.commit()
        done += 1
    if done:
        log.info("recorder: replayed %d failed writes", done)
    return done


class DbRecorder:
    def __init__(self, session_id: str, user_id: str, *, store_transcripts: bool,
                 minutes: InterviewTime | None = None) -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.store_transcripts = store_transcripts
        # This connection's interview time: shared with the live-minute heartbeat, which moves it to a new row when
        # the plan changes. `live_seconds`, or `mock_seconds` for mock interviews (their own monthly allowance).
        self.minutes = minutes or InterviewTime(None)
        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        self._worker = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            obj = await self._queue.get()
            if obj is None:
                return
            if isinstance(obj, _QuestionText):
                await _update_question_text(obj)
            else:
                await write_durably(obj)

    def _put(self, obj: Any) -> None:
        self._queue.put_nowait(obj)

    async def turn(self, turn_id: str, speaker: Speaker, text: str, start_ms: int, end_ms: int) -> None:
        if self.store_transcripts:
            self._put(SessionTurn(id=turn_id, session_id=self.session_id, speaker=speaker, text=text,
                                  start_ms=start_ms, end_ms=end_ms, created_at=datetime.now(UTC)))

    async def question(self, qid: str, turn_id: str | None, text: str, qtype: str, confidence: float,
                       is_follow_up: bool, source: str) -> None:
        self._put(Question(id=qid, session_id=self.session_id, turn_id=turn_id, text=text, type=qtype,
                           confidence=confidence, is_follow_up=is_follow_up, source=source,
                           created_at=datetime.now(UTC)))

    async def question_text(self, qid: str, text: str) -> None:
        """The interviewer carried on after the question fired ("…? What is dependency injection?"): the stored
        question becomes the whole thing, so the review and exports show what was actually answered. Queued after
        the question's own insert, so it always lands after it."""
        self._put(_QuestionText(qid, text))

    async def answer(self, aid: str, qid: str | None, status: str, content: dict[str, Any] | None,
                     provider: str, model: str, first_token_ms: int | None, total_ms: int | None) -> None:
        self._put(Answer(id=aid, session_id=self.session_id, question_id=qid, status=status, content=content,
                         provider=provider, model=model, first_token_ms=first_token_ms, total_ms=total_ms,
                         created_at=datetime.now(UTC)))

    async def provider_request(self, provider: str, model: str, request_type: str, usage: Usage,
                               latency_ms: int, ok: bool) -> None:
        now = datetime.now(UTC)
        self._put(ProviderRequest(user_id=self.user_id, session_id=self.session_id, provider=provider, model=model,
                                  request_type=request_type, input_tokens=usage.input_tokens,
                                  output_tokens=usage.output_tokens, cached_input_tokens=usage.cached_input_tokens,
                                  latency_ms=latency_ms, estimated_cost_usd=estimate_cost(model, usage, now),
                                  ok=ok, created_at=now))

    async def usage(self, metric: str, quantity: float, key: str | None = None) -> None:
        self._put(UsageEvent(user_id=self.user_id, session_id=self.session_id, metric=metric, quantity=quantity,
                             idempotency_key=key, created_at=datetime.now(UTC)))

    async def detached(self, duration_s: int, stt_seconds: float, summary: str,
                       metrics: dict[str, list[int]] | None = None) -> None:
        await self._finish(duration_s, stt_seconds, summary, metrics, end=False)

    async def ended(self, duration_s: int, stt_seconds: float, summary: str,
                    metrics: dict[str, list[int]] | None = None) -> None:
        await self._finish(duration_s, stt_seconds, summary, metrics, end=True)

    async def _finish(self, duration_s: int, stt_seconds: float, summary: str,
                      metrics: dict[str, list[int]] | None, *, end: bool) -> None:
        self._put(self.minutes.event(self.user_id, self.session_id, duration_s))
        if stt_seconds:
            key = self.minutes.key
            await self.usage("stt_seconds", stt_seconds, f"stt:{key}" if key else None)
        await self.flush()

        async def close_row() -> None:
            async with sessionmaker()() as db:
                row = await db.get(LiveSessionRow, self.session_id)
                if row is not None:
                    if end:
                        row.status = "ended"
                        row.ended_at = row.ended_at or datetime.now(UTC)
                    row.duration_s = (row.duration_s or 0) + duration_s
                    row.rolling_summary = summary or row.rolling_summary
                    if metrics:  # accumulate across reconnects
                        row.metrics = merge_metrics(row.metrics, metrics)
                    await db.commit()

        await _with_retries(close_row, "session row update")
        if end:
            # The report is a durable job: the session ends for the user right away, and a restart
            # mid-report doesn't lose it.
            await _with_retries(
                lambda: enqueue_now("report", {"session_id": self.session_id}, report_key(self.session_id)),
                "report enqueue")

    async def flush(self) -> None:
        await self._queue.put(None)
        with contextlib.suppress(Exception):
            await self._worker
        self._worker = asyncio.create_task(self._run())

    async def close(self) -> None:
        await self._queue.put(None)
        with contextlib.suppress(Exception):
            await self._worker
