"""GET /v1/region: the country a visitor's request came from, so signed-out pages can word things for where they are
(the same country the prices follow, billing/pricing.py). The web app's edge (Cloudflare) states it on the proxied
request, and it's believed only with the proxy secret; null when the edge didn't say or can't be believed. Public and
stateless: nothing is stored and no cookie is set (the web app asks once per page load)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from orbit_api.billing.pricing import request_country

router = APIRouter(prefix="/v1", tags=["region"])


class RegionOut(BaseModel):
    # ISO 3166-1 alpha-2 ("US"), or None when unknown.
    country: str | None


@router.get("/region", response_model=RegionOut)
async def visitor_region(request: Request) -> RegionOut:
    return RegionOut(country=request_country(request))
