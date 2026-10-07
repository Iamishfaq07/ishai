"""Skills: what a job post asks for, and whether the candidate has it.

A post's skills are read once, when it's fetched (`listing_keywords`, the same keyword reading the resume maker's ATS
score uses, kept to skill-shaped terms), so ranking a thousand cached posts is set lookups, not regexes over their
text. Whether the candidate has a skill uses the ATS matcher too, synonyms included ("k8s" is Kubernetes), against
the resume and the skills the user listed in their job profile.
"""

import re

from orbit_api.resumes.ats import SKILL_VOCAB, SYNONYMS, _norm, _term_pattern, extract_keywords

MAX_KEYWORDS = 20
_VOCAB = frozenset(SKILL_VOCAB)
_SYNONYM_OF = {term: group for group in SYNONYMS for term in group}
# Tools common in Indian job posts that the ATS vocabulary doesn't list; found by name in the post's text.
EXTRA_SKILLS: tuple[str, ...] = (
    "Spring Boot", "Hibernate", "Microservices", "React Native", "Flutter", "Redux", "Tailwind", "Next.js", "NestJS",
    "Laravel", "Celery", "PySpark", "Databricks", "Kafka", "Grafana", "Prometheus", "Datadog", "Splunk", "Helm",
    "Argo CD", "Istio", "Nginx", "Cassandra", "DynamoDB", "ClickHouse", "Selenium", "Cypress", "Playwright", "Jest",
    "Pytest", "JUnit", "LangChain", "MLOps", "SQL Server", "Oracle", "Unix", "Bash", "Shell scripting", "Photoshop",
    "Illustrator", "AutoCAD", "SolidWorks", "MATLAB", "Tally", "GST", "Zoho", "SAP FICO", "Power Apps", "Google Ads",
    "Meta Ads", "Content writing", "Lead generation", "Cold calling", "B2B sales", "Inside sales", "Recruitment",
    "Payroll", "Financial analysis", "Auditing", "Taxation",
)
_EXTRA = frozenset(t.lower() for t in EXTRA_SKILLS)
_EXTRA_PATTERNS = tuple((term, _term_pattern(term)) for term in EXTRA_SKILLS)
# Product and tech names: "GraphQL", "AWS", "EC2", "Node.js", "C++".
_TECH_SHAPED = re.compile(r"[A-Z]{2,}|[a-z][A-Z]|\d|[+#]|\.\w")


# Acronyms in Indian job posts that aren't skills: pay, degrees, office terms.
_NOT_SKILLS = frozenset({"ctc", "lpa", "btech", "b.tech", "mtech", "m.tech", "mba", "mca", "bca", "bsc", "msc", "phd",
                         "be", "me", "wfo", "wfh", "tat", "jd", "hr", "pf", "esic", "nda", "ncr", "kpis", "okrs"})


# Words every post uses ("communication", "performance", "embedded finance"): no signal about fit, and noise as a
# "missing skill". A post whose title names one ("Performance Marketing Manager") still has it from its title.
WEAK = frozenset({"communication", "leadership", "performance", "strategy", "operations", "research", "writing",
                  "editing", "training", "mentoring", "presentation", "cross-functional", "automation", "scalability",
                  "brand", "mobile", "networking", "embedded", "onboarding", "team leadership", "testing", "cloud",
                  "security", "monitoring", "analytics", "process improvement", "ai"})
_JUNK = re.compile(r"[A-Za-z0-9]{24,}")  # a tracking code, not a word


def skill_like(term: str) -> bool:
    low = term.lower()
    if low in _NOT_SKILLS or len(term) > 30 or _JUNK.search(term):
        return False
    return low in _VOCAB or low in _SYNONYM_OF or low in _EXTRA or bool(_TECH_SHAPED.search(term))


def _display(term: str) -> str:
    """"JAVA" -> "Java", "LEADERSHIP" -> "Leadership": a shouted known word in its usual form."""
    if term.isupper() and len(term) > 4 and term.lower() in _VOCAB:
        return term.title()
    if "/" in term and all(len(p) <= 4 for p in term.split("/")):
        return term.upper()  # "Ci/Cd" -> "CI/CD"
    return term


def listing_keywords(title: str, description: str, company: str = "") -> list[str]:
    """The skills a post asks for, most prominent first (its title's words and the most repeated first)."""
    text = f"{title}\n{description}"
    in_title = title.lower()
    skip = {company.lower().strip()} if company.strip() else set()
    found: list[str] = []
    seen: set[str] = set()
    for t in extract_keywords(text, 30):
        low = t.lower()
        if skill_like(t) and low not in skip and low not in seen and (low not in WEAK or low in in_title):
            found.append(_display(t))
            seen.add(low)
    norm = _norm(text[:8_000])
    for term, pattern in _EXTRA_PATTERNS:
        if term.lower() not in seen and pattern.search(norm):
            found.append(term)
            seen.add(term.lower())
    return found[:MAX_KEYWORDS]


class SkillMatcher:
    """Does the candidate have this skill? Built once per feed request from the resume's text and the profile's
    skills; each term is looked up once and remembered."""

    def __init__(self, resume_text: str, profile_skills: list[str]) -> None:
        self._text = _norm(resume_text + "\n" + "\n".join(profile_skills))
        self._seen: dict[str, bool] = {}

    def has(self, term: str) -> bool:
        key = term.lower()
        hit = self._seen.get(key)
        if hit is None:
            forms = _SYNONYM_OF.get(key, frozenset({key})) | {key}
            hit = any(_term_pattern(f).search(self._text) for f in forms)
            self._seen[key] = hit
        return hit
