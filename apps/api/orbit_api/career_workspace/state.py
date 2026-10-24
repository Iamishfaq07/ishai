"""Revision-checked storage for personal tools; no external actions from stored JSON."""
import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.career_workspace.schemas import CONTRACTS
from orbit_api.db import get_db
from orbit_api.models import CareerWorkspaceState, User
from orbit_api.ratelimit import limit_user

router = APIRouter(prefix="/v1/career/workspace", tags=["career workspace"],
                   dependencies=[Depends(limit_user("career-state", rate_per_s=3, burst=30))])
Kind = Literal["readiness", "campus", "priority", "projects", "transition"]


class StateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    data: JsonValue

    @field_validator("data")
    @classmethod
    def bounded(cls, data: JsonValue) -> JsonValue:
        if not isinstance(data, list | dict) or len(json.dumps(data).encode()) > 128_000:
            raise ValueError("Use an object or list containing at most 128 KB.")
        return data


def out(row: CareerWorkspaceState | None) -> dict[str, Any]:
    return {"revision": row.revision if row else 0, "data": row.data if row else None,
            "updated_at": row.updated_at.isoformat() if row else None}


@router.get("/{kind}")
async def read(kind: Kind, user: Annotated[User, Depends(current_user)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return out(await db.get(CareerWorkspaceState, (user.id, kind)))


@router.put("/{kind}")
async def write(kind: Kind, body: StateIn, user: Annotated[User, Depends(current_user)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    try:
        CONTRACTS[kind].validate_python(body.data)
    except ValidationError as e:
        raise HTTPException(422, "Workspace data has invalid fields. Review the values before saving.") from e
    if body.revision == 0:
        row = CareerWorkspaceState(user_id=user.id, kind=kind, data=body.data, revision=1)
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "This workspace changed. Review the account version before saving.") from None
    else:
        changed = await db.scalar(update(CareerWorkspaceState).where(
            CareerWorkspaceState.user_id == user.id, CareerWorkspaceState.kind == kind,
            CareerWorkspaceState.revision == body.revision).values(
                data=body.data, revision=body.revision + 1, updated_at=datetime.now(UTC))
            .returning(CareerWorkspaceState.revision))
        if changed is None:
            raise HTTPException(409, "This workspace changed. Review the account version before saving.")
        await db.commit()
    return out(await db.get(CareerWorkspaceState, (user.id, kind)))
