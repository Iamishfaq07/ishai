"""The resume, tailored to one job from true facts only (rules.py, rule 3), with a diff the candidate sees.

Two steps. Each is checked:
1. **Reword** (Resume AI's tailoring: `resumes/ai.py suggest_request(mode="tailor")` and its grounding checks). Only
   rewrites of existing lines (the summary and role bullets) are kept. Never a new bullet, never a new skill, never a
   figure or a tool the resume doesn't already have. The AI is optional: without it this step is skipped.
2. **Reorder**: within each role, the bullets the job asks about come first. Within each skill group, so do the
   matching skills, and the projects follow the same rule. Nothing is added or removed.

`truth_violations` then compares the result with the master resume: the same skills, the same roles, titles,
companies, dates and education, no figure and no tool the master doesn't show, and none of the job's keywords the
master lacks. Anything that fails it falls back to the reorder alone, which can't fail it.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable

from pydantic import BaseModel

from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse
from orbit_api.resumes import ai
from orbit_api.resumes.apply import apply_suggestion
from orbit_api.resumes.ats import _norm, _term_pattern, extract_keywords, match_keywords, resume_text, score_resume
from orbit_api.resumes.claims import invented_figures, invented_terms
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)
MAX_REWRITES = 4
Generate = Callable[[LLMRequest], Awaitable[LLMResponse]]


class Change(BaseModel):
    kind: str  # reorder | rephrase
    section: str  # summary | experience | skills | projects
    label: str
    before: str
    after: str


class Tailored(BaseModel):
    data: ResumeData
    changes: list[Change]
    ai_used: bool = False


def _relevance(text: str, terms: list[re.Pattern[str]]) -> int:
    t = _norm(text)
    return sum(1 for p in terms if p.search(t))


def job_terms(job_text: str) -> list[re.Pattern[str]]:
    return [_term_pattern(k) for k in extract_keywords(job_text, limit=30)]


def reorder(data: ResumeData, job_text: str) -> tuple[ResumeData, list[Change]]:
    """The same resume with what the job asks about first. Order only: the content is untouched."""
    terms = job_terms(job_text)
    out = data.model_copy(deep=True)
    changes: list[Change] = []
    if not terms:
        return out, changes
    for e in out.experience:
        ranked = sorted(range(len(e.bullets)), key=lambda i: (-_relevance(e.bullets[i], terms), i))
        if ranked != list(range(len(e.bullets))):
            before = list(e.bullets)
            e.bullets = [before[i] for i in ranked]
            changes.append(Change(kind="reorder", section="experience", label=f"{e.title} at {e.company}".strip(),
                                  before="\n".join(before), after="\n".join(e.bullets)))
    for g in out.skills:
        ranked = sorted(range(len(g.items)), key=lambda i: (-_relevance(g.items[i], terms), i))
        if ranked != list(range(len(g.items))):
            before = list(g.items)
            g.items = [before[i] for i in ranked]
            changes.append(Change(kind="reorder", section="skills", label=g.name or "Skills",
                                  before=", ".join(before), after=", ".join(g.items)))
    ranked = sorted(range(len(out.projects)), key=lambda i: (
        -_relevance(" ".join([out.projects[i].name, out.projects[i].description, *out.projects[i].bullets]), terms),
        i))
    if ranked != list(range(len(out.projects))):
        before_names = [p.name for p in out.projects]
        out.projects = [out.projects[i] for i in ranked]
        changes.append(Change(kind="reorder", section="projects", label="Projects", before=", ".join(before_names),
                              after=", ".join(p.name for p in out.projects)))
    return out, changes


def _skills(data: ResumeData) -> list[str]:
    return sorted(i.strip().lower() for g in data.skills for i in g.items if i.strip())


def _facts(data: ResumeData) -> list[tuple[str, ...]]:
    return sorted([(e.title, e.company, e.start, e.end, str(e.current)) for e in data.experience]
                  + [(e.school, e.degree, e.field, e.start, e.end, e.grade) for e in data.education]
                  + [(c.name, c.issuer, c.date) for c in data.certifications])


def truth_violations(master: ResumeData, tailored: ResumeData, job_text: str) -> list[str]:
    """What the tailored resume claims that the master doesn't. Empty means it's the candidate's own facts."""
    out: list[str] = []
    if _skills(master) != _skills(tailored):
        out.append("the skills changed")
    if _facts(master) != _facts(tailored):
        out.append("roles, schools or dates changed")
    if len(tailored.projects) != len(master.projects) or {p.name for p in tailored.projects} != {
            p.name for p in master.projects}:
        out.append("the projects changed")
    before, after = resume_text(master), resume_text(tailored)
    lacking = match_keywords(extract_keywords(job_text, limit=30), master).missing
    text, had = _norm(after), _norm(before)
    for kw in lacking:
        if _term_pattern(kw).search(text) and not _term_pattern(kw).search(had):
            out.append(f"names {kw}, which the resume doesn't show")
    out += [f"names {t}, which the resume doesn't show" for t in invented_terms(after, before)]
    out += [f"adds the figure {f}" for f in invented_figures(after, before)]
    return out


async def _reword(master: ResumeData, job_text: str, generate: Generate) -> tuple[ResumeData, list[Change]]:
    llm = get_llm_provider()
    report = score_resume(master, job_text=job_text)
    req = ai.suggest_request(master, report, llm, mode="tailor", job_text=job_text, focus=None)
    req.request_type = "apply_tailor"
    resp = await generate(req)
    suggestions = ai.parse_suggestions(resp, master, job_text=job_text, add_below=0)
    had = _norm(resume_text(master))
    lacking = [k for k in match_keywords(extract_keywords(job_text, limit=30), master).missing
               if not _term_pattern(k).search(had)]
    out = master
    changes: list[Change] = []
    for s in suggestions:
        if s.kind != "rewrite" or not (s.path == "basics.summary" or s.path.startswith("experience.")):
            continue
        if any(_term_pattern(k).search(_norm(s.after)) for k in lacking):
            log.info("apply tailoring: dropped a rewrite naming a skill the resume lacks")
            continue
        changed = apply_suggestion(out, s)
        if changed is out:
            continue
        out = changed
        changes.append(Change(kind="rephrase", section="summary" if s.path == "basics.summary" else "experience",
                              label=s.label, before=s.before, after=s.after))
        if len(changes) >= MAX_REWRITES:
            break
    return out, changes


async def tailor(master: ResumeData, job_text: str, generate: Generate | None = None) -> Tailored:
    master = master.visible()
    reworded: ResumeData = master
    rephrased: list[Change] = []
    if generate is not None and job_text.strip():
        try:
            reworded, rephrased = await _reword(master, job_text, generate)
        except (LLMError, ValueError, KeyError, TypeError) as e:  # the AI is optional here
            log.info("apply tailoring: rewording skipped (%s)", type(e).__name__)
            reworded, rephrased = master, []
    data, moved = reorder(reworded, job_text)
    problems = truth_violations(master, data, job_text)
    if problems:
        log.warning("apply tailoring: rewording dropped (%s)", "; ".join(problems[:3]))
        data, moved = reorder(master, job_text)
        rephrased = []
        if truth_violations(master, data, job_text):  # can't happen: reordering adds nothing
            return Tailored(data=master, changes=[])
    return Tailored(data=data, changes=[*rephrased, *moved], ai_used=bool(rephrased))
