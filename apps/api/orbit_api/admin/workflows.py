"""Operator visibility and explicit, audited replay of recoverable background workflows."""
import re
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs
from orbit_api.admin.routes import require_admin
from orbit_api.db import get_db
from orbit_api.models import AuditLog, Job, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/admin/workflows", tags=["admin workflows"])
# Tailoring can consume credits and requires its own candidate-facing recovery flow; do not replay it here.
REPLAYABLE = frozenset({"report", "biz_indexing"})
Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[User, Depends(require_admin)]


def stamp(value: datetime) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()


@router.get("")
async def overview(_: Admin, db: Db) -> dict[str, Any]:
    now = datetime.now(UTC)
    counts: dict[str, int] = {status: count for status, count in (
        await db.execute(select(Job.status, func.count()).group_by(Job.status))).all()}
    due = await db.scalar(select(func.count()).select_from(Job).where(Job.status == "queued", Job.run_after <= now))
    expired = await db.scalar(select(func.count()).select_from(Job).where(jobs.expired(now)))
    oldest = await db.scalar(select(func.min(Job.run_after)).where(Job.status == "queued", Job.run_after <= now))
    failed = (await db.execute(select(Job.id, Job.kind, Job.attempts, Job.updated_at, Job.last_error)
        .where(Job.status == "failed").order_by(Job.updated_at.desc(), Job.id).limit(26))).all()
    records = []
    for row in failed[:25]:
        category = (row.last_error or "").partition(":")[0]
        records.append({"id": row.id, "kind": row.kind, "attempts": row.attempts,
            "updated_at": stamp(row.updated_at),
            "error_type": category if re.fullmatch(r"[A-Za-z][A-Za-z0-9_.]{0,60}", category) else "WorkflowError",
            "can_retry": row.kind in REPLAYABLE and row.kind in jobs._handlers})
    return {"counts": counts, "due": due or 0, "expired_leases": expired or 0,
            "oldest_due_at": stamp(oldest) if oldest else None, "failed": records, "truncated": len(failed) > 25}


class RetryIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    updated_at: AwareDatetime
    reason: str = Field(min_length=10, max_length=300)


@router.post("/{job_id}/retry", dependencies=[Depends(limit_user("admin-workflow-retry", 1 / 60, 5))])
async def retry(job_id: str, body: RetryIn, admin: Admin, db: Db) -> dict[str, str]:
    kind = await db.scalar(select(Job.kind).where(Job.id == job_id))
    if kind is None:
        raise HTTPException(404, "Workflow not found.")
    if kind not in REPLAYABLE or kind not in jobs._handlers:
        raise HTTPException(409, "This workflow requires recovery through its original product flow.")
    changed = await db.scalar(update(Job).where(Job.id == job_id, Job.kind == kind, Job.status == "failed",
        Job.updated_at == body.updated_at, Job.lease_token.is_(None)).values(status="queued", attempts=0,
        last_error=None, run_after=datetime.now(UTC), rerun_requested=False, lease_until=None).returning(Job.id))
    if changed is None:
        raise HTTPException(409, "This workflow changed. Refresh its current status before retrying.")
    db.add(AuditLog(user_id=admin.id, action="admin.workflow_retry", target=f"{job_id} {kind}: {body.reason}"))
    await db.commit()
    return {"id": job_id, "status": "queued"}
