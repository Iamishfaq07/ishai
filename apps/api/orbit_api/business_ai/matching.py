"""Deterministic requirement matching: the ranking's cheap path and its floor.

A requirement ("3+ years of Python", "B.Tech in CS or related", "Kubernetes or ECS") is read into term groups (any
synonym of a group counts) and an optional minimum of years. Against the redacted profile:

- "yes": every group is named on some line, and the years (if asked) are met;
- "partly": at least half the groups are named, or all of them are but the years fall short;
- "no": otherwise ("not shown in the resume", never a judgement of the person).

Evidence is the profile line naming the most groups, verbatim.
"""

import re
from dataclasses import dataclass

from orbit_api.business_ai.schemas import Met, RequirementMatch
from orbit_api.business_ai.text import fold, tokens
from orbit_api.resumes.ats import _SYNONYM_OF, SKILL_VOCAB

# Equivalent ways resumes write the same qualification (on top of the resume tools' SYNONYMS).
_ALIASES: tuple[frozenset[str], ...] = tuple(frozenset(g) for g in (
    # (Not "be", "ba", "me", "ms" or "it": as plain words they'd match almost any line.)
    {"bachelor", "bachelors", "bachelor's", "btech", "bsc", "bca", "bcom", "bba", "barch", "undergraduate",
     "graduate", "graduation"},
    {"master", "masters", "master's", "mtech", "msc", "mca", "mba", "pgdm", "postgraduate"},
    {"phd", "doctorate"},
    {"computer science", "cs", "cse", "computer engineering", "information technology", "software engineering",
     "computer applications", "bca", "mca"},
    {"chartered accountant", "ca"}, {"gst", "goods and services tax"},
    {"kubernetes", "k8s", "eks", "aks", "gke"}, {"amazon web services", "aws", "ec2", "s3"},
    {"react", "reactjs", "react native"}, {"spreadsheets", "excel", "google sheets"},
    {"english", "english fluency", "fluent english"}, {"customer support", "customer service", "support"},
    {"leadership", "led", "lead", "managed", "mentored"}, {"communication", "presented", "presentation"},
    {"internship", "internships", "intern", "interned", "trainee"},
))
_ALIAS_OF = {t: g for g in _ALIASES for t in g}

_FILLER = frozenset("""
a an the and or of in on at to for with by from as is are be being been strong solid good excellent proven
deep working hands-on handson practical demonstrated experience experienced exposure knowledge understanding
familiarity familiar proficiency proficient ability able skills skill skilled background expertise plus
preferred required must should nice have having etc related relevant similar equivalent field fields years year
yrs yr minimum min least atleast at-least over more than one two three four five professional industry using use
work worked working comfortable degree like e.g eg such tools tool any other fluent fluency fluently native
speaker speaking spoken written verbal concepts fundamentals basics principles environment environments based
driven oriented development developing building good great hands track record
""".split())
_SLASHED = re.compile(r"([a-z0-9+#.&]+)\s*/\s*([a-z0-9+#.&]+)")
_KEEP_SLASHED = frozenset(t for t in (*SKILL_VOCAB, *_SYNONYM_OF) if "/" in t)
_YEARS = re.compile(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)", re.IGNORECASE)
_BAND = re.compile(r"(\d+(?:\.\d+)?)\s*(?:\+|plus|or more)?\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?))?", re.IGNORECASE)
_VOCAB = sorted(SKILL_VOCAB, key=lambda t: -len(t))
_META = re.compile(r"^(?:Skills|Headline|Total experience \(years\)|Role):")


@dataclass(frozen=True)
class Requirement:
    text: str
    groups: tuple[frozenset[str], ...]  # each group: forms that count for one term
    min_years: float | None


def _forms(term: str) -> frozenset[str]:
    t = fold(term)
    return frozenset({t}) | _SYNONYM_OF.get(t, frozenset()) | _ALIAS_OF.get(t, frozenset())


def parse_requirement(text: str) -> Requirement:
    years_m = _YEARS.search(text)
    min_years = float(years_m.group(1)) if years_m else None
    body = fold(_YEARS.sub(" ", text)).replace("(", " ").replace(")", " ")
    # "Python/Go" is a choice; "CI/CD" and "A/B testing" are one term.
    body = _SLASHED.sub(lambda m: m.group(0) if f"{m.group(1)}/{m.group(2)}" in _KEEP_SLASHED
                        else f"{m.group(1)} or {m.group(2)}", body)
    alternatives = [a for a in re.split(r"\s+or\s+", body) if a.strip()]
    per_alt: list[list[str]] = []
    for alt in alternatives:
        rest = f" {alt} "
        found: list[str] = []
        for term in _VOCAB:
            pat = re.compile(r"(?<![a-z0-9])" + re.escape(fold(term)) + r"s?(?![a-z0-9+#])")
            if pat.search(rest):
                found.append(term)
                rest = pat.sub(" ", rest)
        for multi in sorted((t for t in _ALIAS_OF if " " in t), key=len, reverse=True):
            if f" {multi} " in rest:
                found.append(multi)
                rest = rest.replace(f" {multi} ", " ")
        found += [w for w in tokens(rest) if w not in _FILLER and len(w) >= 2 and not w.isdigit()]
        if found:
            per_alt.append(list(dict.fromkeys(found)))
    if len(per_alt) == 1:  # every term needed ("REST APIs and microservices"; "B.Tech in CS or related field")
        groups = [_forms(t) for t in per_alt[0]]
    else:  # "Python or Go": one group, any of them counts
        merged: set[str] = set()
        for t in (t for alt in per_alt for t in alt):
            merged |= _forms(t)
        groups = [frozenset(merged)] if merged else []
    return Requirement(text=text, groups=tuple(groups), min_years=min_years)


def _named(form: str, line_folded: str, line_tokens: set[str]) -> bool:
    if " " in form or not re.fullmatch(r"[\w']+", form):
        return re.search(r"(?<![a-z0-9])" + re.escape(form) + r"s?(?![a-z0-9+#])", line_folded) is not None
    return form in line_tokens or (len(form) > 3 and form + "s" in line_tokens)


def match(req: Requirement, lines: list[str], total_years: float | None) -> RequirementMatch:
    if not req.groups:
        return RequirementMatch(requirement=req.text, met="no", evidence=None)
    folded = [(line, fold(line), set(tokens(line))) for line in lines]
    found: set[int] = set()
    best_line, best_key = None, (0, False)
    for line, f, toks in folded:
        hits = {i for i, g in enumerate(req.groups) if any(_named(form, f, toks) for form in g)}
        found |= hits
        # The line naming most of it; on a tie, a line about the work rather than the skills list or headline.
        key = (len(hits), not _META.match(line))
        if hits and key > best_key:
            best_line, best_key = line, key
    share = len(found) / len(req.groups)
    years_ok = req.min_years is None or (total_years is not None and total_years >= req.min_years)
    met: Met = "yes" if share == 1 and years_ok else "partly" if share >= 0.5 else "no"
    return RequirementMatch(requirement=req.text, met=met, evidence=best_line[:400] if best_line and met != "no"
                            else None)


def match_all(requirements: list[str], lines: list[str], total_years: float | None) -> list[RequirementMatch]:
    return [match(parse_requirement(r), lines, total_years) for r in requirements]


def parse_band(band: str | None) -> tuple[float, float | None] | None:
    """"3-5 years" -> (3, 5); "5+ years" -> (5, None); "fresher"/"entry level" -> (0, 1); None if unreadable."""
    if not band:
        return None
    low = band.lower()
    if re.search(r"fresher|entry[- ]level|graduate trainee|no experience|0\s*years?", low) and not re.search(
            r"[1-9]", low):
        return (0.0, 1.0)
    m = _BAND.search(low)
    if not m:
        return None
    lo = float(m.group(1))
    hi = float(m.group(2)) if m.group(2) else None
    if hi is None and not re.search(r"\+|plus|or more|at least|minimum|min\b", low):
        hi = None if re.search(r"years?|yrs?", low) else lo
    return (min(lo, hi), max(lo, hi)) if hi is not None else (lo, None)
