"""Orbit Direct: jobs companies post on Orbit for Business (orbit-business-plan.md, Phase 1). Applying to one is a
row in Orbit's own database, submitted by the server at once, with no browser and no pacing. The site is Orbit's own,
and the candidate is an Orbit user who consented.

This is the seam. Orbit for Business (its jobs and applications) is being built separately, and until it lands no
listing has source "orbit", so `apply_direct` is never reached with a real job. When it lands, `apply_direct` creates
the Business application from the packet (resume, cover letter, answers, "Applied via Orbit" label) and returns
the result. The planner and the tracker already handle that result like an executor's `submitted`.
"""

from __future__ import annotations

from dataclasses import dataclass

from orbit_api.models import ApplicationPacket


@dataclass(frozen=True)
class DirectResult:
    status: str  # submitted | failed
    confirmation_text: str | None = None
    reason: str | None = None


async def apply_direct(packet: ApplicationPacket) -> DirectResult | None:
    """Submit an Orbit Direct packet. None: Orbit Direct isn't available yet, so the packet waits as prepared."""
    return None
