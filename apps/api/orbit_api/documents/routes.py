from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, chunk_document, detect_format, extract_text
from orbit_api.entitlements import plan_for
from orbit_api.models import Document, DocumentChunk, User
from orbit_api.retrieval.embeddings import get_embedder

router = APIRouter(prefix="/v1/documents", tags=["documents"])

DocKind = Literal["resume", "job_description", "notes", "other"]


class DocumentOut(BaseModel):
    id: str
    title: str
    kind: str
    filename: str | None
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime


class TextDocIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    kind: DocKind
    text: str = Field(min_length=20, max_length=200_000)


async def _out(db: AsyncSession, d: Document) -> DocumentOut:
    count = await db.scalar(select(func.count()).select_from(DocumentChunk).where(DocumentChunk.document_id == d.id))
    return DocumentOut(id=d.id, title=d.title, kind=d.kind, filename=d.filename, size_bytes=d.size_bytes,
                       status=d.status, error=d.error, chunk_count=int(count or 0), created_at=d.created_at)


async def _check_quota(db: AsyncSession, user: User) -> None:
    plan = await plan_for(db, user.id)
    if plan.documents is None:
        return
    n = await db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user.id))
    if (n or 0) >= plan.documents:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            f"Your plan allows {plan.documents} documents. Delete one or upgrade.")


async def _ingest(db: AsyncSession, doc: Document, text: str) -> None:
    embedder = get_embedder()
    drafts = chunk_document(text, doc.kind, doc.title)
    for i, c in enumerate(drafts):
        db.add(DocumentChunk(document_id=doc.id, user_id=doc.user_id, ordinal=i, category=c.category,
                             label=c.label, text=c.text, verified=c.verified, embedding=embedder.embed(c.text)))
    doc.status = "ready"
    doc.extracted = {"chunk_categories": sorted({c.category for c in drafts})}


@router.get("", response_model=list[DocumentOut])
async def list_documents(user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> list[DocumentOut]:
    docs = (await db.scalars(select(Document).where(Document.user_id == user.id)
                             .order_by(Document.created_at.desc()))).all()
    return [await _out(db, d) for d in docs]


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File()],
    kind: Annotated[DocKind, Form()],
    title: Annotated[str | None, Form(max_length=300)] = None,
) -> DocumentOut:
    await _check_quota(db, user)
    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Max file size is {limit // 1_048_576} MB.")
    filename = (file.filename or "document").replace("\\", "/").rsplit("/", 1)[-1][:300]
    try:
        fmt = detect_format(filename, file.content_type, data[:8])
        text = extract_text(data, fmt)
    except ParseError as e:
        raise HTTPException(422, str(e)) from e
    # The original bytes are not retained: only extracted text chunks are stored.
    doc = Document(user_id=user.id, title=title or filename, kind=kind, filename=filename,
                   content_type=file.content_type, size_bytes=len(data))
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, text)
    await db.commit()
    return await _out(db, doc)


@router.post("/text", response_model=DocumentOut, status_code=201)
async def create_text_document(body: TextDocIn, user: Annotated[User, Depends(current_user)],
                               db: Annotated[AsyncSession, Depends(get_db)]) -> DocumentOut:
    await _check_quota(db, user)
    doc = Document(user_id=user.id, title=body.title, kind=body.kind, size_bytes=len(body.text.encode()))
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, body.text)
    await db.commit()
    return await _out(db, doc)


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: str, user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    doc = await db.get(Document, doc_id)
    if doc is None or doc.user_id != user.id:  # same 404 for "not yours" — no existence oracle
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    await db.delete(doc)
    await db.commit()
