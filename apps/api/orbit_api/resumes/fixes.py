"""Fixes the editor can apply without rewriting a sentence: add the skills the resume already proves (or the job post
asks for), and write every date the same way.

Skills come in three honesty tiers, and the editor shows which is which:
- evidence: a tool the resume's own bullets and projects name but its Skills section lacks. Adding it says nothing new.
- job post: a keyword the posting asks for that the resume doesn't have. The candidate must confirm they have it.
- typical: common for the kind of role (the AI's guess, see `ai.parse_skill_ideas`). Same confirmation.
"""

import re
from collections import Counter
from typing import Literal

from pydantic import BaseModel

from orbit_api.live.keyterms import shaped_terms
from orbit_api.resumes.ats import (
    _MONTH_NUM,
    _MONTHS,
    ACTION_VERBS,
    SKILL_VOCAB,
    AtsReport,
    _term_pattern,
    date_style,
    pretty_term,
)
from orbit_api.resumes.claims import _GENERIC
from orbit_api.resumes.schema import ResumeData, new_id

MIN_SKILLS = 8
JOB_CONFIRM = "These come from the job post. Add only the ones you've really used."
TYPICAL_CONFIRM = "Common for your kind of role, not taken from your resume. Add only what you really use."

# Vocabulary words that read as a topic rather than a skill when they turn up in a sentence ("cut cloud costs").
_VAGUE = frozenset({"cloud", "writing", "research", "training", "audit", "brand", "operations", "editing", "lean"})

Kind = Literal["rewrite", "add_skill", "add_bullet", "set"]


class Suggestion(BaseModel):
    """One change the editor can apply. `rewrite` and `set` replace the text at `path` (which must still equal
    `before`); `add_skill` adds the comma-separated skills in `after`; `add_bullet` appends `after` to the role at
    `path` ("experience.<id>.bullets.+"). `confirm` is a warning the candidate must read before accepting."""
    id: str
    path: str
    label: str
    before: str
    after: str
    reason: str
    kind: Kind = "rewrite"
    confirm: str | None = None


def has_skill(skills: set[str], term: str) -> bool:
    key = term.lower().strip()
    return key in skills or key.rstrip("s") in skills or any(key == s.rstrip("s") for s in skills)


def current_skills(data: ResumeData) -> set[str]:
    return {i.strip().lower() for g in data.skills for i in g.items if i.strip()}


_pretty = pretty_term


def _own_words(data: ResumeData) -> set[str]:
    """Words that name the candidate's employers, schools and titles: never skills."""
    parts = [data.basics.name]
    for e in data.experience:
        parts += [e.company, e.title]
    parts += [x for ed in data.education for x in (ed.school, ed.degree, ed.field)]
    parts += [p.name for p in data.projects]
    return {w.lower() for text in parts for w in re.findall(r"[A-Za-z][A-Za-z0-9+#.]*", text)}


def evidence_skills(data: ResumeData) -> list[str]:
    """Tools the resume's own text names that its skills list lacks, most often named first."""
    have = current_skills(data)
    own = _own_words(data)
    texts = [data.basics.summary, *(b for e in data.experience for b in e.bullets),
             *(t for p in data.projects for t in (p.description, *p.bullets))]
    body = "\n".join(t for t in texts if t.strip())
    found: Counter[str] = Counter()
    shown: dict[str, str] = {}
    for term in SKILL_VOCAB:
        n = len(_term_pattern(term).findall(body.lower()))
        if n and term not in own and term not in _VAGUE:
            found[term] += n
            shown[term] = _pretty(term, body)
    for text in texts:
        words = re.findall(r"[A-Za-z]+", text)
        first = words[0].lower() if words else ""
        for term in shaped_terms(text):
            key = term.lower()
            if key == first or key in ACTION_VERBS or key in _GENERIC or key in own or len(term) > 30:
                continue
            found[key] += 1
            shown.setdefault(key, term)
    out = []
    taken: list[str] = []
    for key, _ in found.most_common():
        if has_skill(have, key) or any(key in t.split() or t in key.split() for t in taken):
            continue
        taken.append(key)
        out.append(shown[key])
    return out


def job_skills(report: AtsReport, job_text: str, data: ResumeData, skip: list[str]) -> list[str]:
    if not report.keywords:
        return []
    have = current_skills(data) | {s.lower() for s in skip}
    return [_pretty(k, job_text) for k in report.keywords.missing if not has_skill(have, k)][:8]


def skill_suggestions(data: ResumeData, report: AtsReport, job_text: str = "") -> list[Suggestion]:
    """Up to two suggestions: skills the resume proves, and (with a job post) skills the posting asks for."""
    out: list[Suggestion] = []
    mine = evidence_skills(data)[:10]
    if mine:
        out.append(Suggestion(
            id=new_id(), path="skills", label="Skills your resume already shows", before="", after=", ".join(mine),
            reason="You mention these in your experience but don't list them: a recruiter searching the Skills "
                   "section, or an ATS filter, won't find them otherwise.", kind="add_skill"))
    theirs = job_skills(report, job_text, data, mine)
    if theirs:
        out.append(Suggestion(
            id=new_id(), path="skills", label="Skills the job post asks for", before="", after=", ".join(theirs),
            reason="The job post uses these words and your resume doesn't, so keyword filters skip it.",
            kind="add_skill", confirm=JOB_CONFIRM))
    return out


def casing_suggestions(data: ResumeData) -> list[Suggestion]:
    """Tool and tech names written the standard way ("github" -> "GitHub"), one "set" per line: mechanical, so
    they're free on every plan and apply in bulk with the other safe fixes."""
    from orbit_api.resumes.lint import line_issues

    out: list[Suggestion] = []
    labels = {p: label for p, (label, _) in _field_labels(data).items()}
    for issue in line_issues(data):
        if issue.kind != "casing" or issue.fixed is None:
            continue
        before = _text_at(data, issue.path)
        if before is None or before == issue.fixed:
            continue
        out.append(Suggestion(id=new_id(), path=issue.path, label=labels.get(issue.path, "Spelling"), before=before,
                              after=issue.fixed, reason=issue.message, kind="set"))
    return out


def _field_labels(data: ResumeData) -> dict[str, tuple[str, str]]:
    from orbit_api.resumes.ai import editable_fields

    return editable_fields(data)


def _text_at(data: ResumeData, path: str) -> str | None:
    """The text at a summary or bullet path ("experience.<id>.bullets.2"), if it's there."""
    if path == "basics.summary":
        return data.basics.summary
    parts = path.split(".")
    if len(parts) == 4 and parts[2] == "bullets" and parts[3].isdigit():
        items = data.experience if parts[0] == "experience" else data.projects if parts[0] == "projects" else []
        for item in items:
            if item.id == parts[1] and int(parts[3]) < len(item.bullets):
                return item.bullets[int(parts[3])]
    return None


def skills_needed(data: ResumeData) -> int:
    return max(0, MIN_SKILLS - len(current_skills(data)))


# ---- dates -----------------------------------------------------------------------------------------------------


def _month_year(value: str) -> tuple[int, int] | None:
    """(year, month) when the date names both: "Jan 2021", "January 2021", "01/2021", "2021-01"."""
    v = value.strip().lower()
    year = re.search(r"\b(?:19|20)\d{2}\b", v)
    if not year:
        return None
    month = _MONTH_NUM.get(v[:3])
    if month is None:
        m = re.fullmatch(r"(\d{1,2})\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*(\d{1,2})", v)
        month = int(m.group(1) or m.group(2)) if m else None
    return (int(year.group(0)), month) if month and 1 <= month <= 12 else None


def date_suggestions(data: ResumeData) -> list[Suggestion]:
    """Rewrite the role dates that don't match the rest: to "Jan 2021" when every date names its month, else to the
    year alone (turning "2021" into "Jan 2021" would invent a month)."""
    fields = [(e, attr, getattr(e, attr)) for e in data.experience for attr in ("start", "end")]
    styles = {s for _, _, v in fields if (s := date_style(v))}
    if len(styles) <= 1 and "other" not in styles:
        return []
    to_months = "year" not in styles
    out: list[Suggestion] = []
    for e, attr, value in fields:
        if date_style(value) is None:  # blank, or "Present"
            continue
        if to_months:
            my = _month_year(value)
            if my is None:
                continue
            after = f"{_MONTHS[my[1] - 1].title()} {my[0]}"
        else:
            year = re.search(r"\b(?:19|20)\d{2}\b", value)
            after = year.group(0) if year else ""
        if not after or value.strip() == after:
            continue
        role = " at ".join(x for x in (e.title, e.company) if x) or "Role"
        out.append(Suggestion(
            id=new_id(), path=f"experience.{e.id}.{attr}", label=f"{role}, {attr} date", before=value, after=after,
            reason="Writes every date the same way so a parser can work out how long each role lasted.", kind="set"))
    return out[:12]
