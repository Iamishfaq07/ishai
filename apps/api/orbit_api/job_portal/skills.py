"""Skills: what a job post asks for, and whether the candidate has it.

A post's skills are read once, when it's fetched (`listing_keywords`, the same keyword reading the resume maker's ATS
score uses, kept to skill-shaped terms), so ranking a thousand cached posts is set lookups, not regexes over their
text. Whether the candidate has a skill uses the ATS matcher too, synonyms included ("k8s" is Kubernetes), against
the resume and the skills the user listed in their job profile.
"""

import re

from orbit_api.resumes.ats import SKILL_VOCAB, SYNONYMS, _norm, _term_pattern, extract_keywords

MAX_KEYWORDS = 20
# Part of every listing's text hash (postings.text_hash): bumping it re-reads every cached post's skills on its next
# refresh, after a change to how skills are read.
KEYWORDS_VERSION = 3
_VOCAB = frozenset(SKILL_VOCAB)
# The ATS matcher's synonyms, plus ones job posts write that resumes don't (or the other way round).
_JOB_SYNONYMS: tuple[frozenset[str], ...] = tuple(frozenset(g) for g in (
    {"go", "golang"}, {"github actions", "gh actions"}, {"elasticsearch", "elastic search"},
    {"microservices", "micro services", "microservice"}, {"terraform", "hcl"},
))
_SYNONYM_OF: dict[str, frozenset[str]] = {}
for _group in (*SYNONYMS, *_JOB_SYNONYMS):
    _merged = frozenset().union(*(_SYNONYM_OF.get(t, frozenset()) for t in _group), _group)
    for _term in _merged:
        _SYNONYM_OF[_term] = _merged
# How each skill is usually written, so the same one reads the same on every card ("Ci/Cd", "JAVA", "Golang" and
# "golang" are "CI/CD", "Java" and "Go").
CANONICAL: dict[str, str] = {t.lower(): t for t in (
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "C++", "C#", "Ruby", "PHP", "Kotlin", "Swift", "Scala",
    "SQL", "NoSQL", "HTML", "CSS", "React", "Angular", "Vue", "Node.js", "Next.js", "Django", "Flask", "FastAPI",
    "Spring", "Ruby on Rails", ".NET", "GraphQL", "REST", "gRPC", "Microservices", "Kubernetes", "Docker", "Terraform",
    "Ansible", "AWS", "Azure", "GCP", "Linux", "Git", "CI/CD", "Jenkins", "GitHub Actions", "GitHub", "GitLab",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "RabbitMQ", "Elasticsearch", "Spark", "Hadoop", "Airflow",
    "Snowflake", "dbt", "BigQuery", "Tableau", "Power BI", "Looker", "Excel", "Pandas", "NumPy", "PyTorch",
    "TensorFlow", "scikit-learn", "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "Data Science",
    "Data Analysis", "Data Engineering", "LLM", "Generative AI", "Distributed Systems", "System Design", "API Design",
    "DevOps", "SRE", "Observability", "ETL", "Data Pipelines", "iOS", "Android", "Figma", "UX", "UI", "SAP", "ERP",
    "CRM", "SEO", "Salesforce", "HubSpot", "Serverless", "Selenium", "Jira",
)} | {"golang": "Go", "postgres": "PostgreSQL", "psql": "PostgreSQL", "k8s": "Kubernetes", "nodejs": "Node.js",
      "node": "Node.js", "reactjs": "React", "react.js": "React", "restful": "REST", "rest api": "REST",
      "rest apis": "REST", "js": "JavaScript", "ts": "TypeScript", "ml": "Machine Learning", "ci cd": "CI/CD",
      "amazon web services": "AWS", "google cloud": "GCP", "google cloud platform": "GCP"}
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


# Acronyms in Indian job posts that aren't skills: pay, degrees, office terms, and the legal and hiring lines of
# global companies' posts ("AEDT": New York's automated-hiring law; "PIP", "YC", "IC", "USD").
_NOT_SKILLS = frozenset({"ctc", "lpa", "btech", "b.tech", "mtech", "m.tech", "mba", "mca", "bca", "bsc", "msc", "phd",
                         "be", "me", "wfo", "wfh", "tat", "jd", "hr", "pf", "esic", "nda", "ncr", "kpis", "okrs", "kpi",
                         "okr", "aedt", "yc", "ic", "ics", "top", "usd", "inr", "eur", "gbp", "db", "ce", "bd", "pip",
                         "smb", "smbs", "ip", "ceo", "cto", "cfo", "coo", "vp", "faq", "roi", "esop", "esops", "eeoc",
                         "ofccp", "gdpr", "ccpa", "ai/ml", "r&d", "b2b", "b2c", "saas", "nyc", "sf", "ny"})


# Words every post uses ("communication", "performance", "embedded finance"), and the hiring and business lines most
# engineering posts carry ("recruiting", "compliance", "roadmap"): no signal about fit, and noise as a "missing
# skill". A post whose title names one ("Performance Marketing Manager", "Compliance Analyst") still has it.
WEAK = frozenset({"communication", "leadership", "performance", "strategy", "operations", "research", "writing",
                  "editing", "training", "mentoring", "presentation", "cross-functional", "automation", "scalability",
                  "brand", "mobile", "networking", "embedded", "onboarding", "team leadership", "testing", "cloud",
                  "security", "monitoring", "analytics", "process improvement", "ai", "recruiting", "recruitment",
                  "roadmap", "compliance", "risk management", "sales", "social media", "customer service",
                  "supply chain", "procurement", "agile", "scrum", "kanban", "sdlc", "user research", "accessibility",
                  "negotiation", "budgeting", "forecasting", "stakeholder management", "customer success",
                  "quality assurance", "audit", "logistics", "marketing", "lean", "unit testing"})
_JUNK = re.compile(r"[A-Za-z0-9]{24,}")  # a tracking code, not a word


def skill_like(term: str) -> bool:
    low = term.lower()
    if low in _NOT_SKILLS or len(term) > 30 or _JUNK.search(term):
        return False
    if low in _VOCAB or low in _SYNONYM_OF or low in _EXTRA or low in CANONICAL:
        return True
    # An unknown two-letter acronym ("IA", "AA", "CE") is far more often an abbreviation than a skill.
    return bool(_TECH_SHAPED.search(term)) and not re.fullmatch(r"[A-Z]{2}s?", term)


def display(term: str) -> str:
    """A skill as it's usually written: "golang" and "Golang" -> "Go", "Ci/Cd" -> "CI/CD", "JAVA" -> "Java"."""
    known = CANONICAL.get(term.lower())
    if known:
        return known
    if "/" in term and all(len(p) <= 4 for p in term.split("/")):
        return term.upper()
    if term.isupper() and len(term) > 4 and term.isalpha() and term.lower() in _VOCAB:
        return term.title()  # "LEADERSHIP"
    return term


def same_skill(term: str) -> str:
    """One key per skill, synonyms included ("Golang" and "Go", "ML" and "Machine Learning")."""
    low = term.lower()
    group = _SYNONYM_OF.get(low)
    return min(group) if group else low


# First words of company names that are everyday words: "Data Axle" doesn't make "Databricks" its own product.
_COMMON_FIRST = frozenset("""
data cloud smart tech info digital global india first open blue next code soft micro meta deep fast easy home link
care life star true zero wise work team pure big one new web app
""".split())


def _companys_own(term: str, company: str) -> bool:
    """The company's name or one of its products ("FamCard" at FamPay, "Okta Workforce Identity" at Okta): what the
    company sells isn't a skill the candidate needs."""
    words = re.findall(r"[a-z0-9]+", company.lower())
    if not words:
        return False
    low, first = term.lower(), words[0]
    if low == company.lower().strip():
        return True
    if len(first) < 4 or first in _COMMON_FIRST:
        return False
    # Its name ("Elastic" -> "Elasticsearch"), or a CamelCase name on its stem ("FamPay" -> "FamCard").
    return low.startswith(first) or (low.startswith(first[:3]) and bool(re.fullmatch(r"[A-Z][a-z]+[A-Z]\w*", term)))


def listing_keywords(title: str, description: str, company: str = "") -> list[str]:
    """The skills a post asks for, most prominent first (its title's words and the most repeated first), each once."""
    text = f"{title}\n{description}"
    in_title = title.lower()
    found: list[str] = []
    seen: set[str] = set()
    for t in extract_keywords(text, 30):
        low, key = t.lower(), same_skill(t)
        if (skill_like(t) and key not in seen and (low not in WEAK or low in in_title)
                and not _companys_own(t, company)):
            found.append(display(t))
            seen.add(key)
    norm = _norm(text[:8_000])
    for term, pattern in _EXTRA_PATTERNS:
        key = same_skill(term)
        if key not in seen and term.lower() not in WEAK and pattern.search(norm) and not _companys_own(term, company):
            found.append(term)
            seen.add(key)
    return found[:MAX_KEYWORDS]


class SkillMatcher:
    """Does the candidate have this skill? Built once per feed request from the resume's text and the profile's
    skills; each term is looked up once and remembered."""

    def __init__(self, resume_text: str, profile_skills: list[str]) -> None:
        self._raw = resume_text + "\n" + "\n".join(profile_skills)
        self._text = _norm(self._raw)
        # Nothing to compare with (no resume, no skills in the profile): every post would look like a total miss.
        self.empty = not self._text.strip()
        self._seen: dict[str, bool] = {}

    def has(self, term: str) -> bool:
        key = term.lower()
        hit = self._seen.get(key)
        if hit is None:
            forms = _SYNONYM_OF.get(key, frozenset({key})) | {key}
            # "Go" in a resume is ambiguous ("go-to", "go live"); as a skill the matcher looks for it as written.
            if key in ("go", "golang"):
                hit = bool(re.search(r"(?<![A-Za-z0-9])(?:Go|GO|Golang|golang)(?![A-Za-z0-9])", self._raw))
                self._seen[key] = hit
                return hit
            hit = any(_term_pattern(f).search(self._text) for f in forms)
            self._seen[key] = hit
        return hit
