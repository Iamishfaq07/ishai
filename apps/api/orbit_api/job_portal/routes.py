"""Jobs: `/v1/jobs/...`. The latest jobs that match the user's resume, the profile behind it, the AI around each job,
and the tracker. See job_portal/__init__.py for how it fits together.

- `GET/PUT /profile`, `POST /profile/suggest`: the search profile; "suggest" reads it from a resume (AI, free,
  cached per resume content, ORBIT_JOBS_PROFILE_DAILY a day, else worked out without the AI).
- `GET /feed`: ranked, filtered, paginated from the cache; starts background refreshes, never waits for one. `q` is
  the search box ("remote React jobs in Bangalore, 2 years").
- `GET /listings/{id}`, `POST /listings/{id}/fit` (AI fit check, free, ORBIT_JOBS_FIT_DAILY a day, cached),
  `/tailor` (a copy of a resume aimed at the job, opened in the resume maker, whose AI runs on credits as usual),
  `/prepare` (the job description saved to Documents, where Practice's prep and mock interview pick it up).
- `GET/POST /tracker`, `PATCH/DELETE /tracker/{id}`: saved → applied → interviewing → offer / rejected.
- `POST /tracker/link`, `POST /tracker/manual`: a job found elsewhere (Naukri, LinkedIn, a campus portal), tracked
  from its link or typed in (job_portal/manual.py: `listing_id = "ext:<hex>"`, `source = "manual"`). The link is
  read from its address only; nothing is fetched.
- `GET /stats`: the one route without a session, for Jobs AI's public page: how many fresh jobs the cache holds and
  the free daily allowances. Counts only, worked out at most every 10 minutes; it never starts a refresh.

Listings are shared (anyone signed in may read them); profiles, fit checks and tracker entries are the user's own,
and every route that takes one checks it (404 for anyone else's, the same as a missing one).
"""

import asyncio
import logging
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from orbit_api.auth.guards import require_verified_email, require_verified_user
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.job_portal import fit as fitcheck
from orbit_api.job_portal import manual, ranking, refresh
from orbit_api.job_portal.geo import WORLD_CITIES
from orbit_api.job_portal.portals import portal_links, portals_for
from orbit_api.job_portal.postings import CITIES, EmploymentType, Level, Workplace
from orbit_api.job_portal.profile import (
    JobPrefs,
    Suggested,
    anywhere_for,
    apply_suggestion,
    cities_for,
    from_resume,
    parse_profile,
    profile_request,
    resume_hash,
    search_queries,
)
from orbit_api.job_portal.search_parse import parse_search
from orbit_api.job_portal.skills import SkillMatcher
from orbit_api.job_portal.sources import enabled_sources, source_named
from orbit_api.models import (
    Document,
    JobApplication,
    JobFitCheck,
    JobListing,
    JobSearchProfile,
    ProviderRequest,
    Resume,
    User,
)
from orbit_api.prep import job_link
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse
from orbit_api.providers.llm.pricing import estimate_cost
from orbit_api.ratelimit import limit, limit_user
from orbit_api.resumes.ats import resume_text
from orbit_api.resumes.routes import MAX_JOB_TEXT, MAX_RESUMES
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/jobs", tags=["jobs"])

feed_limit = limit_user("jobs-feed", rate_per_s=2, burst=40)
read_limit = limit_user("jobs-read", rate_per_s=3, burst=60)
ai_limit = limit("jobs-ai", rate_per_s=0.2, burst=10)
ai_user_limit = limit_user("jobs-ai-user", rate_per_s=40 / 3600, burst=10)
# Tailor and prepare make a resume or a document, and may fetch the post's page once.
action_limit = limit_user("jobs-action", rate_per_s=30 / 3600, burst=8)
# Jobs added by hand: no fetch and no AI, but each is a row, so a burst of 20 and 60 an hour (MAX_TRACKED caps them).
manual_limit = limit_user("jobs-manual", rate_per_s=60 / 3600, burst=20)
# The public page's numbers, per network (no session): cached, so this only guards against floods.
stats_limit = limit("jobs-stats", rate_per_s=1, burst=30)

PAGE_SIZE = 20
MAX_TRACKED = 500
FULL_TEXT_MIN = 700  # shorter than this, a post is likely only a snippet: tailoring fetches the page once
Status = Literal["saved", "applied", "interviewing", "offer", "rejected"]
Sort = Literal["best", "newest"]

_user_locks: dict[str, asyncio.Lock] = {}


def _lock(user_id: str) -> asyncio.Lock:
    """One AI request per user at a time, so two at once can't both pass the daily cap."""
    if len(_user_locks) > 5_000:
        for k in [k for k, v in _user_locks.items() if not v.locked()][:2_500]:
            del _user_locks[k]
    return _user_locks.setdefault(user_id, asyncio.Lock())


# ---- response shapes -----------------------------------------------------------------------------------------------


class ResumeRef(BaseModel):
    id: str
    title: str


class AttributionOut(BaseModel):
    label: str
    url: str
    large: bool = False


class SourceOut(BaseModel):
    id: str
    label: str
    kind: str
    listings: int
    last_success_at: datetime | None
    refreshing: bool
    failing: bool


class PortalOut(BaseModel):
    id: str
    name: str
    url: str


class MatchOut(BaseModel):
    score: int
    matched: list[str]
    missing: list[str]


class TrackedRef(BaseModel):
    id: str
    status: Status


class JobOut(BaseModel):
    id: str
    source: str
    source_label: str
    direct: bool  # the company's own posting: Apply goes straight to the employer
    attribution: AttributionOut | None
    company: str
    title: str
    locations: list[str]
    place: str  # one line for the card: "Bengaluru, Pune · Hybrid", "Remote (India)"
    workplace: Workplace | None
    employment_type: EmploymentType | None
    level: Level | None
    experience: str | None  # "3-5 years", "5+ years"
    posted_at: datetime
    url: str
    apply_url: str
    snippet: str
    salary: str | None
    # When Orbit first saw the post. A post that doesn't say when it was posted is dated when it's fetched, so the
    # earlier of this and `posted_at` is as fresh as the post can be trusted to be ("Early applicant").
    first_seen_at: datetime
    # When Orbit last found the post still on the company's own careers page (a board's refresh drops posts taken
    # down). None for feeds and searches, which Orbit can't re-check, so they never say "still open".
    still_listed_at: datetime | None = None
    match: MatchOut | None = None
    tracked: TrackedRef | None = None


class FeedOut(BaseModel):
    items: list[JobOut]
    total: int
    page: int
    page_size: int
    has_more: bool
    refreshing: bool
    sources: list[SourceOut]
    portals: list[PortalOut]
    understood: list[str]  # what the search box was read as ("Remote", "Bengaluru", "2 years")
    keywords: str
    resume: ResumeRef | None
    has_profile: bool


class ProfileOut(BaseModel):
    prefs: JobPrefs
    suggested: Suggested | None
    resume: ResumeRef | None
    resumes: list[ResumeRef]
    ai_left: int | None  # AI profile reads left today; None = no cap (the admin)
    saved: bool  # False until the user (or "suggest") saves one; until then it's worked out from the resume
    portals: dict[str, str]  # every portal: id -> name
    sources: list[dict[str, str]]  # the sources this server uses: id, label
    cities: list[str]
    note: str | None = None


class FitOut(BaseModel):
    check: fitcheck.FitCheck
    cached: bool
    left: int | None  # fit checks left today; None = no cap


class DetailOut(BaseModel):
    job: JobOut
    full_text: bool  # Orbit has the whole post (not only a snippet): tailoring and prep can use it as is
    fit: fitcheck.FitCheck | None
    tracker: "TrackerOut | None"


class TrackerOut(BaseModel):
    id: str
    listing_id: str
    source: str
    company: str
    title: str
    location: str
    url: str
    apply_url: str
    posted_at: datetime | None
    status: Status
    notes: str
    applied_at: datetime | None
    next_at: datetime | None
    status_at: datetime
    resume_id: str | None
    document_id: str | None
    live: bool  # the listing is still in the feed's cache (posts are dropped after about 30 days)
    still_listed_at: datetime | None = None  # as JobOut's: seen on the company's own careers page then
    created_at: datetime
    updated_at: datetime


DetailOut.model_rebuild()


# ---- helpers -------------------------------------------------------------------------------------------------------


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def _experience(row: JobListing) -> str | None:
    if row.exp_min is not None and row.exp_max is not None:
        return f"{row.exp_min}-{row.exp_max} years"
    if row.exp_min is not None:
        return f"{row.exp_min}+ years"
    return None


def _location_line(row: JobListing) -> str:
    """"Bengaluru, Pune · Hybrid", "Remote (India)": the cities as Orbit knows them, else what the post says."""
    cities = row.cities or []
    if cities:
        where = ", ".join(cities[:3]) + (f" +{len(cities) - 3}" if len(cities) > 3 else "")
    else:
        where = ", ".join(row.locations[:2]) if row.locations else ""
    mode = {"remote": "Remote", "hybrid": "Hybrid"}.get(row.workplace or "")
    if mode and mode.lower() not in where.lower():
        where = f"{where} · {mode}" if where else mode
    return where[:300]


def _still_listed(source_id: str, fetched_at: datetime | None) -> datetime | None:
    """When the post was last seen on the company's own board: a board's fetch replaces its listings (refresh.py), so
    a post taken down is gone after the next one. Feeds and searches aren't the employer's own word: None."""
    source = source_named(source_id)
    return _aware(fetched_at) if source is not None and source.direct and fetched_at is not None else None


def _job_out(row: JobListing, match: ranking.Match | None = None, tracked: JobApplication | None = None) -> JobOut:
    source = source_named(row.source)
    attribution = source.attribution if source else None
    return JobOut(
        id=row.id, source=row.source, source_label=source.label if source else row.source,
        direct=bool(source and source.direct),
        attribution=AttributionOut(label=attribution.label, url=attribution.url, large=attribution.large)
        if attribution else None,
        company=row.company, title=row.title, locations=row.locations or [], place=_location_line(row),
        workplace=row.workplace,
        employment_type=row.employment_type, level=row.level, experience=_experience(row),
        posted_at=_aware(row.posted_at), url=row.url, apply_url=row.apply_url, snippet=row.snippet,
        salary=row.salary, first_seen_at=_aware(row.created_at or row.posted_at),
        still_listed_at=_still_listed(row.source, row.fetched_at),
        match=MatchOut(score=match.score, matched=match.matched, missing=match.missing) if match else None,
        tracked=TrackedRef(id=tracked.id, status=tracked.status) if tracked else None)


def _tracker_out(t: JobApplication, live: bool, still_listed_at: datetime | None = None) -> TrackerOut:
    return TrackerOut(
        id=t.id, listing_id=t.listing_id, source=t.source, company=t.company, title=t.title, location=t.location,
        url=t.url, apply_url=t.apply_url, posted_at=_aware(t.posted_at) if t.posted_at else None,
        status=t.status, notes=t.notes or "", applied_at=_aware(t.applied_at) if t.applied_at else None,
        next_at=_aware(t.next_at) if t.next_at else None, status_at=_aware(t.status_at),
        resume_id=t.resume_id, document_id=t.document_id, live=live, still_listed_at=still_listed_at,
        created_at=_aware(t.created_at), updated_at=_aware(t.updated_at))


def _has_content(r: Resume) -> bool:
    data = r.data or {}
    return bool(data.get("experience") or data.get("skills") or data.get("projects"))


async def _resumes(db: AsyncSession, user: User) -> list[Resume]:
    return list((await db.scalars(select(Resume).where(Resume.user_id == user.id)
                                  .order_by(Resume.updated_at.desc(), Resume.created_at.desc()))).all())


async def _owned_resume(db: AsyncSession, resume_id: str, user: User) -> Resume:
    r = await db.get(Resume, resume_id)
    if r is None or r.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found")
    return r


async def _resume_for(db: AsyncSession, user: User, profile: JobSearchProfile | None,
                      resume_id: str | None = None) -> Resume | None:
    """The resume the feed matches against: the one asked for, else the profile's, else the latest with content."""
    if resume_id:
        return await _owned_resume(db, resume_id, user)
    if profile is not None and profile.resume_id:
        r = await db.get(Resume, profile.resume_id)
        if r is not None and r.user_id == user.id:
            return r
    rows = await _resumes(db, user)
    return next((r for r in rows if _has_content(r)), rows[0] if rows else None)


def _data(r: Resume | None) -> ResumeData | None:
    return ResumeData.model_validate(r.data or {}) if r is not None else None


async def _profile(db: AsyncSession, user: User) -> tuple[JobSearchProfile | None, JobPrefs, Resume | None]:
    """The saved profile, or one worked out from the latest resume until the user saves theirs."""
    row = await db.get(JobSearchProfile, user.id)
    resume = await _resume_for(db, user, row)
    if row is not None:
        return row, JobPrefs.model_validate(row.prefs or {}), resume
    data = _data(resume)
    prefs = apply_suggestion(from_resume(data), None) if data is not None else JobPrefs()
    return None, prefs, resume


def _today() -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def _ai_left(db: AsyncSession, user: User, request_type: str, cap: int) -> int | None:
    if await is_admin(db, user):
        return None
    used = await db.scalar(select(func.count()).select_from(ProviderRequest).where(
        ProviderRequest.user_id == user.id, ProviderRequest.request_type == request_type,
        ProviderRequest.created_at >= _today()))
    return max(cap - int(used or 0), 0)


async def _generate(db: AsyncSession, user: User, req: LLMRequest) -> LLMResponse:
    """One AI call, cost-logged like the resume maker's (resumes/routes.py `_generate`), but free: no credit."""
    llm = get_llm_provider()
    resp = await llm.generate(req)
    db.add(ProviderRequest(user_id=user.id, provider=resp.provider or llm.name, model=resp.model,
                           request_type=req.request_type, input_tokens=resp.usage.input_tokens,
                           output_tokens=resp.usage.output_tokens, cached_input_tokens=resp.usage.cached_input_tokens,
                           estimated_cost_usd=estimate_cost(resp.model, resp.usage)))
    await db.commit()
    return resp


async def _listing(db: AsyncSession, listing_id: str) -> JobListing:
    row = await db.get(JobListing, listing_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job isn't listed anymore.")
    return row


async def _tracked(db: AsyncSession, user: User, listing_ids: list[str]) -> dict[str, JobApplication]:
    if not listing_ids:
        return {}
    rows = (await db.scalars(select(JobApplication).where(JobApplication.user_id == user.id,
                                                          JobApplication.listing_id.in_(listing_ids)))).all()
    return {r.listing_id: r for r in rows}


async def _room(db: AsyncSession, user: User) -> None:
    count = await db.scalar(select(func.count()).select_from(JobApplication).where(JobApplication.user_id == user.id))
    if (count or 0) >= MAX_TRACKED:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Your tracker holds up to {MAX_TRACKED} jobs. Remove some you're done with first.")


async def _track(db: AsyncSession, user: User, row: JobListing, status_: Status = "saved") -> JobApplication:
    """The tracker entry for this job, made (as `status_`) if it isn't there yet."""
    entry = (await _tracked(db, user, [row.id])).get(row.id)
    if entry is not None:
        return entry
    await _room(db, user)
    now = datetime.now(UTC)
    entry = JobApplication(user_id=user.id, listing_id=row.id, source=row.source, company=row.company,
                           title=row.title, location=_location_line(row), url=row.url, apply_url=row.apply_url,
                           posted_at=row.posted_at, status=status_, status_at=now,
                           applied_at=now if status_ == "applied" else None)
    db.add(entry)
    await db.flush()
    return entry


def _country(user: User) -> str:
    """The country the user applies in (India until they've said, as the app always was)."""
    return (user.country or "IN").upper()


def _search(prefs: JobPrefs, q: str, country: str = "IN") -> tuple[ranking.Search, Any]:
    parsed = parse_search(q, country)
    return ranking.Search(
        titles=prefs.titles, skills=prefs.skills,
        locations=parsed.locations or prefs.locations,
        workplace=parsed.workplace or prefs.workplace,
        level=parsed.level or (prefs.level if parsed.years is None else None),
        years=parsed.years if parsed.years is not None else prefs.years,
        job_types=parsed.job_types or prefs.job_types,
        days=parsed.posted_within or prefs.posted_within, sources_off=prefs.sources_off, exclude=prefs.exclude,
        keywords=parsed.keywords, country=country), parsed


_ROW_COLUMNS = tuple(getattr(JobListing, name) for name in ranking.ROW_FIELDS)


async def _rows(db: AsyncSession, days: int, country: str) -> list[ranking.Row]:
    """The recent posts that could be shown to someone applying in `country`: there, or remote (ranking checks who
    a remote one is open to)."""
    since = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(select(*_ROW_COLUMNS).where(
        JobListing.posted_at >= since, or_(JobListing.country == country, JobListing.workplace == "remote")))
    return [ranking.row_of(r) for r in result.all()]


async def _matches(db: AsyncSession, user: User, search: ranking.Search, data: ResumeData | None,
                   sort: Sort) -> list[ranking.Match]:
    rhash = resume_hash(data) if data is not None else "-"
    key = f"{user.id}|{search.key()}|{rhash}|{refresh.version()}|{sort}"
    hit = ranking.cached(key)
    if hit is not None:
        return hit
    rows = await _rows(db, search.days, search.country)
    matcher = SkillMatcher(resume_text(data.visible()) if data is not None else "", search.skills)
    # Scoring a few thousand cached posts is CPU work: off the event loop.
    out = await asyncio.to_thread(ranking.rank, rows, search, matcher, sort=sort)
    ranking.remember(key, out)
    return out


def _portals(prefs: JobPrefs, search: ranking.Search) -> list[PortalOut]:
    city = next((c for c in search.locations if c in CITIES or c in WORLD_CITIES), None)
    keywords = search.keywords or (prefs.titles[0] if prefs.titles else "")
    return [PortalOut(id=p.id, name=p.name, url=p.url) for p in portal_links(
        keywords=keywords, city=city, posted_within=search.days, workplace=list(search.workplace),
        level=search.level, years=search.years, portals=prefs.portals, country=search.country)]


def _sources_out(statuses: list[refresh.SourceStatus]) -> list[SourceOut]:
    return [SourceOut(id=s.id, label=s.label, kind=s.kind, listings=s.listings, last_success_at=s.last_success_at,
                      refreshing=s.refreshing, failing=s.failing) for s in statuses]


# ---- profile -------------------------------------------------------------------------------------------------------


async def _profile_out(db: AsyncSession, user: User, row: JobSearchProfile | None, prefs: JobPrefs,
                       resume: Resume | None, note: str | None = None) -> ProfileOut:
    resumes = await _resumes(db, user)
    return ProfileOut(
        prefs=prefs, suggested=Suggested.model_validate(row.suggested) if row is not None and row.suggested else None,
        resume=ResumeRef(id=resume.id, title=resume.title) if resume else None,
        resumes=[ResumeRef(id=r.id, title=r.title) for r in resumes],
        ai_left=await _ai_left(db, user, "job_profile", get_settings().jobs_profile_daily), saved=row is not None,
        portals=portals_for(_country(user)), sources=[{"id": s.id, "label": s.label} for s in enabled_sources()],
        cities=[anywhere_for(_country(user)), *cities_for(_country(user))], note=note)


@router.get("/profile", response_model=ProfileOut, dependencies=[Depends(read_limit)])
async def get_profile(user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> ProfileOut:
    row, prefs, resume = await _profile(db, user)
    return await _profile_out(db, user, row, prefs, resume)


class ProfileIn(BaseModel):
    prefs: JobPrefs
    resume_id: str | None = Field(None, max_length=36)


@router.put("/profile", response_model=ProfileOut, dependencies=[Depends(read_limit)])
async def save_profile(body: ProfileIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> ProfileOut:
    resume = await _owned_resume(db, body.resume_id, user) if body.resume_id else None
    row = await db.get(JobSearchProfile, user.id)
    if row is None:
        row = JobSearchProfile(user_id=user.id)
        db.add(row)
    row.prefs = body.prefs.model_dump(mode="json")
    row.resume_id = resume.id if resume else None
    await db.commit()
    return await _profile_out(db, user, row, body.prefs, await _resume_for(db, user, row))


class SuggestIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


@router.post("/profile/suggest", response_model=ProfileOut, dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def suggest_profile(body: SuggestIn, user: Annotated[User, Depends(require_verified_email)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> ProfileOut:
    """Fill the profile from a resume: titles, seniority, skills and cities. The AI reads it once per resume content
    (asking again for the same resume is free and instant); past today's allowance, or if the AI is down, it's
    worked out from the resume without the AI, and `note` says so."""
    row = await db.get(JobSearchProfile, user.id)
    resume = await _resume_for(db, user, row, body.resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Make a resume in Resume AI first: your job feed is matched to it.")
    data = ResumeData.model_validate(resume.data or {})
    rhash = resume_hash(data)
    if row is None:
        row = JobSearchProfile(user_id=user.id)
        db.add(row)
    prev = JobPrefs.model_validate(row.prefs) if row.prefs else None
    note = None
    if row.suggested and row.suggested_hash == rhash:
        suggestion = Suggested.model_validate(row.suggested)
    else:
        async with _lock(user.id):
            left = await _ai_left(db, user, "job_profile", get_settings().jobs_profile_daily)
            suggestion = from_resume(data)
            if left == 0:
                note = "You've used today's AI profile reads, so this one is from your resume as written."
            else:
                try:
                    resp = await _generate(db, user, profile_request(data.visible(), suggestion.years,
                                                                     get_llm_provider(), user.country))
                    suggestion = parse_profile(resp.text, data)
                except (LLMError, ValueError) as e:
                    log.warning("job profile: AI unusable (%s); worked out from the resume", type(e).__name__)
                    note = "The AI couldn't read your resume just now, so this is from your resume as written."
        row.suggested, row.suggested_hash = suggestion.model_dump(mode="json"), rhash
    prefs = apply_suggestion(suggestion, prev)
    row.prefs, row.resume_id = prefs.model_dump(mode="json"), resume.id
    await db.commit()
    return await _profile_out(db, user, row, prefs, resume, note)


# ---- feed ----------------------------------------------------------------------------------------------------------


@router.get("/feed", response_model=FeedOut, dependencies=[Depends(feed_limit)])
async def feed(user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)],
               q: Annotated[str, Query(max_length=200)] = "", sort: Sort = "best",
               page: Annotated[int, Query(ge=1, le=200)] = 1,
               page_size: Annotated[int, Query(ge=1, le=50)] = PAGE_SIZE) -> FeedOut:
    row, prefs, resume = await _profile(db, user)
    search, parsed = _search(prefs, q, _country(user))
    await refresh.ensure_fresh(db, search_queries(prefs, parsed.keywords, _country(user)))
    data = _data(resume)
    matches = await _matches(db, user, search, data, sort)
    window = matches[(page - 1) * page_size: page * page_size]
    ids = [m.id for m in window]
    listings = {r.id: r for r in (await db.scalars(select(JobListing).options(defer(JobListing.description))
                                                   .where(JobListing.id.in_(ids)))).all()} if ids else {}
    tracked = await _tracked(db, user, ids)
    statuses = await refresh.statuses(db)
    return FeedOut(
        items=[_job_out(listings[m.id], m, tracked.get(m.id)) for m in window if m.id in listings],
        total=len(matches), page=page, page_size=page_size, has_more=page * page_size < len(matches),
        refreshing=any(s.refreshing for s in statuses), sources=_sources_out(statuses),
        portals=_portals(prefs, search), understood=parsed.understood, keywords=parsed.keywords,
        resume=ResumeRef(id=resume.id, title=resume.title) if resume else None, has_profile=row is not None)


# ---- one job -------------------------------------------------------------------------------------------------------


def _match_for(row: JobListing, prefs: JobPrefs, data: ResumeData | None) -> ranking.Match:
    """This job's score for the profile, without its filters (a job opened from the tracker still gets one)."""
    search = replace(_search(prefs, "")[0], days=3650, sources_off=[], exclude=[], locations=[], any_country=True,
                     workplace=["remote", "hybrid", "onsite"],
                     job_types=["full_time", "part_time", "contract", "internship"])
    matcher = SkillMatcher(resume_text(data.visible()) if data is not None else "", prefs.skills)
    found = ranking.rank([ranking.row_of(row)], search, matcher, now=datetime.now(UTC))
    if found:
        return found[0]
    considered = [k for k in (row.keywords or []) if matcher.has(k)]
    return ranking.Match(row.id, 10, considered[:6], [k for k in (row.keywords or []) if k not in considered][:6],
                         _aware(row.posted_at))


@router.get("/listings/{listing_id}", response_model=DetailOut, dependencies=[Depends(read_limit)])
async def get_listing(listing_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> DetailOut:
    row = await _listing(db, listing_id)
    _, prefs, resume = await _profile(db, user)
    data = _data(resume)
    entry = (await _tracked(db, user, [row.id])).get(row.id)
    check = None
    if data is not None:
        cached = await db.scalar(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
                                                           JobFitCheck.listing_id == row.id,
                                                           JobFitCheck.resume_hash == resume_hash(data)))
        check = fitcheck.FitCheck.model_validate(cached.result) if cached else None
    source = source_named(row.source)
    return DetailOut(job=_job_out(row, _match_for(row, prefs, data), entry),
                     full_text=not (source and source.snippet_only) and len(row.description) >= FULL_TEXT_MIN,
                     fit=check, tracker=_tracker_out(entry, True, _still_listed(row.source, row.fetched_at))
                     if entry else None)


@router.post("/listings/{listing_id}/fit", response_model=FitOut,
             dependencies=[Depends(ai_limit), Depends(ai_user_limit)])
async def fit_check(listing_id: str, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> FitOut:
    """How well the resume fits this job, by the AI: free, ORBIT_JOBS_FIT_DAILY a day (the admin has no cap). The
    same job and the same resume content are answered from the last check, at no cost to the allowance."""
    row = await _listing(db, listing_id)
    _, prefs, resume = await _profile(db, user)
    if resume is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Make a resume in Resume AI first: the fit check compares it with the job.")
    data = ResumeData.model_validate(resume.data or {})
    rhash = resume_hash(data)
    cap = get_settings().jobs_fit_daily
    async with _lock(user.id):
        cached = await db.scalar(select(JobFitCheck).where(JobFitCheck.user_id == user.id,
                                                           JobFitCheck.listing_id == row.id,
                                                           JobFitCheck.resume_hash == rhash))
        if cached is not None:
            return FitOut(check=fitcheck.FitCheck.model_validate(cached.result), cached=True,
                          left=await _ai_left(db, user, "job_fit", cap))
        left = await _ai_left(db, user, "job_fit", cap)
        if left == 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "fit_check_limit",
                "message": f"You've used today's {cap} free fit checks. They're back tomorrow ("
                           + ("at 5:30 am India time" if _country(user) == "IN" else "at midnight UTC")
                           + "). Checks you've already run stay open."})
        match = _match_for(row, prefs, data)
        job = {"title": row.title, "company": row.company, "location": _location_line(row),
               "text": row.description or row.snippet}
        try:
            resp = await _generate(db, user, fitcheck.fit_request(data.visible(), job, {
                "matched": match.matched, "missing": match.missing}, get_llm_provider(), user.country))
            check = fitcheck.parse_fit(resp.text, data, job, match.score, match.matched)
        except LLMError as e:
            log.warning("fit check failed: %s", e)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The AI isn't available right now. Try again in a moment.") from e
        except ValueError as e:
            log.warning("fit check unusable: %s", e)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI's answer came back garbled. Try again.") from e
        db.add(JobFitCheck(user_id=user.id, listing_id=row.id, resume_hash=rhash, result=fitcheck.as_json(check)))
        await db.commit()
        return FitOut(check=check, cached=False, left=None if left is None else max(left - 1, 0))


async def _full_text(db: AsyncSession, row: JobListing) -> tuple[str, str | None]:
    """The post's text for tailoring or prep, and a note when Orbit only has its snippet. A short post is fetched
    from its page once (SSRF-safe, prep/job_link.py) and kept."""
    source = source_named(row.source)
    text = row.description or row.snippet
    if len(text) >= FULL_TEXT_MIN and not (source and source.snippet_only):
        return text, None
    try:
        posting = await job_link.fetch_job_posting(row.url)
    except job_link.JobLinkError as e:
        log.info("jobs: couldn't read the full post for %s: %s", row.id, e)
        return text, ("Orbit only has a short summary of this job, so there's less to work with. Paste the full post "
                      "from the job's page if you can.")
    if len(posting.text) > len(text):
        row.description = posting.text[:20_000]
        text = row.description
    return text, None


def _job_text(row: JobListing, text: str) -> str:
    head = "\n".join(x for x in (row.title, " · ".join(x for x in (row.company, _location_line(row)) if x),
                                 f"Original post: {row.url}") if x)
    return f"{head}\n\n{text}".strip()[:MAX_JOB_TEXT]


class TailorIn(BaseModel):
    resume_id: str | None = Field(None, max_length=36)


class TailorOut(BaseModel):
    resume_id: str
    title: str
    note: str | None
    tracker_id: str  # the job is in the tracker now (saved), with this resume attached


@router.post("/listings/{listing_id}/tailor", response_model=TailorOut, status_code=201,
             dependencies=[Depends(action_limit)])
async def tailor(listing_id: str, body: TailorIn, user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> TailorOut:
    """A copy of the resume aimed at this job (its job post filled in), for the resume maker's Tailor and score to
    work on. The original is left as it was."""
    row = await _listing(db, listing_id)
    profile = await db.get(JobSearchProfile, user.id)
    resume = await _resume_for(db, user, profile, body.resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Make a resume in Resume AI first, then tailor it to this job.")
    count = await db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == user.id))
    if (count or 0) >= MAX_RESUMES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    text, note = await _full_text(db, row)
    copy = Resume(user_id=user.id, title=f"{resume.title} · {row.company}"[:160], data=resume.data,
                  design=resume.design, job_text=_job_text(row, text), cover_letter="")
    db.add(copy)
    await db.flush()
    entry = await _track(db, user, row)
    entry.resume_id = copy.id
    await db.commit()
    return TailorOut(resume_id=copy.id, title=copy.title, note=note, tracker_id=entry.id)


class PrepareOut(BaseModel):
    document_id: str
    title: str
    reused: bool
    note: str | None
    tracker_id: str  # the tracker entry the job description is attached to


@router.post("/listings/{listing_id}/prepare", response_model=PrepareOut, dependencies=[Depends(action_limit)])
async def prepare(listing_id: str, user: Annotated[User, Depends(require_verified_user)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> PrepareOut:
    """Save the job description to Documents (once per job), where Practice's interview prep and mock interview use
    the newest one by default."""
    from orbit_api.documents.routes import _check_quota, _ingest  # the documents' own quota and chunking

    row = await _listing(db, listing_id)
    entry = (await _tracked(db, user, [row.id])).get(row.id)
    if entry is not None and entry.document_id:
        doc = await db.get(Document, entry.document_id)
        if doc is not None and doc.user_id == user.id:
            return PrepareOut(document_id=doc.id, title=doc.title, reused=True, note=None, tracker_id=entry.id)
    await _check_quota(db, user)
    text, note = await _full_text(db, row)
    body = _job_text(row, text)
    doc = Document(user_id=user.id, title=f"{row.title} — {row.company}"[:300], kind="job_description",
                   size_bytes=len(body.encode()))
    db.add(doc)
    await db.flush()
    await _ingest(db, doc, body)
    entry = await _track(db, user, row)
    entry.document_id = doc.id
    await db.commit()
    return PrepareOut(document_id=doc.id, title=doc.title, reused=False, note=note, tracker_id=entry.id)


# ---- tracker -------------------------------------------------------------------------------------------------------


async def _owned_entry(db: AsyncSession, entry_id: str, user: User) -> JobApplication:
    entry = await db.get(JobApplication, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not in your tracker")
    return entry


async def _live(db: AsyncSession, entries: list[JobApplication]) -> dict[str, datetime | None]:
    """The entries' listings still in the feed's cache: listing id -> when it was last seen on the company's own
    careers page (None for a feed's or a search's post). Jobs added by hand ("ext:") are never in it."""
    ids = [e.listing_id for e in entries if not manual.is_manual(e.listing_id)]
    if not ids:
        return {}
    rows = (await db.execute(select(JobListing.id, JobListing.source, JobListing.fetched_at)
                             .where(JobListing.id.in_(ids)))).all()
    return {lid: _still_listed(source, fetched) for lid, source, fetched in rows}


@router.get("/tracker", response_model=list[TrackerOut], dependencies=[Depends(read_limit)])
async def list_tracker(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> list[TrackerOut]:
    rows = list((await db.scalars(select(JobApplication).where(JobApplication.user_id == user.id)
                                  .order_by(JobApplication.status_at.desc()))).all())
    live = await _live(db, rows)
    return [_tracker_out(r, r.listing_id in live, live.get(r.listing_id)) for r in rows]


class TrackIn(BaseModel):
    listing_id: str = Field(max_length=36)
    status: Status = "saved"


@router.post("/tracker", response_model=TrackerOut, status_code=201, dependencies=[Depends(read_limit)])
async def track(body: TrackIn, user: Annotated[User, Depends(current_user)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> TrackerOut:
    """Save a job (or mark it applied) from the feed. Saving one that's already tracked moves it to `status`."""
    row = await _listing(db, body.listing_id)
    entry = await _track(db, user, row, body.status)
    _move(entry, body.status)
    await db.commit()
    await db.refresh(entry)
    return _tracker_out(entry, True, _still_listed(row.source, row.fetched_at))


def _move(entry: JobApplication, to: Status) -> None:
    if entry.status != to:
        entry.status, entry.status_at = to, datetime.now(UTC)
    if to == "applied" and entry.applied_at is None:
        entry.applied_at = datetime.now(UTC)


class TrackPatch(BaseModel):
    status: Status | None = None
    notes: str | None = Field(None, max_length=4_000)
    applied_at: datetime | None = None
    next_at: datetime | None = None
    clear_next: bool = False


@router.patch("/tracker/{entry_id}", response_model=TrackerOut, dependencies=[Depends(read_limit)])
async def update_tracker(entry_id: str, body: TrackPatch, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> TrackerOut:
    entry = await _owned_entry(db, entry_id, user)
    if body.status is not None:
        _move(entry, body.status)
    if body.notes is not None:
        entry.notes = body.notes
    if body.applied_at is not None:
        entry.applied_at = body.applied_at
    if body.next_at is not None or body.clear_next:
        entry.next_at = None if body.clear_next else body.next_at
    await db.commit()
    await db.refresh(entry)
    live = await _live(db, [entry])
    return _tracker_out(entry, entry.listing_id in live, live.get(entry.listing_id))


@router.delete("/tracker/{entry_id}", status_code=204, dependencies=[Depends(read_limit)])
async def delete_tracker(entry_id: str, user: Annotated[User, Depends(current_user)],
                         db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await db.delete(await _owned_entry(db, entry_id, user))
    await db.commit()


# ---- jobs found elsewhere ------------------------------------------------------------------------------------------


class LinkIn(BaseModel):
    url: str = Field(max_length=manual.MAX_URL + 100)


class LinkOut(BaseModel):
    url: str  # tidied: what's saved
    site: str  # "Naukri", "LinkedIn", or the site's host
    title: str  # "" when the address doesn't say. Read from the address: guesses, for the user to check
    company: str
    location: str
    listing_id: str | None  # the same post is in Orbit's feed: it's tracked as that post, with its own page
    tracked: TrackedRef | None  # this link is already on the tracker


async def _listing_at(db: AsyncSession, *urls: str) -> JobListing | None:
    """A post in the feed's cache at one of these addresses (its page or its apply link)."""
    wanted = [u for u in dict.fromkeys(u.strip() for u in urls) if u]
    if not wanted:
        return None
    return (await db.scalars(select(JobListing).options(defer(JobListing.description)).where(
        or_(JobListing.url.in_(wanted), JobListing.apply_url.in_(wanted))).limit(1))).first()


async def _already(db: AsyncSession, user: User, urls: list[str], listing: JobListing | None,
                   company: str = "", title: str = "") -> JobApplication | None:
    """This job on the user's tracker already: the same post, the same link, or (typed in, no link) the same company
    and title among the jobs added by hand."""
    if listing is not None and (hit := (await _tracked(db, user, [listing.id])).get(listing.id)):
        return hit
    mine = select(JobApplication).where(JobApplication.user_id == user.id)
    wanted = [u for u in dict.fromkeys(u.strip() for u in urls) if u]
    if wanted:
        return (await db.scalars(mine.where(or_(JobApplication.url.in_(wanted), JobApplication.apply_url.in_(wanted)))
                                 .limit(1))).first()
    if not company or not title:
        return None
    key = (company.casefold(), title.casefold())
    rows = (await db.scalars(mine.where(JobApplication.listing_id.startswith(manual.EXT_PREFIX)))).all()
    return next((r for r in rows if (r.company.casefold(), r.title.casefold()) == key), None)


def _read_link(url: str) -> manual.JobLink:
    try:
        return manual.read_link(url)
    except manual.LinkError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e


@router.post("/tracker/link", response_model=LinkOut, dependencies=[Depends(read_limit)])
async def read_tracker_link(body: LinkIn, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> LinkOut:
    """What a job's link says, for "Add a job you found elsewhere" to fill in before saving: the site, and the title,
    company and city where the address has them. Read from the address alone, never fetched. A post that's in Orbit's
    feed comes back as that post; a link already on the tracker says so."""
    link = _read_link(body.url)
    listing = await _listing_at(db, link.url, body.url)
    dup = await _already(db, user, [link.url, body.url], listing)
    title, company, where = ((listing.title, listing.company, _location_line(listing)) if listing is not None
                             else (link.title, link.company, link.location))
    return LinkOut(url=link.url, site=link.site, title=title, company=company, location=where,
                   listing_id=listing.id if listing is not None else None,
                   tracked=TrackedRef(id=dup.id, status=dup.status) if dup else None)


class ManualIn(BaseModel):
    url: str = Field("", max_length=manual.MAX_URL + 100)
    company: str = Field("", max_length=200)
    title: str = Field("", max_length=300)
    location: str = Field("", max_length=300)
    status: Status = "saved"
    applied_at: datetime | None = None  # "applied" (or further along) without one: now
    next_at: datetime | None = None
    notes: str = Field("", max_length=4_000)
    document_id: str | None = Field(None, max_length=36)  # the job post saved to Documents, for Practice


@router.post("/tracker/manual", response_model=TrackerOut, status_code=201,
             dependencies=[Depends(read_limit), Depends(manual_limit)])
async def track_manual(body: ManualIn, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> TrackerOut:
    """Track a job found elsewhere (Naukri, LinkedIn, a campus portal, a company's own site), from its link or typed
    in. What was typed wins; the rest comes from the link's address. A link that's a post in Orbit's feed is tracked
    as that post (it keeps its page and its "still open"); one already on the tracker is refused (409,
    `already_tracked`, with its `id`)."""
    link = _read_link(body.url) if body.url.strip() else None
    urls = [link.url, body.url] if link else []
    listing = await _listing_at(db, *urls)
    company = manual.clean_text(body.company, 200) or (link.company if link else "")
    title = manual.clean_text(body.title, 300) or (link.title if link else "")
    if listing is None and (not company or not title):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Add the company and the job title: Orbit couldn't read them from the link." if link
                            else "Add the company and the job title, or paste the job's link.")
    doc = await db.get(Document, body.document_id) if body.document_id else None
    if body.document_id and (doc is None or doc.user_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    dup = await _already(db, user, urls, listing, company, title)
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "already_tracked", "id": dup.id,
            "message": f"{dup.title} at {dup.company} is already on your tracker."})
    now = datetime.now(UTC)
    if listing is not None:
        entry = await _track(db, user, listing, body.status)
    else:
        await _room(db, user)
        entry = JobApplication(user_id=user.id, listing_id=manual.new_listing_id(), source=manual.SOURCE,
                               company=company, title=title,
                               location=manual.clean_text(body.location, 300) or (link.location if link else ""),
                               url=link.url if link else "", apply_url=link.url if link else "", posted_at=None,
                               status=body.status, status_at=now)
        db.add(entry)
    if body.applied_at is not None:
        entry.applied_at = body.applied_at
    elif entry.applied_at is None and body.status in ("applied", "interviewing", "offer"):
        entry.applied_at = now
    entry.next_at = body.next_at
    entry.notes = manual.clean_notes(body.notes)
    if doc is not None:
        entry.document_id = doc.id
    await db.commit()
    await db.refresh(entry)
    return _tracker_out(entry, listing is not None,
                        _still_listed(listing.source, listing.fetched_at) if listing is not None else None)


# ---- public --------------------------------------------------------------------------------------------------------

STATS_DAYS = 7
STATS_TTL_S = 600


class StatsOut(BaseModel):
    jobs: int  # posted in the last STATS_DAYS days, in the cache the feed ranks
    companies: int  # how many companies those are from
    days: int
    feeds: list[str]  # the job boards credited by name (Himalayas, Remote OK, Jobicy)
    updated_at: datetime | None  # the last successful fetch from any source
    fit_daily: int  # free AI fit checks a day (ORBIT_JOBS_FIT_DAILY)
    profile_daily: int  # free AI profile reads a day (ORBIT_JOBS_PROFILE_DAILY)


_stats: tuple[float, StatsOut] | None = None


def clear_stats_cache() -> None:
    global _stats
    _stats = None


@router.get("/stats", response_model=StatsOut, dependencies=[Depends(stats_limit)])
async def stats(db: Annotated[AsyncSession, Depends(get_db)]) -> StatsOut:
    """Jobs AI's public page, signed out: counts from the shared job cache and the free daily allowances. No user
    data, read-only; worked out at most every STATS_TTL_S seconds, and never starts a refresh."""
    global _stats
    if _stats is not None and time.monotonic() - _stats[0] < STATS_TTL_S:
        return _stats[1]
    since = datetime.now(UTC) - timedelta(days=STATS_DAYS)
    jobs, companies = (await db.execute(
        select(func.count(), func.count(func.distinct(JobListing.company))).where(JobListing.posted_at >= since))).one()
    statuses = await refresh.statuses(db)
    settings = get_settings()
    out = StatsOut(jobs=int(jobs), companies=int(companies), days=STATS_DAYS,
                   feeds=[s.label for s in enabled_sources() if s.kind != "board"],
                   updated_at=max((s.last_success_at for s in statuses if s.last_success_at), default=None),
                   fit_daily=settings.jobs_fit_daily, profile_daily=settings.jobs_profile_daily)
    _stats = (time.monotonic(), out)
    return out
