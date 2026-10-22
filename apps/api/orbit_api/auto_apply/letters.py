"""The short texts Orbit writes for one job: the cover letter and the answer to "why this company?". Both come from
the approved resume and facts, plus what the job post itself says. When the AI is down, or what it wrote fails a
check, a plain template written from the same facts is used instead, so a packet never waits on the AI.

Checks on AI text: no unfinished [placeholder], no figure the resume and post don't give (resumes/claims.py), and
no sentence that names a skill from the post the resume doesn't show (it would read as a claim). The AI line
("Prepared with Orbit AI from my verified profile.", rules.AI_LINE) ends the cover letter unless the candidate turned
it off.
"""

from __future__ import annotations

import logging
import re

from orbit_api.auto_apply import rules
from orbit_api.auto_apply.setup import Facts
from orbit_api.auto_apply.tailor import Generate
from orbit_api.live.context_builder import fence
from orbit_api.providers.llm.base import LLMError, LLMMessage, LLMRequest
from orbit_api.resumes import ai
from orbit_api.resumes.ats import _norm, _term_pattern, extract_keywords, match_keywords, resume_text
from orbit_api.resumes.claims import invented_figures, strip_invented_figures
from orbit_api.resumes.schema import ResumeData

log = logging.getLogger(__name__)
MAX_WHY = 1_200
_PLACEHOLDER = re.compile(r"\[[^\]\n]{1,80}\]|\bX%|\[mock\]", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")

WHY_SYSTEM = """You write a candidate's answer to "Why do you want to work here?" on a job application.

Rules:
- First person, plain and specific, 60-130 words, no greeting or sign-off, no markdown.
- Only facts the resume gives about the candidate. Never claim a skill, tool, degree, employer or number the resume
  doesn't show.
- What you say about the company or the role must come from the job post. Don't invent the company's mission,
  products or values.
- Connect two or three of the candidate's real experiences to what the post asks for.
Return only the answer."""


def lacking_terms(data: ResumeData, job_text: str) -> list[re.Pattern[str]]:
    """The post's skills the resume doesn't show, as patterns (a sentence naming one reads as a claim)."""
    had = _norm(resume_text(data))
    missing = match_keywords(extract_keywords(job_text, limit=30), data).missing
    return [p for p in (_term_pattern(k) for k in missing) if not p.search(had)]


def _clean(text: str, data: ResumeData, job_text: str) -> str | None:
    """AI text that passes the checks (sentences naming a skill the resume lacks are taken out), or None."""
    text = text.strip()
    if not text or _PLACEHOLDER.search(text):
        return None
    lacking = lacking_terms(data, job_text)
    paragraphs = []
    for para in re.split(r"\n\s*\n", text):
        kept = [s for s in _SENTENCE.split(para.strip())
                if s and not any(p.search(_norm(s)) for p in lacking)]
        if kept:
            paragraphs.append(" ".join(kept))
    out = "\n\n".join(paragraphs)
    out, _ = strip_invented_figures(out, resume_text(data) + "\n" + job_text[:ai.MAX_JOB_CHARS])
    if invented_figures(out, resume_text(data) + "\n" + job_text):
        return None
    return out or None


def _years(f: Facts) -> str:
    if f.years_experience is None:
        return ""
    y = f.years_experience
    n = str(int(y)) if float(y).is_integer() else f"{y:.1f}"
    return f" with {n} year{'' if y == 1 else 's'} of experience"


def _strong_lines(data: ResumeData, job_text: str, limit: int = 2) -> list[str]:
    terms = [_term_pattern(k) for k in extract_keywords(job_text, limit=30)]
    lines = [b.strip().rstrip(".") for e in data.experience for b in e.bullets if b.strip()]
    lines.sort(key=lambda b: -sum(1 for p in terms if p.search(_norm(b))))
    return lines[:limit]


def _matched(data: ResumeData, job_text: str, limit: int = 4) -> list[str]:
    return match_keywords(extract_keywords(job_text, limit=30), data).matched[:limit]


def template_letter(data: ResumeData, facts: Facts, company: str, title: str, job_text: str) -> str:
    name = facts.full_name() or data.basics.name
    role = facts.current_title or (data.experience[0].title if data.experience else "") or data.basics.headline
    first = f"I'm applying for the {title} role at {company}."
    if role:
        first += f" I'm a {role.strip()}{_years(facts)}"
        now = facts.current_company or (data.experience[0].company if data.experience else "")
        first += f", most recently at {now.strip()}." if now.strip() else "."
    parts = [f"Dear {company} hiring team,", first]
    lines = _strong_lines(data, job_text)
    if lines:
        parts.append("Some of my recent work: " + "; ".join(lines) + ".")
    skills = _matched(data, job_text)
    if skills:
        parts.append(f"The role asks for {', '.join(skills)}, which I use in my work today.")
    parts.append("I'd welcome the chance to talk about the role.")
    parts.append(f"Sincerely,\n{name}" if name else "Sincerely,")
    return "\n\n".join(parts)


def template_why(data: ResumeData, facts: Facts, company: str, title: str, job_text: str) -> str:
    skills = _matched(data, job_text, 3)
    lines = _strong_lines(data, job_text, 1)
    out = f"The {title} role at {company} lines up closely with the work I do"
    out += f": {', '.join(skills)}." if skills else "."
    if lines:
        out += f" Most relevant, I {lines[0][0].lower() + lines[0][1:]}." if lines[0][:1].isupper() else \
            f" Most relevant: {lines[0]}."
    out += f" I'd like to bring that experience to {company}."
    return out[:MAX_WHY]


def with_ai_line(letter: str, on: bool) -> str:
    return f"{letter.rstrip()}\n\n{rules.AI_LINE}" if on else letter


async def cover_letter(data: ResumeData, facts: Facts, company: str, title: str, job_text: str,
                       generate: Generate | None, ai_line: bool) -> tuple[str, bool]:
    """(the letter, whether the AI wrote it)."""
    if generate is not None:
        try:
            req = ai.cover_letter_request(data, job_text, length="short")
            req.request_type = "apply_cover_letter"
            resp = await generate(req)
            text = _clean(ai.parse_cover_letter(resp.text, data, job_text), data, job_text)
            if text and len(text) >= 200:
                return with_ai_line(text, ai_line), True
        except (LLMError, ValueError) as e:
            log.info("apply cover letter: template used (%s)", type(e).__name__)
    return with_ai_line(template_letter(data, facts, company, title, job_text), ai_line), False


async def why_company(data: ResumeData, facts: Facts, company: str, title: str, job_text: str,
                      generate: Generate | None) -> tuple[str, bool]:
    if generate is not None:
        try:
            body = (f"Company: {company}\nRole: {title}\n\n<reference_data source=\"resume\">\n"
                    f"{fence(ai._resume_json(data))}\n</reference_data>\n\n<reference_data source=\"job_post\">\n"
                    f"{fence(job_text[:ai.MAX_JOB_CHARS])}\n</reference_data>")
            resp = await generate(LLMRequest(messages=[LLMMessage("system", WHY_SYSTEM), LLMMessage("user", body)],
                                             max_tokens=400, temperature=0.4, request_type="apply_why"))
            text = _clean(resp.text, data, job_text)
            if text and 80 <= len(text) <= MAX_WHY:
                return text, True
        except (LLMError, ValueError) as e:
            log.info("apply why-company: template used (%s)", type(e).__name__)
    return template_why(data, facts, company, title, job_text), False


OPEN_SYSTEM = """You answer one question on a job application form for the candidate.

Rules:
- First person, plain and specific. Text answers: 40-150 words, no greeting, no markdown.
- Only facts the resume gives about the candidate. Never claim a skill, tool, degree, employer, number, date,
  salary, notice period, location preference or legal status the resume doesn't show.
- Anything about the company or role comes from the job post only.
- If the question has options, reply with exactly one option, copied as written, and only when the resume clearly
  supports it.
- If the resume doesn't give what the question asks, reply with exactly: NONE
Return only the answer."""


async def open_answer(data: ResumeData, company: str, title: str, job_text: str, question: str,
                      options: list[str] | None, generate: Generate | None) -> str | None:
    """A new question's answer drafted from the resume and the post, checked like the letters; None when the AI is
    off, the resume can't answer it, or the draft fails a check (the question then waits for the candidate)."""
    if generate is None:
        return None
    body = (f"Company: {company}\nRole: {title}\nQuestion: {question[:500]}\n"
            + (f"Options: {' | '.join(o[:120] for o in options[:30])}\n" if options else "")
            + f"\n<reference_data source=\"resume\">\n{fence(ai._resume_json(data))}\n</reference_data>\n\n"
            f"<reference_data source=\"job_post\">\n{fence(job_text[:ai.MAX_JOB_CHARS])}\n</reference_data>")
    try:
        resp = await generate(LLMRequest(messages=[LLMMessage("system", OPEN_SYSTEM), LLMMessage("user", body)],
                                         max_tokens=400, temperature=0.3, request_type="apply_open_answer"))
    except (LLMError, ValueError) as e:
        log.info("apply open answer: left for the candidate (%s)", type(e).__name__)
        return None
    text = resp.text.strip().strip('"')
    if not text or text.upper().startswith("NONE"):
        return None
    if options:
        return next((o for o in options if o.strip().casefold() == text.casefold()), None)
    clean = _clean(text, data, job_text)
    return clean if clean and 20 <= len(clean) <= MAX_WHY else None
