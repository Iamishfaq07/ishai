"""What the session knows about the candidate's real background, so answers sound like them (no model call).

- `infer_level`: fresher / junior / mid / senior, from the resume (years stated, dated roles, titles, "final-year
  student") and, when the resume says nothing, the target role. A fresher's answer that talks like a staff engineer
  is the one an interviewer catches.
- `Background.unshown`: the technologies a question names that the verified facts never mention ("Have you used
  Kubernetes?" against a resume without it), so the answer doesn't fake hands-on expertise there.

Heuristics on the documents already loaded for the session, run once per session (the level) or per question (a
few substring checks).
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from orbit_api.live.events import ExperienceLevel, QuestionType
from orbit_api.live.keyterms import tech_terms
from orbit_api.retrieval.index import IndexedChunk

Level = ExperienceLevel  # never "auto" once inferred

_MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                                       "dec"), 1)}
# "(2021–2025)", "May 2025 – July 2025", "2018 - present", "Jan 2020 to Mar 2022"
_DATE = r"(?:(?P<{0}m>jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?P<{0}y>(?:19|20)\d{{2}})"
_RANGE = re.compile(_DATE.format("s") + r"\s*(?:–|—|-|to|until)\s*(?:" + _DATE.format("e")
                    + r"|(?P<now>present|current|now|today|date))", re.IGNORECASE)
_YEARS = re.compile(r"\b(\d{1,2})\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:professional|industry|hands-on|work))?"
                    r"(?:\s+experience)?", re.IGNORECASE)
_INTERN = re.compile(r"\b(?:intern|internship|trainee|apprentice|student|teaching assistant|volunteer)\b", re.I)
_FRESHER = re.compile(r"\b(?:final[- ]year|pre[- ]final|undergraduate|fresher|recent graduate|fresh graduate|"
                      r"graduating|expected (?:19|20)\d{2}|student|pursuing|campus)\b", re.I)
_SENIOR_TITLE = re.compile(r"\b(?:senior|sr\.?|lead|staff|principal|architect|head of|manager|director|vp)\b", re.I)
_JUNIOR_TITLE = re.compile(r"\b(?:junior|jr\.?|associate|graduate|entry[- ]level)\b", re.I)
_ROLE_FRESHER = re.compile(r"\b(?:intern|internship|graduate|fresher|trainee|entry[- ]level|campus|new grad)\b", re.I)


def _month(name: str | None) -> int:
    return _MONTHS.get((name or "")[:3].lower(), 6)


def _span_months(text: str, now: datetime) -> int | None:
    m = _RANGE.search(text)
    if m is None:
        return None
    start = int(m.group("sy")) * 12 + (_month(m.group("sm")) if m.group("sm") else 1)
    if m.group("now"):
        end = now.year * 12 + now.month
    else:
        end = int(m.group("ey")) * 12 + (_month(m.group("em")) if m.group("em") else 12)
    return max(end - start, 0)


def infer_level(chunks: Iterable[IndexedChunk], role: str | None, *, now: datetime | None = None) -> Level | None:
    """The candidate's level from what the session knows, or None when it can't tell (no resume and a plain role)."""
    now = now or datetime.now(UTC)
    resume = [c for c in chunks if c.doc_kind == "resume"]
    stated = [int(m.group(1)) for c in resume if c.category == "summary" for m in _YEARS.finditer(c.text)]
    # One entry per dated role: experience chunks repeat their "Role — Company (dates)" heading on every bullet.
    roles: dict[str, bool] = {}  # heading → is an internship
    months = 0
    for c in resume:
        if c.category != "experience":
            continue
        heading = c.text.split(": ", 1)[0] if ": " in c.text else c.text
        if heading in roles:
            continue
        roles[heading] = bool(_INTERN.search(heading))
        span = _span_months(heading, now)
        if span is not None and not roles[heading]:
            months += span
    years = max([*stated, months / 12], default=0.0)
    senior_title = any(_SENIOR_TITLE.search(h) for h, intern in roles.items() if not intern)
    fresher_words = any(_FRESHER.search(c.text) for c in resume if c.category in ("summary", "education"))
    if resume:
        if years >= 6 or (senior_title and years >= 4):
            return "senior"
        if years >= 2.5:
            return "mid"
        if years >= 0.75 and not fresher_words:
            return "junior"
        if fresher_words or (roles and all(roles.values())) or not roles:
            return "fresher"  # a student, only internships, or a resume of projects and education
        if senior_title:
            return "senior"  # undated, but "Senior Engineer"
        if any(_JUNIOR_TITLE.search(h) for h in roles):
            return "junior"
    if role:
        if _ROLE_FRESHER.search(role):
            return "fresher"
        if _JUNIOR_TITLE.search(role):
            return "junior"
        if _SENIOR_TITLE.search(role):
            return "senior"
    return None


# Tools and platforms people have (or haven't) used hands-on, as a question may name them, capitalised or not (live
# transcripts and typed chat don't always). Concepts and protocols (HTTPS, an API, a URL shortener) are knowledge,
# not something to have run in production, so they aren't here.
_TECH_WORDS = (
    "sql", "nosql", "spark", "kafka streams",
    "kubernetes", "docker", "kafka", "git", "github", "gitlab", "jenkins", "terraform", "ansible", "helm", "linux",
    "postgres", "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "rabbitmq", "nginx", "airflow",
    "hadoop", "snowflake", "bigquery", "dbt", "tableau", "excel", "react", "angular", "vue", "django", "flask",
    "fastapi", "spring", "node.js", "nodejs", "java", "python", "golang", "rust", "scala", "kotlin", "swift",
    "flutter", "android",
    "typescript", "javascript", "php", "laravel", "ruby", "rails", "tensorflow", "pytorch", "pandas", "numpy",
    "selenium", "cypress", "jira", "figma", "salesforce", "prometheus", "grafana", "datadog", "splunk", "kubectl",
    "microservices", "serverless", "graphql", "websockets", "oauth", "machine learning", "deep learning",
    "computer vision", "nlp", "llm", "llms", "devops", "mlops", "ci/cd", "cicd", "aws", "azure", "gcp",
)
_TECH_WORD = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(w) for w in _TECH_WORDS) + r")(?![\w-])", re.I)
# Different names for the same thing: a resume saying "K8s" or "EKS" shows Kubernetes.
_ALIASES: dict[str, tuple[str, ...]] = {
    "kubernetes": ("k8s", "eks", "gke", "aks", "openshift", "kubectl"), "kubectl": ("kubernetes", "k8s"),
    "postgres": ("postgresql",), "postgresql": ("postgres",), "golang": ("go",), "go": ("golang",),
    "javascript": ("js", "node.js", "react", "typescript"), "node.js": ("nodejs", "node"),
    "aws": ("amazon web services", "ec2", "s3", "eks", "lambda"), "gcp": ("google cloud",),
    "azure": ("microsoft azure",),
    "ci/cd": ("cicd", "github actions", "jenkins", "gitlab ci", "continuous integration"), "cicd": ("ci/cd",),
    "machine learning": ("ml", "model", "models", "scikit", "pytorch", "tensorflow"), "ml": ("machine learning",),
    "llm": ("llms", "gpt", "language model"), "llms": ("llm", "gpt", "language model"),
    "microservices": ("microservice", "services on kubernetes"), "git": ("github", "gitlab", "bitbucket"),
    "sql": ("postgres", "postgresql", "mysql", "sqlite", "oracle", "sql server", "bigquery", "snowflake"),
}
# "Have you used gRPC?", "Any experience with Pulsar?": asked about hands-on use, any tool the question names counts
# (by shape or as a name, keyterms.tech_terms), not only the known ones.
_HANDS_ON_ASK = re.compile(r"\b(?:have you (?:ever )?(?:used|worked|tried|built|deployed|run|set up|touched)|"
                           r"experience (?:with|in|using)|familiar with|comfortable with|worked with|hands[- ]on)\b",
                           re.I)
# Named or shaped words that aren't a tool to have used ("Is it OK", "HR round", "Q2", "a URL").
_NOT_TECH = frozenset({"ok", "hr", "ctc", "ceo", "cto", "us", "uk", "usa", "eu", "it", "q1", "q2", "q3", "q4", "i",
                       "url", "urls", "id", "ui", "ux", "os", "api", "apis", "faq", "kpi", "kpis", "okr", "okrs"})
# Definitions ("What is Docker?") are knowledge, not a claim to have used it: no framing needed there.
_DEFINITION = re.compile(r"^\s*(?:what(?:'s| is| are| does)|define|what do you mean by)\b", re.I)
_ASKS_ABOUT_TECH = frozenset({QuestionType.technical, QuestionType.system_design, QuestionType.resume,
                              QuestionType.follow_up})


@dataclass(frozen=True)
class Background:
    """The verified facts' text (resume, story bank), lowercased, to check a question's technologies against."""

    text: str

    @classmethod
    def of(cls, chunks: Iterable[IndexedChunk]) -> "Background":
        return cls(" ".join(c.text for c in chunks if c.verified).lower())

    def shows(self, term: str) -> bool:
        key = term.lower()
        return any(re.search(r"(?<![\w-])" + re.escape(t) + r"(?![\w-])", self.text) for t in (key, *_ALIASES.get(
            key, ())))

    def unshown(self, question: str, qtype: QuestionType) -> list[str]:
        """The technologies the question asks about hands-on that the verified facts never mention (at most 3), or []
        when there's no resume to tell (then nothing is assumed) or the question only asks what something is."""
        if not self.text or qtype not in _ASKS_ABOUT_TECH or _DEFINITION.search(question):
            return []
        found = [m.group(0) for m in _TECH_WORD.finditer(question)]
        if _HANDS_ON_ASK.search(question):
            found += [t for t in tech_terms(question) if t.lower() not in _NOT_TECH]
        out: list[str] = []
        for term in found:
            if term.lower() not in {o.lower() for o in out} and not self.shows(term):
                out.append(term)
        return out[:3]
