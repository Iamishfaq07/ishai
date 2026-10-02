"""Saved interview setups: pick one and start, instead of re-selecting documents and preferences every time."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.live.events import AnswerLength, AnswerStyle, SessionType
from orbit_api.models import Document, LiveSessionRow, User, Workspace, WorkspaceDocument

router = APIRouter(prefix="/v1/workspaces", tags=["workspaces"])

MAX_WORKSPACES = 50


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str | None = Field(None, max_length=200)
    role: str | None = Field(None, max_length=300)
    session_type: SessionType = "interview"
    language: str = Field("en", max_length=16)
    answer_language: str | None = Field(None, max_length=16)
    length: AnswerLength = "short"
    style: AnswerStyle = "natural"
    auto_answer: bool = True
    notes: str | None = Field(None, max_length=4000)
    document_ids: list[str] = Field(default_factory=list, max_length=20)

    # Orbit is English only: older clients and saved setups may still send another language, so it's pinned here.
    @field_validator("language")
    @classmethod
    def _english(cls, _: str) -> str:
        return "en"

    @field_validator("answer_language")
    @classmethod
    def _no_answer_language(cls, _: str | None) -> None:
        return None


class WorkspaceOut(WorkspaceIn):
    id: str
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
    session_count: int = 0


async def owned_workspace(db: AsyncSession, workspace_id: str, user: User) -> Workspace:
    ws = await db.get(Workspace, workspace_id)
    if ws is None or ws.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return ws


async def workspace_document_ids(db: AsyncSession, workspace_id: str) -> list[str]:
    return list((await db.scalars(select(WorkspaceDocument.document_id)
                                  .where(WorkspaceDocument.workspace_id == workspace_id))).all())


async def _check_documents(db: AsyncSession, user: User, ids: list[str]) -> list[str]:
    unique = list(dict.fromkeys(ids))
    if unique:
        owned = set((await db.scalars(select(Document.id).where(Document.id.in_(unique),
                                                                Document.user_id == user.id))).all())
        if owned != set(unique):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return unique


def _to_out(ws: Workspace, session_count: int, document_ids: list[str]) -> WorkspaceOut:
    return WorkspaceOut(
        id=ws.id, name=ws.name, company=ws.company, role=ws.role, session_type=ws.session_type,
        language=ws.language, answer_language=ws.answer_language, length=ws.length,
        style=ws.style, auto_answer=ws.auto_answer, notes=ws.notes,
        document_ids=document_ids, created_at=ws.created_at,
        updated_at=ws.updated_at, last_used_at=ws.last_used_at, session_count=session_count,
    )


async def _out(db: AsyncSession, ws: Workspace) -> WorkspaceOut:
    count = await db.scalar(select(func.count()).select_from(LiveSessionRow)
                            .where(LiveSessionRow.workspace_id == ws.id))
    return _to_out(ws, int(count or 0), await workspace_document_ids(db, ws.id))


async def _set_documents(db: AsyncSession, ws: Workspace, ids: list[str]) -> None:
    for link in (await db.scalars(select(WorkspaceDocument).where(WorkspaceDocument.workspace_id == ws.id))).all():
        await db.delete(link)
    await db.flush()
    for doc_id in ids:
        db.add(WorkspaceDocument(workspace_id=ws.id, document_id=doc_id))


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> list[WorkspaceOut]:
    """Most recently used first."""
    rows = (await db.scalars(select(Workspace).where(Workspace.user_id == user.id)
                             .order_by(func.coalesce(Workspace.last_used_at, Workspace.created_at).desc()))).all()
    ids = [ws.id for ws in rows]
    if not ids:
        return []
    # Two grouped queries for the whole list instead of two per setup.
    counts: dict[str, int] = {
        wid: int(n) for wid, n in (await db.execute(
            select(LiveSessionRow.workspace_id, func.count()).where(LiveSessionRow.workspace_id.in_(ids))
            .group_by(LiveSessionRow.workspace_id))).all() if wid is not None
    }
    docs: dict[str, list[str]] = {}
    for wid, did in (await db.execute(select(WorkspaceDocument.workspace_id, WorkspaceDocument.document_id)
                                      .where(WorkspaceDocument.workspace_id.in_(ids)))).all():
        docs.setdefault(wid, []).append(did)
    return [_to_out(ws, counts.get(ws.id, 0), docs.get(ws.id, [])) for ws in rows]


@router.post("", response_model=WorkspaceOut, status_code=201)
async def create_workspace(body: WorkspaceIn, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> WorkspaceOut:
    count = await db.scalar(select(func.count()).select_from(Workspace).where(Workspace.user_id == user.id))
    if (count or 0) >= MAX_WORKSPACES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_WORKSPACES} saved setups.")
    docs = await _check_documents(db, user, body.document_ids)
    ws = Workspace(user_id=user.id, **body.model_dump(exclude={"document_ids"}))
    db.add(ws)
    await db.flush()
    await _set_documents(db, ws, docs)
    await db.commit()
    return await _out(db, ws)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(workspace_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> WorkspaceOut:
    return await _out(db, await owned_workspace(db, workspace_id, user))


@router.put("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(workspace_id: str, body: WorkspaceIn, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> WorkspaceOut:
    ws = await owned_workspace(db, workspace_id, user)
    docs = await _check_documents(db, user, body.document_ids)
    for key, value in body.model_dump(exclude={"document_ids"}).items():
        setattr(ws, key, value)
    await _set_documents(db, ws, docs)
    await db.commit()
    await db.refresh(ws)
    return await _out(db, ws)


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(workspace_id: str, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """Sessions started from it are kept (their link becomes empty); documents are not touched."""
    ws = await owned_workspace(db, workspace_id, user)
    # Explicit (the FK is ON DELETE SET NULL, but SQLite only honours it with foreign_keys enabled).
    await db.execute(update(LiveSessionRow).where(LiveSessionRow.workspace_id == ws.id).values(workspace_id=None))
    await db.delete(ws)
    await db.commit()
