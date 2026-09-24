"""Any OpenAI-compatible Chat Completions API (OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq, Together…),
used as Orbit's backup LLM. Server-side only; configured with ORBIT_FALLBACK_LLM_* (see config.py).

`stream_chat_completions` is the shared SSE reader: DeepSeek's provider uses it too, so both parse streams,
usage and errors identically.
"""

import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest, Usage


async def stream_chat_completions(client: httpx.AsyncClient, payload: dict[str, Any], label: str,
                                  cached_tokens_key: str = "prompt_cache_hit_tokens") -> AsyncIterator[LLMChunk]:
    """POST /chat/completions with stream=true and yield text deltas + the final usage. Errors become LLMError:
    429/5xx/timeouts/network are retryable; the provider's body is kept for server logs only."""
    try:
        async with client.stream("POST", "/chat/completions", json=payload) as resp:
            if resp.status_code != 200:
                body = (await resp.aread())[:500].decode(errors="replace")
                retryable = resp.status_code in (429, 500, 502, 503, 504)
                code = "rate_limited" if resp.status_code == 429 else f"http_{resp.status_code}"
                raise LLMError(code, f"{label} returned {resp.status_code}: {body}", retryable=retryable)
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
                    cached = u.get(cached_tokens_key)
                    if cached is None:  # OpenAI's shape
                        cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens")
                    usage = Usage(u.get("prompt_tokens") or 0, u.get("completion_tokens") or 0,
                                  cached_input_tokens=cached or 0)
                delta = ""
                choices = obj.get("choices") or []
                if choices:
                    # `reasoning_content` (chain-of-thought) is deliberately not surfaced.
                    delta = (choices[0].get("delta") or {}).get("content") or ""
                if delta or usage:
                    yield LLMChunk(delta=delta, usage=usage)
    except httpx.TimeoutException as e:
        raise LLMError("timeout", f"{label} request timed out", retryable=True) from e
    except httpx.TransportError as e:
        raise LLMError("network", f"{label} network error: {e}", retryable=True) from e


def chat_messages(request: LLMRequest) -> list[dict[str, Any]]:
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


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, name: str, api_key: str, base_url: str, model: str, *, vision: bool = False,
                 extra: dict[str, Any] | None = None, client: httpx.AsyncClient | None = None) -> None:
        self.name = name
        self._model = model
        self._vision = vision
        # Provider-specific request fields merged into every payload, e.g. {"reasoning_effort": "low"} for
        # OpenAI o-series / Gemini thinking models, {"thinking": {"type": "disabled"}} for DeepSeek: a model that
        # "thinks" by default otherwise spends the answer's token budget before writing a word.
        self._extra = dict(extra or {})
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0),
            limits=httpx.Limits(max_keepalive_connections=10, keepalive_expiry=120),
        )

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return self._model

    def supports_vision(self) -> bool:
        return self._vision

    def supports_structured_output(self) -> bool:
        return True

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        if request.images and not self._vision:
            raise LLMError("vision_unsupported", f"{self._model} is not configured for images")
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": chat_messages(request),
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if request.json_mode:
            payload["response_format"] = {"type": "json_object"}
        payload.update(self._extra)
        return stream_chat_completions(self._client, payload, self.name, cached_tokens_key="cached_tokens")

    async def aclose(self) -> None:
        await self._client.aclose()
