"""Job-grounded interview design. Preview only; saving uses the existing versioned hiring-plan contract."""
import hashlib
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import hiring
from orbit_api.business.access import CompanyCtx, company_ctx, job_for, lock_company
from orbit_api.business.hiring_schema import Contract, HiringPlan
from orbit_api.business_ai.fairness import asks_protected, discriminatory
from orbit_api.db import get_db
from orbit_api.models import BizHiringPlan
from orbit_api.workflow_ai import preview

router = APIRouter(prefix="/v1/business/companies/{company_id}", tags=["business hiring"])


class AssistIn(Contract):
    base_revision: int = Field(ge=0)


class Source(Contract):
    criterion_id: str = Field(min_length=1, max_length=40)
    requirement_quote: str = Field(min_length=2, max_length=500)


class Draft(Contract):
    plan: HiringPlan
    sources: list[Source] = Field(min_length=1, max_length=12)


@router.post("/jobs/{job_id}/hiring-plan/assist")
async def assist(job_id: str, body: AssistIn, ctx: CompanyCtx,
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    ctx.writable()
    if not ctx.can("manage_jobs") and ctx.role != "hiring_manager":
        ctx.require("manage_jobs")
    job = await job_for(db, ctx, job_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(job)
    row = await db.get(BizHiringPlan, job.id, populate_existing=True)
    if (row.revision if row else 0) != body.base_revision:
        raise HTTPException(409, "The interview plan changed. Reload before generating a draft.")
    source = hiring.design_evidence(job, row)
    stages = {s["id"] for s in job.stages if s["kind"] not in ("hired", "rejected")}
    quotes = [job.title, *job.must_haves, job.description_html[:16000]]

    def validate(raw: object) -> Draft:
        draft = Draft.model_validate(raw)
        ids = {c.id for c in draft.plan.criteria}
        if {s.criterion_id for s in draft.sources} != ids or len(draft.sources) != len(ids):
            raise ValueError("Every criterion needs one requirement source")
        if any(c.stage_id not in stages for c in draft.plan.criteria):
            raise ValueError("Invalid interview stage")
        if not draft.plan.independent_feedback:
            raise ValueError("Keep independent feedback enabled")
        if discriminatory(draft.plan.candidate_intro) or asks_protected(draft.plan.candidate_intro):
            raise ValueError("Candidate guidance must be job-related")
        if any(not any(s.requirement_quote in q for q in quotes) for s in draft.sources):
            raise ValueError("Unsupported job requirement")
        return draft

    result, provider = await preview(db, ctx.user, "business_plan_assist",
        'Design a structured, job-related interview plan from the saved job. Return JSON with plan and sources. '
        'The plan has the same schema as current_plan. Create 3 to 6 criteria with unique lowercase ids, valid '
        'nonterminal stage_ids, questions, probes, concrete strong/weak evidence anchors and realistic minutes. '
        'Keep independent_feedback true. Optional work_sample uses the current plan schema; never require unpaid '
        'production work. Do not assess protected traits, personality, appearance or candidate authenticity. '
        'sources contains exactly one {criterion_id, requirement_quote} per criterion; quote an exact substring '
        'of title, requirements or description. No invented requirements. Preserve candidate adjustments. '
        'Do not rate candidates, send invitations, or claim this plan has been saved. '
        'Output schema: ' + json.dumps(Draft.model_json_schema()),
        source, validate, company_id=ctx.company.id)
    # Recheck permissions and source after the network wait, including concurrent membership/job edits.
    cid, user = ctx.company.id, ctx.user
    db.expire_all()
    await db.refresh(user)
    ctx = await company_ctx(cid, user, db)
    ctx.writable()
    if not ctx.can("manage_jobs") and ctx.role != "hiring_manager":
        ctx.require("manage_jobs")
    job = await job_for(db, ctx, job_id)
    row = await db.get(BizHiringPlan, job_id)
    if (row.revision if row else 0) != body.base_revision or hiring.design_evidence(job, row) != source:
        raise HTTPException(409, "The job or interview plan changed while AI was drafting. Reload and try again.")
    return {**result.model_dump(), "base_revision": body.base_revision,
        "source_version": hashlib.sha256(source.encode()).hexdigest(), "source": "mock" if provider == "mock" else "ai"}
