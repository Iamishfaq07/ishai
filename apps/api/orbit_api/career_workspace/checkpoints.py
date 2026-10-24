"""Explicit saved-plan checkpoints using existing account-owned workspace storage."""
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.career_workspace.schemas import Transition
from orbit_api.db import get_db
from orbit_api.models import CareerWorkspaceState, User

router = APIRouter(prefix="/v1/career/transition/checkpoints", tags=["career workspace"])
KIND = "transition_checkpoints"


class CheckpointIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    revision: int = Field(ge=1)
    note: str = Field(min_length=3, max_length=500)


async def store(db: AsyncSession, user_id: str, row: CareerWorkspaceState | None,
                data: list[dict[str, Any]]) -> None:
    if row is None:
        db.add(CareerWorkspaceState(user_id=user_id, kind=KIND, revision=1, data=data))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "Checkpoint history changed. Refresh and try again.") from None
    else:
        changed = await db.scalar(update(CareerWorkspaceState).where(CareerWorkspaceState.user_id == user_id,
            CareerWorkspaceState.kind == KIND, CareerWorkspaceState.revision == row.revision)
            .values(data=data, revision=row.revision + 1, updated_at=datetime.now(UTC))
            .returning(CareerWorkspaceState.revision))
        if changed is None:
            raise HTTPException(409, "Checkpoint history changed. Refresh and try again.")
        await db.commit()


@router.get("")
async def listing(user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> list[dict[str, Any]]:
    row = await db.get(CareerWorkspaceState, (user.id, KIND))
    return list(row.data) if row else []


@router.post("", status_code=201)
async def capture(body: CheckpointIn, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    plan = await db.scalar(select(CareerWorkspaceState).where(CareerWorkspaceState.user_id == user.id,
        CareerWorkspaceState.kind == "transition").with_for_update())
    if plan is None or plan.revision != body.revision:
        raise HTTPException(409, "Save and load the latest plan before creating a checkpoint.")
    validated = Transition.model_validate(plan.data)
    row = await db.get(CareerWorkspaceState, (user.id, KIND))
    history = list(row.data) if row else []
    if len(history) >= 10:
        raise HTTPException(409, "Keep up to 10 checkpoints. Download and remove an older one first.")
    if any(item["revision"] == body.revision for item in history):
        raise HTTPException(409, "This saved revision already has a checkpoint.")
    checkpoint = {"id": str(uuid.uuid4()), "revision": body.revision, "note": body.note.strip(),
                  "created_at": datetime.now(UTC).isoformat(), "plan": validated.model_dump()}
    await store(db, user.id, row, [checkpoint, *history])
    return checkpoint


@router.delete("/{checkpoint_id}", status_code=204)
async def remove(checkpoint_id: str, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    row = await db.get(CareerWorkspaceState, (user.id, KIND))
    data = [item for item in row.data if item["id"] != checkpoint_id] if row else []
    if row is None or len(data) == len(row.data):
        raise HTTPException(404, "Checkpoint not found")
    await store(db, user.id, row, data)
