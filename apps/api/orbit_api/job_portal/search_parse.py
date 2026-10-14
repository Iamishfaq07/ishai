"""The search box: "remote React jobs in Bangalore, 2 years" -> filters (remote, Bengaluru, 2 years) + keywords
("React"). Done by rules, not the AI: it's instant, free, works offline, and the vocabulary of a job search is small
(places, work modes, years, seniority, job types, recency). Anything left over is the keywords.
"""

import re
from dataclasses import dataclass, field

from orbit_api.job_portal.geo import WORLD_CITIES, city_country, world_cities
from orbit_api.job_portal.postings import _CITY_RE, EmploymentType, Level, Workplace, find_cities

_STOP = frozenset("""
job jobs opening openings role roles position positions vacancy vacancies hiring for in at near me with and or of
the a an any all looking want need work experience exp exper experienced yr yrs year years based city around
posted post latest recent new show find search last past this within since
""".split())


@dataclass
class ParsedSearch:
    keywords: str = ""
    locations: list[str] = field(default_factory=list)
    workplace: list[Workplace] = field(default_factory=list)
    years: float | None = None
    level: Level | None = None
    job_types: list[EmploymentType] = field(default_factory=list)
    posted_within: int | None = None
    # What was understood, in words, for the chips under the box ("Remote", "Bengaluru", "2 years").
    understood: list[str] = field(default_factory=list)


# "contract" in a title ("smart contract", "contract engineer") stays a keyword. These are the employment type.
_CONTRACT = (
    r"\bfreelance\b|\bcontractual\b|\bon[- ]contract\b|"
    r"\bcontract[- ](?:role|roles|job|jobs|position|positions|work|basis)\b"
)
_RULES: list[tuple[str, str]] = [
    (r"\b(?:work from home|wfh|remote(?:ly)?)\b", "remote"),
    (r"\bhybrid\b", "hybrid"),
    (r"\b(?:on[- ]?site|in[- ]office|work from office|wfo)\b", "onsite"),
    (r"\b(?:internships?|interns?)\b", "internship"),
    (r"\b(?:freshers?|entry[- ]level|graduates?|new grads?|no experience)\b", "fresher"),
    (r"\b(?:part[- ]time)\b", "part_time"),
    (r"\b(?:full[- ]time)\b", "full_time"),
    (_CONTRACT, "contract"),
    (r"\b(?:today|last 24 ?hours?|past 24 ?hours?|24 ?h(?:ours?)?)\b", "days:1"),
    (r"\b(?:last|past) (?:3|three) days\b", "days:3"),
    (r"\b(?:this|last|past) week\b|\b7 days\b", "days:7"),
    (r"\b(?:this|last|past) month\b|\b30 days\b", "days:30"),
    (r"\banywhere in india\b|\ball india\b|\bpan india\b", "india"),
    (r"\banywhere\b|\bnationwide\b", "anywhere"),
    (r"\b(?:senior|sr\.?)\b", "level:senior"),
    (r"\b(?:junior|jr\.?)\b", "level:junior"),
    (r"\bmid(?:[- ]level)?\b", "level:mid"),
]
_YEARS = re.compile(r"\b(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)"
                    r"(?:\s+(?:of\s+)?(?:exp|experience))?\b")
_LABEL = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "In office", "internship": "Internships",
          "fresher": "Fresher", "part_time": "Part-time", "full_time": "Full-time", "contract": "Contract",
          "india": "Anywhere in India", "anywhere": "Anywhere"}


def parse_search(text: str, country: str | None = None) -> ParsedSearch:
    """`country`: where the user applies. A city elsewhere in the world stays a keyword ("Phoenix framework")."""
    out = ParsedSearch()
    q = " " + re.sub(r"\s+", " ", text.lower()).strip()[:200] + " "
    for pattern, meaning in _RULES:
        if not re.search(pattern, q):
            continue
        q = re.sub(pattern, " ", q)
        if meaning in ("remote", "hybrid", "onsite"):
            out.workplace.append(meaning)  # type: ignore[arg-type]
        elif meaning in ("internship", "part_time", "full_time", "contract"):
            out.job_types.append(meaning)  # type: ignore[arg-type]
            if meaning == "internship":
                out.level = "fresher"
        elif meaning == "fresher":
            out.level = "fresher"
        elif meaning.startswith("days:"):
            out.posted_within = int(meaning[5:])
            out.understood.append({1: "Last 24 hours", 3: "Last 3 days", 7: "Last 7 days",
                                   30: "Last 30 days"}[out.posted_within])
            continue
        elif meaning.startswith("level:"):
            out.level = meaning[6:]  # type: ignore[assignment]
            out.understood.append(meaning[6:].title())
            continue
        elif meaning == "india":
            out.locations.append("India")
        elif meaning == "anywhere":
            out.locations.append("Anywhere")
        out.understood.append(_LABEL[meaning])
    m = _YEARS.search(q)
    if m:
        out.years = float(m.group(1))
        q = q[:m.start()] + " " + q[m.end():]
        out.understood.append(f"{out.years:g} years")
    cities = find_cities(q)
    if cities:
        out.locations += cities
        out.understood += cities
        q = _CITY_RE.sub(" ", q)
    here = [c for c in world_cities(q) if country and city_country(c) == country.upper()]
    if here:
        out.locations += here
        out.understood += here
        for c in here:
            for alias in (c.lower(), *WORLD_CITIES[c][1]):
                q = re.sub(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", " ", q)
    words = [w for w in re.findall(r"[a-z0-9+#.]+(?:[-/][a-z0-9+#.]+)*", q) if w not in _STOP and not w.isdigit()]
    out.keywords = " ".join(words).strip(" .,")
    return out
