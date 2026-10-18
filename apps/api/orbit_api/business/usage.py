"""Business AI calls, stored per company in provider_requests (company_id), with their estimated cost: the counts a
plan's AI allowance will be checked against later (D82). business_ai is a pure module and records nothing itself;
ai_port.recording() collects what it called."""

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business.ai_port import UsageRecord
from orbit_api.models import ProviderRequest
from orbit_api.providers.llm.base import Usage
from orbit_api.providers.llm.pricing import estimate_cost


def store(db: AsyncSession, company_id: str, user_id: str | None, calls: list[UsageRecord]) -> None:
    for c in calls:
        usage = Usage(c.input_tokens, c.output_tokens, c.cached_input_tokens)
        db.add(ProviderRequest(user_id=user_id, company_id=company_id, provider=c.provider, model=c.model or "unknown",
                               request_type=c.request_type, input_tokens=c.input_tokens,
                               output_tokens=c.output_tokens, cached_input_tokens=c.cached_input_tokens,
                               latency_ms=c.latency_ms, ok=c.ok,
                               estimated_cost_usd=estimate_cost(c.model, usage) if c.ok and c.model else None))
