"""Opt-in comparison of lexical and neural ordering, using only already eligible feed matches."""
import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.routes import _country, _data, _matches, _profile, _search
from orbit_api.models import JobListing, User
from orbit_api.ratelimit import limit_user
from orbit_api.retrieval.embeddings import Embedder, cosine, get_embedder

router = APIRouter(prefix="/v1/jobs/semantic-preview", tags=["jobs"],
    dependencies=[Depends(limit_user("semantic-preview", rate_per_s=1 / 20, burst=3))])


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    goal: str = Field(min_length=10, max_length=1000)


def rerank(embedder: Embedder, goal: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reciprocal-rank fusion avoids presenting cosine as a calibrated match probability."""
    query = embedder.embed_query(goal)
    neural = sorted(candidates, key=lambda row: -cosine(query, embedder.embed(row["text"])))
    positions = {row["id"]: rank + 1 for rank, row in enumerate(neural)}
    return sorted(candidates, key=lambda row: -(1 / (60 + row["baseline_rank"]) + 1 / (60 + positions[row["id"]])))


@router.get("")
async def availability(user: Annotated[User, Depends(current_user)]) -> dict[str, Any]:
    embedder = get_embedder()
    return {"available": embedder.ready and not embedder.model_id.startswith("hash"), "model": embedder.model_id}


@router.post("")
async def compare(body: PreviewIn, request: Request, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    embedder = get_embedder()
    if not embedder.ready or embedder.model_id.startswith("hash"):
        raise HTTPException(503, "Semantic comparison needs the configured neural model to be ready.")
    _, prefs, resume = await _profile(db, user)
    search, _ = _search(prefs, "", _country(user, request))
    baseline = (await _matches(db, user, search, _data(resume), "best"))[:40]
    rows = {r.id: r for r in await db.scalars(select(JobListing).where(JobListing.id.in_([m.id for m in baseline])))}
    candidates = [{"id": m.id, "title": rows[m.id].title, "company": rows[m.id].company,
                   "baseline_rank": i + 1, "text": f"{rows[m.id].title}\n{rows[m.id].description[:4000]}"}
                  for i, m in enumerate(baseline) if m.id in rows]
    ordered = await asyncio.to_thread(rerank, embedder, body.goal, candidates) if candidates else []
    return {"model": embedder.model_id, "candidate_count": len(candidates),
            "scope": "Reorders up to 40 matches from your saved search profile. All existing feed filters apply. "
                     "This experiment does not broaden recall or predict hiring. Search-box overrides do not apply.",
            "results": [{k: v for k, v in row.items() if k != "text"} for row in ordered[:10]]}
