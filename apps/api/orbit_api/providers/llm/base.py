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


@dataclass
class Usage:
    input_tokens: int = 0  # all prompt tokens (cached + uncached)
    output_tokens: int = 0
    cached_input_tokens: int = 0  # prompt tokens served from the provider's context cache (billed cheaper)


@dataclass
class LLMChunk:
    delta: str = ""
    usage: Usage | None = None  # set on the final chunk when the provider reports it


@dataclass
class LLMResponse:
    text: str
    model: str
    usage: Usage


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
        async for chunk in self.stream(request):
            parts.append(chunk.delta)
            if chunk.usage:
                usage = chunk.usage
        return LLMResponse(text="".join(parts), model=self.model_for(request.reasoning), usage=usage)

    def supports_vision(self) -> bool:
        return False

    def supports_structured_output(self) -> bool:
        return False

    async def aclose(self) -> None:  # noqa: B027 - optional hook
        pass