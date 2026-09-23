"""Persists live-session events off the hot path: the engine enqueues, a single worker writes in order."""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime
from typing import Any

from orbit_api.db import sessionmaker
from orbit_api.live.events import Speaker
from orbit_api.models import Answer, LiveSessionRow, ProviderRequest, Question, SessionTurn, UsageEvent
from orbit_api.providers.llm.base import Usage, estimate_cost
from orbit_api.sessions.report import generate_report

log = logging.getLogger(__name__)


class DbRecorder:
    def __init__(self, session_id: str, user_id: str, *, store_transcripts: bool) -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.store_transcripts = store_transcripts
        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        self._worker = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            obj = await self._queue.get()
            if obj is None:
                return
            try:
                async with sessionmaker()() as db:
                    # add(), not merge(): every row has a fresh PK and is written once, so merge's
                    # pre-INSERT SELECT is pure overhead on the live recording hot path.
                    db.add(obj)
                    await db.commit()
            except Exception:
                log.exception("recorder write failed (%s)", type(obj).__name__)

    def _put(self, obj: Any) -> None:
        self._queue.put_nowait(obj)

    async def turn(self, turn_id: str, speaker: Speaker, text: str, start_ms: int, end_ms: int) -> None:
        if self.store_transcripts:
            self._put(SessionTurn(id=turn_id, session_id=self.session_id, speaker=speaker, text=text,
                                  start_ms=start_ms, end_ms=end_ms))

    async def question(self, qid: str, turn_id: str | None, text: str, qtype: str, confidence: float,
                       is_follow_up: bool, source: str) -> None:
        self._put(Question(id=qid, session_id=self.session_id, turn_id=turn_id, text=text, type=qtype,
                           confidence=confidence, is_follow_up=is_follow_up, source=source))

    async def answer(self, aid: str, qid: str | None, status: str, content: dict[str, Any] | None,
                     provider: str, model: str, first_token_ms: int | None, total_ms: int | None) -> None:
        self._put(Answer(id=aid, session_id=self.session_id, question_id=qid, status=status, content=content,
                         provider=provider, model=model, first_token_ms=first_token_ms, total_ms=total_ms))

    async def provider_request(self, provider: str, model: str, request_type: str, usage: Usage,
                               latency_ms: int, ok: bool) -> None:
        self._put(ProviderRequest(user_id=self.user_id, session_id=self.session_id, provider=provider, model=model,
                                  request_type=request_type, input_tokens=usage.input_tokens,
                                  output_tokens=usage.output_tokens, latency_ms=latency_ms,
                                  estimated_cost_usd=estimate_cost(model, usage), ok=ok))

    async def detached(self, duration_s: int, stt_seconds: float, summary: str) -> None:
        await self._finish(duration_s, stt_seconds, summary, end=False)

    async def ended(self, duration_s: int, stt_seconds: float, summary: str) -> None:
        await self._finish(duration_s, stt_seconds, summary, end=True)

    async def _finish(self, duration_s: int, stt_seconds: float, summary: str, *, end: bool) -> None:
        self._put(UsageEvent(user_id=self.user_id, session_id=self.session_id, metric="live_seconds",
                             quantity=duration_s))
        if stt_seconds:
            self._put(UsageEvent(user_id=self.user_id, session_id=self.session_id, metric="stt_seconds",
                                 quantity=stt_seconds))
        await self.flush()
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, self.session_id)
            if row is not None:
                if end:
                    row.status = "ended"
                    row.ended_at = datetime.now(UTC)
                row.duration_s = (row.duration_s or 0) + duration_s
                row.rolling_summary = summary or row.rolling_summary
                await db.commit()
        if not end:
            return
        try:
            await asyncio.wait_for(generate_report(self.session_id), timeout=30)
        except Exception:
            log.exception("session report generation failed")

    async def flush(self) -> None:
        await self._queue.put(None)
        with contextlib.suppress(Exception):
            await self._worker
        self._worker = asyncio.create_task(self._run())

    async def close(self) -> None:
        await self._queue.put(None)
        with contextlib.suppress(Exception):
            await self._worker
