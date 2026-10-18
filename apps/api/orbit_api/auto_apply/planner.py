"""The planner: picks jobs for a candidate from Jobs AI's feed and turns each into an ApplicationPacket. It runs
from the sweeper every few hours for every consented setup, and on demand from the web app.

For each candidate:
1. The master resume must be the one they approved, unchanged since (its content hash). An edit pauses planning
   until they approve it again.
2. Jobs come from the feed's own ranking (job_portal/ranking.py) for each country they apply in, filtered by their
   Orbit Apply filters. Each must score at or over their threshold (the reason is kept), be fresh (30 days at most),
   not look reposted or like a standing ad (job_portal/signals.py), clear the salary floor when the post gives
   pay, and not be at an excluded company.
3. Dedupe: a job already prepared or applied to (the same listing, or the same job listed elsewhere), one on the
   tracker as applied or further, and companies that already have two in 30 days.
4. Where to apply (resolve.py). The employer's own Greenhouse, Lever or Ashby form is read (forms.py) and answered
   from the bank (bank.py). A job board listing becomes a hand-off with the answers ready, and Orbit Direct goes
   through its seam (direct.py).
5. The resume is tailored (tailor.py, true facts only, with a diff), and a short cover letter and any
   "why this company" answer are written (letters.py).
The packet is `needs_answer` when a required question has no truthful answer, `review` in Review-first mode, and
otherwise `ready` for the executor. Pacing (pacing.py) decides when it goes.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import bank, direct, letters, rules
from orbit_api.auto_apply.forms import FormClient, FormError, FormQuestion, fetch_form, standard_form
from orbit_api.auto_apply.pacing import OPEN, aware, company_count, daily_limit, expire
from orbit_api.auto_apply.resolve import Target, resolve
from orbit_api.auto_apply.setup import Facts, Filters
from orbit_api.auto_apply.tailor import Generate, tailor
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal import ranking, signals
from orbit_api.job_portal.profile import JobPrefs, apply_suggestion, from_resume, resume_hash
from orbit_api.job_portal.sources import source_named
from orbit_api.models import (
    AnswerBankEntry,
    ApplicationPacket,
    AutoApplySetup,
    JobApplication,
    JobListing,
    JobSearchProfile,
    Resume,
    User,
)
from orbit_api.resumes.schema import ResumeData
from orbit_api.sessions.loop_memory import same_company

log = logging.getLogger(__name__)
PLAN_EVERY = timedelta(hours=3)
BATCH = 20  # setups per sweep
MAX_CONSIDERED = 80  # matches read per country per run
GHOST_KINDS = frozenset({"redated", "earlier", "evergreen"})
_rng = random.Random()  # noqa: S311  (spacing jitter, not a secret)
SWEEP_IN_TESTS = False
# The form reader's transport: None is the network. Tests and the local end-to-end run set recorded forms here.
FORM_TRANSPORT: httpx.AsyncBaseTransport | None = None


@dataclass
class Skip:
    listing_id: str
    title: str
    company: str
    reason: str


@dataclass
class PlanReport:
    created: int = 0
    considered: int = 0
    blocked: str | None = None  # why nothing could be planned (no consent, resume changed, ...)
    skipped: list[Skip] = field(default_factory=list)

    def skip(self, row: JobListing, reason: str) -> None:
        if len(self.skipped) < 40:
            self.skipped.append(Skip(row.id, row.title, row.company, reason))


def company_key(company: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", company.lower()).split())[:200]


async def load_bank(db: AsyncSession, user_id: str) -> dict[str, str]:
    rows = (await db.scalars(select(AnswerBankEntry).where(AnswerBankEntry.user_id == user_id))).all()
    return {r.norm: r.value for r in rows if r.value.strip()}


async def master_resume(db: AsyncSession, setup: AutoApplySetup) -> tuple[Resume | None, ResumeData | None, bool]:
    """The master resume, its content, and whether it's still the version the candidate approved."""
    if not setup.resume_id:
        return None, None, False
    resume = await db.get(Resume, setup.resume_id)
    if resume is None or resume.user_id != setup.user_id:
        return None, None, False
    data = ResumeData.model_validate(resume.data or {})
    return resume, data, bool(setup.resume_hash) and resume_hash(data) == setup.resume_hash


_MONEY = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(k|l|lpa|lakh|lakhs|m|cr|crore)?\b", re.I)
_SCALE = {"k": 1_000, "l": 100_000, "lpa": 100_000, "lakh": 100_000, "lakhs": 100_000, "m": 1_000_000,
          "cr": 10_000_000, "crore": 10_000_000}


def salary_top(text: str | None) -> float | None:
    """The highest yearly figure a post's pay line gives (an hourly rate is left out), or None."""
    if not text or re.search(r"\b(?:hour|hr|hourly)\b", text, re.I):
        return None
    figures = [float(n.replace(",", "")) * _SCALE.get((unit or "").lower(), 1) for n, unit in _MONEY.findall(text)]
    if re.search(r"\b(?:month|monthly|/mo)\b", text, re.I):
        figures = [f * 12 for f in figures]
    figures = [f for f in figures if f >= 1_000]
    return max(figures) if figures else None


def _keywords_ok(row: JobListing, filters: Filters) -> bool:
    if not filters.keywords:
        return True
    hay = " ".join([row.title, *(row.keywords or [])]).lower()
    return all(k.lower() in hay for k in filters.keywords)


def _reason(match: ranking.Match, threshold: int) -> str:
    out = f"{match.score}% match (your threshold is {threshold}%)"
    if match.matched:
        out += f": your resume shows {', '.join(match.matched[:4])}"
    if match.missing:
        out += f"; it also asks for {', '.join(match.missing[:3])}"
    return out[:500]


def _fields(facts: Facts) -> dict[str, str]:
    return {"first_name": facts.first_name, "last_name": facts.last_name, "full_name": facts.full_name(),
            "email": facts.email, "phone": facts.phone, "location": facts.location(), "linkedin": facts.linkedin,
            "website": facts.website, "github": facts.github, "current_company": facts.current_company,
            "current_title": facts.current_title}


def _handoff_answers(ctx: bank.Context, entries: dict[str, str]) -> list[dict[str, Any]]:
    """For a hand-off: everything ready to copy. The cover letter, "why this company", and the candidate's bank."""
    out: list[dict[str, Any]] = []
    for key, label in (("why_company", "Why this company?"), ("cover_letter", "Cover letter")):
        if ctx.generated.get(key):
            out.append(bank.Answer(question_id=None, label=label, kind="textarea", value=ctx.generated[key],
                                   source="generated").model_dump())
    for norm, value in entries.items():
        seed = bank.SEED_BY_KEY.get(norm.split("@", 1)[0])
        if seed is not None and seed.per_company:
            continue
        out.append(bank.Answer(question_id=None, label=seed.label if seed else norm, kind="text", value=value,
                               source="bank").model_dump())
    return out


async def answer_form(questions: list[FormQuestion], ctx: bank.Context) -> tuple[list[bank.Answer],
                                                                                  list[bank.Missing]]:
    answers: list[bank.Answer] = []
    missing: list[bank.Missing] = []
    for q in questions:
        a = bank.answer(q, ctx)
        if isinstance(a, bank.Answer):
            answers.append(a)
        elif isinstance(a, bank.Missing):
            missing.append(a)
    return answers, missing


def needs_why(questions: list[FormQuestion]) -> bool:
    return any((s := bank.seed_for(q.label, q.description)) is not None and s.key == "why_company"
               for q in questions)


async def prepare(db: AsyncSession, user: User, setup: AutoApplySetup, row: JobListing, target: Target,
                  match: ranking.Match, master: ResumeData, resume_title: str, *, now: datetime,
                  generate: Generate | None, transport: httpx.AsyncBaseTransport | None) -> ApplicationPacket:
    from orbit_api.job_portal.routes import _job_text

    facts = Facts.model_validate(setup.profile or {})
    entries = await load_bank(db, user.id)
    job_text = _job_text(row, row.description or row.snippet)
    source = source_named(row.source)
    ckey = company_key(row.company)
    ctx = bank.Context(facts=facts, resume=master, bank=entries, company=row.company, company_key=ckey,
                       title=row.title, job_country=row.country, job_cities=list(row.cities or []),
                       direct=bool(source and source.direct))
    questions: list[FormQuestion] = []
    form_source = "standard"
    if target.ats in rules.ATS_SUPPORTED:
        try:
            async with FormClient(transport or FORM_TRANSPORT) as client:
                questions = await fetch_form(client, target.ats, target.tenant, target.job_ref)
            form_source = "fetched"
        except FormError as e:
            log.info("orbit apply: %s form for %s not read (%s); the standard fields are used", target.ats, row.id, e)
            questions = standard_form(target.ats)
    letter, _ = await letters.cover_letter(master, facts, row.company, row.title, job_text, generate, setup.ai_line)
    ctx.generated["cover_letter"] = letter
    if needs_why(questions) or not target.automatic:
        ctx.generated["why_company"], _ = await letters.why_company(master, facts, row.company, row.title, job_text,
                                                                    generate)
    tailored = await tailor(master, job_text, generate)
    if target.automatic:
        answers, missing = await answer_form(questions, ctx)
        answer_dicts = [a.model_dump() for a in answers]
        if missing:
            status, reason = "needs_answer", (
                f"{len(missing)} question{'' if len(missing) == 1 else 's'} only you can answer")
        elif setup.mode == "review":
            status, reason = "review", "Ready for your review"
        else:
            status, reason = "ready", ""
    else:
        answer_dicts, missing = _handoff_answers(ctx, entries), []
        status = "handoff"
        site = target.site or "the job's site"
        reason = f"Needs you: apply on {site}. Orbit doesn't apply on job boards for you; your answers are ready."
    packet = ApplicationPacket(
        user_id=user.id, listing_id=row.id, status=status, ats=target.ats, tenant=target.tenant,
        job_ref=target.job_ref, site=target.site, company=row.company, company_key=ckey, title=row.title,
        url=row.url, apply_url=target.apply_url or row.apply_url or row.url, dedupe_key=row.dedupe_key,
        match_score=match.score, match_reason=_reason(match, setup.threshold), resume_title=resume_title,
        resume_data=tailored.data.model_dump(mode="json"), resume_diff=[c.model_dump() for c in tailored.changes],
        cover_letter=letter, generated=dict(ctx.generated), fields=_fields(facts), answers=answer_dicts,
        questions=[q.model_dump() for q in questions], missing=[m.model_dump() for m in missing],
        form_source=form_source, not_before=now, expires_at=now + rules.PACKET_TTL,
        tenant_gap_s=_rng.randint(*rules.TENANT_GAP_S), reason=reason)
    db.add(packet)
    await db.flush()
    if target.ats == "orbit":
        result = await direct.apply_direct(packet)
        if result is not None:  # not reachable until Orbit Direct lands (direct.py)
            packet.status = result.status
            packet.confirmation_text = result.confirmation_text
    return packet


def _searches(user: User, prefs: JobPrefs, filters: Filters, facts: Facts) -> list[ranking.Search]:
    from orbit_api.job_portal.routes import _country

    countries = filters.countries or [_country(user)]
    out = []
    for country in countries:
        auth = facts.auth_for(country)
        out.append(ranking.Search(
            titles=filters.titles or prefs.titles, skills=prefs.skills,
            locations=filters.locations or prefs.locations,
            workplace=list(filters.workplace or prefs.workplace), level=prefs.level, years=prefs.years,
            job_types=prefs.job_types, days=min(filters.days, rules.MAX_FRESH_DAYS), sources_off=prefs.sources_off,
            exclude=prefs.exclude, country=country,
            needs_sponsorship=bool(auth and auth.needs_sponsorship)))
    return out


async def _prefs(db: AsyncSession, user: User, master: ResumeData) -> JobPrefs:
    row = await db.get(JobSearchProfile, user.id)
    if row is not None:
        return JobPrefs.model_validate(row.prefs or {})
    return apply_suggestion(from_resume(master), None)


async def plan_for_user(db: AsyncSession, user: User, *, now: datetime | None = None,
                        generate: Generate | None = None, transport: httpx.AsyncBaseTransport | None = None,
                        use_ai: bool = True) -> PlanReport:
    """Prepare packets for one candidate, up to what their daily limit keeps ahead. Commits."""
    from orbit_api.job_portal.routes import _generate, _matches

    now = now or datetime.now(UTC)
    report = PlanReport()
    setup = await db.get(AutoApplySetup, user.id)
    if setup is None or setup.consent_at is None:
        report.blocked = "Finish the Orbit Apply setup and give your consent first."
        return report
    resume, master, approved = await master_resume(db, setup)
    if resume is None or master is None:
        report.blocked = "Choose the resume Orbit Apply should use."
        return report
    if not approved:
        report.blocked = "Your resume changed since you approved it. Approve it again in the setup."
        return report
    await expire(db, now, user.id)
    filters = Filters.model_validate(setup.filters or {})
    facts = Facts.model_validate(setup.profile or {})
    prefs = await _prefs(db, user, master)
    open_count = await db.scalar(select(func.count()).select_from(ApplicationPacket).where(
        ApplicationPacket.user_id == user.id, ApplicationPacket.status.in_(OPEN))) or 0
    budget = daily_limit(setup) * rules.PREPARED_AHEAD - int(open_count)
    setup.last_planned_at = now
    if budget <= 0:
        await db.commit()
        return report
    if generate is None and use_ai:
        async def generate_free(req: Any) -> Any:  # logged like Jobs AI's own free AI, no credit
            return await _generate(db, user, req)
        generate = generate_free
    threshold = max(setup.threshold or rules.DEFAULT_THRESHOLD, rules.MIN_THRESHOLD)
    seen = (await db.execute(select(ApplicationPacket.listing_id, ApplicationPacket.dedupe_key)
                             .where(ApplicationPacket.user_id == user.id))).all()
    seen_ids = {lid for lid, _ in seen}
    seen_keys = {k for _, k in seen if k}
    tracked = (await db.execute(select(JobApplication.listing_id, JobApplication.company, JobApplication.title,
                                       JobApplication.status).where(JobApplication.user_id == user.id))).all()
    applied_ids = {lid for lid, _, _, st in tracked if st != "saved"}
    applied_jobs = [(c, t.lower()) for _, c, t, st in tracked if st != "saved"]
    excluded = filters.exclude_companies
    for search in _searches(user, prefs, filters, facts):
        matches = [m for m in await _matches(db, user, search, master, "best") if m.score >= threshold]
        ids = [m.id for m in matches[:MAX_CONSIDERED]]
        rows = {r.id: r for r in (await db.scalars(select(JobListing).where(JobListing.id.in_(ids)))).all()}
        for m in matches[:MAX_CONSIDERED]:
            if report.created >= budget:
                break
            row = rows.get(m.id)
            if row is None:
                continue
            report.considered += 1
            if row.id in seen_ids or row.dedupe_key in seen_keys or row.id in applied_ids:
                continue  # already prepared, applied to, or the same job from another source
            if any(same_company(c, row.company) and t == row.title.lower() for c, t in applied_jobs):
                continue
            if any(same_company(x, row.company) for x in excluded):
                report.skip(row, "A company you excluded.")
                continue
            if not _keywords_ok(row, filters):
                report.skip(row, "Doesn't have the words your filters ask for.")
                continue
            if filters.seniority and row.level and row.level not in filters.seniority:
                report.skip(row, "Not a seniority you chose.")
                continue
            if aware(row.posted_at) is not None and (aware(row.posted_at) or now) < now - timedelta(days=filters.days):
                continue
            top = salary_top(row.salary)
            if filters.salary_floor and top is not None and top < filters.salary_floor:
                report.skip(row, "Its pay range is under your salary floor.")
                continue
            earliest = await db.scalar(select(func.min(JobListing.created_at)).where(
                JobListing.dedupe_key == row.dedupe_key, JobListing.id != row.id))
            cautions = signals.posting_check(title=row.title, description=row.description, salary=row.salary,
                                             posted_at=row.posted_at, first_seen_at=row.created_at or row.posted_at,
                                             earliest_elsewhere=earliest, still_listed_at=None, direct=True,
                                             full_text=True, now=now)
            if any(c.kind in GHOST_KINDS for c in cautions):
                report.skip(row, "Looks reposted or like a standing ad, not one open role.")
                continue
            ckey = company_key(row.company)
            if await company_count(db, user.id, ckey, now) >= rules.PER_COMPANY_LIMIT:  # this run's count too
                report.skip(row, "Already two applications to this company in the last 30 days.")
                continue
            target, apply_row = await resolve(db, row)
            if apply_row.id != row.id and (apply_row.id in seen_ids or apply_row.id in applied_ids):
                continue
            user_id, row_id = user.id, row.id  # read before a rollback can expire them
            try:
                await prepare(db, user, setup, apply_row, target, m, master, resume.title, now=now, generate=generate,
                              transport=transport)
            except Exception:
                log.exception("orbit apply: preparing %s failed; it's tried again next run", row_id)
                await db.rollback()
                setup = await db.get(AutoApplySetup, user_id)
                if setup is None:
                    return report
                # The rollback expired every object in the session (prepare's AI calls commit, so a savepoint can't
                # hold it). Reload what the rest of the run reads, or the next attribute access is an async lazy load
                # (MissingGreenlet, a 500 for the plan route).
                await db.refresh(user)
                if resume is not None:
                    await db.refresh(resume)
                for rid, r in list(rows.items()):
                    try:
                        await db.refresh(r)
                    except InvalidRequestError:  # deleted meanwhile
                        rows.pop(rid, None)
                continue
            seen_ids |= {row.id, apply_row.id}
            seen_keys.add(row.dedupe_key)
            report.created += 1
    await db.commit()
    return report


async def plan_due(now: datetime | None = None) -> int:
    """The sweeper's pass: expire old leases and packets, then plan for the setups due. Returns packets made."""
    from orbit_api.auto_apply.notify import notify

    if get_settings().env == "test" and not SWEEP_IN_TESTS:
        return 0  # the suite plans explicitly, with recorded forms: a sweep at app start would fetch real ones
    now = now or datetime.now(UTC)
    made = 0
    async with sessionmaker()() as db:
        await expire(db, now)
        await db.commit()
        due = (await db.scalars(select(AutoApplySetup).where(
            AutoApplySetup.consent_at.is_not(None), AutoApplySetup.paused.is_(False),
            (AutoApplySetup.last_planned_at.is_(None)) | (AutoApplySetup.last_planned_at < now - PLAN_EVERY))
            .order_by(AutoApplySetup.last_planned_at).limit(BATCH))).all()
        user_ids = [s.user_id for s in due]
    for uid in user_ids:
        async with sessionmaker()() as db:
            user = await db.get(User, uid)
            if user is None or user.suspended_at is not None:
                continue
            try:
                made += (await plan_for_user(db, user, now=now)).created
                if await notify(db, user, now):
                    await db.commit()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("orbit apply: planning for one account failed; it's tried again next pass")
    return made
