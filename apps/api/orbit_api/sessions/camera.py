"""The camera coach in mock interviews (ORBIT_VIDEO_MOCK): the browser measures, on the person's own device, how
much of the time their face was in frame and facing the camera, and how much their head moved. Only those numbers
come here; video, images and face landmarks never leave the device.

They're descriptive, for self-practice: nothing here judges confidence, honesty, emotion, engagement or
employability, and "facing the camera" is head direction, not where the eyes look.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import LiveSessionRow, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])
write_limit = Depends(limit_user("camera-metrics", rate_per_s=0.5, burst=20))
TREND = 6  # sessions shown in the trend, this one included


class CameraMetrics(BaseModel):
    """What the device measured over the time the coach was on."""

    seconds: float = Field(ge=0, le=6 * 3600)
    samples: int = Field(ge=0, le=500_000)
    face_in_frame_pct: float = Field(ge=0, le=100)
    facing_camera_pct: float = Field(ge=0, le=100)  # of the time the face was in frame
    head_movement_deg_s: float = Field(ge=0, le=360)  # average head turning speed, degrees per second


class CameraPoint(BaseModel):
    session_id: str
    at: datetime
    face_in_frame_pct: float
    facing_camera_pct: float
    head_movement_deg_s: float


class CameraOut(BaseModel):
    metrics: CameraMetrics
    trend: list[CameraPoint]  # oldest first, this session last


@router.put("/{session_id}/camera-metrics", status_code=status.HTTP_204_NO_CONTENT, dependencies=[write_limit])
async def save_camera_metrics(session_id: str, body: CameraMetrics, user: Annotated[User, Depends(current_user)],
                              db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    """The session's numbers so far (sent again as they grow; the last ones win)."""
    if not get_settings().video_mock:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The camera coach isn't on for this server.")
    row = await db.get(LiveSessionRow, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if row.type != "mock":
        raise HTTPException(status.HTTP_409_CONFLICT, "The camera coach is for mock interviews.")
    if body.samples == 0:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    row.camera_metrics = {**body.model_dump(), "updated_at": datetime.now(UTC).isoformat()}
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _point(row: LiveSessionRow) -> CameraPoint | None:
    m: dict[str, Any] = row.camera_metrics or {}
    try:
        return CameraPoint(session_id=row.id, at=row.started_at or row.created_at,
                           face_in_frame_pct=m["face_in_frame_pct"], facing_camera_pct=m["facing_camera_pct"],
                           head_movement_deg_s=m["head_movement_deg_s"])
    except (KeyError, TypeError, ValueError):
        return None


async def camera_for(db: AsyncSession, row: LiveSessionRow) -> CameraOut | None:
    """This session's numbers and the trend up to it, or None when the coach wasn't used."""
    if not row.camera_metrics:
        return None
    try:
        metrics = CameraMetrics.model_validate(row.camera_metrics)
    except ValueError:
        return None
    earlier = (await db.scalars(
        select(LiveSessionRow).where(LiveSessionRow.user_id == row.user_id, LiveSessionRow.id != row.id,
                                     LiveSessionRow.camera_metrics.is_not(None),
                                     LiveSessionRow.created_at <= row.created_at)
        .order_by(LiveSessionRow.created_at.desc()).limit(TREND - 1))).all()
    points = [p for r in reversed(earlier) if (p := _point(r))] + [p for p in (_point(row),) if p]
    return CameraOut(metrics=metrics, trend=points)
