"""LinkedIn AI's suggestions: what to paste where, kept with the profile, and what applying one does to Orbit's copy.

The row's JSON (models.LinkedInProfileRow.data) is Orbit's copy of the profile at its top level (as it was before
suggestions existed, so old rows read as they are), plus an "orbit" key holding the profile as it was last read from
LinkedIn and the suggestions:

    {...Profile fields (Orbit's copy)..., "orbit": {"read": {...Profile as read...}, "suggestions": [...]}}

Applying a suggestion writes its text into Orbit's copy, so the audit re-scores as if it were on LinkedIn; putting it
back restores what was read. Whether one is applied is worked out from the copy each time (never stored), so it can't
drift. "Done on LinkedIn" is the user's own checklist, stored on the suggestion. One suggestion per part (and per role
for a role's description or a recommendation request): writing it again replaces it.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from orbit_api.linkedin.audit import role_name, url_slug
from orbit_api.linkedin.read import Profile
from orbit_api.linkedin.where import HEADLINE_MAX, ROLE_MAX, SKILLS_MAX

Part = Literal["headline", "about", "experience", "skills", "url", "featured", "photo", "recommendation",
               "open_to_work"]
Source = Literal["profile", "resume", "both"]  # what it was written from
APPLIES: frozenset[str] = frozenset({"headline", "about", "experience", "skills", "url", "featured", "photo"})
MAX_SUGGESTIONS = 40


class Option(BaseModel):
    label: str = Field(max_length=60)  # "Built for search"
    text: str = Field(max_length=HEADLINE_MAX)


class Suggestion(BaseModel):
    id: str = Field(max_length=40)
    part: Part
    role_key: str = Field("", max_length=420)  # experience, recommendation: "title|company" of the role
    label: str = Field(max_length=200)
    before: str = Field("", max_length=4_000)
    after: str = Field(max_length=4_000)
    options: list[Option] = Field(default_factory=list, max_length=5)  # headline, url: pick one (`choice`)
    choice: int = Field(0, ge=0, le=4)
    items: list[str] = Field(default_factory=list, max_length=SKILLS_MAX)  # skills, Featured ideas, checklist steps
    checked: list[int] = Field(default_factory=list, max_length=SKILLS_MAX)  # a checklist's steps ticked
    limit: int = 0  # LinkedIn's character limit for `after`; 0: none
    shown: int = 0  # characters LinkedIn shows before cutting it off (search results, "see more"); 0: all
    where: list[str] = Field(default_factory=list, max_length=6)
    help_url: str = Field("", max_length=200)
    note: str = Field("", max_length=600)  # what to check before pasting ("Put your real figures in [X%]")
    placeholders: int = 0  # [X%]-style gaps for the user's own figures
    source: Source = "profile"
    ai: bool = False  # written by the AI (else worked out here, free)
    done: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SuggestionOut(Suggestion):
    applies: bool  # it can be applied to Orbit's copy (a message or a settings list can't)
    applied: bool  # Orbit's copy has it


def role_key(title: str, company: str) -> str:
    return f"{' '.join(title.lower().split())}|{' '.join(company.lower().split())}"


def find_role(p: Profile, key: str) -> int | None:
    return next((i for i, r in enumerate(p.experience) if role_key(r.title, r.company) == key), None)


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def _skill_key(s: str) -> str:
    return re.sub(r"[\s._-]", "", s.lower())


# ---- the row's JSON --------------------------------------------------------------------------------------------


class State(BaseModel):
    read: Profile | None = None  # as last read from LinkedIn; None for a row from before suggestions
    suggestions: list[Suggestion] = Field(default_factory=list)


def load(data: dict[str, Any] | None) -> tuple[Profile, State]:
    raw = dict(data or {})
    orbit = raw.pop("orbit", None)
    profile = Profile.model_validate(raw)
    state = State.model_validate(orbit) if isinstance(orbit, dict) else State()
    if state.read is None:
        state.read = profile
    return profile, state


def dump(profile: Profile, state: State) -> dict[str, Any]:
    """A new dict every time, so SQLAlchemy sees the JSON column change."""
    return {**profile.model_dump(mode="json"), "orbit": state.model_dump(mode="json")}


def put(state: State, s: Suggestion, *, add_options: bool = False) -> State:
    """`s` in place of the suggestion for the same part (and role), newest first, at most MAX_SUGGESTIONS. Its
    "before" is the part as LinkedIn has it. `add_options`: a headline joins the one already there as another option
    (the rewrite from a resume), so the one picked, maybe applied, stays."""
    if s.part in APPLIES and s.part != "photo" and state.read is not None:
        s = s.model_copy(update={"before": current(state.read, s)[:4_000]})
    old = next((x for x in state.suggestions if (x.part, x.role_key) == (s.part, s.role_key)), None)
    if add_options and old is not None and old.options and s.options:
        texts = {o.text.lower() for o in old.options}
        options = [*old.options, *(o for o in s.options if o.text.lower() not in texts)][:5]
        s = old.model_copy(update={"options": options, "created_at": s.created_at})
    kept = [x for x in state.suggestions if (x.part, x.role_key) != (s.part, s.role_key)]
    out = [s, *kept]
    while len(out) > MAX_SUGGESTIONS:  # the oldest finished one goes first, else the oldest
        old = next((x for x in reversed(out) if x.done), out[-1])
        out.remove(old)
    return state.model_copy(update={"suggestions": out})


# ---- applying ------------------------------------------------------------------------------------------------


def chosen(s: Suggestion) -> str:
    if s.options and s.part in ("headline", "url"):
        return s.options[min(s.choice, len(s.options) - 1)].text
    return s.after


def _url(text: str) -> str:
    slug = url_slug(text) or text.strip().strip("/")
    return f"https://www.linkedin.com/in/{slug}"


def apply(p: Profile, s: Suggestion) -> Profile:
    """Orbit's copy with `s` in it (unchanged when it can't take it: a message, a role that's gone)."""
    text = chosen(s)
    if s.part == "headline":
        return p.model_copy(update={"headline": text[:HEADLINE_MAX]})
    if s.part == "about":
        return p.model_copy(update={"about": text})
    if s.part == "experience":
        i = find_role(p, s.role_key)
        if i is None:
            return p
        roles = list(p.experience)
        roles[i] = roles[i].model_copy(update={"description": text[:ROLE_MAX]})
        return p.model_copy(update={"experience": roles})
    if s.part == "skills":
        return p.model_copy(update={"skills": list(dict.fromkeys(s.items))[:SKILLS_MAX]})
    if s.part == "url":
        return p.model_copy(update={"url": _url(text)})
    if s.part == "featured":
        return p.model_copy(update={"featured": s.items[:20]})
    if s.part == "photo":
        return p.model_copy(update={"photo": True, "banner": True})
    return p


def unapply(p: Profile, read: Profile, s: Suggestion) -> Profile:
    """Orbit's copy with that part as it was read from LinkedIn."""
    if s.part == "experience":
        i, j = find_role(p, s.role_key), find_role(read, s.role_key)
        if i is None:
            return p
        roles = list(p.experience)
        roles[i] = roles[i].model_copy(update={"description": read.experience[j].description if j is not None else ""})
        return p.model_copy(update={"experience": roles})
    field = {"headline": "headline", "about": "about", "skills": "skills", "url": "url", "featured": "featured"}.get(
        s.part)
    if field:
        return p.model_copy(update={field: getattr(read, field)})
    if s.part == "photo":
        return p.model_copy(update={"photo": read.photo, "banner": read.banner})
    return p


def applied(p: Profile, s: Suggestion) -> bool:
    text = chosen(s)
    if s.part == "headline":
        return _norm(p.headline) == _norm(text)
    if s.part == "about":
        return _norm(p.about) == _norm(text)
    if s.part == "experience":
        i = find_role(p, s.role_key)
        return i is not None and _norm(p.experience[i].description) == _norm(text)
    if s.part == "skills":
        want = [_skill_key(x) for x in s.items]
        return bool(want) and [_skill_key(x) for x in p.skills[:len(want)]] == want
    if s.part == "url":
        return bool(url_slug(p.url)) and url_slug(p.url).lower() == (url_slug(text) or text).strip("/").lower()
    if s.part == "featured":
        return bool(s.items) and (p.featured or []) == s.items[:20]
    if s.part == "photo":
        return bool(p.photo and p.banner)
    return False


def out(p: Profile, s: Suggestion) -> SuggestionOut:
    return SuggestionOut(**s.model_dump(), applies=s.part in APPLIES, applied=applied(p, s))


def projected(p: Profile, suggestions: list[Suggestion], score: Callable[[Profile], int] | None = None) -> Profile:
    """Orbit's copy with the suggestions applied, the one written last winning (they're stored newest first). With
    `score`, each one only where it doesn't lower the score: a newer version that scores below the one already
    applied doesn't drag the "with your fixes" score under the score now."""
    best = score(p) if score else 0
    for s in reversed(suggestions):
        if s.part not in APPLIES:
            continue
        q = apply(p, s)
        if score is None:
            p = q
        elif (got := score(q)) >= best:
            p, best = q, got
    return p


def current(p: Profile, s: Suggestion) -> str:
    """What the part reads now in `p`: the "before" of a suggestion for it."""
    if s.part == "headline":
        return p.headline
    if s.part == "about":
        return p.about
    if s.part == "experience":
        i = find_role(p, s.role_key)
        return p.experience[i].description if i is not None else ""
    if s.part == "skills":
        return ", ".join(p.skills)
    if s.part == "url":
        return f"linkedin.com/in/{url_slug(p.url)}" if url_slug(p.url) else ""
    if s.part == "featured":
        return ", ".join(p.featured or [])
    return s.before


def after_read(state: State, fresh: Profile) -> State:
    """A new read from LinkedIn: suggestions for roles that are gone go; each one's "before" is what LinkedIn says now,
    and one LinkedIn now has (the user pasted it in) is ticked done."""
    kept = []
    for s in state.suggestions:
        if s.role_key and s.part == "experience" and find_role(fresh, s.role_key) is None:
            continue
        update: dict[str, Any] = {}
        if s.part in APPLIES and s.part != "photo":
            update["before"] = current(fresh, s)[:4_000]
            if applied(fresh, s):
                update["done"] = True
        kept.append(s.model_copy(update=update))
    return State(read=fresh, suggestions=kept)


def label_for(p: Profile, part: str, key: str = "") -> str:
    i = find_role(p, key) if key else None
    role = role_name(p.experience[i]) if i is not None else ""
    return {"headline": "Headline", "about": "About", "experience": role or "A role's description",
            "skills": "Skills, in order", "url": "Custom profile URL", "featured": "Featured",
            "photo": "Photo and background", "recommendation": f"Recommendation request{f': {role}' if role else ''}",
            "open_to_work": "Open to work settings"}.get(part, part)
