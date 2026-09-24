"""LLM failover (brief §12), provider health (§13), and subtle user-facing recovery (§24)."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers import health
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMImage, LLMMessage, LLMProvider, LLMRequest, Usage
from orbit_api.providers.llm.fallback import CircuitBreaker, FallbackProvider
from orbit_api.providers.llm.openai_compat import OpenAICompatibleProvider


class Scripted(LLMProvider):
    """Yields `words`, or fails with `error` before (at=0) or after (at=n) n chunks; can stall before the first."""

    def __init__(self, name: str, words: list[str] | None = None, *, error: LLMError | None = None, at: int = 0,
                 stall_s: float = 0.0, vision: bool = False) -> None:
        self.name, self.words, self.error, self.at = name, words or [], error, at
        self.stall_s, self.vision = stall_s, vision
        self.calls = 0

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return f"{self.name}-model"

    def supports_vision(self) -> bool:
        return self.vision

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        self.calls += 1
        if self.stall_s:
            await asyncio.sleep(self.stall_s)
        for i, w in enumerate(self.words):
            if self.error and i == self.at:
                raise self.error
            yield LLMChunk(delta=w)
        if self.error and self.at >= len(self.words):
            raise self.error
        yield LLMChunk(usage=Usage(10, len(self.words)))


def req(**kw: Any) -> LLMRequest:
    return LLMRequest(messages=[LLMMessage("user", "q")], **kw)


async def collect(p: LLMProvider, r: LLMRequest) -> tuple[str, list[LLMChunk]]:
    chunks = [c async for c in p.stream(r)]
    return "".join(c.delta for c in chunks), chunks


@pytest.fixture(autouse=True)
def _clean_health() -> None:
    health.reset()


E503 = LLMError("http_503", "down", retryable=True)


async def test_primary_serves_and_is_attributed() -> None:
    primary, backup = Scripted("deepseek", ["Hel", "lo"]), Scripted("backup", ["no"])
    text, chunks = await collect(FallbackProvider(primary, backup), req())
    assert text == "Hello" and backup.calls == 0
    assert (chunks[0].provider, chunks[0].model) == ("deepseek", "deepseek-model")
    assert health.state_of("deepseek") == "healthy"


@pytest.mark.parametrize("error", [E503, LLMError("rate_limited", "429", retryable=True),
                                   LLMError("network", "x", retryable=True), LLMError("http_402", "no credit")])
async def test_failure_before_first_token_goes_to_backup(error: LLMError) -> None:
    primary, backup = Scripted("deepseek", ["x"], error=error, at=0), Scripted("backup", ["Back", "up"])
    text, chunks = await collect(FallbackProvider(primary, backup), req())
    assert text == "Backup" and chunks[0].provider == "backup" and chunks[0].model == "backup-model"
    assert health.dependency("deepseek", "llm").last_error == error.code


async def test_no_first_token_within_budget_goes_to_backup() -> None:
    primary, backup = Scripted("deepseek", ["late"], stall_s=0.5), Scripted("backup", ["fast"])
    text, _ = await collect(FallbackProvider(primary, backup, first_token_timeout_s=0.05), req())
    assert text == "fast" and health.dependency("deepseek", "llm").last_error == "timeout"


async def test_thinking_gets_extra_first_token_headroom() -> None:
    fp = FallbackProvider(Scripted("deepseek"), Scripted("backup"), first_token_timeout_s=1)
    assert fp._budget(req(thinking="max")) > fp._budget(req())


async def test_never_switches_models_mid_answer() -> None:
    primary, backup = Scripted("deepseek", ["one ", "two"], error=E503, at=1), Scripted("backup", ["other"])
    got: list[str] = []
    with pytest.raises(LLMError):
        async for c in FallbackProvider(primary, backup).stream(req()):
            got.append(c.delta)
    assert got == ["one "] and backup.calls == 0


@pytest.mark.parametrize("error", [LLMError("http_400", "bad request")])
async def test_request_errors_do_not_fail_over(error: LLMError) -> None:
    backup = Scripted("backup", ["b"])
    with pytest.raises(LLMError):
        await collect(FallbackProvider(Scripted("deepseek", ["x"], error=error), backup), req())
    assert backup.calls == 0


async def test_plan_without_fallback_never_uses_backup() -> None:
    backup = Scripted("backup", ["b"])
    with pytest.raises(LLMError, match="down"):
        await collect(FallbackProvider(Scripted("deepseek", ["x"], error=E503), backup), req(allow_fallback=False))
    assert backup.calls == 0


async def test_images_only_go_to_a_backup_that_can_see() -> None:
    img = req(images=[LLMImage(b"png")])
    blind = Scripted("backup", ["b"])
    with pytest.raises(LLMError):
        await collect(FallbackProvider(Scripted("deepseek", ["x"], error=E503, vision=True), blind), img)
    seeing = Scripted("backup", ["seen"], vision=True)
    text, _ = await collect(FallbackProvider(Scripted("deepseek", ["x"], error=E503, vision=True), seeing), img)
    assert text == "seen"


async def test_no_backup_configured_raises_for_the_engine_to_retry() -> None:
    with pytest.raises(LLMError) as e:
        await collect(FallbackProvider(Scripted("deepseek", ["x"], error=E503), None), req())
    assert e.value.retryable


async def test_circuit_breaker_opens_then_half_opens() -> None:
    primary, backup = Scripted("deepseek", ["x"], error=E503), Scripted("backup", ["b"])
    fp = FallbackProvider(primary, backup, breaker=CircuitBreaker(threshold=3, cooldown_s=0.1))
    for _ in range(3):
        await collect(fp, req())
    assert fp.breaker.state == "open" and primary.calls == 3
    await collect(fp, req())
    assert primary.calls == 3  # skipped while open: straight to the backup
    await asyncio.sleep(0.12)
    primary.error = None
    text, _ = await collect(fp, req())  # half-open trial succeeds → closed
    assert text == "x" and primary.calls == 4 and fp.breaker.state == "closed"
    assert health.state_of("deepseek") == "degraded"  # recovered, but recent failures still show


def test_health_states() -> None:
    assert health.state_of("nothing") == "unknown"
    for _ in range(3):
        health.record("dg", "stt", False, error="http_500")
    assert health.state_of("dg") == "down"
    health.record("dg", "stt", True, 200)
    assert health.state_of("dg") == "degraded"
    for _ in range(30):
        health.record("db", "database", True, 20)
    snap = next(s for s in health.snapshot() if s["name"] == "db")
    assert snap["state"] == "healthy" and snap["p95_ms"] == 20 and snap["failure_rate"] == 0


# ---- the OpenAI-compatible backup itself ---------------------------------------------------------------------


def _sse(events: list[dict[str, Any]]) -> bytes:
    return b"".join(f"data: {json.dumps(e)}\n\n".encode() for e in events) + b"data: [DONE]\n\n"


async def test_openai_compatible_stream_and_usage() -> None:
    sent: dict[str, Any] = {}

    def handler(r: httpx.Request) -> httpx.Response:
        sent.update(json.loads(r.content))
        assert r.headers["authorization"] == "Bearer sk-test" and r.url.path.endswith("/chat/completions")
        return httpx.Response(200, content=_sse([
            {"choices": [{"delta": {"content": "Hi "}}]}, {"choices": [{"delta": {"content": "there"}}]},
            {"choices": [], "usage": {"prompt_tokens": 50, "completion_tokens": 2,
                                      "prompt_tokens_details": {"cached_tokens": 32}}}]))

    client = httpx.AsyncClient(base_url="https://api.example/v1", transport=httpx.MockTransport(handler),
                               headers={"Authorization": "Bearer sk-test"})
    p = OpenAICompatibleProvider("openai", "sk-test", "https://api.example/v1", "gpt-x", client=client)
    text, chunks = await collect(p, req(json_mode=True))
    assert text == "Hi there" and chunks[-1].usage == Usage(50, 2, cached_input_tokens=32)
    assert sent["model"] == "gpt-x" and sent["stream"] is True and sent["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize(("status", "code", "retryable"), [(429, "rate_limited", True), (503, "http_503", True),
                                                           (401, "http_401", False)])
async def test_openai_compatible_errors(status: int, code: str, retryable: bool) -> None:
    client = httpx.AsyncClient(base_url="https://api.example/v1",
                               transport=httpx.MockTransport(lambda r: httpx.Response(status, text="nope")))
    p = OpenAICompatibleProvider("openai", "k", "https://api.example/v1", "m", client=client)
    with pytest.raises(LLMError) as e:
        await collect(p, req())
    assert (e.value.code, e.value.retryable) == (code, retryable)
    with pytest.raises(LLMError, match="images"):
        await collect(p, req(images=[LLMImage(b"x")]))


# ---- engine: attribution + subtle recovery --------------------------------------------------------------------


async def test_engine_answer_served_by_backup_is_recorded_and_subtle() -> None:
    from orbit_api.live.engine import LiveEngine, NullRecorder, SessionProfile
    from orbit_api.live.events import LiveSettings
    from orbit_api.providers.stt.base import TranscriptEvent
    from orbit_api.providers.stt.mock import MockSTTProvider
    from orbit_api.retrieval.index import SessionIndex
    from tests.test_engine import Sink

    calls: list[tuple[str, str, bool]] = []

    class Rec(NullRecorder):
        async def provider_request(self, provider: str, model: str, request_type: str, usage: Usage,
                                   latency_ms: int, ok: bool) -> None:
            calls.append((provider, model, ok))

    backup = Scripted("backup", ["ANSWER: Use a hash map.\n"])
    llm = FallbackProvider(Scripted("deepseek", ["x"], error=E503), backup)
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True),
                     LiveSettings(response_timing="quick"), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]), recorder=Rec())
    await eng.start()
    await eng.on_transcript("system", TranscriptEvent("final", "How would you find duplicates?", 0, 100, endpoint=True))
    await sink.wait_for("answer.completed")
    assert ("backup", "backup-model", True) in calls
    recovered = [p for p in sink.of("provider.status") if p.get("detail") == "AI connection recovered"]
    assert recovered and "503" not in json.dumps(sink.events)  # no provider error codes reach the user
    assert not sink.of("answer.failed")
    await eng.end()


async def test_engine_respects_plan_without_fallback() -> None:
    from orbit_api.live.engine import LiveEngine, SessionProfile
    from orbit_api.live.events import LiveSettings
    from orbit_api.providers.stt.base import TranscriptEvent
    from orbit_api.providers.stt.mock import MockSTTProvider
    from orbit_api.retrieval.index import SessionIndex
    from tests.test_engine import Sink

    backup = Scripted("backup", ["ANSWER: x\n"])
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True, allow_fallback=False),
                     LiveSettings(response_timing="quick"), send=sink,
                     llm=FallbackProvider(Scripted("deepseek", ["x"], error=E503), backup),
                     stt=MockSTTProvider(), index=SessionIndex([]))
    await eng.start()
    await eng.on_transcript("system", TranscriptEvent("final", "How would you find duplicates?", 0, 100, endpoint=True))
    await sink.wait_for("answer.failed")
    assert backup.calls == 0
    await eng.end()


# ---- preflight + config ---------------------------------------------------------------------------------------


async def test_preflight_reports_backup_answering(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import preflight

    fp = FallbackProvider(Scripted("deepseek", ["x"], error=E503), Scripted("backup", ["OK"]))
    monkeypatch.setattr(preflight, "get_llm_provider", lambda: fp)
    check = await preflight._llm_check()
    assert check.status == "warn" and "backup AI is answering" in check.detail
    fp_down = FallbackProvider(Scripted("deepseek", ["x"], error=E503), Scripted("backup", ["x"], error=E503))
    monkeypatch.setattr(preflight, "get_llm_provider", lambda: fp_down)
    assert (await preflight._llm_check()).status == "fail"


def test_production_validates_backup_config() -> None:
    from tests.test_launch_security import _prod

    with pytest.raises(ValueError, match="_API_KEY"):
        _prod(ORBIT_FALLBACK_LLM_BASE_URL="https://api.openai.com/v1")
    with pytest.raises(ValueError, match="https"):
        _prod(ORBIT_FALLBACK_LLM_BASE_URL="http://api.example/v1", ORBIT_FALLBACK_LLM_API_KEY="k",
              ORBIT_FALLBACK_LLM_MODEL="m")
    assert _prod(ORBIT_FALLBACK_LLM_BASE_URL="https://api.openai.com/v1", ORBIT_FALLBACK_LLM_API_KEY="k",
                 ORBIT_FALLBACK_LLM_MODEL="gpt-4o-mini").fallback_llm_model == "gpt-4o-mini"


async def test_backup_extra_payload_is_merged() -> None:
    sent: dict[str, Any] = {}

    def handler(r: httpx.Request) -> httpx.Response:
        sent.update(json.loads(r.content))
        return httpx.Response(200, content=_sse([{"choices": [{"delta": {"content": "ok"}}]}]))

    client = httpx.AsyncClient(base_url="https://api.example/v1", transport=httpx.MockTransport(handler))
    p = OpenAICompatibleProvider("gemini", "k", "https://api.example/v1", "m",
                                 extra={"reasoning_effort": "low"}, client=client)
    await collect(p, req())
    assert sent["reasoning_effort"] == "low" and sent["model"] == "m"