"""An advisory second reader of an owned application, never a submit/approve tool."""
import hashlib
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.auto_apply.packets import owned
from orbit_api.db import get_db
from orbit_api.models import AutoApplySetup, JobListing, Resume, User
from orbit_api.ratelimit import limit_user
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.schema import ResumeData
from orbit_api.workflow_advice import INSTRUCTION, AdviceIn, validate_advice
from orbit_api.workflow_ai import preview

router = APIRouter(prefix="/v1/apply/packets", tags=["application review"],
    dependencies=[Depends(limit_user("apply-review", rate_per_s=1, burst=20))])


def text(data: dict[str, Any]) -> str:
    return resume_text(ResumeData.model_validate(data).visible())


async def snapshot(db: AsyncSession, user: User, packet_id: str) -> dict[str, Any]:
    db.expire_all()  # previews commit before inference; re-read authoritative ownership and content afterwards
    await db.refresh(user)
    p = await owned(db, user, packet_id)
    listing = await db.get(JobListing, p.listing_id)
    setup = await db.get(AutoApplySetup, user.id)
    master = await db.get(Resume, setup.resume_id) if setup and setup.resume_id else None
    facts: list[dict[str, str]] = []

    def add(key: str, label: str, body: str) -> None:
        if body.strip():
            facts.append({"id": key, "label": label, "text": body[:8000]})

    description = listing.description if listing else "Posting no longer available."
    add("job", "Posting captured with application" if p.posting_text is not None else "Current posting · no archive",
        f"{p.title} at {p.company}\n{p.posting_text if p.posting_text is not None else description}")
    if listing and p.posting_text is not None and listing.description != p.posting_text:
        add("current_job", "Current posting · changed since preparation", description)
    if master and master.user_id == user.id:
        add("master", "Current source resume", text(master.data))
    if p.resume_data:
        add("prepared", "Prepared application resume", text(p.resume_data))
    add("letter", "Prepared cover letter", p.cover_letter or "")
    add("questions", "Unanswered required questions", "\n".join(str(q.get("label", "")) for q in p.missing))
    add("status", "Application state", f"Status: {p.status}. Match: {p.match_score}. {p.reason}")
    version = hashlib.sha256(json.dumps({"facts": facts, "packet": p.id, "updated": str(p.updated_at),
        "resume": master.data if master and master.user_id == user.id else None,
        "prepared": p.resume_data, "letter": p.cover_letter, "answers": p.answers,
        "approval": p.approval_fingerprint, "approved_hash": setup.resume_hash if setup else None,
        "posting": listing.description if listing else None, "archived_posting": p.posting_text},
        sort_keys=True).encode()).hexdigest()
    return {"version": version, "facts": facts}


@router.get("/{packet_id}/review")
async def sources(packet_id: str, user: Annotated[User, Depends(current_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    return await snapshot(db, user, packet_id)


@router.post("/{packet_id}/review")
async def review(packet_id: str, body: AdviceIn, user: Annotated[User, Depends(require_verified_email)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    source = await snapshot(db, user, packet_id)
    if source["version"] != body.version:
        raise HTTPException(409, "This application changed. Refresh before reviewing.")
    result, provider = await preview(db, user, "application_second_reader", INSTRUCTION +
        "Review this application as a careful second reader. Compare the posting, current source resume and "
        "prepared materials. Identify specific gaps, unsupported claims, unclear wording or unanswered questions. "
        "A current source resume is not necessarily the previously approved version. Only suggest changes "
        "supported by supplied facts; when evidence is absent ask the candidate to check, never invent it. "
        "Missing skills are gaps, not keywords to add. Quote the exact source that needs attention. "
        "Do not infer protected traits, rank people, certify truthfulness, approve legal attestations or promise "
        "ATS success. Recommendations are advisory and never change or approve an application.",
        json.dumps({"facts": source["facts"]}), lambda raw: validate_advice(raw, source["facts"]))
    if (await snapshot(db, user, packet_id))["version"] != source["version"]:
        raise HTTPException(409, "This application changed during review. Refresh to continue.")
    return {**source, **result.model_dump(), "source": "mock" if provider == "mock" else "ai"}
