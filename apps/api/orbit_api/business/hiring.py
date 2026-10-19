"""Evidence-led interview preparation and debriefs. No model decides who is hired."""
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.business import conversations, rules
from orbit_api.business.access import Ctx
from orbit_api.business.hiring_schema import Criterion, HiringPlan
from orbit_api.business_ai.fairness import asks_protected, discriminatory
from orbit_api.models import BizApplication, BizEvent, BizHiringPlan, BizInterviewFeedback, BizJob, BizWorkSample


def aware(t: datetime) -> datetime:
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


def default_plan(job: BizJob) -> HiringPlan:
    stage = next((s["id"] for s in job.stages if s["kind"] == "interview"), job.stages[0]["id"])
    names = [s for s in job.must_haves if not discriminatory(s) and not asks_protected(s)][:6] or ["Role outcomes"]
    return HiringPlan(criteria=[Criterion(
        id=hashlib.sha256(name.encode()).hexdigest()[:16],
        name=(name if len(name) >= 2 else f"{name} experience")[:120], stage_id=stage,
        question=f"Walk me through a specific example involving {name[:120]}. What did you do and why?",
        probe="What changed, what failed, and what evidence tells you the outcome improved?",
        strong="Explains their own decisions, alternatives, constraints and concrete evidence of the result.",
        weak="Describes general knowledge without a specific example or evidence of their own contribution.",
    ) for name in dict.fromkeys(names)])


def plan_payload(row: BizHiringPlan | None, job: BizJob) -> dict[str, Any]:
    plan = HiringPlan.model_validate(row.content) if row else default_plan(job)
    return {"job_id": job.id, "revision": row.revision if row else 0, "plan": plan.model_dump(),
            "updated_at": aware(row.updated_at).isoformat() if row else None}


def blind_text(ctx: Ctx, app: BizApplication, text: str) -> str:
    return rules.blind_text(text, app.name, app.email, app.phone) if ctx.company.blind_review else text


async def visible_stages(db: AsyncSession, ctx: Ctx, app: BizApplication, job: BizJob) -> set[str] | None:
    """None = all submitted feedback; an empty set = only your own drafts. The same guard protects legacy routes."""
    plan = await db.get(BizHiringPlan, job.id)
    if plan is None or not plan.content.get("independent_feedback", True):
        return None
    if ctx.role in ("owner", "admin", "recruiter") or (
            ctx.role == "hiring_manager" and ctx.user.id not in (app.interviewers or [])):
        return None
    return set(await db.scalars(select(BizInterviewFeedback.stage_id).where(
        BizInterviewFeedback.application_id == app.id, BizInterviewFeedback.author_id == ctx.user.id,
        BizInterviewFeedback.submitted_at.is_not(None))))


def evidence_map(ctx: Ctx, app: BizApplication, plan: HiringPlan) -> list[dict[str, Any]]:
    matches = {str(r.get("requirement", "")).casefold(): r
               for r in (app.ranking or {}).get("must_haves", []) if isinstance(r, dict)}
    rows = []
    for criterion in plan.criteria:
        match = matches.get(criterion.name.casefold(), {})
        quote = str(match.get("evidence") or "")
        offset = app.resume_text.find(quote) if quote else -1
        rows.append({"criterion_id": criterion.id, "name": criterion.name,
            "status": "resume_reference" if offset >= 0 else "not_shown",
            "quote": blind_text(ctx, app, quote) if offset >= 0 else "",
            "source_start": offset if offset >= 0 and not ctx.company.blind_review else None,
            "probe": criterion.probe, "question": criterion.question})
    return rows


def sample_payload(sample: BizWorkSample | None) -> dict[str, Any] | None:
    if sample is None:
        return None
    # The change request is introduced after the first submission, never embedded in a hidden HTML field.
    brief = {k: v for k, v in sample.brief.items() if k != "change_request"}
    return {"revision": sample.revision, "plan_revision": sample.plan_revision, "brief": brief,
        "answer": sample.answer, "follow_up": sample.follow_up,
        "change_request": sample.brief.get("change_request") if sample.answer is not None else None,
        "submitted_at": aware(sample.submitted_at).isoformat() if sample.submitted_at else None,
        "completed_at": aware(sample.completed_at).isoformat() if sample.completed_at else None}


def feedback_payload(row: BizInterviewFeedback, ctx: Ctx, app: BizApplication,
                     addenda: list[BizEvent]) -> dict[str, Any]:
    content = dict(row.content)
    content["summary"] = blind_text(ctx, app, str(content.get("summary") or ""))
    content["ratings"] = [{**rating,
        "observation": blind_text(ctx, app, str(rating.get("observation") or "")),
        "quote": blind_text(ctx, app, str(rating.get("quote") or ""))}
        for rating in content.get("ratings", [])]
    return {"id": row.id, "stage_id": row.stage_id, "author_id": row.author_id, "author": row.author_name,
        "revision": row.revision, "plan_revision": row.plan_revision, "plan_snapshot": row.plan_snapshot,
        "content": content, "mine": row.author_id == ctx.user.id,
        "submitted_at": aware(row.submitted_at).isoformat() if row.submitted_at else None,
        "updated_at": aware(row.updated_at).isoformat(),
        "addenda": [{"id": e.id, "author": e.actor_name, "created_at": aware(e.created_at).isoformat(),
            "reason": blind_text(ctx, app, str(e.data.get("reason", ""))),
            "message": blind_text(ctx, app, str(e.data.get("message", "")))}
            for e in addenda if e.data.get("feedback_id") == row.id]}


async def room_payload(db: AsyncSession, ctx: Ctx, app: BizApplication, job: BizJob) -> dict[str, Any]:
    row = await db.get(BizHiringPlan, job.id)
    plan = HiringPlan.model_validate(row.content) if row else default_plan(job)
    revision = row.revision if row else 0
    feedback = list(await db.scalars(select(BizInterviewFeedback).where(
        BizInterviewFeedback.application_id == app.id).order_by(BizInterviewFeedback.created_at)))
    stages = await visible_stages(db, ctx, app, job)
    shown = [f for f in feedback if f.author_id == ctx.user.id or
             (f.submitted_at is not None and (stages is None or f.stage_id in stages))]
    submitted = [f for f in feedback if f.submitted_at is not None]
    addenda = list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "feedback_addendum").order_by(BizEvent.created_at, BizEvent.id)))
    sample = await db.get(BizWorkSample, app.id)
    coverage: list[dict[str, Any]] = []
    for criterion in plan.criteria:
        observations = []
        for f in shown:
            if f.submitted_at is None:
                continue
            for rating in f.content.get("ratings", []):
                if rating["criterion_id"] == criterion.id and rating.get("score") is not None:
                    observations.append({"author": f.author_name, "score": rating["score"],
                        "observation": blind_text(ctx, app, rating.get("observation", "")),
                        "source": rating.get("source", "interview"), "plan_revision": f.plan_revision})
        scores = [o["score"] for o in observations]
        coverage.append({"criterion_id": criterion.id, "name": criterion.name, "observations": observations,
            "assessed": bool(scores), "spread": max(scores) - min(scores) if len(scores) > 1 else 0})
    expected = set(app.interviewers or [])
    planned_stages = {c.stage_id for c in plan.criteria}
    feedback_stage = app.stage_id if app.stage_id in planned_stages else plan.criteria[0].stage_id
    can_view = stages is None or feedback_stage in stages
    current_submissions = [f for f in submitted if f.stage_id == feedback_stage]
    missing = expected - {f.author_id for f in current_submissions}
    gaps = []
    if revision == 0:
        gaps.append("Save the job's interview plan.")
    if not expected:
        gaps.append("Assign the interview panel.")
    if missing:
        gaps.append(f"{len(missing)} panel member(s) have not submitted feedback for this stage.")
    if any(not c["assessed"] for c in coverage):
        gaps.append("Some criteria have not been observed in submitted feedback.")
    if any(c["spread"] >= 2 for c in coverage):
        gaps.append("Review the criteria where interviewer scores differ by two or more.")
    if any(f.plan_revision != revision for f in submitted):
        gaps.append("Some feedback uses an earlier plan. Check the changed criteria.")
    if plan.work_sample and plan.work_sample.required and (sample is None or sample.completed_at is None):
        gaps.append("The required work sample and change request are not both submitted.")
    screening = list(await db.scalars(select(BizEvent.id).where(BizEvent.application_id == app.id,
        BizEvent.kind.in_(("saba_invited", "saba_answer", "saba_alternative", "saba_review", "saba_explanation",
                          "saba_integrity_review", "saba_network_check"))).order_by(BizEvent.id)))
    digest = hashlib.sha256(json.dumps({"plan": row.content if row else None, "revision": revision,
        "feedback": [(f.id, f.revision, aware(f.submitted_at).isoformat())
                     for f in submitted if f.submitted_at],
        "addenda": [e.id for e in addenda],
        **({"screening": screening} if screening else {}),
        "sample": sample.revision if sample else None, "stage": app.stage_id, "status": app.status,
        "panel": sorted(expected), "resume": hashlib.sha256(app.resume_text.encode()).hexdigest()},
        sort_keys=True).encode()).hexdigest()
    decisions = list(await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id,
        BizEvent.kind == "hiring_decision").order_by(BizEvent.created_at.desc()).limit(20))) if can_view else []
    sample_data = sample_payload(sample)
    if sample_data is not None and ctx.company.blind_review:
        for key in ("answer", "follow_up"):
            if isinstance(sample_data.get(key), dict):
                sample_data[key] = {k: blind_text(ctx, app, str(v)) for k, v in sample_data[key].items()}
    questions = await conversations.question_page(db, app, mask=lambda text: blind_text(ctx, app, text), staff=True)
    return {"application_id": app.id, "reference": app.reference,
        "name": rules.candidate_label(app.reference) if ctx.company.blind_review else app.name,
        "job_id": job.id, "job_title": job.title, "stage_id": app.stage_id, "status": app.status,
        "stages": [{"id": s["id"], "name": s["name"]} for s in job.stages],
        "feedback_stage_id": feedback_stage,
        "plan": plan_payload(row, job), "evidence": evidence_map(ctx, app, plan),
        "feedback": [feedback_payload(f, ctx, app, addenda) for f in shown],
        "feedback_locked": not can_view, "pending_reviewers": len(missing), "expected_reviewers": len(expected),
        "coverage": coverage, "gaps": gaps, "evidence_version": digest,
        "work_sample": sample_data,
        "candidate_questions": questions["threads"],
        "decision_outdated": bool(decisions and decisions[0].data.get("evidence_version") != digest),
        "decisions": [{"id": d.id, "actor": d.actor_name, "created_at": aware(d.created_at).isoformat(),
            **{**d.data, "rationale": blind_text(ctx, app, str(d.data.get("rationale", "")))}} for d in decisions]}
