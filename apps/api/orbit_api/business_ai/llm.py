"""One structured LLM call with the Business AI's limits: a token cap and a timeout per call, one retry (a plain
retry after a transport failure, a repair prompt after an answer that isn't valid JSON for the schema), and then
`AIUnavailable` so the caller can take its deterministic path. Never more than two model calls per function call.

Usage (tokens, estimated cost) is logged per call; nothing here touches the database.
"""

import asyncio
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMMessage, LLMProvider, LLMRequest, Usage
from orbit_api.providers.llm.pricing import estimate_cost

log = logging.getLogger(__name__)

MAX_CALLS = 2  # the first call and one retry/repair
REPAIR_ECHO_CHARS = 6_000  # how much of a broken answer the repair prompt shows back


class AIUnavailable(Exception):
    """The model couldn't give a usable answer within the limits (down, slow, or invalid twice)."""


@dataclass(frozen=True)
class CallLimits:
    max_tokens: int
    timeout_s: float
    temperature: float = 0.2


@dataclass
class CallResult[T]:
    value: T
    model: str
    usage: Usage
    calls: int


def provider() -> LLMProvider:
    """The app's provider (tests monkeypatch this)."""
    return get_llm_provider()


def loads_lenient(text: str) -> Any:
    """The JSON object in a model's answer: code fences, prose around it and trailing commas are tolerated (the
    local half of the repair step; the model is asked again only when this fails)."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in the answer")
    body = t[start:end + 1]
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return json.loads(re.sub(r",\s*([}\]])", r"\1", body))


async def call_json[T](
    system: str,
    user: str,
    parse: Callable[[Any], T],
    *,
    limits: CallLimits,
    request_type: str,
    llm: LLMProvider | None = None,
) -> CallResult[T]:
    """Ask for JSON and turn it into T with `parse` (which raises ValueError/ValidationError on a bad answer)."""
    model_llm = llm or provider()
    messages = [LLMMessage("system", system), LLMMessage("user", user)]
    total = Usage()
    last_error = "no answer"
    for attempt in range(1, MAX_CALLS + 1):
        req = LLMRequest(messages=list(messages), max_tokens=limits.max_tokens, temperature=limits.temperature,
                         json_mode=model_llm.supports_structured_output(), request_type=request_type)
        try:
            resp = await asyncio.wait_for(model_llm.generate(req), timeout=limits.timeout_s)
        except (LLMError, TimeoutError) as e:
            last_error = e.code if isinstance(e, LLMError) else "timeout"
            log.warning("business_ai %s: call %d failed (%s)", request_type, attempt, last_error)
            continue  # a plain retry with the same prompt
        total = Usage(total.input_tokens + resp.usage.input_tokens, total.output_tokens + resp.usage.output_tokens,
                      total.cached_input_tokens + resp.usage.cached_input_tokens)
        try:
            value = parse(loads_lenient(resp.text))
        except (ValueError, ValidationError, TypeError) as e:
            last_error = f"invalid answer: {str(e)[:300]}"
            log.warning("business_ai %s: call %d gave an invalid answer (%s)", request_type, attempt, last_error)
            # The repair step: show the model its answer and what was wrong with it.
            messages = [*messages[:2], LLMMessage("assistant", resp.text[:REPAIR_ECHO_CHARS]), LLMMessage(
                "user", f"That answer can't be used: {str(e)[:500]}\nReturn ONLY the corrected JSON object, "
                        "following every rule above.")]
            continue
        model = resp.model or model_llm.model_for("light")
        cost = estimate_cost(model, total)
        log.info("business_ai %s: ok model=%s calls=%d in=%d out=%d cost_usd=%s", request_type, model, attempt,
                 total.input_tokens, total.output_tokens, cost)
        return CallResult(value=value, model=model, usage=total, calls=attempt)
    raise AIUnavailable(last_error)
