"""DeepSeek via its OpenAI-compatible Chat Completions API (server-side only)."""

import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest, Usage

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
            "messages": _messages(request),
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

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        payload = self._payload(request)
        try:
            async with self._client.stream("POST", "/chat/completions", json=payload) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread())[:500].decode(errors="replace")
                    retryable = resp.status_code in (429, 500, 502, 503, 504)
                    code = "rate_limited" if resp.status_code == 429 else f"http_{resp.status_code}"
                    raise LLMError(code, f"DeepSeek returned {resp.status_code}: {body}", retryable=retryable)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    usage = None
                    if obj.get("usage"):
                        u = obj["usage"]
                        usage = Usage(u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                    delta = ""
                    choices = obj.get("choices") or []
                    if choices:
                        # `reasoning_content` (reasoner chain-of-thought) is deliberately not surfaced.
                        delta = (choices[0].get("delta") or {}).get("content") or ""
                    if delta or usage:
                        yield LLMChunk(delta=delta, usage=usage)
        except httpx.TimeoutException as e:
            raise LLMError("timeout", "DeepSeek request timed out", retryable=True) from e
        except httpx.TransportError as e:
            raise LLMError("network", f"DeepSeek network error: {e}", retryable=True) from e

    async def aclose(self) -> None:
        await self._client.aclose()


def _messages(request: LLMRequest) -> list[dict[str, Any]]:
    """Chat messages; images ride on the last user message as OpenAI-style content parts."""
    msgs: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in request.messages]
    if request.images:
        last_user = max(i for i, m in enumerate(msgs) if m["role"] == "user")
        parts: list[dict[str, Any]] = [{"type": "text", "text": msgs[last_user]["content"]}]
        for img in request.images:
            data = base64.b64encode(img.data).decode("ascii")
            parts.append({"type": "image_url", "image_url": {"url": f"data:{img.media_type};base64,{data}"}})
        msgs[last_user] = {"role": "user", "content": parts}
    return msgs
