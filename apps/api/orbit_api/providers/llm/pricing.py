"""Internal LLM cost estimates (never shown to users). Config-driven: the defaults below are DeepSeek's list
prices (api-docs.deepseek.com/quick_start/pricing, checked 2026-09-24); override or extend them with
ORBIT_LLM_PRICING_JSON, e.g. {"my-model": {"cache_hit": 0.01, "cache_miss": 0.5, "output": 2.0}}.

A model with no price is reported as cost-unknown (None + a warning), never as $0, so a renamed or newly
configured paid model can't silently read as free in the cost dashboards.
"""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache

from orbit_api.providers.llm.base import Usage

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelPrice:
    """USD per 1M tokens at the PEAK rate. `offpeak_factor` scales it outside the peak windows."""

    cache_hit: float
    cache_miss: float
    output: float
    offpeak_factor: float = 1.0
    deepseek_peak: bool = False  # peak windows are DeepSeek's (Mon–Fri 01–04 & 06–10 UTC)


_FLASH = ModelPrice(cache_hit=0.006, cache_miss=0.30, output=1.20, offpeak_factor=0.5, deepseek_peak=True)
DEFAULT_PRICES: dict[str, ModelPrice] = {
    "deepseek-flash": _FLASH,
    # Legacy names are now aliases of V4.1-Flash on DeepSeek's side and bill the same.
    "deepseek-chat": _FLASH,
    "deepseek-reasoner": _FLASH,
    "deepseek-v4-pro": ModelPrice(cache_hit=0.044, cache_miss=1.32, output=3.96, offpeak_factor=0.5,
                                  deepseek_peak=True),
    "mock": ModelPrice(0.0, 0.0, 0.0),
}


def is_deepseek_peak(at: datetime) -> bool:
    """DeepSeek peak: Mon–Fri 01:00–04:00 and 06:00–10:00 UTC. Chinese public holidays (off-peak) aren't
    modelled, so estimates err slightly high on those days, never low."""
    at = at.astimezone(UTC)
    return at.weekday() < 5 and (1 <= at.hour < 4 or 6 <= at.hour < 10)


@lru_cache
def price_table() -> dict[str, ModelPrice]:
    from orbit_api.config import get_settings

    table = dict(DEFAULT_PRICES)
    raw = get_settings().llm_pricing_json
    if raw:
        for model, p in json.loads(raw).items():
            table[model] = ModelPrice(
                cache_hit=float(p.get("cache_hit", p["cache_miss"])), cache_miss=float(p["cache_miss"]),
                output=float(p["output"]), offpeak_factor=float(p.get("offpeak_factor", 1.0)),
                deepseek_peak=bool(p.get("deepseek_peak", False)),
            )
    return table


_warned: set[str] = set()


def estimate_cost(model: str, usage: Usage, at: datetime | None = None) -> float | None:
    """Estimated USD for one request, or None when the model has no configured price."""
    price = price_table().get(model)
    if price is None:
        if model not in _warned:
            _warned.add(model)
            log.warning("no price configured for LLM model %r: cost recorded as unknown "
                        "(add it to ORBIT_LLM_PRICING_JSON)", model)
        return None
    factor = 1.0
    if price.offpeak_factor != 1.0 and not (price.deepseek_peak and is_deepseek_peak(at or datetime.now(UTC))):
        factor = price.offpeak_factor
    hit = min(usage.cached_input_tokens, usage.input_tokens)
    miss = usage.input_tokens - hit
    usd = (hit * price.cache_hit + miss * price.cache_miss + usage.output_tokens * price.output) / 1_000_000
    return round(usd * factor, 8)
