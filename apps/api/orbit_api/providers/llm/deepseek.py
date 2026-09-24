"""DeepSeek via its OpenAI-compatible Chat Completions API (server-side only)."""

from collections.abc import AsyncIterator
from typing import Any

import httpx

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest
from orbit_api.providers.llm.openai_compat import chat_messages, stream_chat_completions

# Models that accept image input (DeepSeek-V4.1-Flash reports input_modalities ["text", "image"]).
VISION_MODELS = frozenset({"deepseek-flash"})

# Extra max_tokens for chain-of-thought, which counts against max_tokens (max effort used ~1.6k tokens on a
# multi-part design question; the old reasoner ~2.5k).
REASONING_HEADROOM = 4000


class DeepSeekProvider(LLMProvider):
    name = "deepseek"

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        reasoning_model: str,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._model = model
        self._reasoning_model = reasoning_model
        # One pooled HTTP/1.1 keep-alive client: saves a TLS handshake on every answer.
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0),
            limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=120),
        )

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return self._reasoning_model if reasoning == "deep" else self._model

    def supports_vision(self) -> bool:
        return self._model in VISION_MODELS

    def supports_structured_output(self) -> bool:
        return True  # json_object response_format

    def _payload(self, request: LLMRequest) -> dict[str, Any]:
        model = self.model_for(request.reasoning)
        if request.images and model not in VISION_MODELS:
            # Refuse rather than silently dropping the image (spec §62: never fake vision).
            raise LLMError("vision_unsupported", f"{model} does not accept images")
        thinking = request.thinking if request.thinking != "off" else ("high" if request.reasoning == "deep" else None)
        payload: dict[str, Any] = {
            "model": model,
            "messages": chat_messages(request),
            # Chain-of-thought counts against max_tokens: with an answer-sized budget the model thinks until
            # the cap and returns no content at all (finish_reason=length).
            "max_tokens": request.max_tokens + (REASONING_HEADROOM if thinking else 0),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if thinking:
            payload["reasoning_effort"] = thinking  # sampling params are ignored while thinking
        else:
            # V4 models think by DEFAULT — always switch it off explicitly, or every summary/report/answer
            # silently waits ~5 s on hidden reasoning.
            payload["thinking"] = {"type": "disabled"}
            payload["temperature"] = request.temperature
        if request.json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        return stream_chat_completions(self._client, self._payload(request), "DeepSeek")

    async def aclose(self) -> None:
        await self._client.aclose()
