"""Conflicts inside Orbit's company calendar. External calendar availability is never implied."""
from datetime import datetime, timedelta

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from orbit_api import ratelimit
from orbit_api.business.hiring import aware
from orbit_api.models import BizApplication, BizInterview

booking_writes = ratelimit.SlidingWindow(rate_per_s=30 / 3600, burst=30)


def panel(iv: BizInterview, assigned: list[str]) -> set[str]:
    return set(iv.panel_user_ids if iv.panel_user_ids is not None else assigned or (
        [iv.created_by] if iv.created_by else []))


async def available_slots(db: AsyncSession, iv: BizInterview, assigned: list[str]) -> list[str]:
    if not iv.slots:
        return []
    starts = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in iv.slots]
    newer = aliased(BizInterview)
    superseded = exists(select(newer.id).where(newer.application_id == BizInterview.application_id,
        or_(newer.created_at > BizInterview.created_at,
            and_(newer.created_at == BizInterview.created_at, newer.id > BizInterview.id))))
    rows = (await db.execute(select(BizInterview, BizApplication.interviewers).join(
        BizApplication, BizApplication.id == BizInterview.application_id).where(
            BizInterview.company_id == iv.company_id, BizInterview.application_id != iv.application_id,
            BizApplication.status == "active", BizInterview.chosen.is_not(None),
            BizInterview.chosen >= min(starts) - timedelta(hours=4),
            BizInterview.chosen < max(starts) + timedelta(minutes=iv.duration_min), ~superseded))).all()
    mine = panel(iv, assigned)
    return [raw for raw, start in zip(iv.slots, starts, strict=True) if not any(
        other.chosen is not None and mine.intersection(panel(other, people or []))
        and start < aware(other.chosen) + timedelta(minutes=other.duration_min)
        and start + timedelta(minutes=iv.duration_min) > aware(other.chosen)
        for other, people in rows)]
