"""Email-bearing job discovery, reviewed source intake and tailored Gmail drafts."""

import asyncio
import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.auto_apply.letters import template_letter
from orbit_api.auto_apply.setup import Facts
from orbit_api.auto_apply.tailor import tailor
from orbit_api.db import get_db
from orbit_api.gmail.delivery import ApplicationEmail, ResumeAttachment, compose
from orbit_api.gmail.routes import require_config, save_draft
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import Document, GmailConnection, JobListing, ProviderRequest, Resume, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMRequest, LLMResponse
from orbit_api.resumes.docx_export import resume_docx
from orbit_api.resumes.schema import ResumeData, ResumeDesign
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/gmail/jobs", tags=["gmail"])
EMAIL = re.compile(
    r"(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}(?![\w-])", re.I
)


def recipients(text: str) -> list[dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for match in EMAIL.finditer(text):
        raw = match[0]
        try:
            address = str(
                ApplicationEmail(recipient=raw, subject="Validate address", body="Email validation only.").recipient
            )
        except ValueError:
            continue
        found.setdefault(
            address.lower(), {"email": address, "quote": text[max(0, match.start() - 100) : match.end() + 100]}
        )
        if len(found) >= 10:
            break
    return list(found.values())


class PostIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=50, max_length=20000)


class ImportIn(PostIn):
    title: str = Field(min_length=2, max_length=200)
    company: str = Field(min_length=2, max_length=160)
    source_url: HttpUrl | None = None
    recipient: EmailStr
    confirmed: bool = Field(strict=True)


@router.post("/preview")
async def preview(body: PostIn, user: Annotated[User, Depends(current_user)]) -> dict[str, Any]:
    return {
        "recipients": recipients(body.text),
        "note": "Addresses copied from the supplied text, not verified recruiter identities. "
        "Review the application instructions.",
    }


@router.post("/import", status_code=201)
async def import_post(
    body: ImportIn, user: Annotated[User, Depends(require_verified_email)], db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, str]:
    from orbit_api.documents.routes import _check_quota, _ingest
    from orbit_api.job_portal.routes import ManualIn, track_manual

    source = next((r for r in recipients(body.text) if r["email"].lower() == str(body.recipient).lower()), None)
    if not body.confirmed or source is None:
        raise HTTPException(422, "Confirm an application address present in the source text.")
    await _check_quota(db, user, "orbit")
    doc = Document(
        user_id=user.id,
        title=f"{body.company}: {body.title}"[:300],
        kind="job_description",
        origin="orbit",
        source_text=body.text,
        size_bytes=len(body.text.encode()),
        status="ready",
    )
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, body.text)
    doc.extracted = {
        **(doc.extracted or {}),
        "application_email": source["email"],
        "application_email_quote": source["quote"],
        "source_url": str(body.source_url) if body.source_url else None,
    }
    entry = await track_manual(
        ManualIn(
            url=str(body.source_url) if body.source_url else "",
            title=body.title,
            company=body.company,
            document_id=doc.id,
        ),
        user,
        db,
    )
    return {"entry_id": entry.id}


@router.get("/discover")
async def discover(
    request: Request, user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, Any]:
    from orbit_api.job_portal.routes import _country, _data, _matches, _profile, _search

    _, prefs, resume = await _profile(db, user)
    search, _ = _search(prefs, "", _country(user, request))
    matches = (await _matches(db, user, search, _data(resume), "best"))[:100]
    rows = {
        row.id: row for row in await db.scalars(select(JobListing).where(JobListing.id.in_([r.id for r in matches])))
    }
    results = []
    for match in matches:
        row = rows.get(match.id)
        if row and recipients(row.description):
            results.append(
                {
                    "id": row.id,
                    "title": row.title,
                    "company": row.company,
                    "source_url": row.url,
                    "text": row.description[:20000],
                    "recipients": recipients(row.description[:20000]),
                }
            )
        if len(results) >= 10:
            break
    return {
        "jobs": results,
        "note": "Email-bearing posts among your first 100 eligible saved-profile matches. "
        "Addresses may be unrelated contacts; review the original instructions. "
        "LinkedIn account pages are not searched.",
    }


class TailorIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_id: str = Field(max_length=36)


@router.post("/{entry_id}/tailor", status_code=201)
async def prepare(
    entry_id: str,
    body: TailorIn,
    user: Annotated[User, Depends(require_verified_email)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    require_config()
    entry = await owned(db, user, entry_id)
    connection = await db.get(GmailConnection, user.id)
    resume = await db.get(Resume, body.resume_id)
    doc = await db.get(Document, entry.document_id) if entry.document_id else None
    if not connection or not connection.data.get("refresh"):
        raise HTTPException(409, "Connect Gmail first.")
    if resume is None or resume.user_id != user.id or doc is None or doc.user_id != user.id:
        raise HTTPException(404, "Choose your resume and import the email-bearing job post first.")
    text = (doc.source_text or "")[:20000]
    recipient = (doc.extracted or {}).get("application_email")
    if not recipient or not any(r["email"].lower() == recipient.lower() for r in recipients(text)):
        raise HTTPException(409, "Review an application email from this job post first.")
    original = ResumeData.model_validate(resume.data)
    revision = resume.revision
    await lock_account(db, user.id)
    count = await db.scalar(
        select(func.count())
        .select_from(ProviderRequest)
        .where(
            ProviderRequest.user_id == user.id,
            ProviderRequest.request_type == "gmail_tailor",
            ProviderRequest.created_at >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0),
        )
    )
    if (count or 0) >= 5:
        raise HTTPException(429, "Up to five Gmail tailoring requests per UTC day, including failures.")
    record = ProviderRequest(
        user_id=user.id, provider="pending", model="pending", request_type="gmail_tailor", ok=False
    )
    db.add(record)
    await db.commit()

    async def generate(request: LLMRequest) -> LLMResponse:
        provider = get_llm_provider()
        response = await asyncio.wait_for(provider.generate(request), 60)
        record.provider = response.provider or provider.name
        record.model = response.model
        record.input_tokens = response.usage.input_tokens
        record.output_tokens = response.usage.output_tokens
        return response

    try:
        tailored = await tailor(original, text, generate)
        record.ok = True
    except TimeoutError as exc:
        raise HTTPException(503, "AI preparation timed out. "
                            "Your existing applications were not sent or changed.") from exc
    finally:
        await db.commit()
    await db.refresh(resume)
    await db.refresh(doc)
    if resume.revision != revision or (doc.source_text or "")[:20000] != text:
        raise HTTPException(409, "The source resume or job changed during preparation. Prepare a fresh draft.")
    if (doc.extracted or {}).get("application_email") != recipient:
        raise HTTPException(409, "The approved recipient changed. Prepare a new draft.")
    content = await asyncio.to_thread(resume_docx, tailored.data, ResumeDesign.model_validate(resume.design or {}))
    letter = template_letter(original.visible(), Facts(), entry.company, entry.title, text)
    message = ApplicationEmail(recipient=recipient, subject=f"Application: {entry.title}"[:200], body=letter[:20000])
    identity = str(uuid.uuid4())
    attachment = ResumeAttachment("tailored-resume.docx", content)
    mime = compose(message, connection.data["email"], identity, attachment)
    return await save_draft(
        db,
        user,
        entry_id,
        message,
        mime,
        identity,
        attachment.filename,
        connection.data["email"],
        {
            "tailoring": {
                "resume_id": resume.id,
                "resume_revision": revision,
                "job_digest": hashlib.sha256(text.encode()).hexdigest(),
                "changes": [c.model_dump() for c in tailored.changes],
                "ai_used": tailored.ai_used,
                "resume_data": tailored.data.model_dump(mode="json"),
                "source_quote": next(r["quote"] for r in recipients(text) if r["email"].lower() == recipient.lower()),
            "source_url": (doc.extracted or {}).get("source_url"),
            }
        },
    )
