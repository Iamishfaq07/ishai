from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal

from orbit_api.live.routing import ReasoningLevel

# Model "thinking" (chain-of-thought) effort. "off" answers immediately; the rest trade seconds of silence
# before the first word for more reasoning (measured on V4.1-Flash: off ~0.65 s, low ~3.5 s, max ~5-6 s).
ThinkingLevel = Literal["off", "low", "high", "max"]


@dataclass(frozen=True)
class LLMMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class LLMImage:
    data: bytes
    media_type: str = "image/png"


@dataclass
class LLMRequest:
    messages: list[LLMMessage]
    reasoning: ReasoningLevel = "light"
    thinking: ThinkingLevel = "off"
    max_tokens: int = 600
    temperature: float = 0.3
    json_mode: bool = False
    images: list[LLMImage] = field(default_factory=list)
    request_type: str = "answer"  # answer | chat | classify | summary | vision — for cost tracking
    # May a backup provider answer if the primary fails before its first token? (plan feature "provider_fallback")
    allow_fallback: bool = True


@dataclass
class Usage:
    input_tokens: int = 0  # all prompt tokens (cached + uncached)
    output_tokens: int = 0
    cached_input_tokens: int = 0  # prompt tokens served from the provider's context cache (billed cheaper)


@dataclass
class LLMChunk:
    delta: str = ""
    usage: Usage | None = None  # set on the final chunk when the provider reports it
    # Who actually served this stream (set on its first chunk by FallbackProvider), for cost and diagnostics.
    provider: str | None = None
    model: str | None = None


@dataclass
class LLMResponse:
    text: str
    model: str
    usage: Usage
    provider: str | None = None  # the provider that served it, when it wasn't the configured primary


class LLMError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def model_for(self, reasoning: ReasoningLevel) -> str: ...

    @abstractmethod
    def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]: ...

    async def generate(self, request: LLMRequest) -> LLMResponse:
        parts: list[str] = []
        usage = Usage()
        provider: str | None = None
        model = self.model_for(request.reasoning)
        async for chunk in self.stream(request):
            parts.append(chunk.delta)
            if chunk.usage:
                usage = chunk.usage
            if chunk.provider:
                provider, model = chunk.provider, chunk.model or model
        return LLMResponse(text="".join(parts), model=model, usage=usage, provider=provider)

    def supports_vision(self) -> bool:
        return False

    def supports_structured_output(self) -> bool:
        return False

    async def warm(self) -> None:  # noqa: B027 - optional hook
        """Open (or refresh) the connection ahead of a likely request, so the answer doesn't pay for a TLS handshake.
        Cheap, idempotent, never raises."""

    async def aclose(self) -> None:  # noqa: B027 - optional hook
        pass