"""Explicit excerpt sharing. No resume, account identity or private practice is attached implicitly."""
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import CareerEvidenceShare, User
from orbit_api.ratelimit import limit

router = APIRouter(prefix="/v1/career/evidence-shares", tags=["career workspace"])


class ShareIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=160)
    content: str = Field(min_length=40, max_length=20000)
    days: int = Field(default=7, ge=1, le=30)


@router.post("", status_code=201)
async def create(body: ShareIn, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    count = await db.scalar(select(func.count()).select_from(CareerEvidenceShare).where(
        CareerEvidenceShare.user_id == user.id))
    if (count or 0) >= 50:
        raise HTTPException(409, "Remove an older shared excerpt before creating another.")
    token = secrets.token_urlsafe(32)
    row = CareerEvidenceShare(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        title=body.title, content=body.content, expires_at=datetime.now(UTC) + timedelta(days=body.days))
    db.add(row)
    await db.commit()
    return {"id": row.id, "path": f"/v1/career/evidence-shares/view/{token}",
            "expires_at": row.expires_at.isoformat()}


@router.get("")
async def listing(user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> list[dict[str, Any]]:
    return [{"id": r.id, "title": r.title, "expires_at": r.expires_at.isoformat()} for r in await db.scalars(
        select(CareerEvidenceShare).where(CareerEvidenceShare.user_id == user.id)
        .order_by(CareerEvidenceShare.created_at.desc()))]


@router.delete("/{share_id}", status_code=204)
async def revoke(share_id: str, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    row = await db.get(CareerEvidenceShare, share_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Shared excerpt not found")
    await db.delete(row)
    await db.commit()


@router.get("/view/{token}", response_class=HTMLResponse,
            dependencies=[Depends(limit("evidence-share-view", rate_per_s=2, burst=30))])
async def view(token: str, db: Annotated[AsyncSession, Depends(get_db)]) -> HTMLResponse:
    if len(token) != 43:
        raise HTTPException(404, "This link is unavailable")
    row = await db.scalar(select(CareerEvidenceShare).where(
        CareerEvidenceShare.token_hash == hashlib.sha256(token.encode()).hexdigest(),
        CareerEvidenceShare.expires_at > datetime.now(UTC)))
    if row is None:
        raise HTTPException(404, "This link is unavailable or expired")
    return HTMLResponse(f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>{escape(row.title)}</title><body><main><h1>{escape(row.title)}</h1>
<p>Candidate-shared practice work. Authorship, execution and skills have not been independently verified.</p>
<pre style="white-space:pre-wrap;overflow-wrap:anywhere">{escape(row.content)}</pre>
<p>This excerpt expires {escape(row.expires_at.isoformat())}. Links can be revoked; downloaded copies cannot.</p>
</main></body></html>""", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"})
