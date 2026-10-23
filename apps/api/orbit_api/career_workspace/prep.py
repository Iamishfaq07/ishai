"""Explicit, private prep downloads; never service-worker cache account responses."""
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import Document, JobInterviewRound, Resume, User

router = APIRouter(prefix="/v1/career", tags=["career workspace"])


@router.get("/prep-pack/{entry_id}")
async def prep_pack(entry_id: str, user: Annotated[User, Depends(current_user)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await owned(db, user, entry_id)
    sections = [{"title": "Opportunity", "text": f"{row.title} at {row.company}\n{row.location}\n{row.url}"},
                {"title": "Your notes", "text": row.notes or "No notes saved."}]
    if row.document_id:
        doc = await db.get(Document, row.document_id)
        if doc and doc.user_id == user.id:
            sections.append({"title": "Saved job description", "text": (doc.source_text or "")[:20000]})
    if row.resume_id:
        resume = await db.get(Resume, row.resume_id)
        if resume and resume.user_id == user.id:
            # Keep contact fields out of the portable pack by default.
            import json
            selected = {key: value for key, value in resume.data.items()
                        if key in {"summary", "experience", "education", "skills", "projects"}}
            sections.append({"title": "Current linked resume (not proof of what was sent)",
                             "text": json.dumps(selected, ensure_ascii=False, indent=2)})
    rounds = list(await db.scalars(select(JobInterviewRound).where(
        JobInterviewRound.user_id == user.id, JobInterviewRound.application_id == row.id)
        .order_by(JobInterviewRound.created_at.desc()).limit(20)))
    for round_row in rounds:
        sections.append({"title": round_row.label,
            "text": f"{round_row.status} · {round_row.scheduled_at or 'No date'} · {round_row.time_zone}\n"
                    f"{round_row.notes}"})
    if row.interview_questions:
        import json
        sections.append({"title": "Saved preparation questions (AI suggestions)",
                         "text": json.dumps(row.interview_questions, ensure_ascii=False, indent=2)})
    sections.append({"title": "Practice checklist", "text":
        "Explain your contribution with one concrete example.\nDescribe a tradeoff and what you learned.\n"
        "Prepare two questions for the team.\nCheck the latest invitation before travelling or joining."})
    return {"title": f"{row.company} — {row.title}", "generated_at": datetime.now(UTC).isoformat(),
            "sections": sections}
