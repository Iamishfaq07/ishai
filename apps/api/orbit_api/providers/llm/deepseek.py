"""DeepSeek via its OpenAI-compatible Chat Completions API (server-side only)."""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMProvider, LLMRequest, Usage

# Extra max_tokens for the reasoner's chain-of-thought (a system-design question used ~2.5k).
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

    def supports_structured_output(self) -> bool:
        return True  # json_object response_format

    def _payload(self, request: LLMRequest) -> dict[str, Any]:
        if request.images:
            # The DeepSeek chat API does not accept image input; vision is routed to a vision
            # provider by the caller. Refuse rather than silently dropping the image.
            raise LLMError("vision_unsupported", "DeepSeek provider does not accept images")
        model = self.model_for(request.reasoning)
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            # The reasoner's chain-of-thought counts against max_tokens: with an answer-sized budget it
            # thinks until the cap and returns no content at all (finish_reason=length).
            "max_tokens": request.max_tokens + (REASONING_HEADROOM if model == self._reasoning_model else 0),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if model != self._reasoning_model:  # reasoner ignores sampling params
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
