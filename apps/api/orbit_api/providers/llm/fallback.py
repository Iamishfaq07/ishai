"""Primary LLM (DeepSeek) with an optional backup (launch brief §12). Always wraps the primary, so health and the
circuit breaker apply even when no backup is configured.

Rules:
- The primary gets every request unless its circuit breaker is open.
- The backup takes over only when the primary fails **before its first token**. That includes a first token that
  doesn't arrive within the time budget. Once text has streamed, a failure is raised as-is: an answer is never
  silently continued by a different model mid-sentence.
- The budget is for failing over: when no backup can take the request (none configured, a plan without
  fallback, an image it can't read, or the backup itself down), a slow first token is waited for, up to
  NO_BACKUP_FIRST_TOKEN_S for a primary that's really stuck. Cutting it off at the budget only turned a late answer
  into a failed one.
- Failures that mean "try elsewhere" trigger it: 429, 5xx, timeouts, network errors, and account problems
  (401/402/403: bad key, no credit). A bad request (400) or an image the backup can't read doesn't, because the
  backup would fail the same way.
- Requests with `allow_fallback=False` (plans without "provider_fallback") never use the backup.
- Every attempt is logged (primary tried, backup used, why, latency) and recorded in provider health. The first
  chunk of a stream says who served it, so cost is attributed to the right model; an unpriced backup model is
  logged as unknown cost, never zero.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers import health
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest

log = logging.getLogger(__name__)

# Besides every retryable error (429, 5xx, timeouts, network): account problems the backup doesn't share.
ACCOUNT_CODES = frozenset({"http_401", "http_402", "http_403"})
# Chain-of-thought delays the first token by design (measured up to ~6 s at "max"); don't count that as an outage.
THINKING_EXTRA_S = 12.0
# With nowhere to fail over to: a slow primary (DeepSeek under load answering at 11 s) still answers; one that's
# stuck this long fails, and the engine retries it once.
NO_BACKUP_FIRST_TOKEN_S = 45.0


class CircuitBreaker:
    """Opens after `threshold` consecutive failures, for `cooldown_s`; then lets one trial request through."""

    def __init__(self, threshold: int = 3, cooldown_s: float = 30.0) -> None:
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures = 0
        self.opened_at: float | None = None

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        if time.monotonic() - self.opened_at >= self.cooldown_s:
            return True  # half-open: one trial; its outcome closes or re-opens
        return False

    def success(self) -> None:
        self.failures, self.opened_at = 0, None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()

    @property
    def state(self) -> str:
        return "closed" if self.opened_at is None else ("half_open" if self.allow() else "open")


class FallbackProvider(LLMProvider):
    def __init__(self, primary: LLMProvider, fallback: LLMProvider | None, *, first_token_timeout_s: float = 10.0,
                 breaker: CircuitBreaker | None = None) -> None:
        self.primary, self.fallback = primary, fallback
        self.name = primary.name  # what the app is configured with; per-stream attribution is on the chunks
        self.first_token_timeout_s = first_token_timeout_s
        self.breaker = breaker or CircuitBreaker()

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return self.primary.model_for(reasoning)

    def supports_vision(self) -> bool:
        return self.primary.supports_vision() or bool(self.fallback and self.fallback.supports_vision())

    def supports_structured_output(self) -> bool:
        return self.primary.supports_structured_output()

    async def warm(self) -> None:
        await self.primary.warm()

    def _budget(self, request: LLMRequest) -> float:
        """How long the primary has for its first token before the request moves on."""
        wait = (self.first_token_timeout_s if self._backup_ready(request)
                else max(self.first_token_timeout_s, NO_BACKUP_FIRST_TOKEN_S))
        return wait + (THINKING_EXTRA_S if request.thinking != "off" else 0.0)

    def _backup_can_take(self, request: LLMRequest) -> bool:
        return (self.fallback is not None and request.allow_fallback
                and (not request.images or self.fallback.supports_vision()))

    def _backup_ready(self, request: LLMRequest) -> bool:
        """A backup could answer this request if the primary is slow: it can take it, and isn't down itself."""
        return (self._backup_can_take(request) and self.fallback is not None
                and health.state_of(self.fallback.name) != "down")

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        reason = "circuit_open"
        if self.breaker.allow() or not self._backup_can_take(request):
            started = time.monotonic()
            gen = self.primary.stream(request) if not request.images or self.primary.supports_vision() else None
            try:
                if gen is None:
                    raise LLMError("vision_unsupported", f"{self.primary.name} can't read images")
                first = await asyncio.wait_for(anext(gen), timeout=self._budget(request))
            except StopAsyncIteration:
                self.breaker.success()
                health.record(self.primary.name, "llm", True, int((time.monotonic() - started) * 1000))
                return
            except (LLMError, TimeoutError) as e:
                err = e if isinstance(e, LLMError) else LLMError("timeout", "no first token in time", retryable=True)
                close = getattr(gen, "aclose", None)  # abandon the primary's stream cleanly
                if close is not None:
                    await close()
                self.breaker.failure()
                health.record(self.primary.name, "llm", False, error=err.code)
                usable = err.retryable or err.code in ACCOUNT_CODES or err.code == "vision_unsupported"
                if not (usable and self._backup_can_take(request)):
                    raise err from None
                reason = err.code
            else:
                first_ms = int((time.monotonic() - started) * 1000)
                first.provider, first.model = self.primary.name, self.primary.model_for(request.reasoning)
                yield first
                try:
                    async for chunk in gen:  # mid-stream failures propagate: never switch models mid-answer
                        yield chunk
                except LLMError as e:
                    health.record(self.primary.name, "llm", False, error=e.code)
                    raise
                self.breaker.success()
                health.record(self.primary.name, "llm", True, first_ms)
                return

        assert self.fallback is not None  # _backup_can_take() guaranteed it
        started = time.monotonic()
        log.warning("llm fallback: primary=%s backup=%s reason=%s type=%s", self.primary.name, self.fallback.name,
                    reason, request.request_type)
        first_chunk = True
        try:
            async for chunk in self.fallback.stream(request):
                if first_chunk:
                    first_chunk = False
                    chunk.provider, chunk.model = self.fallback.name, self.fallback.model_for(request.reasoning)
                    health.record(self.fallback.name, "llm", True, int((time.monotonic() - started) * 1000))
                yield chunk
        except LLMError as e:
            health.record(self.fallback.name, "llm", False, error=e.code)
            raise

    async def aclose(self) -> None:
        await self.primary.aclose()
        if self.fallback is not None:
            await self.fallback.aclose()
