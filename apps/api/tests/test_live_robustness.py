"""The live engine and socket under things going wrong: speakers in phone mode, a client flooding requests, loops
that must survive one bad event, spend that must be recorded, and sessions that must really stop (ended, deleted,
finished, or never got going). Plus the HTTP routes that did CPU work or N+1 queries on the event loop."""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect, WebSocketState

from orbit_api.live.engine import MAX_SPEAKER_OVERRIDES, REQUEST_BURST, REQUEST_EVERY_S, LiveEngine, SessionProfile
from orbit_api.live.events import LiveSettings, QuestionType
from orbit_api.live.mock_interviewer import MockConfig
from orbit_api.providers.llm.base import LLMChunk, LLMRequest, Usage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from orbit_api.sessions import routes
from tests.test_api import _close_code, _collect, _live, _register
from tests.test_engine import Sink
from tests.test_mock_interview import Spy


class Ledger(Spy):
    """A recorder that keeps the provider requests: what the session spent."""

    def __init__(self) -> None:
        super().__init__()
        self.spend: list[tuple[str, Usage, bool]] = []

    async def provider_request(self, provider: str, model: str, request_type: str, usage: Usage,
                               latency_ms: int, ok: bool) -> None:
        self.spend.append((request_type, usage, ok))

    def failed_answers(self) -> list[Usage]:
        return [u for kind, u, ok in self.spend if kind == "answer" and not ok]


def _engine(llm: Any = None, *, session_type: str = "interview", recorder: Any = None, mock: MockConfig | None = None,
            clock: Any = None, **settings: Any) -> tuple[LiveEngine, Sink]:
    settings.setdefault("response_timing", "quick")
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", session_type, "Engineer", "en", "en", dev_mode=True,  # type: ignore[arg-type]
                                    mock=mock),
                     LiveSettings(**settings), send=sink, llm=llm or MockLLMProvider(), stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=recorder, **({"clock": clock} if clock else {}))
    return eng, sink


async def _ask(eng: LiveEngine, text: str) -> None:
    await eng.on_transcript("system", TranscriptEvent("final", text, 0, 100, endpoint=True))


# ---- phone mode: events without a speaker belong to the open turn -------------------------------------------------


async def test_phone_mode_utterance_end_belongs_to_the_candidates_turn() -> None:
    """Deepgram's UtteranceEnd has no speaker. Taken for the interviewer, the candidate thinking aloud with a question
    fired as a new one: a second answer, and the interviewer's real question overwritten."""
    eng, sink = _engine(session_type="phone")
    await eng.start()
    await eng.on_transcript("mic", TranscriptEvent("final", "What is dependency injection?", 0, 100, endpoint=True,
                                                   speaker_hint=0))
    await sink.wait_for("answer.completed")
    # Another voice (the candidate) asks themselves a question; no speech_final, then the utterance ends.
    await eng.on_transcript("mic", TranscriptEvent("final", "How would you design a rate limiter for a public API?",
                                                   200, 900, speaker_hint=1))
    await eng.on_transcript("mic", TranscriptEvent("utterance_end", endpoint=True))
    await asyncio.sleep(0.3)
    assert [t["speaker"] for t in sink.of("transcript.final")] == ["interviewer", "candidate"]
    assert len(sink.of("question.detected")) == 1 and len(sink.of("answer.started")) == 1
    await eng.end()


class Warming(MockLLMProvider):
    def __init__(self) -> None:
        super().__init__()
        self.warms = 0

    async def warm(self) -> None:
        self.warms += 1


async def test_phone_mode_speech_started_in_the_candidates_turn_is_not_the_interviewer() -> None:
    llm = Warming()
    eng, sink = _engine(llm, session_type="phone")
    await eng.start()
    await eng.on_transcript("mic", TranscriptEvent("final", "What is dependency injection?", 0, 100, endpoint=True,
                                                   speaker_hint=0))
    await sink.wait_for("answer.completed")
    await eng.on_transcript("mic", TranscriptEvent("partial", "So I think the main idea", 200, 500, speaker_hint=1))
    await asyncio.sleep(0.05)
    warms = llm.warms
    await eng.on_transcript("mic", TranscriptEvent("speech_started"))
    await asyncio.sleep(0.05)
    assert llm.warms == warms  # not "the interviewer started talking": no warm-up, no held question pushed back
    await eng.end()


# ---- a client flooding the socket ---------------------------------------------------------------------------------


async def test_a_flood_of_answer_requests_is_throttled_per_connection() -> None:
    now = {"t": 0.0}
    eng, sink = _engine(clock=lambda: now["t"], auto_answer=False)
    await eng.start()
    await _ask(eng, "We rely on Kafka for event streaming across teams")
    for _ in range(REQUEST_BURST + 5):
        await eng.handle_client({"type": "answer.request", "data": {}})
    assert len(sink.of("question.detected")) == REQUEST_BURST  # each one is an LLM stream: the extras are dropped
    await eng.handle_client({"type": "chat.message", "data": {"text": "What should I say about Kafka?"}})
    await asyncio.sleep(0.1)
    assert not [s for s in sink.of("answer.started") if s["source"] == "chat"]  # chat shares the same allowance
    now["t"] += REQUEST_EVERY_S  # it refills
    await eng.handle_client({"type": "answer.request", "data": {}})
    assert len(sink.of("question.detected")) == REQUEST_BURST + 1
    await eng.end()


async def test_speaker_corrections_must_name_a_turn_of_this_connection_and_are_capped() -> None:
    eng, sink = _engine()
    await eng.start()
    await eng.on_transcript("mic", TranscriptEvent("final", "I led the migration to Kafka", 0, 100, endpoint=True))
    turn_id = sink.of("transcript.final")[0]["turn_id"]
    await eng.handle_client({"type": "speaker.correct", "data": {"turn_id": "x" * 5000, "speaker": "interviewer"}})
    assert sink.of("error")[-1]["code"] == "invalid_event"  # not an id the engine could have issued
    await eng.handle_client({"type": "speaker.correct",
                             "data": {"turn_id": str(uuid.uuid4()), "speaker": "interviewer"}})
    assert eng._speaker_overrides == {}  # an unknown turn: nothing it could change, nothing stored
    await eng.handle_client({"type": "speaker.correct", "data": {"turn_id": turn_id, "speaker": "interviewer"}})
    assert eng._speaker_overrides == {turn_id: "interviewer"}
    for tid in [eng._new_turn_id() for _ in range(MAX_SPEAKER_OVERRIDES + 50)]:
        await eng.handle_client({"type": "speaker.correct", "data": {"turn_id": tid, "speaker": "candidate"}})
    assert len(eng._speaker_overrides) == MAX_SPEAKER_OVERRIDES and turn_id not in eng._speaker_overrides
    await eng.end()


class SlowMockQuestions(MockLLMProvider):
    def __init__(self) -> None:
        super().__init__()
        self.delay_s = 0.0

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        await asyncio.sleep(self.delay_s)
        async for chunk in super().stream(request):
            yield chunk


async def test_the_mock_answer_button_doesnt_block_the_socket() -> None:
    llm = SlowMockQuestions()
    eng, sink = _engine(llm, session_type="mock", mock=MockConfig(duration_minutes=5), auto_answer=False)
    await eng.start()
    await sink.wait_for("mock.question")
    llm.delay_s = 1.0  # the next question takes a second to write
    t0 = time.monotonic()
    await eng.handle_client({"type": "answer.request", "data": {}})  # in practice, "Answer" means "I'm done"
    assert time.monotonic() - t0 < 0.5  # written in the background: the read loop (audio too) carries on
    await sink.wait_for("mock.question", 2, timeout=5)
    await eng.end()


# ---- one bad event mustn't kill a loop ------------------------------------------------------------------------------


async def test_a_transcript_event_that_raises_doesnt_stop_transcription() -> None:
    eng, sink = _engine()
    await eng.start()
    real, failed = eng.on_transcript, []

    async def flaky(channel: Any, ev: TranscriptEvent) -> None:
        if ev.kind == "final" and not failed:
            failed.append(ev)
            raise RuntimeError("a bug handling one event")
        await real(channel, ev)

    eng.on_transcript = flaky  # type: ignore[method-assign]
    stt = eng._stt_sessions["system"]
    await stt.emit(TranscriptEvent("final", "Okay, thanks for joining.", 0, 100, endpoint=True))  # type: ignore[attr-defined]
    await stt.emit(TranscriptEvent("final", "What is dependency injection?", 200, 300,  # type: ignore[attr-defined]
                                   endpoint=True))
    await sink.wait_for("answer.completed")
    assert failed
    await eng.end()


async def test_a_tick_that_raises_doesnt_stop_questions_firing() -> None:
    eng, sink = _engine(response_timing="balanced")  # a held question fires from the ticker, after the wait
    await eng.start()
    real, calls = eng._finalizer.tick, []

    def flaky(now_ms: int) -> Any:
        calls.append(now_ms)
        if len(calls) <= 3:
            raise RuntimeError("a bug in one tick")
        return real(now_ms)

    eng._finalizer.tick = flaky  # type: ignore[method-assign]
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed", timeout=6)
    await eng.end()


class UnwrappedError(MockLLMProvider):
    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        yield LLMChunk(delta="ANSWER: Dependency injection means")
        raise RuntimeError("an error the provider didn't wrap in LLMError")


async def test_an_unexpected_error_mid_answer_fails_it_instead_of_hanging() -> None:
    rec = Ledger()
    eng, sink = _engine(UnwrappedError(), recorder=rec)
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.failed")
    assert sink.of("answer.failed")[0]["error"]["code"] == "internal"
    assert eng.state.value == "listening"  # not stuck on "generating"
    [usage] = rec.failed_answers()
    assert usage.input_tokens > 0 and usage.output_tokens > 0  # what it wrote before failing was billed
    await eng.end()


# ---- spend that never reached the screen still counts ------------------------------------------------------------


async def test_dropped_early_answers_and_cancelled_ones_record_their_spend() -> None:
    rec = Ledger()
    eng, sink = _engine(MockLLMProvider(chunk_delay_s=0.06), recorder=rec, response_timing="balanced")
    await eng.start()
    await _ask(eng, "Tell me about a difficult bug you fixed.")
    await asyncio.sleep(0.3)  # an early answer is being written during the wait…
    await _ask(eng, "Specifically, how did you track it down?")  # …the interviewer keeps going: it's dropped unseen
    await asyncio.sleep(0.05)
    assert sink.of("answer.started") == []
    unseen = rec.failed_answers()
    assert unseen and all(u.input_tokens > 0 for u in unseen)

    await sink.wait_for("answer.chunk", timeout=6)  # the whole question fired; its answer is streaming
    await eng.handle_client({"type": "answer.clear", "data": {}})
    await sink.wait_for("answer.cancelled")
    cancelled = rec.failed_answers()[len(unseen):]
    assert len(cancelled) == 1 and cancelled[0].output_tokens > 0  # estimated: the stream never sent its usage
    await eng.end()


# ---- ending ---------------------------------------------------------------------------------------------------


class SlowEnd(Spy):
    def __init__(self) -> None:
        super().__init__()
        self.written = False

    async def ended(self, *a: Any, **k: Any) -> None:
        await asyncio.sleep(0.2)
        self.written = True


async def test_a_second_end_waits_for_the_first_to_finish_writing() -> None:
    rec = SlowEnd()
    eng, sink = _engine(recorder=rec)
    await eng.start()
    first = asyncio.ensure_future(eng.end())  # End pressed elsewhere, say
    await asyncio.sleep(0)
    await eng.end(final=False)  # the socket's teardown: returned at once before, while usage was half-written
    assert rec.written and sink.of("session.ended")  # the first call's end (final) is the one that ran
    await first


async def test_nothing_new_starts_once_the_session_has_ended() -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm)
    await eng.start()
    await eng.end()
    # e.g. a question that fired while end() was waiting for the generations it cancelled
    await eng._start_answer(None, "What is dependency injection?", QuestionType.technical, False, "manual")
    await asyncio.sleep(0.05)
    assert sink.of("answer.started") == [] and not llm.requests  # nothing streamed, or billed, after the end


async def test_metering_stops_and_the_socket_closes_when_the_engine_ends_itself(
        monkeypatch: pytest.MonkeyPatch) -> None:
    commits: list[int] = []

    async def commit(user_id: str, session_id: str, key: str, seconds: int, session_type: str = "") -> float:
        commits.append(seconds)
        return 3600.0

    closed: list[int] = []

    class Socket:
        async def close(self, code: int, reason: str) -> None:
            closed.append(code)

    monkeypatch.setattr(routes, "_commit_live_seconds", commit)
    eng, sink = _engine()
    await eng.start()
    meter = asyncio.ensure_future(routes._meter_live_minutes(Socket(), eng, "u", "s1", "k",  # type: ignore[arg-type]
                                                             asyncio.Event()))
    await asyncio.sleep(0.05)
    beats = len(commits)
    await eng.end()  # as a mock round that runs its course ends its own engine
    await asyncio.wait_for(meter, 2)
    assert len(commits) == beats  # nothing metered after the end
    assert closed == [4009] and sink.of("session.ended")  # the client was told first, then the socket closed


# ---- over the socket ----------------------------------------------------------------------------------------------


def _server_socket(user_headers: dict[str, str], client: TestClient, sid: str) -> Any:
    me = client.get("/v1/auth/me", headers=user_headers).json()["id"]
    return routes._live_sockets.get(me, {}).get(sid)


def test_a_finished_mock_round_closes_its_socket(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={
        "title": "Drill", "type": "mock", "auto_answer": False,
        "mock": {"duration_minutes": 5, "drill": [{"question": "Tell me about a time you failed."}]}}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "mock.question" for e in ev))
        server = _server_socket(h, client, sid)
        ws.send_text(json.dumps({"type": "mock.next", "data": {}}))  # done: the plan's one question was asked
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
        deadline = time.monotonic() + 3
        while server.application_state != WebSocketState.DISCONNECTED and time.monotonic() < deadline:
            time.sleep(0.02)
        # Closed by the server: the client stops streaming audio, and the minutes stop being metered.
        assert server.application_state == WebSocketState.DISCONNECTED
        assert _close_code(ws) == 4009


def test_deleting_a_live_session_stops_it_first(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Delete me"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        engine = routes._live_engines[sid]
        assert client.delete(f"/v1/sessions/{sid}", headers=h).status_code == 204
        assert engine.ended  # STT and the LLM stopped: nothing more streams, or is metered, for a deleted session
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))
        assert _close_code(ws) == 4009
    assert client.get(f"/v1/sessions/{sid}", headers=h).status_code == 404
    other = client.post("/v1/sessions", headers=h, json={"title": "Next"}).json()["id"]
    assert client.post(f"/v1/sessions/{other}/live-ticket", headers=h).status_code == 200  # the live slot is free


def test_deleting_the_account_stops_its_live_session(client: TestClient) -> None:
    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Last one"}).json()["id"]
    with _live(client, h, sid) as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        engine = routes._live_engines[sid]
        assert client.delete("/v1/auth/me", headers=h).status_code == 204
        assert engine.ended
        assert _close_code(ws) == 4009
    assert client.get("/v1/auth/me", headers=h).status_code == 401


def test_a_live_session_that_fails_to_start_frees_the_slot_and_isnt_left_live(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def no_stt() -> Any:
        raise RuntimeError("STT provider is deepgram but no Deepgram API key is set")

    h = _register(client)
    sid = client.post("/v1/sessions", headers=h, json={"title": "Misconfigured"}).json()["id"]
    monkeypatch.setattr(routes, "create_stt_provider", no_stt)
    with pytest.raises(WebSocketDisconnect) as refused, _live(client, h, sid) as ws:
        ws.receive_text()
    assert refused.value.code == 1011
    assert client.get(f"/v1/sessions/{sid}", headers=h).json()["session"]["status"] == "created"
    other = client.post("/v1/sessions", headers=h, json={"title": "Another"}).json()["id"]
    assert client.post(f"/v1/sessions/{other}/live-ticket", headers=h).status_code == 200  # no phantom live session
    monkeypatch.undo()
    with _live(client, h, sid) as ws:  # fixed: the same session starts normally
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "session.end", "data": {}}))
        _collect(ws, lambda ev: any(e["type"] == "session.ended" for e in ev))


# ---- HTTP: column limits, grouped queries, CPU work off the loop --------------------------------------------------


async def _stored_content_type(doc_id: str) -> str | None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import Document

    async with sessionmaker()() as db:
        doc = await db.get(Document, doc_id)
        return doc.content_type if doc else None


def test_client_content_types_and_provider_names_fit_their_columns(client: TestClient) -> None:
    """Only Postgres enforces String(n): a longer value was a DataError there (a 500, or a lost row)."""
    from orbit_api.models import Answer, ProviderRequest

    row = ProviderRequest(provider="p" * 80, model="m" * 200, request_type="answer")
    answer = Answer(id="a", session_id="s", status="completed", provider="p" * 80, model="m" * 200)
    assert (len(row.provider), len(row.model), len(answer.provider), len(answer.model)) == (32, 64, 32, 64)

    h = _register(client)
    r = client.post("/v1/documents", headers=h, data={"kind": "notes"},
                    files={"file": ("notes.txt", b"Project notes\n\nWe migrated to Kafka in 2023.",
                                    "text/plain; x=" + "y" * 300)})
    assert r.status_code == 201, r.text
    assert client.portal is not None
    stored = client.portal.call(_stored_content_type, r.json()["id"])
    assert stored is not None and stored.startswith("text/plain") and len(stored) <= 100


def test_document_and_setup_lists_count_each_item(client: TestClient) -> None:
    h = _register(client)
    made = [client.post("/v1/documents/text", headers=h, json={"title": t, "kind": "notes", "text": body}).json()
            for t, body in (("A", "Kafka migration notes. " * 20), ("B", "Short notes on Go services."))]
    listed = {d["id"]: d["chunk_count"] for d in client.get("/v1/documents", headers=h).json()}
    assert listed == {d["id"]: d["chunk_count"] for d in made} and all(listed.values())

    setup = {"name": "Acme", "session_type": "interview", "length": "short", "style": "natural", "auto_answer": True}
    with_docs = client.post("/v1/workspaces", headers=h, json={**setup, "document_ids": [d["id"] for d in made]})
    empty = client.post("/v1/workspaces", headers=h, json={**setup, "name": "Other"})
    client.post("/v1/sessions", headers=h, json={"title": "From setup", "workspace_id": with_docs.json()["id"]})
    setups = {w["id"]: w for w in client.get("/v1/workspaces", headers=h).json()}
    assert setups[with_docs.json()["id"]]["session_count"] == 1
    assert sorted(setups[with_docs.json()["id"]]["document_ids"]) == sorted(d["id"] for d in made)
    assert setups[empty.json()["id"]]["session_count"] == 0 and setups[empty.json()["id"]]["document_ids"] == []


def _off_the_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return True  # a worker thread
    return False


def test_resume_scoring_runs_off_the_event_loop(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.resumes import routes as resumes

    where: list[bool] = []
    real = resumes.score_resume

    def spy(*a: Any, **k: Any) -> Any:
        where.append(_off_the_loop())
        return real(*a, **k)

    monkeypatch.setattr(resumes, "score_resume", spy)
    h = _register(client)
    client.post("/v1/resumes", headers=h, json={"title": "Mine"})
    assert client.get("/v1/resumes", headers=h).status_code == 200
    assert client.post("/v1/resumes/score", headers=h, json={"data": {}}).status_code == 200
    assert len(where) == 2 and all(where)


async def test_job_page_parsing_runs_off_the_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from orbit_api.prep import job_link

    where: list[bool] = []
    real = job_link.extract_posting

    def spy(*a: Any, **k: Any) -> Any:
        where.append(_off_the_loop())
        return real(*a, **k)

    async def public(host: str, port: int) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(job_link, "extract_posting", spy)
    page = "<html><body><main>" + "<p>Senior engineer role: build and run our payments platform.</p>" * 10
    await job_link.fetch_job_posting("https://jobs.example/1", resolve=public, transport=httpx.MockTransport(
        lambda r: httpx.Response(200, text=page + "</main></body></html>", headers={"content-type": "text/html"})))
    assert where == [True]
