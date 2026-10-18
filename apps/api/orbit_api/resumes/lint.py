"""Line-by-line writing checks (no AI): what a recruiter, or a checker like Resume Worded or Rezi, flags on each line.

Every issue names its line (`path`), so the editor marks the line itself and offers the AI rewrite for it, instead of
one "3 of 9 bullets…" note. Two ATS checks summarise them (ats.py): "clear_writing" (weak openers, passive voice,
filler, a past role in the present tense, a repeated bullet) and "tech_names" (GitHub, not "Github"), whose fixes are
mechanical (fixes.casing_suggestions).
"""

import re
from typing import Literal

from pydantic import BaseModel

from orbit_api.resumes.schema import ResumeData

IssueKind = Literal["weak_opener", "passive", "filler", "tense", "duplicate", "casing"]


class LineIssue(BaseModel):
    path: str
    kind: IssueKind
    message: str
    # "casing" only: the whole line with the names fixed, applied as is (nothing to rewrite).
    fixed: str | None = None


# Openers that describe a duty instead of an action.
_WEAK_OPENER = re.compile(
    r"^(?:responsible for|helped(?: to)?|helping|assisted(?: with| in)?|assisting|worked (?:on|with|in|as)|working "
    r"on|tasked with|duties (?:included|include)|involved in|participated in|in charge of|handled|was responsible)\b",
    re.IGNORECASE)
# "was implemented", "were given", "has been reduced": the result without the doer.
_PASSIVE = re.compile(r"\b(?:was|were|been|being|got|is|are)\s+(?:\w+ly\s+)?(\w+(?:ed|en|wn|lt|ght))\b",
                      re.IGNORECASE)
_NOT_PASSIVE = frozenset({"often", "open", "even", "seen", "been", "given", "taken", "golden", "hidden"})
# Words that take space and say nothing.
_FILLER = re.compile(r"\b(very|really|just|basically|actually|successfully|effectively|various|several|etc\.?|"
                     r"a lot of|lots of|different|numerous|in order to)\b", re.IGNORECASE)

# Names people (and ATS keyword filters) expect spelled one way.
CANONICAL = {name.lower(): name for name in (
    "GitHub", "GitLab", "JavaScript", "TypeScript", "PostgreSQL", "MySQL", "MongoDB", "Node.js", "Next.js", "React",
    "Vue.js", "Angular", "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Python", "Java", "C#", "C++", ".NET",
    "GraphQL", "Jira", "Figma", "Salesforce", "HubSpot", "Tableau", "Power BI", "Terraform", "Ansible", "Jenkins",
    "Kafka", "Redis", "Elasticsearch", "Snowflake", "BigQuery", "iOS", "Android", "macOS", "Linux", "SQL", "NoSQL",
    "HTML", "CSS", "LinkedIn", "YouTube", "WordPress", "Shopify", "Excel", "PowerPoint", "Photoshop", "Illustrator",
    "TensorFlow", "PyTorch", "scikit-learn", "pandas", "NumPy", "FastAPI", "Django", "Flask", "Spring Boot",
    "Ruby on Rails", "DevOps", "CI/CD", "OAuth", "JSON", "REST API", "SaaS", "SEO", "Google Analytics", "Zendesk",
    "Slack", "Notion",
)}
# Spellings that are always a mistake for that name (not an ordinary word in another sense).
_AMBIGUOUS = frozenset({"react", "java", "excel", "slack", "notion", "pandas", "angular", "azure", "flask"})
_CASE_RE = re.compile(r"(?<![\w.#+/-])(" + "|".join(sorted((re.escape(k) for k in CANONICAL if k not in _AMBIGUOUS),
                                                            key=len, reverse=True)) + r")(?![\w#+-])", re.IGNORECASE)


def _bullets(data: ResumeData) -> list[tuple[str, str, bool]]:
    """(path, text, past role) for every non-empty bullet; project bullets count as past."""
    out = []
    for e in data.experience:
        past = not e.current and bool(e.end.strip())
        out += [(f"experience.{e.id}.bullets.{i}", t.strip(), past) for i, t in enumerate(e.bullets) if t.strip()]
    for p in data.projects:
        out += [(f"projects.{p.id}.bullets.{i}", t.strip(), False) for i, t in enumerate(p.bullets) if t.strip()]
    return out


def line_count(data: ResumeData) -> int:
    """How many bullet lines the checks look at (roles and projects)."""
    return len(_bullets(data))


# Past forms spelled like a present: the same word ("Cut", "Set", "Read", "Forecast") or another verb's present
# ("Found": find, found; to found is "founded"). On a role you've left they're the past, so the "+ed" reading
# ("found" -> "founded") mustn't call them present.
_PAST_LOOKALIKES = frozenset("""
found bound wound ground forecast broadcast set put cut read split spread shut hit let cast cost quit bid hurt beat
upset
""".split())


def _present_opener(word: str) -> bool:
    from orbit_api.resumes.ats import ACTION_VERBS, is_action_verb

    w = word.lower().strip(".,;:")
    return (bool(w) and is_action_verb(w) and w not in ACTION_VERBS and w not in _PAST_LOOKALIKES
            and not w.endswith(("ed", "ing")))


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def fix_casing(text: str) -> str:
    return _CASE_RE.sub(lambda m: CANONICAL[m.group(1).lower()], text)


def line_issues(data: ResumeData) -> list[LineIssue]:
    issues: list[LineIssue] = []
    seen: dict[str, str] = {}
    for path, text, past in _bullets(data):
        if m := _WEAK_OPENER.match(text):
            issues.append(LineIssue(path=path, kind="weak_opener",
                                    message=f"Starts with \"{m.group(0)}\", which describes a duty. Lead with what you "
                                            "did: \"Ran…\", \"Built…\", \"Cut…\"."))
        elif past and _present_opener(text.split()[0] if text.split() else ""):
            issues.append(LineIssue(path=path, kind="tense",
                                    message=f"A past role in the present tense (\"{text.split()[0]}…\"): use the past "
                                            "tense for jobs you've left."))
        passive = next((p for p in _PASSIVE.finditer(text) if p.group(1).lower() not in _NOT_PASSIVE), None)
        if passive:
            issues.append(LineIssue(path=path, kind="passive",
                                    message=f"Passive (\"{passive.group(0)}\") hides who did it: say what you did."))
        if f := _FILLER.search(text):
            issues.append(LineIssue(path=path, kind="filler",
                                    message=f"\"{f.group(1)}\" adds nothing here: cut it, or replace it with the "
                                            "specific detail."))
        key = _norm(text)
        if key in seen:
            issues.append(LineIssue(path=path, kind="duplicate",
                                    message="The same bullet appears twice: keep one, or make this one about "
                                            "something else."))
        elif key:
            seen[key] = path
    fields = [*((p, t) for p, t, _ in _bullets(data)), ("basics.summary", data.basics.summary)]
    for path, text in fields:
        fixed = fix_casing(text)
        if fixed != text:
            wrong = next(m.group(1) for m in _CASE_RE.finditer(text) if CANONICAL[m.group(1).lower()] != m.group(1))
            issues.append(LineIssue(path=path, kind="casing", fixed=fixed,
                                    message=f"Write \"{CANONICAL[wrong.lower()]}\", not \"{wrong}\": it's how "
                                            "recruiters and keyword filters spell it."))
    return issues
