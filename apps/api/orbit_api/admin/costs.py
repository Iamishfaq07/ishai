"""Admin cost dashboard (launch brief §40): what the AI and transcription providers cost, per hour of live use, per
session, per user and per plan.

Honesty rules:
- An LLM call whose model has no configured price is counted as **unpriced**, never as $0. Totals say how many
  calls they leave out.
- Speech-to-text cost is minutes × ORBIT_STT_PRICE_PER_MINUTE: an estimate from a list price, labelled as such.
- Everything is computed from `provider_requests` and `usage` rows; no content is read.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.entitlements import plan_for
from orbit_api.models import LiveSessionRow, ProviderRequest, UsageEvent, User
from orbit_api.providers.llm.base import Usage
from orbit_api.providers.llm.pricing import estimate_cost


def _usd(x: float) -> float:
    return round(x, 4)


async def cost_report(db: AsyncSession, days: int) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(days=days)
    reqs = (await db.scalars(select(ProviderRequest).where(ProviderRequest.created_at >= since))).all()
    usage = (await db.scalars(select(UsageEvent).where(
        UsageEvent.created_at >= since,
        UsageEvent.metric.in_(("live_seconds", "mock_seconds", "stt_seconds", "screenshots"))))).all()
    sessions = (await db.scalar(select(LiveSessionRow.id).where(LiveSessionRow.created_at >= since).limit(1)))

    stt_price = get_settings().stt_price_per_minute
    backup = get_settings().fallback_llm_name  # the name backup-served calls are recorded under

    by_model: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"requests": 0, "input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "usd": 0.0,
                 "unpriced": 0, "failed": 0})
    by_type: dict[str, dict[str, Any]] = defaultdict(lambda: {"requests": 0, "usd": 0.0, "unpriced": 0})
    user_llm: dict[str, float] = defaultdict(float)
    session_llm: dict[str, float] = defaultdict(float)
    total_in = total_cached = 0
    answers = answer_in = answer_out = 0
    fallback_requests = 0
    # What the provider's prompt cache saved: each priced call costed again as if no token had been a cache hit.
    cache_saved = 0.0
    for r in reqs:
        m = by_model[(r.provider, r.model)]
        m["requests"] += 1
        m["input_tokens"] += r.input_tokens
        m["cached_input_tokens"] += r.cached_input_tokens
        m["output_tokens"] += r.output_tokens
        m["failed"] += 0 if r.ok else 1
        t = by_type[r.request_type]
        t["requests"] += 1
        if r.estimated_cost_usd is None:
            m["unpriced"] += 1
            t["unpriced"] += 1
        else:
            m["usd"] += r.estimated_cost_usd
            t["usd"] += r.estimated_cost_usd
            if r.user_id:
                user_llm[r.user_id] += r.estimated_cost_usd
            if r.session_id:
                session_llm[r.session_id] += r.estimated_cost_usd
            if r.cached_input_tokens:
                uncached = estimate_cost(r.model, Usage(input_tokens=r.input_tokens, output_tokens=r.output_tokens),
                                         at=r.created_at)
                if uncached is not None:
                    cache_saved += max(0.0, uncached - r.estimated_cost_usd)
        total_in += r.input_tokens
        total_cached += r.cached_input_tokens
        if r.request_type in ("answer", "chat", "vision") and r.ok:
            answers += 1
            answer_in += r.input_tokens
            answer_out += r.output_tokens
        if r.provider == backup:
            fallback_requests += 1

    live_s = sum(u.quantity for u in usage if u.metric in ("live_seconds", "mock_seconds"))
    stt_s = sum(u.quantity for u in usage if u.metric == "stt_seconds")
    screenshots = int(sum(u.quantity for u in usage if u.metric == "screenshots"))
    stt_minutes = stt_s / 60
    stt_usd = stt_minutes * stt_price if stt_price is not None else None
    user_stt: dict[str, float] = defaultdict(float)
    session_ids: set[str] = set()
    for u in usage:
        if u.metric == "stt_seconds" and stt_price is not None:
            user_stt[u.user_id] += u.quantity / 60 * stt_price
        if u.metric in ("live_seconds", "mock_seconds") and u.session_id:
            session_ids.add(u.session_id)

    llm_usd = sum(m["usd"] for m in by_model.values())
    unpriced = sum(m["unpriced"] for m in by_model.values())
    live_hours = live_s / 3600
    session_llm_usd = sum(v for k, v in session_llm.items() if k in session_ids)
    live_total = session_llm_usd + (stt_usd or 0.0)

    per_user: list[dict[str, Any]] = []
    for uid in set(user_llm) | set(user_stt):
        user = await db.get(User, uid)
        total = user_llm.get(uid, 0.0) + user_stt.get(uid, 0.0)
        per_user.append({"user_id": uid, "email": user.email if user else None,
                         "plan": (await plan_for(db, uid)).name if user else None,
                         "llm_usd": _usd(user_llm.get(uid, 0.0)), "stt_usd": _usd(user_stt.get(uid, 0.0)),
                         "usd": _usd(total)})
    per_user.sort(key=lambda row: float(row["usd"]), reverse=True)
    per_plan: dict[str, dict[str, Any]] = defaultdict(lambda: {"users": 0, "usd": 0.0})
    for row in per_user:
        plan = per_plan[row["plan"] or "unknown"]
        plan["users"] += 1
        plan["usd"] = _usd(plan["usd"] + row["usd"])

    return {
        "days": days,
        "has_data": bool(reqs or usage or sessions),
        "totals": {
            "usd": _usd(llm_usd + (stt_usd or 0.0)), "llm_usd": _usd(llm_usd),
            "stt_usd": None if stt_usd is None else _usd(stt_usd),
            "vision_usd": _usd(by_type["vision"]["usd"]) if "vision" in by_type else 0.0,
            "unpriced_llm_requests": unpriced,
        },
        "live": {
            "hours": round(live_hours, 2), "sessions": len(session_ids), "stt_minutes": round(stt_minutes, 1),
            "usd_per_hour": _usd(live_total / live_hours) if live_hours else None,
            "usd_per_session": _usd(live_total / len(session_ids)) if session_ids else None,
            "screenshots": screenshots,
        },
        "llm": {
            "requests": len(reqs),
            "cache_hit_ratio": round(total_cached / total_in, 3) if total_in else None,
            "cache_saved_usd": _usd(cache_saved),
            "tokens_per_answer": {"input": round(answer_in / answers) if answers else None,
                                  "output": round(answer_out / answers) if answers else None},
            "fallback_requests": fallback_requests,
            "by_model": [{"provider": p, "model": mdl, **{k: (_usd(v) if k == "usd" else v) for k, v in s.items()}}
                         for (p, mdl), s in sorted(by_model.items(), key=lambda kv: -kv[1]["usd"])],
            "by_type": {k: {**v, "usd": _usd(v["usd"])} for k, v in sorted(by_type.items())},
        },
        "per_user": per_user[:20],
        "per_plan": dict(per_plan),
        "notes": {
            "stt_price_per_minute": stt_price,
            "stt": "Speech-to-text cost = minutes × ORBIT_STT_PRICE_PER_MINUTE (an estimate from a list price).",
            "unpriced": "Calls to models without a configured price are counted here, not as $0. Add prices with "
                        "ORBIT_LLM_PRICING_JSON.",
        },
    }
