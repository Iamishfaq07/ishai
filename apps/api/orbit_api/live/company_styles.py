"""How well-known companies interview, for the mock interviewer, the live copilot and the Practice page's "What to
expect": the question bank's company guides (question_bank/companies/*.json, written and reviewed by Orbit), read
once at start-up into the plain records the interview code uses.

Each entry is what candidates commonly report and what the company says publicly about what it looks for (values,
principles, round types), kept general on purpose: rounds change by team, level and year, so nothing here is a
promise of a specific process. Matching is by name or a common alias ("AWS" is Amazon, "Tata Consultancy" is TCS).

The guides are written as India's candidates report them. `for_country` gives the one for wherever else the user
applies: a guide whose rounds are India's campus hiring (a spoken-English test, GenC, a group discussion) reads as
its `abroad` version, and an estimation question set in Bengaluru moves to a big city there.
"""

from dataclasses import dataclass, field, replace

from orbit_api import question_bank
from orbit_api.job_portal.geo import cities_in
from orbit_api.question_bank.schema import CompanyGuide, Market
from orbit_api.region import country_code, is_india


@dataclass(frozen=True)
class Abroad:
    """What candidates outside India report instead (None: the same as in India)."""
    rounds: tuple[str, ...]
    looks_for: tuple[str, ...] | None = None
    questions: tuple[str, ...] | None = None
    tips: tuple[str, ...] | None = None


@dataclass(frozen=True)
class CompanyStyle:
    slug: str
    name: str
    aliases: tuple[str, ...]
    # The rounds candidates commonly report, in order, one short line each.
    rounds: tuple[str, ...]
    # What the interviewers are listening for: the company's stated values or principles, as they're probed.
    looks_for: tuple[str, ...]
    # Questions in the company's style, asked as written when the model is unavailable.
    questions: tuple[str, ...]
    tips: tuple[str, ...] = field(default_factory=tuple)
    # India-only rounds above (campus hiring): the guide outside India.
    abroad: Abroad | None = None
    # Where it's suggested for practice: only in India, India first, or everywhere (it matches when typed anywhere).
    market: Market = "global"


def _style(g: CompanyGuide) -> CompanyStyle:
    a = g.abroad
    return CompanyStyle(
        g.slug, g.name, tuple(g.aliases), rounds=tuple(g.rounds), looks_for=tuple(g.looks_for),
        questions=tuple(q.text for q in g.questions), tips=tuple(g.tips), market=g.market,
        abroad=None if a is None else Abroad(
            rounds=tuple(a.rounds), looks_for=tuple(a.looks_for) if a.looks_for else None,
            questions=tuple(q.text for q in a.questions) if a.questions else None,
            tips=tuple(a.tips) if a.tips else None))


# Every guide in the question bank (question_bank/companies/*.json), in file-name order.
STYLES: tuple[CompanyStyle, ...] = tuple(_style(g) for g in question_bank.companies())

_key = question_bank.key  # "Tata Consultancy Services Ltd." → "tata consultancy services"
_BY_KEY: dict[str, CompanyStyle] = {}
for _s in STYLES:
    for _n in (_s.name, _s.slug.replace("-", " "), *_s.aliases):
        _BY_KEY[_key(_n)] = _s


def match(company: str | None) -> CompanyStyle | None:
    """The guide for the company, by its name or a common alias, or None when there isn't one."""
    if not company:
        return None
    key = _key(company)
    if not key:
        return None
    if key in _BY_KEY:
        return _BY_KEY[key]
    # "Amazon (AWS)", "Google Cloud India": a known name as the leading words.
    words = key.split()
    for n in range(len(words) - 1, 0, -1):
        hit = _BY_KEY.get(" ".join(words[:n]))
        if hit is not None:
            return hit
    return None


_INDIA_CITY = "Bengaluru"  # where the guides' estimation questions are set


def for_country(style: CompanyStyle, country: str | None) -> CompanyStyle:
    """The guide where the user applies: as written in India; elsewhere (or not said) its `abroad` version, with an
    estimation question set in the country's biggest job market ("a big city" when there's none to name)."""
    if is_india(country):
        return style
    a = style.abroad
    out = style if a is None else replace(style, rounds=a.rounds, looks_for=a.looks_for or style.looks_for,
                                          questions=a.questions or style.questions, tips=a.tips or style.tips)
    code = country_code(country)
    city = next(iter(cities_in(code)), "a big city") if code else "a big city"
    return replace(out, questions=tuple(q.replace(_INDIA_CITY, city) for q in out.questions))


def interviewer_brief(style: CompanyStyle) -> str:
    """For the mock interviewer: interview the way this company does."""
    return (f"Interview the way {style.name} does. Its interviewers listen for: {'; '.join(style.looks_for)}. "
            f"Rounds candidates report: {'; '.join(style.rounds)}. Ask questions that test those, in that style "
            "(for example: " + " / ".join(style.questions[:2]) + "), and don't name the value you're testing.")


def copilot_hint(style: CompanyStyle) -> str:
    """For the live copilot: what this company's interviewers listen for, so an answer can show it."""
    return (f"{style.name}'s interviewers listen for: {'; '.join(style.looks_for)}. Where it fits naturally, let the "
            "answer show the one this question tests; never name it or recite a value.")
