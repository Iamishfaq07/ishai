"""Matching and ranking: deterministic, computed on the server from cached listings, no AI and no upstream calls.

Each listing that passes the filters (recency, work mode and place, job type, sources, excluded words) gets a match
score out of 100:

    40  title: how close its title is to one of the target titles (words weighted: "backend" says more than
        "engineer"; a manager, intern or sales title for someone who isn't looking for one is halved)
    35  skills: how many of the skills the post asks for (read when it was fetched) the resume or profile shows
    10  place: in one of the chosen cities, or remote when remote is wanted (only posts in the country the candidate
        applies in, or remote and open to it, are considered at all)
    10  experience: the post's years or seniority against the candidate's
     5  recency: posted today counts most, 30 days ago not at all

A post that's neither close in title nor asking for several of the candidate's skills isn't a match and isn't
shown; nor is one asking for four or more skills of which the resume shows none, nor one far off in seniority (a
fresher isn't shown "Staff Engineer"). The same job posted on its company's board and on a feed is shown once, from
the company's board. Best-first sorting spreads one company's many openings out (each further one sorts a little
lower), so a single busy employer or agency doesn't fill the first page.
"""

import math
import re
import time
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from orbit_api.job_portal.geo import city_country, open_to
from orbit_api.job_portal.postings import CITIES, LEVELS, EmploymentType, Level, Workplace
from orbit_api.job_portal.skills import WEAK, SkillMatcher, display, same_skill
from orbit_api.job_portal.sources import PRIORITY

W_TITLE, W_SKILLS, W_PLACE, W_EXPERIENCE, W_RECENCY = 0.40, 0.35, 0.10, 0.10, 0.05
MIN_TITLE = 0.25  # below this, a post needs several of the candidate's skills to count as a match
MIN_SKILLS_MATCHED = 4
MIN_SKILLS_ASKED = 4  # a post asking for this many skills, none of them on the resume, isn't a match
SPREAD_FREE, SPREAD_STEP, SPREAD_MAX = 2, 4, 16
SKILLS_CONSIDERED = 12
SHOWN_SKILLS = 6
TITLE_ORDER_STEP = 0.05  # each title further down the profile's list counts 5% less (the fourth: 85%)
SKILLS_FULL = 10  # matching this many of a post's skills (or all of them, if it lists fewer) is full marks

# ---- titles ------------------------------------------------------------------------------------------------------

_PHRASES = [
    (r"\bback[\s-]?end\b", "backend"), (r"\bfront[\s-]?end\b", "frontend"), (r"\bfull[\s-]?stack\b", "fullstack"),
    (r"\bsite reliability\b", "sre"), (r"\bmachine learning\b", "ml"), (r"\bartificial intelligence\b", "ai"),
    (r"\bdev[\s-]?ops\b", "devops"), (r"\bquality assurance\b", "qa"), (r"\buser experience\b", "ux"),
    (r"\buser interface\b", "ui"), (r"\bsoftware development engineer\b", "software engineer"),
    (r"\b(?:sde|swe)\b", "software engineer"), (r"\bhuman resources?\b", "hr"), (r"\bnode\.?js\b", "node"),
    (r"\bc\+\+", "cpp"), (r"\bc#", "csharp"), (r"\.net\b", "dotnet"), (r"\bk8s\b", "kubernetes"),
    (r"\bgolang\b", "go"), (r"\breact\.?js\b", "react"),
]
_SAME = {"developer": "engineer", "dev": "engineer", "programmer": "engineer", "engineering": "engineer",
         "engineers": "engineer", "developers": "engineer", "analytics": "analyst", "scientists": "scientist",
         "managers": "manager", "designers": "designer"}
_DROP = frozenset("""
senior sr junior jr lead staff principal i ii iii iv v 1 2 3 4 5 level l1 l2 l3 l4 l5 and or of the for in at with
to a an remote hybrid onsite contract fulltime full time part wfh wfo india experience exp yrs years yr year based
new opening urgent hiring immediate joiner joiners f m
""".split()) | {c.lower() for c in CITIES} | {a for aliases in CITIES.values() for a in aliases}
# How much a word says about the role: a head noun shared by many roles says less than what it qualifies.
_WEIGHT = {"engineer": 0.4, "specialist": 0.4, "associate": 0.3, "executive": 0.4, "consultant": 0.5, "officer": 0.4,
           "professional": 0.3, "analyst": 0.6, "manager": 0.6, "architect": 0.7, "scientist": 0.7, "designer": 0.7,
           "software": 0.7}
# A different kind of job than asked for when the target titles don't have the word.
_ROLE_CHANGERS = frozenset({"manager", "director", "head", "vp", "president", "intern", "internship", "trainee",
                            "recruiter", "sales", "marketing", "architect", "consultant", "teacher", "tutor",
                            # a specialism of the same title: "Software Engineer in Test", "Android Engineer"
                            "test", "qa", "sdet", "support", "android", "ios", "mobile", "frontend", "embedded",
                            "firmware", "hardware", "mechanical", "electrical", "civil"})


def title_tokens(title: str, keep: frozenset[str] = frozenset()) -> frozenset[str]:
    """Words that say what the role is. `keep`: words usually ignored ("contract") that this search typed on purpose."""
    t = title.lower()
    for pattern, repl in _PHRASES:
        t = re.sub(pattern, repl, t)
    words = re.findall(r"[a-z0-9+#]+", t)
    return frozenset(_SAME.get(w, w) for w in words
                     if (_SAME.get(w, w) not in _DROP or _SAME.get(w, w) in keep) and len(w) < 30)


# Dropped from titles, but kept when the search box typed them ("contract engineer" is not every engineer).
_KEEP_IF_TYPED = frozenset({"contract"})


def _typed_keep(keywords: str) -> frozenset[str]:
    words = {_SAME.get(w, w) for w in re.findall(r"[a-z0-9+#]+", keywords.lower())}
    return frozenset(words & _KEEP_IF_TYPED)


def _weight(token: str) -> float:
    return _WEIGHT.get(token, 1.0)


def title_score(listing: frozenset[str], targets: list[frozenset[str]], skill_words: frozenset[str]) -> float:
    """0..1: the best overlap with any target title, weighted by what each word says about the role. Titles are in
    the profile's order, best fit first: an adjacent role further down the list counts a little less."""
    if not listing:
        return 0.0
    best = 0.0
    for i, target in enumerate(targets):
        total = sum(_weight(t) for t in target)
        if not total:
            continue
        best = max(best, sum(_weight(t) for t in target & listing) / total * (1 - min(i, 4) * TITLE_ORDER_STEP))
    target_words = frozenset().union(*targets) if targets else frozenset()
    if best and listing & skill_words - target_words:  # "Python Developer" for a Python backend engineer
        best = min(1.0, best + 0.25)
    if listing & _ROLE_CHANGERS - target_words:
        best *= 0.5
    return best


# ---- the search ----------------------------------------------------------------------------------------------------

_NCR = frozenset({"Delhi", "Gurugram", "Noida"})
# "Anywhere in the country": India's profiles say "India" (as they always have), everyone else's "Anywhere".
ANYWHERE = frozenset({"India", "Anywhere"})


@dataclass
class Search:
    """What one feed request looks for: the profile, with the search box's words and filters on top."""

    titles: list[str]
    skills: list[str]
    locations: list[str]
    workplace: list[Workplace]
    level: Level | None
    years: float | None
    job_types: list[EmploymentType]
    days: int
    sources_off: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    keywords: str = ""
    country: str = "IN"  # where the candidate applies: posts there, or remote and open to it
    any_country: bool = False  # one job's own score (opened from the tracker): wherever it is

    def cities(self) -> frozenset[str]:
        """The chosen cities in the country the candidate applies in (one elsewhere, say from the resume, doesn't
        narrow the feed)."""
        india = self.country == "IN"
        wanted = {c for c in self.locations if (c in CITIES if india else city_country(c) == self.country)}
        return frozenset(wanted | (_NCR if wanted & _NCR else set()))

    def anywhere_in_india(self) -> bool:
        """Anywhere in the country (the name is from when that was always India)."""
        return not self.cities() or bool(ANYWHERE & set(self.locations))

    def key(self) -> str:
        return repr((self.titles, sorted(s.lower() for s in self.skills), self.locations, sorted(self.workplace),
                     self.level, self.years, sorted(self.job_types), self.days, sorted(self.sources_off),
                     sorted(self.exclude), self.keywords.lower(), self.country))


@dataclass(frozen=True)
class Row:
    """The columns ranking needs (never a post's text)."""

    id: str
    source: str
    company: str
    title: str
    cities: tuple[str, ...]
    country: str | None
    remote_scope: tuple[str, ...]
    workplace: str | None
    employment_type: str | None
    level: str | None
    exp_min: int | None
    exp_max: int | None
    posted_at: datetime
    keywords: tuple[str, ...]
    dedupe_key: str


ROW_FIELDS = tuple(Row.__dataclass_fields__)


def row_of(obj: Any) -> Row:
    """A Row from a listing (or a result row with the same columns)."""
    values = {name: getattr(obj, name) for name in ROW_FIELDS}
    values["cities"] = tuple(values["cities"] or ())
    values["keywords"] = tuple(values["keywords"] or ())
    # Cached before posts were read worldwide: a remote one was kept because it was open to India.
    scope = tuple(values["remote_scope"] or ())
    values["remote_scope"] = scope or (("IN",) if values["workplace"] == "remote" else ())
    return Row(**values)


@dataclass
class Match:
    id: str
    score: int
    matched: list[str]
    missing: list[str]
    posted_at: datetime
    company_key: str = ""  # the company, normalized (for spreading one company's openings out)


def _experience_fit(row: Row, level: Level | None, years: float | None) -> float:
    if row.exp_min is not None and years is not None:
        if years >= row.exp_min - 0.5:
            return 1.0 if row.exp_max is None or years <= row.exp_max + 2 else 0.6
        short = row.exp_min - years
        return 0.6 if short <= 1.5 else 0.3 if short <= 3 else 0.05
    mine = LEVELS.index(level) if level in LEVELS else None
    theirs = LEVELS.index(row.level) if row.level in LEVELS else None
    if theirs is None and row.exp_min is not None:
        theirs = 0 if row.exp_min < 1 else 1 if row.exp_min < 3 else 2 if row.exp_min < 6 else 3
    if mine is None or theirs is None:
        return 0.7
    return (1.0, 0.6, 0.2, 0.05)[abs(mine - theirs)]


def _place(row: Row, search: Search) -> float | None:
    """None: filtered out. Else how well it fits where the candidate wants to work."""
    modes = set(search.workplace) or {"remote", "hybrid", "onsite"}
    if row.workplace == "remote":  # remote from the candidate's own country counts a little more than open to it
        if "remote" not in modes or not (search.any_country or open_to(row.remote_scope, search.country)):
            return None
        return 1.0 if row.country == search.country else 0.9
    if row.country != search.country and not search.any_country:
        return None
    if not modes & {"hybrid", "onsite"} or (row.workplace in ("hybrid", "onsite") and row.workplace not in modes):
        return None
    wanted = search.cities()
    if search.anywhere_in_india():
        return 1.0 if not wanted or set(row.cities) & wanted else 0.8
    if set(row.cities) & wanted:
        return 1.0
    return 0.5 if not row.cities else None


def _considered(keywords: Iterable[str]) -> list[str]:
    """The post's skills that say something about fit, each once (synonyms are one skill)."""
    out: list[str] = []
    seen: set[str] = set()
    for k in keywords:
        key = same_skill(k)
        if k.lower() not in WEAK and key not in seen:
            out.append(k)
            seen.add(key)
    return out[:SKILLS_CONSIDERED]


def _allowed_types(search: Search) -> set[str]:
    if search.job_types:
        return set(search.job_types)
    return {"full_time", "part_time", "contract"} | ({"internship"} if search.level == "fresher" else set())


def rank(rows: Iterable[Row], search: Search, matcher: SkillMatcher, *, sort: str = "best",
         now: datetime | None = None) -> list[Match]:
    """Every listing that matches, best (or newest) first, one per job."""
    now = now or datetime.now(UTC)
    since = now - timedelta(days=search.days)
    # The search box's words first: what the user is looking for right now.
    targets = [t for t in (title_tokens(x) for x in [search.keywords, *search.titles] if x) if t]
    skill_words = frozenset(w for s in search.skills for w in title_tokens(s))
    keep = _typed_keep(search.keywords)
    keyword_words = title_tokens(search.keywords, keep) if search.keywords else frozenset()
    types = _allowed_types(search)
    off = set(search.sources_off)
    exclude = [e.lower() for e in search.exclude if e.strip()]
    best: dict[str, tuple[tuple[int, float], Match]] = {}
    for row in rows:
        posted = row.posted_at if row.posted_at.tzinfo else row.posted_at.replace(tzinfo=UTC)
        if posted < since or row.source in off:
            continue
        if row.employment_type and row.employment_type not in types:
            continue
        place = _place(row, search)
        if place is None:
            continue
        if exclude:
            hay = " ".join((row.title, row.company, *row.keywords)).lower()
            if any(e in hay for e in exclude):
                continue
        tokens = title_tokens(row.title)
        if keyword_words:  # the search box: its words must be in the title or among the post's skills
            named = title_tokens(row.title, keep)
            post_words = named | frozenset(w for k in row.keywords for w in title_tokens(k, keep))
            if not keyword_words <= post_words:
                continue
        experience = _experience_fit(row, search.level, search.years)
        if experience <= 0.05:
            continue
        title = title_score(tokens, targets, skill_words) if targets else 0.5
        if keyword_words:
            # What the user typed is what they want right now: a post with those words is a match even when it's
            # not one of the profile's titles ("react" for a backend engineer), a little more so in its title.
            title = max(title, 0.6 if keyword_words <= title_tokens(row.title, keep) else 0.45)
        considered = _considered(row.keywords)
        matched = [k for k in considered if matcher.has(k)]
        if considered:
            skills = min(1.0, len(matched) / max(min(len(considered), SKILLS_FULL), 3))
        else:
            skills = title * 0.8  # no text to read skills from: the title has to speak for it
        if targets and title < MIN_TITLE and not (len(matched) >= MIN_SKILLS_MATCHED and skills >= 0.4):
            continue
        # A post that asks for several skills and the resume shows none of them ("SAP ABAP & Backend Developer" for
        # a Go engineer) isn't a match, however close its title. Unless the user typed what they're looking for.
        if not keyword_words and not matcher.empty and len(considered) >= MIN_SKILLS_ASKED and not matched:
            continue
        age_days = max((now - posted).total_seconds() / 86_400, 0.0)
        recency = 1.0 if age_days < 1 else max(0.0, 1 - (age_days - 1) / 29)
        score = W_TITLE * title + W_SKILLS * skills + W_PLACE * place + W_EXPERIENCE * experience + W_RECENCY * recency
        match = Match(row.id, min(99, max(1, math.floor(score * 100 + 0.5))),
                      [display(k) for k in matched[:SHOWN_SKILLS]],
                      [display(k) for k in considered if k not in matched][:SHOWN_SKILLS], posted,
                      row.dedupe_key.split("|", 1)[0])
        prefer = (PRIORITY.get(row.source, 99), -posted.timestamp())
        kept = best.get(row.dedupe_key)
        if kept is None or prefer < kept[0]:
            best[row.dedupe_key] = (prefer, match)
    out = [m for _, m in best.values()]
    if sort == "newest":
        out.sort(key=lambda m: (-m.posted_at.timestamp(), -m.score))
        return out
    out.sort(key=lambda m: (-m.score, -m.posted_at.timestamp()))
    return spread(out)


def spread(matches: list[Match]) -> list[Match]:
    """Best first, but one company's many openings don't crowd out everyone else's: each further match from the same
    company after its first SPREAD_FREE sorts as if it scored SPREAD_STEP lower (up to SPREAD_MAX). The score shown is
    unchanged."""
    seen: Counter[str] = Counter()
    keyed: list[tuple[int, float, Match]] = []
    for m in matches:
        n = max(seen[m.company_key] - SPREAD_FREE + 1, 0) if m.company_key else 0
        keyed.append((m.score - min(n * SPREAD_STEP, SPREAD_MAX), m.posted_at.timestamp(), m))
        seen[m.company_key] += 1
    keyed.sort(key=lambda k: (-k[0], -k[1]))
    return [m for _, _, m in keyed]


# ---- a short-lived cache of ranked feeds ----------------------------------------------------------------------

CACHE_TTL_S = 600
_MAX_CACHED = 256
_cache: dict[str, tuple[float, list[Match]]] = {}


def cached(key: str) -> list[Match] | None:
    hit = _cache.get(key)
    if hit is None or time.monotonic() - hit[0] > CACHE_TTL_S:
        return None
    return hit[1]


def remember(key: str, matches: list[Match]) -> None:
    if len(_cache) >= _MAX_CACHED:
        for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[: _MAX_CACHED // 4]:
            del _cache[k]
    _cache[key] = (time.monotonic(), matches)


def clear_cache() -> None:
    _cache.clear()
