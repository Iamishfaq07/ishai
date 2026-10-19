"""Bounded, persisted AI preview calls. Reservations survive failures and concurrent requests."""
import asyncio
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.career.service import BOUNDARY
from orbit_api.live.context_builder import fence
from orbit_api.models import ProviderRequest, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMMessage, LLMRequest
from orbit_api.providers.llm.pricing import estimate_cost
from orbit_api.transactions import lock_account


async def preview[T: BaseModel](db: AsyncSession, user: User, kind: str, instruction: str,
                               evidence: str, validate: Callable[[object], T],
                               company_id: str | None = None) -> tuple[T, str]:
    # Caller checks resource permissions before reserving. A company caller holds its company lock too.
    await lock_account(db, user.id)
    scope = ProviderRequest.company_id == company_id if company_id else ProviderRequest.user_id == user.id
    count = await db.scalar(select(func.count()).select_from(ProviderRequest).where(
        scope, ProviderRequest.request_type == kind,
        ProviderRequest.created_at >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)))
    if (count or 0) >= (10 if company_id else 5):
        raise HTTPException(429, "Today's AI preview allowance is used. It resets at midnight UTC.")
    record = ProviderRequest(user_id=user.id, company_id=company_id, provider="pending", model="pending",
                             request_type=kind, ok=False)
    db.add(record)
    await db.commit()  # Release database locks before network I/O, but keep the durable quota reservation.
    start = time.perf_counter()
    try:
        llm = get_llm_provider()
        record.provider = llm.name
        response = await asyncio.wait_for(llm.generate(LLMRequest(
            messages=[LLMMessage("system", BOUNDARY + instruction), LLMMessage("user",
                '<reference_data source="workflow">\n' + fence(evidence) + '\n</reference_data>')],
            request_type=kind, max_tokens=3000, json_mode=llm.supports_structured_output(), temperature=0.2)), 60)
        record.provider, record.model = response.provider or llm.name, response.model
        record.input_tokens, record.output_tokens = response.usage.input_tokens, response.usage.output_tokens
        record.cached_input_tokens = response.usage.cached_input_tokens
        record.estimated_cost_usd = estimate_cost(response.model, response.usage)
        raw = response.text[response.text.find("{"):response.text.rfind("}") + 1]
        result = validate(json.loads(raw))
        record.ok = True
    except (LLMError, TimeoutError, RuntimeError) as exc:
        raise HTTPException(503, "AI is unavailable. Your saved work is unchanged; you can continue manually.") from exc
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(502, "The AI draft did not pass validation. Your saved work is unchanged.") from exc
    finally:
        record.latency_ms = int((time.perf_counter() - start) * 1000)
        await db.commit()
    return result, record.provider
