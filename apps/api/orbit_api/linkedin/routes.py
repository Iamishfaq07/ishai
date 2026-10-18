"""LinkedIn AI: read the user's LinkedIn profile (LinkedIn's "Save to PDF", or the text pasted), audit it against the
role they're after and what job posts for it ask for, flag where it disagrees with their Orbit resume, and fix it a
part at a time, like Resume AI.

- Reading is AI (free, a few a day); the audit is measured, so changing the target role re-audits at no cost.
- `POST /fix` writes one part (linkedin/fixes.py): the headline, the About, a role's description, Featured ideas or
  a recommendation request by the AI, priced as one of Resume AI's single fixes (`Allowance.as_fix`, a fraction of
  a resume credit); skills, a custom URL, the photo checklist and the Open-to-work settings are worked out here and
  free. It writes from the profile, the user's resume, or both (their pick).
- `POST /rewrite` is the whole-profile rewrite from a resume (Resume AI's LinkedIn writer, one resume credit): a
  headline, About and skills, as suggestions.
- Each suggestion is kept with the profile (linkedin/suggestions.py): apply it to Orbit's copy (the audit re-scores),
  put it back, tick it done on LinkedIn, pick a headline option, edit it, or drop it.
The credit is claimed just before the model is called and given back if the call fails, the answer is unusable, or
the request is cancelled (resumes/routes.py `_spend`), so it's kept only for a suggestion actually delivered.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import Counter
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.documents.parsing import ParseError, detect_format, extract_text_isolated
from orbit_api.job_portal import refresh
from orbit_api.job_portal.ranking import title_tokens
from orbit_api.job_portal.skills import WEAK, display, same_skill
from orbit_api.linkedin import audit as auditmod
from orbit_api.linkedin import fixes
from orbit_api.linkedin import suggestions as sug
from orbit_api.linkedin.read import Profile, parse_read, read_request
from orbit_api.linkedin.suggestions import Option, Part, State, Suggestion, SuggestionOut
from orbit_api.models import JobListing, LinkedInProfileRow, User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMRequest
from orbit_api.ratelimit import limit, limit_user
from orbit_api.region import market_country
from orbit_api.resumes import kit
from orbit_api.resumes.allowance import Allowance
from orbit_api.resumes.routes import _generate, _owned, _spend, account_allowance, ai_limit, ai_user_limit
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/linkedin", tags=["linkedin"])
read_limit = Depends(limit_user("linkedin-read", rate_per_s=3, burst=60))
ai_limits = [Depends(limit("linkedin-ai", rate_per_s=0.5, burst=20)),
             Depends(limit_user("linkedin-ai-user", rate_per_s=10 / 3600, burst=5))]
# An AI fix is Resume AI's kind of call, spending its credits, so it counts against Resume AI's limits
# (resumes/routes.py); a fix worked out here (skills, the URL, a checklist) only against a light one of its own.
fix_limits = [Depends(ai_limit), Depends(ai_user_limit)]
free_fix_limit = limit_user("linkedin-free-fix", rate_per_s=1, burst=30)
fix_ip_limit = Depends(limit("linkedin-fix", rate_per_s=1, burst=40))
MIN_TEXT = 200
MAX_KEYWORDS = 15


class CheckOut(BaseModel):
    id: str
    section: str
    ok: bool
    points: int
    max: int
    title: str
    tip: str
    part: str | None = None
    kind: str = "you"
    role: int | None = None
    known: bool = True
    gain: int = 0


class RoleScoreOut(BaseModel):
    index: int
    label: str
    points: int
    max: int


class SectionOut(BaseModel):
    id: str
    label: str
    points: int
    max: int
    known: bool
    roles: list[RoleScoreOut] = []


class RaiseOut(BaseModel):
    part: str | None
    role: int | None
    label: str
    gain: int
    kind: str
    checks: list[str]


class AuditOut(BaseModel):
    score: int
    checks: list[CheckOut]
    keywords: list[str]
    found: list[str]
    missing: list[str]
    mismatches: list[str]
    posts: int  # how many job posts the keywords came from
    sections: list[SectionOut] = []
    raise_it: list[RaiseOut] = []  # what would raise the score, biggest gain first


class ScoresOut(BaseModel):
    read: int  # the profile as read from LinkedIn
    now: int  # Orbit's copy, with what's been applied
    projected: int  # with every suggestion applied


class ProgressOut(BaseModel):
    done: int  # suggestions ticked done on LinkedIn
    total: int


class LinkedInOut(BaseModel):
    profile: Profile | None  # Orbit's copy
    read: Profile | None = None  # as read from LinkedIn
    target_role: str
    audit: AuditOut | None
    read_at: datetime | None
    reads_left: int | None  # AI reads left today; None = no cap (the admin)
    scores: ScoresOut | None = None
    suggestions: list[SuggestionOut] = []
    progress: ProgressOut = ProgressOut(done=0, total=0)


class FixOut(LinkedInOut):
    suggestion_id: str  # the suggestion just written


_kw_cache: dict[tuple[str, str, int], tuple[list[str], int]] = {}


async def market_keywords(db: AsyncSession, role: str, country: str) -> tuple[list[str], int]:
    """The skills job posts for this role ask for most (each post counts once per skill), and how many posts."""
    want = title_tokens(role)
    if not want:
        return [], 0
    key = (" ".join(sorted(want)), country, refresh.version())
    if key in _kw_cache:
        return _kw_cache[key]
    rows = (await db.execute(select(JobListing.title, JobListing.keywords)
                             .where((JobListing.country == country) | (JobListing.workplace == "remote")))).all()
    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    posts = 0
    for title, kws in rows:
        if not want <= title_tokens(title):
            continue
        posts += 1
        for k in {same_skill(k): k for k in (kws or []) if k.lower() not in WEAK}.items():
            counts[k[0]] += 1
            names.setdefault(k[0], display(k[1]))
    top = [names[k] for k, n in counts.most_common(MAX_KEYWORDS * 2) if n >= 2][:MAX_KEYWORDS]
    out = (top, posts) if posts >= 3 else ([], posts)
    if len(_kw_cache) > 300:
        _kw_cache.clear()
    _kw_cache[key] = out
    return out


async def _default_target(db: AsyncSession, user: User, profile: Profile | None) -> str:
    from orbit_api.job_portal.routes import _profile

    _, prefs, _ = await _profile(db, user)
    if prefs.titles:
        return prefs.titles[0]
    if profile and profile.experience:
        return profile.experience[0].title
    return ""


async def _resume_roles(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    from orbit_api.job_portal.routes import _data, _profile

    _, _, resume = await _profile(db, user)
    data = _data(resume)
    return [(e.title, e.company) for e in data.experience] if data is not None else []


def _audit_out(a: auditmod.Audit, posts: int) -> AuditOut:
    return AuditOut(
        score=a.score, checks=[CheckOut(**c.__dict__) for c in a.checks], keywords=a.keywords, found=a.found,
        missing=a.missing, mismatches=a.mismatches, posts=posts,
        sections=[SectionOut(id=s.id, label=s.label, points=s.points, max=s.max, known=s.known,
                             roles=[RoleScoreOut(**r.__dict__) for r in s.roles]) for s in a.sections],
        raise_it=[RaiseOut(**r.__dict__) for r in a.raise_it])


async def _out(db: AsyncSession, user: User, row: LinkedInProfileRow | None,
               request: Request | None = None) -> LinkedInOut:
    from orbit_api.job_portal.routes import _ai_left

    left = await _ai_left(db, user, "linkedin_read", get_settings().linkedin_read_daily)
    if row is None:
        return LinkedInOut(profile=None, target_role=await _default_target(db, user, None), audit=None, read_at=None,
                           reads_left=left)
    profile, state = sug.load(row.data)
    read = state.read or profile
    target = row.target_role or await _default_target(db, user, profile)
    keywords, posts = await market_keywords(db, target, market_country(user.country, request))
    roles = await _resume_roles(db, user)

    def work() -> tuple[auditmod.Audit, int, int]:
        # CPU-bound (regexes over the profile, a few times over): off the event loop.
        a = auditmod.audit(profile, target, keywords, roles)

        def score(p: Profile) -> int:
            return auditmod.audit(p, target, keywords).score

        return a, score(read), score(sug.projected(profile, state.suggestions, score))

    a, before, after = await asyncio.to_thread(work)
    return LinkedInOut(profile=profile, read=read, target_role=target, read_at=row.updated_at, reads_left=left,
                       audit=_audit_out(a, posts), scores=ScoresOut(read=before, now=a.score, projected=after),
                       suggestions=[sug.out(profile, s) for s in state.suggestions],
                       progress=ProgressOut(done=sum(s.done for s in state.suggestions),
                                            total=len(state.suggestions)))


async def _row(db: AsyncSession, user: User) -> LinkedInProfileRow:
    row = await db.get(LinkedInProfileRow, user.id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Read your LinkedIn profile first.")
    return row


@router.get("", response_model=LinkedInOut, dependencies=[read_limit])
async def get_linkedin(request: Request, user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    return await _out(db, user, await db.get(LinkedInProfileRow, user.id), request)


class TargetIn(BaseModel):
    target_role: str = Field(min_length=2, max_length=200)


@router.put("/target", response_model=LinkedInOut, dependencies=[read_limit])
async def set_target(request: Request, body: TargetIn, user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    row = await _row(db, user)
    row.target_role = " ".join(body.target_role.split())
    await db.commit()
    return await _out(db, user, row, request)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, dependencies=[read_limit])
async def delete_linkedin(user: Annotated[User, Depends(current_user)],
                          db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    row = await db.get(LinkedInProfileRow, user.id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# One per user: a read, a fix being stored and an apply don't write the row's JSON over each other. One API instance
# (docs/DECISIONS.md D12), so memory is enough.
_locks: dict[str, asyncio.Lock] = {}


def _lock(user: User) -> asyncio.Lock:
    return _locks.setdefault(user.id, asyncio.Lock())


async def _read(db: AsyncSession, user: User, text: str, request: Request) -> LinkedInOut:
    from orbit_api.job_portal.routes import _ai_left
    from orbit_api.job_portal.routes import _generate as _free_generate

    text = text.strip()
    if len(text) < MIN_TEXT:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "There isn't enough of a profile there. Use LinkedIn's Save to PDF, or paste the whole "
                            "profile.")
    cap = get_settings().linkedin_read_daily
    async with _lock(user):
        if await _ai_left(db, user, "linkedin_read", cap) == 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "linkedin_read_limit",
                "message": f"You've read your profile {cap} times today. Reads are back tomorrow; the audit "
                           "below still updates."})
        try:
            resp = await _free_generate(db, user, read_request(text, get_llm_provider()))
            profile = await asyncio.to_thread(parse_read, resp.text, text)
        except LLMError as e:
            log.warning("linkedin read failed: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "The AI isn't available right now. Try again in a moment.") from e
        except ValueError as e:
            log.warning("linkedin read unusable: %s", e)
            await db.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Orbit couldn't read a LinkedIn profile from that. Use LinkedIn's Save to PDF.") from e
        row = await db.get(LinkedInProfileRow, user.id)
        if row is None:
            row = LinkedInProfileRow(user_id=user.id, target_role="")
            db.add(row)
            state = State(read=profile)
        else:
            # A new read: Orbit's copy is LinkedIn's again; the suggestions stay, ticked done where LinkedIn has them.
            _, old = sug.load(row.data)
            state = sug.after_read(old, profile)
        row.data = sug.dump(profile, state)
        await db.commit()
        await db.refresh(row)
        return await _out(db, user, row, request)


class ReadIn(BaseModel):
    text: str = Field(max_length=60_000)


@router.post("/read", response_model=LinkedInOut, dependencies=ai_limits)
async def read_text(request: Request, body: ReadIn, user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    return await _read(db, user, body.text, request)


@router.post("/read-file", response_model=LinkedInOut, dependencies=ai_limits)
async def read_file(request: Request, file: Annotated[UploadFile, File()],
                    user: Annotated[User, Depends(require_verified_email)],
                    db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """LinkedIn's "Save to PDF" (profile → More → Save to PDF). The file isn't kept."""
    max_bytes = get_settings().max_upload_bytes
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Max file size is {max_bytes // 1_048_576} MB.")
    filename = (file.filename or "profile.pdf").replace("\\", "/").rsplit("/", 1)[-1][:300]
    try:
        fmt = detect_format(filename, file.content_type, raw[:8])
        text = await asyncio.to_thread(extract_text_isolated, raw, fmt)
    except ParseError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    return await _read(db, user, text, request)


# ---- fixes ----------------------------------------------------------------------------------------------------


class FixIn(BaseModel):
    part: Part
    role: int | None = Field(None, ge=0, lt=30)  # experience, recommendation: the role's place in the profile
    source: Literal["profile", "resume", "both"] = "profile"
    resume_id: str | None = Field(None, min_length=1, max_length=36)
    recipient: str = Field("", max_length=80)  # recommendation: who it's to ("Priya Nair")


async def _resume(db: AsyncSession, user: User, resume_id: str | None) -> ResumeData:
    if not resume_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick the resume to write it from.")
    r = await _owned(db, resume_id, user)  # 404 for someone else's, before anything is spent
    return ResumeData.model_validate(r.data or {}).visible()  # a hidden section never reaches the AI


async def _sources(db: AsyncSession, user: User, row: LinkedInProfileRow, request: Request,
                   source: str, resume_id: str | None) -> fixes.Sources:
    profile, _ = sug.load(row.data)
    resume = await _resume(db, user, resume_id) if source != "profile" else None
    target = row.target_role or await _default_target(db, user, profile)
    keywords, _ = await market_keywords(db, target, market_country(user.country, request))
    return fixes.Sources(profile=profile, use_profile=source != "resume", resume=resume, target=target,
                         market=keywords, country=user.country)


async def _store(db: AsyncSession, user: User, row: LinkedInProfileRow, *new: Suggestion,
                 add_options: bool = False) -> None:
    async with _lock(user):
        await db.refresh(row)  # whatever landed while the AI was writing
        profile, state = sug.load(row.data)
        for s in reversed(new):
            state = sug.put(state, s, add_options=add_options)
        row.data = sug.dump(profile, state)
        await db.commit()


def _unusable(what: str) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY,
                         f"The AI's {what} came back unusable, so nothing was spent. Try again.")


async def _ai_fix(db: AsyncSession, user: User, body: FixIn, src: fixes.Sources, allowance: Allowance) -> Suggestion:
    """One AI-written part. Any failure here (the AI down, an answer that doesn't pass the checks) reaches `_spend`,
    which gives the credit back."""
    llm = get_llm_provider()
    part, i = body.part, body.role or 0

    async def ask(req: LLMRequest) -> str:
        return (await _generate(db, user, req, f"linkedin {part}", allowance)).text

    try:
        if part == "headline":
            options = fixes.parse_headline(await ask(fixes.headline_request(src, llm)), src)
            return fixes.headline_suggestion(src, options)
        if part == "about":
            return fixes.about_suggestion(src, fixes.parse_about(await ask(fixes.about_request(src, llm)), src))
        if part == "experience":
            text, holes = fixes.parse_role(await ask(fixes.role_request(src, i, llm)), src, i)
            return fixes.role_suggestion(src, i, text, holes)
        if part == "featured":
            ideas = fixes.parse_featured(await ask(fixes.featured_request(src, llm)), src)
            return fixes.featured_suggestion(src, ideas)
        message = fixes.parse_recommendation(
            await ask(fixes.recommendation_request(src, i, body.recipient, llm)), src, i, body.recipient)
        return fixes.recommendation_suggestion(src, i, message)
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("linkedin fix %s unusable: %s", part, e)
        raise _unusable({"headline": "headlines", "about": "About", "experience": "bullets",
                         "featured": "ideas"}.get(part, "message")) from e


def _free_fix(body: FixIn, src: fixes.Sources) -> Suggestion:
    p = src.profile
    if body.part == "skills":
        made = fixes.skills_fix(src)
        if made is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "Your skills already lead with what employers ask for, and there's nothing new in "
                                "your sources to add.")
        return made
    if body.part == "url":
        url = fixes.url_fix(p, src.target)
        if url is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "Orbit needs your name from the profile to suggest an address.")
        return url
    if body.part == "photo":
        return fixes.photo_fix(p)
    return fixes.open_to_work_fix(p, src.target)


@router.post("/fix", response_model=FixOut, dependencies=[fix_ip_limit])
async def fix(request: Request, body: FixIn, user: Annotated[User, Depends(require_verified_email)],
              db: Annotated[AsyncSession, Depends(get_db)],
              allowance: Annotated[Allowance, Depends(account_allowance)]) -> FixOut:
    """One part of the profile, written as a suggestion and kept with the profile. The AI's parts cost one single
    fix (a fraction of a resume credit), given back if nothing usable comes of it; the rest are free."""
    if body.part in fixes.FREE_PARTS:
        await free_fix_limit(user)
    else:
        ai_limit(request)
        await ai_user_limit(user)
    row = await _row(db, user)
    src = await _sources(db, user, row, request, body.source, body.resume_id)
    if body.part in ("experience", "recommendation"):
        if body.role is None or body.role >= len(src.profile.experience):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick one of the roles on your profile.")
        if body.part == "experience" and not src.use_profile and fixes.resume_role(src, body.role) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "Your resume doesn't have this role, so there's nothing to write it from. Write it "
                                "from your profile, or from both.")
    if body.part in fixes.FREE_PARTS:
        made = _free_fix(body, src)
        await _store(db, user, row, made)
    else:
        allowance.as_fix()  # one part of the profile: a fraction of a credit, like one of Resume AI's fixes

        async def run() -> Suggestion:
            s = await _ai_fix(db, user, body, src, allowance)
            await _store(db, user, row, s)  # inside `_spend`: a suggestion that isn't kept isn't paid for
            return s

        made = await _spend(allowance, run())
    out = await _out(db, user, row, request)
    return FixOut(**out.model_dump(), suggestion_id=made.id)


class RewriteIn(BaseModel):
    resume_id: str = Field(min_length=1, max_length=36)


@router.post("/rewrite", response_model=LinkedInOut, dependencies=fix_limits)
async def rewrite(request: Request, body: RewriteIn, user: Annotated[User, Depends(require_verified_email)],
                  db: Annotated[AsyncSession, Depends(get_db)],
                  allowance: Annotated[Allowance, Depends(account_allowance)]) -> LinkedInOut:
    """"Rewrite everything" from a resume: Resume AI's LinkedIn writer (one resume credit) for the headline, About and
    top skills, stored as suggestions like any fix."""
    row = await _row(db, user)
    src = await _sources(db, user, row, request, "resume", body.resume_id)
    data = kit._ready(src.resume or ResumeData())  # 422 before anything is spent
    brief = "\n\n".join(x for x in (src.target, f"Skills employers ask for: {', '.join(src.market)}"
                                    if src.market else "") if x)

    async def run() -> None:
        req = kit.profile_request("linkedin", data, brief, await kit._matched_keywords(data, brief), user.country)
        resp = await _generate(db, user, req, "linkedin rewrite", allowance)
        try:
            written = kit.parse_linkedin(resp.text, data, brief)
        except (ValueError, json.JSONDecodeError) as e:
            log.warning("linkedin rewrite unusable: %s", e)
            raise _unusable("rewrite") from e
        made = [fixes.headline_suggestion(src, [Option(label="From your resume", text=written.headline)]),
                fixes.about_suggestion(src, written.about)]
        if (skills := fixes.skills_fix(src)) is not None:
            top = list(dict.fromkeys([*written.skills, *skills.items]))
            made.append(skills.model_copy(update={"items": top, "after": ", ".join(top), "ai": True}))
        await _store(db, user, row, *made, add_options=True)  # its headline joins the options already there

    await _spend(allowance, run())
    return await _out(db, user, row, request)


# ---- one suggestion ---------------------------------------------------------------------------------------------

Change = Callable[[Profile, State, Suggestion], tuple[Profile, State]]


async def _change(db: AsyncSession, user: User, sid: str, request: Request, change: Change) -> LinkedInOut:
    """The user's own suggestion (404 if it isn't one of theirs), changed by `change` under the row's lock."""
    row = await _row(db, user)
    async with _lock(user):
        await db.refresh(row)
        profile, state = sug.load(row.data)
        s = next((x for x in state.suggestions if x.id == sid), None)
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That suggestion isn't there any more.")
        profile, state = change(profile, state, s)
        row.data = sug.dump(profile, state)
        await db.commit()
    return await _out(db, user, row, request)


def _applies(p: Profile, s: Suggestion) -> None:
    if s.part not in sug.APPLIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "This one isn't part of your profile's text: copy it, then tick it done.")
    if s.part == "experience" and sug.find_role(p, s.role_key) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That role isn't on your profile any more.")


@router.post("/suggestions/{sid}/apply", response_model=LinkedInOut, dependencies=[read_limit])
async def apply_suggestion(sid: str, request: Request, user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """Into Orbit's copy of the profile: the audit re-scores as if it were on LinkedIn."""
    def change(p: Profile, state: State, s: Suggestion) -> tuple[Profile, State]:
        _applies(p, s)
        return sug.apply(p, s), state

    return await _change(db, user, sid, request, change)


@router.post("/suggestions/{sid}/unapply", response_model=LinkedInOut, dependencies=[read_limit])
async def unapply_suggestion(sid: str, request: Request, user: Annotated[User, Depends(current_user)],
                             db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """That part of Orbit's copy back as it was read from LinkedIn."""
    def change(p: Profile, state: State, s: Suggestion) -> tuple[Profile, State]:
        _applies(p, s)
        return sug.unapply(p, state.read or p, s), state

    return await _change(db, user, sid, request, change)


class SuggestionPatch(BaseModel):
    done: bool | None = None  # done on LinkedIn
    choice: int | None = Field(None, ge=0, le=4)  # which option (a headline, a URL)
    checked: list[int] | None = Field(None, max_length=100)  # a checklist's steps ticked
    after: str | None = Field(None, min_length=1, max_length=4_000)  # the user's own edit


EDITABLE = frozenset({"headline", "about", "experience", "recommendation"})


def _patched(s: Suggestion, body: SuggestionPatch) -> Suggestion:
    update: dict[str, object] = {}
    choice = s.choice
    if body.done is not None:
        update["done"] = body.done
    if body.choice is not None:
        if body.choice >= max(len(s.options), 1):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "There's no such option.")
        choice = body.choice
        update["choice"] = choice
        if s.options:
            update["after"] = s.options[choice].text
    if body.checked is not None:
        if any(i < 0 or i >= len(s.items) for i in body.checked):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "There's no such step.")
        update["checked"] = sorted(set(body.checked))
        if s.items and len(set(body.checked)) == len(s.items) and body.done is None:
            update["done"] = True  # every step ticked: it's done
    if body.after is not None:
        if s.part not in EDITABLE:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This one can't be edited here.")
        text = body.after.replace("\r\n", "\n").strip()
        if s.limit and len(text) > s.limit:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                f"That's {len(text):,} characters: LinkedIn allows {s.limit:,}.")
        update["after"] = text
        update["placeholders"] = len(fixes.PLACEHOLDER.findall(text))
        if s.options:
            options = list(s.options)
            i = min(choice, len(options) - 1)
            options[i] = options[i].model_copy(update={"text": text})
            update["options"] = options
    return s.model_copy(update=update)


@router.patch("/suggestions/{sid}", response_model=LinkedInOut, dependencies=[read_limit])
async def patch_suggestion(sid: str, body: SuggestionPatch, request: Request,
                           user: Annotated[User, Depends(current_user)],
                           db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """Tick it done on LinkedIn (kept with the profile), pick an option, tick a step, or edit the text."""
    def change(p: Profile, state: State, s: Suggestion) -> tuple[Profile, State]:
        new = _patched(s, body)
        return p, state.model_copy(update={"suggestions": [new if x.id == s.id else x for x in state.suggestions]})

    return await _change(db, user, sid, request, change)


@router.delete("/suggestions/{sid}", response_model=LinkedInOut, dependencies=[read_limit])
async def delete_suggestion(sid: str, request: Request, user: Annotated[User, Depends(current_user)],
                            db: Annotated[AsyncSession, Depends(get_db)]) -> LinkedInOut:
    """Drop it. If it was applied, that part of Orbit's copy goes back to what LinkedIn says."""
    def change(p: Profile, state: State, s: Suggestion) -> tuple[Profile, State]:
        if s.part in sug.APPLIES and sug.applied(p, s):
            p = sug.unapply(p, state.read or p, s)
        return p, state.model_copy(update={"suggestions": [x for x in state.suggestions if x.id != s.id]})

    return await _change(db, user, sid, request, change)
