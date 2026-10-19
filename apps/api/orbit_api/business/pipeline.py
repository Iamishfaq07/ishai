"""The pipeline: applicants by stage, moving and rejecting (always a person's click: nothing here or anywhere in Orbit
rejects automatically), tags, notes with @mentions, scorecards, emails, interview scheduling, re-ranking, export and
delete-on-request. Every change is on the application's timeline and in the company's audit log (applicants named by
reference only).

Blind review (the company's setting) hides names, contact details and the resume's contact lines from everyone; owners,
admins and recruiters may reveal one applicant (`reveal=true`), which is logged.
"""

import csv
import io
import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs as job_queue
from orbit_api import ratelimit
from orbit_api.business import emails, hiring, rules
from orbit_api.business.access import (
    CompanyCtx,
    Ctx,
    application_for,
    audit,
    delete_application_rows,
    job_for,
    lock_company,
    sees_application,
    timeline,
)
from orbit_api.business.ai_port import basic_match
from orbit_api.business.apply import RANK_KIND, iso, latest_interview, sync_tracker_status
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.models import (
    BizApplication,
    BizEvent,
    BizHiringPlan,
    BizInterview,
    BizJob,
    BizMember,
    BizNote,
    BizNotification,
    BizScorecard,
    User,
)
from orbit_api.providers.email import OutgoingEmail, send_safely

router = APIRouter(prefix="/v1/business/companies/{company_id}", tags=["business"])

MAX_BULK = 200
_rerank_app = ratelimit.SlidingWindow(rate_per_s=1 / 600, burst=1)  # one re-rank per application per 10 minutes
_rerank_company = ratelimit.SlidingWindow(rate_per_s=200 / 86400, burst=200)  # 200 a day per company
WAITING_FOR_CONFIRMATION = ("Waiting for the applicant to confirm their email. Emails from your team go out once "
                            "they open the link in Orbit's confirmation email.")


def now() -> datetime:
    return datetime.now(UTC)


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


# ---- models --------------------------------------------------------------------------------------------------------


class ListItem(BaseModel):
    id: str
    reference: str
    name: str
    email: str | None
    headline: str | None
    stage_id: str
    status: str
    source: str
    tags: list[str]
    applied_at: datetime
    stage_changed_at: datetime
    email_confirmed: bool
    via_orbit: bool
    knockout_failed: bool
    knockout_reasons: list[str]
    ranking_status: str
    score: int | None
    must_haves_met: int | None
    must_haves_total: int | None
    match_label: str | None
    # Keyword matching alone (the AI model was unavailable): the UI says "basic match".
    basic_match: bool = False
    deletion_requested: bool


class JobRef(BaseModel):
    id: str
    title: str
    stages: list[dict[str, Any]]
    status: str


class ListOut(BaseModel):
    job: JobRef
    items: list[ListItem]
    blind: bool


class NoteOut(BaseModel):
    id: str
    author: str
    author_id: str | None
    body: str
    mentions: list[str]
    created_at: datetime


class ScoreItem(BaseModel):
    criterion: str = Field(min_length=1, max_length=80)
    score: int = Field(ge=1, le=4)


class ScorecardOut(BaseModel):
    id: str
    stage_id: str
    author: str
    author_id: str | None
    ratings: list[ScoreItem]
    notes: str
    recommendation: str
    created_at: datetime


class EventOut(BaseModel):
    id: str
    kind: str
    text: str
    actor: str | None
    created_at: datetime


class InterviewOut(BaseModel):
    id: str
    slots: list[str]
    duration_min: int
    location: str
    chosen: str | None
    created_at: datetime


class Consent(BaseModel):
    notice_version: str
    accepted_at: str


class Detail(ListItem):
    job_id: str
    job_title: str
    phone: str | None
    location: str | None
    resume_text: str
    resume_filename: str | None
    resume_source: str
    parsed: dict[str, Any] | None
    answers: list[dict[str, Any]]
    ranking: dict[str, Any] | None
    notes: list[NoteOut]
    scorecards: list[ScorecardOut]
    timeline: list[EventOut]
    interviewers: list[str]
    interview: InterviewOut | None
    consent: Consent
    hiring_plan_revision: int = 0


def _is_blind(ctx: Ctx, reveal: bool) -> bool:
    if not ctx.company.blind_review:
        return False
    return not (reveal and (ctx.can("all_jobs") or ctx.role == "recruiter"))


def match_counts(ranking: dict[str, Any] | None) -> tuple[int | None, int | None, str | None]:
    if not ranking:
        return None, None, None
    must = ranking.get("must_haves") or []
    if not must:
        return 0, 0, "No must-haves set"
    met = sum(1 for m in must if m.get("met") == "yes")
    return met, len(must), f"Matches {met}/{len(must)} must-haves"


def company_ranking(ranking: dict[str, Any] | None) -> dict[str, Any] | None:
    """The ranking as a company's members see it: without its model version, which names the model (that's for the
    audit log and the Orbit admin, D82/D83)."""
    if not ranking:
        return None
    return {k: v for k, v in ranking.items() if k != "model_version"}


def _blind(app: BizApplication, text: str) -> str:
    """Text about the applicant with their name, email, phone and links hidden (blind review)."""
    return rules.blind_text(text, app.name, app.email, app.phone)


def _blind_parsed(app: BizApplication, parsed: dict[str, Any]) -> dict[str, Any]:
    def walk(v: Any) -> Any:
        if isinstance(v, str):
            return _blind(app, v)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return {k: walk(v) for k, v in parsed.items()}


def _item(app: BizApplication, blind: bool, hide_ranking: bool = False) -> ListItem:
    met, total, label = match_counts(app.ranking)
    headline = (app.parsed or {}).get("headline") if app.parsed else None
    if blind and isinstance(headline, str):
        headline = _blind(app, headline)
    item = ListItem(
        id=app.id, reference=app.reference, name=rules.candidate_label(app.reference) if blind else app.name,
        email=None if blind else app.email, headline=headline, stage_id=app.stage_id, status=app.status,
        source=app.source, tags=app.tags or [], applied_at=_aware(app.created_at) or now(),
        stage_changed_at=_aware(app.stage_changed_at) or now(), email_confirmed=app.email_confirmed_at is not None,
        via_orbit=app.resume_source != "upload", knockout_failed=app.knockout_failed,
        knockout_reasons=app.knockout_reasons or [], ranking_status=app.ranking_status,
        score=int(app.ranking["score"]) if app.ranking and app.ranking.get("score") is not None else None,
        must_haves_met=met, must_haves_total=total, match_label=label,
        basic_match=app.ranking is not None and basic_match(app.ranking_model),
        deletion_requested=app.deletion_requested_at is not None)
    if hide_ranking:
        item.score, item.must_haves_met, item.must_haves_total, item.match_label = None, None, None, None
        item.basic_match = False
    return item


def _sort_key(app: BizApplication) -> tuple[int, int, float]:
    score = int(app.ranking["score"]) if app.ranking and app.ranking.get("score") is not None else -1
    return (1 if app.knockout_failed else 0, -score, -(_aware(app.created_at) or now()).timestamp())


# ---- reading -------------------------------------------------------------------------------------------------------


@router.get("/jobs/{job_id}/applications", response_model=ListOut)
async def list_applications(
    job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)],
    stage: Annotated[str | None, Query(max_length=16)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    sort: Annotated[Literal["score", "applied", "name"], Query()] = "score",
    reveal: bool = False,
) -> ListOut:
    job = await job_for(db, ctx, job_id, for_interviewer=True)
    query = select(BizApplication).where(BizApplication.job_id == job.id, BizApplication.company_id == ctx.company.id)
    if stage:
        query = query.where(BizApplication.stage_id == stage)
    apps = list((await db.scalars(query)).all())
    apps = [a for a in apps if sees_application(ctx, a, job)]
    blind = _is_blind(ctx, reveal)
    plan = await db.get(BizHiringPlan, job.id)
    independent = bool(plan and plan.content.get("independent_feedback", True) and
                       ctx.role not in ("owner", "admin", "recruiter"))
    if tag:
        apps = [a for a in apps if tag in (a.tags or [])]
    if q:
        needle = q.strip().lower()
        apps = [a for a in apps if needle in a.reference.lower()
                or (not blind and (needle in a.name.lower() or needle in a.email))
                or any(needle in t.lower() for t in a.tags or [])]
    if sort == "applied" or independent:
        apps.sort(key=lambda a: -(_aware(a.created_at) or now()).timestamp())
    elif sort == "name":
        apps.sort(key=lambda a: a.reference if blind else a.name.lower())
    else:
        apps.sort(key=_sort_key)
    if blind is False and ctx.company.blind_review and reveal:
        audit(db, ctx.company.id, ctx.user, "application.revealed", f"job:{job.id}", scope="list")
        await db.commit()
    return ListOut(job=JobRef(id=job.id, title=job.title, stages=job.stages, status=job.status),
                   items=[_item(a, blind, independent) for a in apps], blind=blind)


_EVENT_TEXT = {
    "hiring_task_created": "Added a hiring follow-up",
    "hiring_task_updated": "Updated hiring follow-up ({action}): {note}",
    "withdrawn": "Withdrew their application", "interview_cancelled": "Interview invitation cancelled",
    "applied": "Applied", "email_confirmed": "Confirmed their email", "stage": "Moved to {to}",
    "rejected": "Rejected", "unrejected": "Moved back into the pipeline", "hired": "Hired", "note": "Added a note",
    "scorecard": "Added a scorecard ({recommendation})", "email": "Emailed: {subject}",
    "interview_slots": "Offered interview times", "interview_booked": "Booked an interview time",
    "ranked": "Ranked by Orbit's AI ({score}/100)", "tags": "Tags: {tags}",
    "deletion_requested": "Asked for their data to be deleted",
    "candidate_question": "Asked the hiring team a question", "candidate_reply": "Replied to a candidate question",
    "feedback_submitted": "Submitted interview feedback", "feedback_addendum": "Added context to interview feedback",
}


def _event_text(e: BizEvent, stages: dict[str, str], app: BizApplication | None = None, blind: bool = False) -> str:
    data = {**(e.data or {})}
    if blind and e.kind == "hiring_task_updated" and app is not None:
        data["note"] = _blind(app, str(data.get("note", "")))
    if blind and e.kind == "email" and app is not None:
        # The subject as the template was written ({{candidate_name}}, not the name), or masked for older events.
        data["subject"] = data.get("subject_template") or _blind(app, str(data.get("subject", "")))
    if "to" in data:
        data["to"] = stages.get(str(data["to"]), str(data["to"]))
    if "tags" in data and isinstance(data["tags"], list):
        data["tags"] = ", ".join(data["tags"]) or "none"
    try:
        return _EVENT_TEXT.get(e.kind, e.kind).format(**data)
    except (KeyError, IndexError):
        return _EVENT_TEXT.get(e.kind, e.kind).split(" (")[0].split(":")[0]


async def detail_out(db: AsyncSession, ctx: Ctx, app: BizApplication, job: BizJob, blind: bool) -> Detail:
    notes = (await db.scalars(select(BizNote).where(BizNote.application_id == app.id)
                              .order_by(BizNote.created_at))).all()
    cards = (await db.scalars(select(BizScorecard).where(BizScorecard.application_id == app.id)
                              .order_by(BizScorecard.created_at))).all()
    visible = await hiring.visible_stages(db, ctx, app, job)
    if visible is not None:
        cards = [c for c in cards if c.author_id == ctx.user.id or c.stage_id in visible]
        # Notes have no stage: showing them after one round could leak a later round's recommendations.
        notes = [n for n in notes if n.author_id == ctx.user.id]
    events = (await db.scalars(select(BizEvent).where(BizEvent.application_id == app.id)
                               .order_by(BizEvent.created_at))).all()
    if visible is not None:
        # The timeline must not reveal a peer's recommendation before their card can be read.
        events = [e for e in events if e.kind not in (
            "scorecard", "hiring_decision", "ranked", "feedback_submitted", "feedback_addendum",
            "hiring_task_created", "hiring_task_updated")
                  or e.actor_id == ctx.user.id]
    iv = await latest_interview(db, app.id)
    stage_names = {s["id"]: s["name"] for s in job.stages}
    parsed = None
    if app.parsed:
        parsed = {k: app.parsed.get(k) for k in ("headline", "total_years", "skills", "experience", "education")}
        if blind:
            parsed = _blind_parsed(app, parsed)
    answers = app.answers or []
    if blind:
        answers = [{**a, "answer": _blind(app, str(a.get("answer", "")))} for a in answers]
    base = _item(app, blind, visible is not None).model_dump()
    plan = await db.get(BizHiringPlan, job.id)
    return Detail(
        **base, job_id=job.id, job_title=job.title, phone=None if blind else app.phone,
        location=None if blind else app.location,
        resume_text=_blind(app, app.resume_text) if blind else app.resume_text,
        resume_filename=None if blind else app.resume_filename, resume_source=app.resume_source, parsed=parsed,
        answers=answers, ranking=(_blind_parsed(app, company_ranking(app.ranking) or {}) if blind else
                                 company_ranking(app.ranking)) if visible is None else None,
        notes=[NoteOut(id=n.id, author=n.author_name, author_id=n.author_id,
                       body=_blind(app, n.body) if blind else n.body, mentions=n.mentions or [],
                       created_at=_aware(n.created_at) or now()) for n in notes],
        scorecards=[ScorecardOut(id=c.id, stage_id=c.stage_id, author=c.author_name, author_id=c.author_id,
                                 ratings=[ScoreItem(**r) for r in c.ratings or []],
                                 notes=_blind(app, c.notes) if blind else c.notes,
                                 recommendation=c.recommendation, created_at=_aware(c.created_at) or now())
                    for c in cards],
        timeline=[EventOut(id=e.id, kind=e.kind, text=_event_text(e, stage_names, app, blind), actor=e.actor_name,
                           created_at=_aware(e.created_at) or now()) for e in events],
        interviewers=app.interviewers or [],
        interview=InterviewOut(id=iv.id, slots=iv.slots, duration_min=iv.duration_min, location=iv.location,
                               chosen=iso(iv.chosen),
                               created_at=_aware(iv.created_at) or now()) if iv is not None else None,
        hiring_plan_revision=plan.revision if plan else 0,
        consent=Consent(notice_version=str((app.consent or {}).get("notice_version", "")),
                        accepted_at=str((app.consent or {}).get("accepted_at", ""))))


@router.get("/applications/{application_id}", response_model=Detail)
async def get_application(application_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)],
                          reveal: bool = False) -> Detail:
    app, job = await application_for(db, ctx, application_id)
    blind = _is_blind(ctx, reveal)
    if ctx.company.blind_review and not blind:
        audit(db, ctx.company.id, ctx.user, "application.revealed", app.reference, job_id=job.id)
        await db.commit()
    return await detail_out(db, ctx, app, job, blind)


# ---- moving and rejecting ------------------------------------------------------------------------------------------


async def _apps_for(db: AsyncSession, ctx: Ctx, ids: list[str]) -> list[tuple[BizApplication, BizJob]]:
    if not ids or len(ids) > MAX_BULK:
        raise HTTPException(422, f"Choose 1 to {MAX_BULK} applicants.")
    out = []
    for i in dict.fromkeys(ids):
        app, job = await application_for(db, ctx, i)
        out.append((app, job))
    return out


def _responded(app: BizApplication) -> None:
    if app.first_response_at is None:
        app.first_response_at = now()


def confirmed(app: BizApplication) -> bool:
    """The applicant's address is theirs: they opened Orbit's confirmation link, or applied signed in (their Orbit
    email is verified). Until then nothing a company writes is sent to it (D82: no relay through the apply form)."""
    return app.email_confirmed_at is not None


def _refuse_unconfirmed(app: BizApplication) -> None:
    if not confirmed(app):
        raise HTTPException(409, detail={"code": "biz_email_unconfirmed", "message": WAITING_FOR_CONFIRMATION})


async def _send_template(db: AsyncSession, ctx: Ctx, app: BizApplication, job: BizJob, kind: str, *,
                         stage: str = "", subject: str | None = None, body: str | None = None,
                         attachments: tuple[tuple[str, str, bytes], ...] = ()) -> tuple[str, str]:
    """Sends a company email (a template, or the member's own words) to a confirmed applicant: (the subject as sent,
    the subject as written, for blind review's timeline)."""
    if not confirmed(app):
        raise emails.EmailNotConfirmed(app.id)
    t_subject, t_body, _ = await emails.template(db, ctx.company.id, kind)
    values = emails.values(ctx.company, job, app, token=emails.status_token_for(app), stage=stage,
                           recruiter=ctx.actor_name)
    written = rules.one_line(subject or t_subject)
    final_subject = rules.one_line(emails.render(written, values))
    await emails.send_to_applicant(ctx.company, app, final_subject, emails.render(body or t_body, values),
                                   ctx.user.email, attachments)
    return final_subject, written


def _emailed(db: AsyncSession, ctx: Ctx, app: BizApplication, sent: tuple[str, str]) -> None:
    timeline(db, app, "email", ctx.user, subject=sent[0], subject_template=sent[1])


class MoveIn(BaseModel):
    ids: list[str] = Field(max_length=MAX_BULK)
    stage_id: str = Field(max_length=16)
    notify: bool = False


class BulkOut(BaseModel):
    moved: int
    items: list[ListItem]
    # Emails not sent because the applicant hasn't confirmed their address yet (the UI says they're waiting).
    emails_waiting: int = 0


@router.post("/applications/move", response_model=BulkOut)
async def move(body: MoveIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> BulkOut:
    ctx.require("move_applicants")
    ctx.writable()
    await lock_company(db, ctx.company.id)
    pairs = await _apps_for(db, ctx, body.ids)
    to_send: list[tuple[BizApplication, BizJob, str]] = []
    for app, job in pairs:
        if app.status == "withdrawn":
            raise HTTPException(409, "The candidate withdrew this application. It cannot be moved back into hiring.")
        stage = next((s for s in job.stages if s["id"] == body.stage_id), None)
        if stage is None:
            raise HTTPException(422, "That stage isn't in this job's pipeline.")
        if app.stage_id == body.stage_id:
            continue
        before = app.stage_id
        app.stage_id, app.stage_changed_at = body.stage_id, now()
        kind = stage["kind"]
        if kind == "rejected":
            app.status, app.rejected_at = "rejected", now()
        elif kind == "hired":
            app.status, app.rejected_at = "hired", None
        else:
            if app.status == "rejected":
                timeline(db, app, "unrejected", ctx.user)
            app.status, app.rejected_at = "active", None
        _responded(app)
        timeline(db, app, "stage", ctx.user, to=body.stage_id)
        audit(db, ctx.company.id, ctx.user, "application.moved", app.reference, job_id=job.id, **{
            "from": before, "to": body.stage_id})
        await sync_tracker_status(db, app, kind)
        if body.notify and kind not in {"rejected"}:
            to_send.append((app, job, stage["name"]))
    await db.commit()
    waiting = 0
    for app, job, name in to_send:
        if not confirmed(app):
            waiting += 1
            continue
        label = rules.CANDIDATE_STAGE.get(rules.stage_kind(job.stages, app.stage_id), ("", ""))[0]
        _emailed(db, ctx, app, await _send_template(db, ctx, app, job, "stage", stage=label or name))
    if to_send:
        await db.commit()
    return BulkOut(moved=len(pairs), items=[_item(a, _is_blind(ctx, False)) for a, _ in pairs],
                   emails_waiting=waiting)


class RejectIn(BaseModel):
    ids: list[str] = Field(max_length=MAX_BULK)
    send_email: bool = False
    subject: str | None = Field(None, max_length=200)
    body: str | None = Field(None, max_length=8000)


@router.post("/applications/reject", response_model=BulkOut)
async def reject(body: RejectIn, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> BulkOut:
    """A person rejects these applicants (one or many). The only way anyone is rejected in Orbit."""
    ctx.require("move_applicants")
    ctx.writable()
    await lock_company(db, ctx.company.id)
    pairs = await _apps_for(db, ctx, body.ids)
    done: list[tuple[BizApplication, BizJob]] = []
    for app, job in pairs:
        if app.status == "withdrawn":
            raise HTTPException(409, "The candidate withdrew this application. It cannot be marked rejected.")
        if app.status == "rejected":
            continue
        target = rules.first_stage(job.stages, "rejected") or "rejected"
        app.stage_id, app.status, app.rejected_at, app.stage_changed_at = target, "rejected", now(), now()
        _responded(app)
        timeline(db, app, "rejected", ctx.user, email=body.send_email)
        audit(db, ctx.company.id, ctx.user, "application.rejected", app.reference, job_id=job.id,
              email=body.send_email,
              ranking_model=app.ranking_model, score=(app.ranking or {}).get("score"))
        await sync_tracker_status(db, app, "rejected")
        done.append((app, job))
    await db.commit()
    waiting = 0
    if body.send_email:
        for app, job in done:
            if not confirmed(app):
                waiting += 1
                continue
            _emailed(db, ctx, app, await _send_template(db, ctx, app, job, "rejection", subject=body.subject,
                                                        body=body.body))
        await db.commit()
    return BulkOut(moved=len(done), items=[_item(a, _is_blind(ctx, False)) for a, _ in pairs],
                   emails_waiting=waiting)


@router.post("/applications/{application_id}/unreject", response_model=Detail)
async def unreject(application_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.status == "withdrawn":
        raise HTTPException(409, "The candidate withdrew this application. It cannot be reopened by the team.")
    if app.status == "rejected":
        app.status, app.rejected_at = "active", None
        app.stage_id = rules.first_stage(job.stages, "applied") or app.stage_id
        app.stage_changed_at = now()
        timeline(db, app, "unrejected", ctx.user)
        audit(db, ctx.company.id, ctx.user, "application.unrejected", app.reference, job_id=job.id)
        await sync_tracker_status(db, app, "applied")
        await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


class PatchIn(BaseModel):
    tags: list[str] | None = Field(None, max_length=20)
    interviewers: list[str] | None = Field(None, max_length=20)


@router.patch("/applications/{application_id}", response_model=Detail)
async def patch_application(application_id: str, body: PatchIn, ctx: CompanyCtx,
                            db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    if body.tags is not None:
        tags = list(dict.fromkeys(t.strip()[:40] for t in body.tags if t.strip()))[:20]
        if tags != (app.tags or []):
            app.tags = tags
            timeline(db, app, "tags", ctx.user, tags=tags)
    if body.interviewers is not None:
        ids = list(dict.fromkeys(body.interviewers))
        members = set((await db.scalars(select(BizMember.user_id).where(
            BizMember.company_id == ctx.company.id, BizMember.user_id.in_(ids)))).all()) if ids else set()
        if set(ids) - members:
            raise HTTPException(422, "Interviewers must be members of this company.")
        app.interviewers = ids
        audit(db, ctx.company.id, ctx.user, "application.interviewers", app.reference, job_id=job.id, count=len(ids))
    await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


# ---- notes, mentions, scorecards -----------------------------------------------------------------------------------

_MENTION = re.compile(r"@([\w.+-]+@[\w-]+(?:\.[\w-]+)+|[\w.-]+)")


async def _mentioned(db: AsyncSession, ctx: Ctx, body: str) -> list[User]:
    words = {m.group(1).lower().rstrip(".") for m in _MENTION.finditer(body)}
    if not words:
        return []
    rows = (await db.execute(select(User).join(BizMember, BizMember.user_id == User.id)
                             .where(BizMember.company_id == ctx.company.id))).scalars().all()
    out = []
    for u in rows:
        first = (u.name or "").split()[0].lower() if u.name else ""
        keys = {u.email.lower(), u.email.split("@")[0].lower(), first, (u.name or "").replace(" ", "").lower()}
        if words & {k for k in keys if k} and u.id != ctx.user.id:
            out.append(u)
    return out


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


@router.post("/applications/{application_id}/notes", response_model=Detail, status_code=201)
async def add_note(application_id: str, body: NoteIn, ctx: CompanyCtx,
                   db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    people = await _mentioned(db, ctx, body.body)
    # Only someone who can see this applicant is told about it.
    visible: list[User] = []
    for u in people:
        m = await db.scalar(select(BizMember).where(BizMember.company_id == ctx.company.id, BizMember.user_id == u.id))
        if m is not None and sees_application(Ctx(user=u, company=ctx.company, member=m), app, job):
            visible.append(u)
    db.add(BizNote(company_id=ctx.company.id, application_id=app.id, author_id=ctx.user.id,
                   author_name=ctx.actor_name, body=body.body.strip(), mentions=[u.id for u in visible]))
    timeline(db, app, "note", ctx.user)
    who = rules.candidate_label(app.reference) if ctx.company.blind_review else app.name
    for u in visible:
        db.add(BizNotification(user_id=u.id, company_id=ctx.company.id, application_id=app.id, kind="mention",
                               text=f"{ctx.actor_name} mentioned you on {who} ({job.title})"[:400]))
    await db.commit()
    link = f"{get_settings().web_url.rstrip('/')}/business/app/{ctx.company.id}/applications/{app.id}"
    for u in visible:
        await send_safely(OutgoingEmail(
            to=u.email, subject=f"{ctx.actor_name} mentioned you in {ctx.company.name}",
            text=f"{ctx.actor_name} mentioned you in a note on an applicant for {job.title}:\n\n"
                 f"{body.body.strip()[:1000]}\n\nOpen it: {link}",
            footer="Sent by Orbit for Business."))
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


class ScorecardIn(BaseModel):
    stage_id: str = Field(max_length=16)
    ratings: list[ScoreItem] = Field(min_length=1, max_length=12)
    notes: str = Field("", max_length=5000)
    recommendation: Literal["hire", "no_hire"]


@router.post("/applications/{application_id}/scorecards", response_model=Detail, status_code=201)
async def add_scorecard(application_id: str, body: ScorecardIn, ctx: CompanyCtx,
                        db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.status == "withdrawn":
        raise HTTPException(409, "This application was withdrawn and is not collecting assessments.")
    if await db.get(BizHiringPlan, job.id) is not None:
        raise HTTPException(409, "This job uses a structured interview plan. Submit evidence in the interview room.")
    if not any(s["id"] == body.stage_id for s in job.stages):
        raise HTTPException(422, "That stage isn't in this job's pipeline.")
    ratings = [r.model_dump() for r in body.ratings]

    async def mine() -> BizScorecard | None:
        card: BizScorecard | None = await db.scalar(select(BizScorecard).where(
            BizScorecard.application_id == app.id, BizScorecard.stage_id == body.stage_id,
            BizScorecard.author_id == ctx.user.id).execution_options(populate_existing=True))
        return card

    # One scorecard per member per stage: a double submit updates it (an insert that loses the race, in a savepoint,
    # falls back to updating the winner's row).
    card = await mine()
    if card is None:
        try:
            async with db.begin_nested():
                db.add(BizScorecard(company_id=ctx.company.id, application_id=app.id, stage_id=body.stage_id,
                                    author_id=ctx.user.id, author_name=ctx.actor_name, ratings=ratings,
                                    notes=body.notes.strip(), recommendation=body.recommendation))
                await db.flush()
        except IntegrityError:
            card = await mine()
    if card is not None:
        card.ratings, card.notes, card.recommendation = ratings, body.notes.strip(), body.recommendation
    timeline(db, app, "scorecard", ctx.user, recommendation="hire" if body.recommendation == "hire" else "no hire")
    audit(db, ctx.company.id, ctx.user, "application.scorecard", app.reference, job_id=job.id,
          stage=body.stage_id, recommendation=body.recommendation)
    await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


# ---- email, scheduling, ranking again ------------------------------------------------------------------------------


class EmailIn(BaseModel):
    kind: Literal["stage", "rejection", "interview", "received"] | None = None
    subject: str | None = Field(None, max_length=200)
    body: str | None = Field(None, max_length=8000)


@router.post("/applications/{application_id}/email", response_model=Detail)
async def email_applicant(application_id: str, body: EmailIn, ctx: CompanyCtx,
                          db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.status == "withdrawn":
        raise HTTPException(409, "This application was withdrawn. Review its saved record before contacting them.")
    if body.kind is None and not (body.subject and body.body):
        raise HTTPException(422, "Choose a template or write a subject and message.")
    _refuse_unconfirmed(app)
    label = rules.CANDIDATE_STAGE.get(rules.stage_kind(job.stages, app.stage_id), ("", ""))[0]
    sent = await _send_template(db, ctx, app, job, body.kind or "stage", stage=label, subject=body.subject,
                                body=body.body)
    _responded(app)
    _emailed(db, ctx, app, sent)
    audit(db, ctx.company.id, ctx.user, "application.emailed", app.reference, job_id=job.id)
    await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


class SlotsIn(BaseModel):
    slots: list[datetime] = Field(min_length=3, max_length=5)
    duration_min: int = Field(30, ge=15, le=240)
    location: str = Field(min_length=2, max_length=300)
    message: str | None = Field(None, max_length=4000)


@router.post("/applications/{application_id}/interview", response_model=Detail, status_code=201)
async def offer_slots(application_id: str, body: SlotsIn, ctx: CompanyCtx,
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    if app.status != "active":
        raise HTTPException(409, "Only an applicant in the pipeline can be invited.")
    _refuse_unconfirmed(app)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.status != "active" or app.deletion_requested_at is not None:
        raise HTTPException(409, "This application is not accepting interview invitations.")
    slots = sorted({(s if s.tzinfo else s.replace(tzinfo=UTC)).astimezone(UTC) for s in body.slots})
    if len(slots) < 3 or slots[0] <= now() + timedelta(minutes=30):
        raise HTTPException(422, "Offer 3 to 5 different times, all at least 30 minutes from now.")
    previous = await latest_interview(db, app.id)
    if previous is not None and previous.chosen is not None:
        raise HTTPException(409, "Cancel the booked interview before offering replacement times.")
    iv = BizInterview(company_id=ctx.company.id, application_id=app.id,
                      slots=[s.isoformat().replace("+00:00", "Z") for s in slots], duration_min=body.duration_min,
                      location=body.location.strip(), created_by=ctx.user.id, reply_to=ctx.user.email,
                      panel_user_ids=list(app.interviewers or [ctx.user.id]))
    db.add(iv)
    _responded(app)
    timeline(db, app, "interview_slots", ctx.user, count=len(slots))
    audit(db, ctx.company.id, ctx.user, "application.interview_offered", app.reference, job_id=job.id)
    await db.commit()
    _emailed(db, ctx, app, await _send_template(db, ctx, app, job, "interview", body=(
        None if not body.message else body.message + "\n\nPick a time here:\n{{status_link}}")))
    await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


@router.post("/applications/{application_id}/interview/cancel", response_model=Detail)
async def cancel_interview(application_id: str, ctx: CompanyCtx,
                           db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    iv = await latest_interview(db, app.id)
    if iv is None or not iv.slots:
        return await detail_out(db, ctx, app, job, _is_blind(ctx, False))
    # An empty latest invitation revokes the old booking and frees its panel's time.
    db.add(BizInterview(company_id=ctx.company.id, application_id=app.id, slots=[],
        duration_min=iv.duration_min, location=iv.location, created_by=ctx.user.id, reply_to=ctx.user.email,
        panel_user_ids=iv.panel_user_ids))
    timeline(db, app, "interview_cancelled", ctx.user)
    audit(db, ctx.company.id, ctx.user, "application.interview_cancelled", app.reference, job_id=job.id)
    await db.commit()
    attachments: tuple[tuple[str, str, bytes], ...] = ()
    if iv.chosen:
        cal = emails.ics(uid=iv.id, start=hiring.aware(iv.chosen), minutes=iv.duration_min,
            summary=f"Cancelled interview: {job.title}", description="The hiring team cancelled this interview.",
            location=iv.location, organizer=iv.reply_to, sequence=iv.revision + 1, cancelled=True)
        attachments = (("cancelled-interview.ics", "text/calendar", cal),)
    if app.email_confirmed_at is not None:
        await emails.send_to_applicant(ctx.company, app, f"Interview cancelled: {job.title}",
            "The hiring team cancelled your current interview invitation. They can offer new times on your "
            "application page. If you imported the previous calendar file, update or remove that event.",
            ctx.user.email, attachments=attachments)
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


@router.post("/applications/{application_id}/rerank", response_model=Detail)
async def rerank(application_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Detail:
    ctx.require("move_applicants")
    ctx.writable()
    app, job = await application_for(db, ctx, application_id)
    await lock_company(db, ctx.company.id)
    await db.refresh(app)
    if app.status == "withdrawn":
        raise HTTPException(409, "This application was withdrawn and is not collecting new rankings.")
    ratelimit.check(_rerank_app, f"biz-rerank:{app.id}", "This applicant was ranked again a moment ago. Try again "
                    "in 10 minutes.")
    ratelimit.check(_rerank_company, f"biz-rerank-company:{ctx.company.id}", "That's today's limit for ranking "
                    "applicants again. Try tomorrow.")
    app.ranking_status = "pending"
    await job_queue.enqueue(db, RANK_KIND, {"application_id": app.id}, dedupe_key=f"{RANK_KIND}:{app.id}")
    await db.commit()
    return await detail_out(db, ctx, app, job, _is_blind(ctx, False))


# ---- data controls -------------------------------------------------------------------------------------------------


@router.delete("/applications/{application_id}", status_code=204)
async def delete_application(application_id: str, ctx: CompanyCtx,
                             db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    ctx.require("delete_applicants")
    app, job = await application_for(db, ctx, application_id)
    ref, requested = app.reference, app.deletion_requested_at is not None
    await delete_application_rows(db, app.id)
    audit(db, ctx.company.id, ctx.user, "application.deleted", ref, job_id=job.id, on_request=requested)
    await db.commit()
    return Response(status_code=204)


@router.get("/jobs/{job_id}/export.csv")
async def export_csv(job_id: str, ctx: CompanyCtx, db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    ctx.require("delete_applicants")
    job = await job_for(db, ctx, job_id)
    apps = (await db.scalars(select(BizApplication).where(BizApplication.job_id == job.id)
                             .order_by(BizApplication.created_at))).all()
    stages = {s["id"]: s["name"] for s in job.stages}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["reference", "name", "email", "phone", "stage", "status", "applied_at", "source", "via_orbit",
                "email_confirmed", "score", "must_haves_met", "knockout", "tags"])

    def cell(v: Any) -> str:
        s = "" if v is None else str(v)
        return "'" + s if s[:1] in {"=", "+", "-", "@", "\t", "\r"} else s  # no formulas in a spreadsheet

    for a in apps:
        met, total, _ = match_counts(a.ranking)
        w.writerow([cell(x) for x in (
            a.reference, a.name, a.email, a.phone, stages.get(a.stage_id, a.stage_id), a.status,
            (_aware(a.created_at) or now()).isoformat(), a.source, a.resume_source != "upload",
            a.email_confirmed_at is not None, (a.ranking or {}).get("score"),
            f"{met}/{total}" if total else "", "; ".join(a.knockout_reasons or []), ", ".join(a.tags or []))])
    audit(db, ctx.company.id, ctx.user, "job.exported", job.title, job_id=job.id, rows=len(apps))
    await db.commit()
    name = rules.slugify(job.title, 40)
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}-applicants.csv"'})
