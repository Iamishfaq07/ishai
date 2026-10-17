""""Fix with AI" from the ATS score: fix one problem, or all of them, and make sure it's actually fixed.

Each problem is fixed the way it can be: the mechanical ones on the spot (dates, tech names, the template, the photo,
the order of roles, contact details the account already has), wording by the AI, line by line, on exactly the lines
the check flagged. The result is applied and re-scored here; whatever is still failing gets a second, narrower AI
pass. What the AI can't honestly do is handed back instead of faked:
- a number only the candidate knows ("needs a number"): a short question per line; the answers come back as `facts`
  and are written into those lines;
- a claim the resume doesn't prove (skills from the job post, bullets drafted from a job title): `review`, for the
  candidate to keep or skip;
- something only they can add (a phone number, a role's dates): left in `remaining`, with what to add.
One request is one AI action: however many model calls it makes, it spends one resume credit. Answering its questions
(`followup`) is part of the same fix: free for half an hour.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import math
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel, Field

from orbit_api.config import get_settings
from orbit_api.models import User
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.base import LLMProvider, LLMRequest, LLMResponse
from orbit_api.resumes import ai, fixes
from orbit_api.resumes.apply import apply_suggestion, get_at
from orbit_api.resumes.ats import AtsCheck, AtsReport, date_key, is_quantified, score_resume, word_count
from orbit_api.resumes.fixes import Suggestion
from orbit_api.resumes.schema import Experience, ResumeData, ResumeDesign, new_id

log = logging.getLogger(__name__)

PASSES = 2  # model calls for the rewrite: the fix, then one on whatever is still failing
MAX_QUESTIONS = 6
# Checks fixed by rewriting the lines they flag (`paths`), and every check the AI has a part in.
LINE_CHECKS = frozenset(ai.LINE_PROBLEMS) - {"tech_names"}
AI_CHECKS = LINE_CHECKS | {"clear_writing", "summary", "bullets_per_role", "length", "keywords", "has_skills",
                           "skills_count"}
GENERIC_QUESTION = "What number would show the size of this: how many, how often, or how much?"
AI_DOWN = "The AI isn't available right now, so only the fixes that need no AI are done. Try again in a minute."
MAX_WORDS = 1000  # the "300-1,000 words" check
LATEST_ROLE_KEEPS = 4  # trimming for length never takes the current role below this many bullets
FOLLOWUP_S = 30 * 60  # how long the answers to a fix's questions are written in for free


class Question(BaseModel):
    """A number only the candidate knows, asked about one line."""
    path: str
    text: str
    question: str


class FixIn(BaseModel):
    data: ResumeData
    design: ResumeDesign = Field(default_factory=ResumeDesign)
    job_text: str = Field("", max_length=20_000)
    check: str | None = Field(None, max_length=40)  # one ATS check by id; None fixes everything
    # The candidate's answers to `questions`: path -> "about 40 a week".
    facts: dict[str, str] = Field(default_factory=dict, max_length=20)
    # From the fix that asked them (FixOut.followup): writing the answers in is part of that fix, so it's free.
    followup: str | None = Field(None, max_length=4_000)


class FixOut(BaseModel):
    suggestions: list[Suggestion]  # apply in order: one per field, `before` is the text that was sent
    review: list[Suggestion]  # need the candidate's OK first: the resume doesn't prove them
    questions: list[Question]
    design: dict[str, Any] = {}  # e.g. {"template": "classic", "show_photo": false}
    order: list[str] | None = None  # experience ids, most recent first
    score_before: int
    score_after: int  # with `suggestions`, `design` and `order` applied
    remaining: list[AtsCheck]  # what's still failing of what was asked, with how to fix it
    upgrade_required: bool = False
    ai_error: str | None = None  # the AI was down: only the fixes that need no AI are in
    followup: str | None = None  # send back with the answers to `questions`


Generate = Callable[[LLMRequest], Awaitable[LLMResponse]]


def _mac(body: str) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return urlsafe_b64encode(hmac.new(key, f"resume-fix:{body}".encode(), hashlib.sha256).digest()).decode().rstrip("=")


def _line_key(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).encode()).hexdigest()[:20]


# Follow-up tokens already used (jti -> expiry). One API instance (docs/DECISIONS.md D12), so memory is enough.
_spent: dict[str, float] = {}


def followup_token(user_id: str, lines: dict[str, str]) -> str:
    """Lets the answers to these lines' questions be written in, free, once, within FOLLOWUP_S, and only into the
    lines as they read when the questions were asked (path -> text)."""
    payload = json.dumps({"u": user_id, "l": {p: _line_key(t) for p, t in sorted(lines.items())},
                          "e": int(time.time()) + FOLLOWUP_S, "j": secrets.token_urlsafe(12)})
    body = urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{body}.{_mac(body)}"


def followup_ok(token: str, user_id: str, data: ResumeData, paths: Iterable[str]) -> bool:
    """A valid, unused token for these lines, which still read as they did: spends it."""
    body, _, mac = token.partition(".")
    if not body or not hmac.compare_digest(mac, _mac(body)):
        return False
    try:
        payload = json.loads(urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return False
    now = time.time()
    lines = payload.get("l") or {}
    jti = str(payload.get("j") or "")
    if (payload.get("u") != user_id or int(payload.get("e", 0)) < now or not jti or jti in _spent
            or not all(p in lines and lines[p] == _line_key(get_at(data, p) or "") for p in paths)):
        return False
    for old in [k for k, exp in _spent.items() if exp < now]:
        del _spent[old]
    _spent[jti] = float(payload["e"])
    return True


def _sorted_roles(roles: list[Experience]) -> list[str]:
    """Experience ids, current and most recent first (by end date, then start)."""
    def key(e: Experience) -> tuple[int, int, int, int]:
        end = date_key("present" if e.current else e.end, end=True) or (0, 0)
        start = date_key(e.start) or (0, 0)
        return (-end[0], -end[1], -start[0], -start[1])
    return [e.id for e in sorted(roles, key=key)]


def _lines(report: AtsReport, ids: set[str], data: ResumeData) -> tuple[dict[str, list[str]], list[str]]:
    """What to rewrite (path -> the problems on it) and which roles need bullets, for the checks in `ids`."""
    fields = ai.editable_fields(data)
    lines: dict[str, list[str]] = {}
    roles: list[str] = []

    def need(path: str, problem: str) -> None:
        if path in fields and problem not in lines.setdefault(path, []):
            lines[path].append(problem)

    for c in report.checks:
        if c.passed or c.id not in ids:
            continue
        if c.id in LINE_CHECKS:
            for path in c.paths:
                if path.endswith(".bullets.+"):
                    roles.append(path)
                else:
                    need(path, ai.LINE_PROBLEMS[c.id])
        elif c.id == "clear_writing":
            for issue in report.issues:
                if issue.path in c.paths and issue.kind != "casing":
                    need(issue.path, issue.message)
        elif c.id == "summary":
            need("basics.summary", "write a 2-3 sentence summary of 25-90 words: who they are, their strongest "
                                   "proven skills, and what they want next")
        elif c.id == "bullets_per_role":
            roles += [p for p in c.paths if p.endswith(".bullets.+")]
        elif c.id == "length":
            if "add more detail" in (c.fix or ""):
                if len(data.basics.summary.split()) < 25:
                    need("basics.summary", "write a 2-3 sentence summary of 40-80 words from the resume")
                for p, (_, t) in fields.items():
                    if ".bullets." in p and t.strip() and len(t.split()) < 14:
                        need(p, "too thin: add what it covered and the result, from the resume (15-30 words)")
                roles += list(ai.addable_roles(data, below=4))
            else:
                for p, (_, t) in fields.items():
                    if ".bullets." in p and len(t.split()) > 24:
                        need(p, "too long: tighten to under 22 words, keeping every number and tool it names")
    return lines, list(dict.fromkeys(roles))


def _collapse(original: ResumeData, applied: list[Suggestion]) -> list[Suggestion]:
    """One change per field, replacing the text that was sent: a line rewritten twice (the fix, then the second pass)
    comes back as one rewrite from the original to the final text."""
    out: list[Suggestion] = []
    by_path: dict[str, Suggestion] = {}
    for s in applied:
        if s.kind in ("rewrite", "set"):
            if s.path in by_path:
                first = by_path[s.path]
                first.after, first.reason = s.after, s.reason or first.reason
                continue
            before = get_at(original, s.path)
            if before is None:
                continue
            s = s.model_copy(update={"before": before})
            by_path[s.path] = s
        out.append(s)
    return [s for s in out if s.kind not in ("rewrite", "set") or s.after != s.before]


class _Fix:
    """The resume as the fix goes, and what it has done so far."""

    def __init__(self, body: FixIn) -> None:
        self.body = body
        self.data = body.data
        self.design_patch: dict[str, Any] = {}
        self.order: list[str] | None = None
        self.applied: list[Suggestion] = []
        self.review: list[Suggestion] = []
        self.asked: dict[str, str] = {}
        self.facts = {p: f.strip()[:200] for p, f in body.facts.items() if f.strip() and get_at(body.data, p)}

    async def score(self) -> AtsReport:
        # CPU-bound (regexes over the whole resume): off the event loop, so live sessions don't stall.
        return await asyncio.to_thread(score_resume, self.data, self.body.design.model_copy(update=self.design_patch),
                                       self.body.job_text)

    def take(self, s: Suggestion) -> None:
        if s.confirm:
            self.review.append(s)
        else:
            self.data = apply_suggestion(self.data, s)
            self.applied.append(s)

    def mechanical(self, ids: set[str], start: AtsReport, user: User) -> None:
        """Everything that needs no AI (free on every plan)."""
        job = self.body.job_text
        if ids & {"has_skills", "skills_count", "keywords"}:
            for s in fixes.skill_suggestions(self.data, start, job):
                self.take(s)
        if "dates" in ids:
            for s in fixes.date_suggestions(self.data):
                self.take(s)
        if "single_column" in ids:
            self.design_patch["template"] = "classic"
        if "no_photo" in ids:
            self.design_patch["show_photo"] = False
        if "bullets_per_role" in ids:
            # A role with more than six: its strongest six stay (the rest are emptied, each one restorable).
            for e in self.data.experience:
                for s in fixes.trim_role(self.data, e.id, fixes.MAX_BULLETS,
                                         "Kept this role's 6 strongest bullets: more gets skimmed."):
                    self.take(s)
        order_check = next((c for c in start.checks if c.id == "date_order"), None)
        if "date_order" in ids and order_check is not None and order_check.fix_kind == "auto":
            self.order = _sorted_roles(self.data.experience)
            rank = {rid: i for i, rid in enumerate(self.order)}
            self.data = self.data.model_copy(update={"experience": sorted(self.data.experience,
                                                                          key=lambda e: rank[e.id])})
        latest = next((e.location for e in self.data.experience if e.location.strip()), "")
        for field, value, why in (("email", user.email, "From your account."),
                                  ("name", user.name or "", "From your account."),
                                  ("location", latest, "From your most recent role.")):
            if field in ids and value.strip():
                self.take(Suggestion(id=new_id(), path=f"basics.{field}", label=f"Your {field}",
                                     before=getattr(self.data.basics, field), after=value.strip(), reason=why,
                                     kind="set"))

    async def rewrite(self, ids: set[str], llm: LLMProvider, generate: Generate) -> None:
        """The AI's part: the flagged lines, a second pass on what's still failing, the job post's keywords, skills."""
        job = self.body.job_text
        for n in range(PASSES):
            report = await self.score()
            if n > 0 and self.body.check is None:
                # Fixing everything: also what the first pass's own rewrites broke ("5 bullets start with Led").
                ids = ids | {c.id for c in report.checks if not c.passed and c.id in AI_CHECKS}
            lines, roles = _lines(report, ids, self.data)
            if n == 0 and self.facts:
                # Answers to the questions: just those lines, each with its number written in.
                fields = ai.editable_fields(self.data)
                lines = {p: [*lines.get(p, []), f"work in the candidate's fact: {f}"]
                         for p, f in self.facts.items() if p in fields}
                roles = []
            elif n > 0:
                # Only what's still failing; a line that needs a number is asked about, not tried again.
                lines = {p: [x for x in probs if x != ai.LINE_PROBLEMS["quantified"]] for p, probs in lines.items()}
                lines = {p: probs for p, probs in lines.items() if probs}
                roles = []
            if not lines and not roles:
                break
            resp = await generate(ai.fix_request(self.data, llm, lines=lines, roles=roles, job_text=job,
                                                 facts=self.facts or None, tailor="keywords" in ids))
            try:
                got = ai.parse_suggestions(resp, self.data, only=set(lines) | set(roles), facts=self.facts,
                                           limit=ai.MAX_FIX_LINES, add_below=6, job_text=job)
                if n == 0:
                    self.asked = ai.parse_questions(resp, set(lines))
            except (ValueError, json.JSONDecodeError) as e:
                log.warning("resume fix pass %s unusable: %s", n + 1, e)
                continue
            for s in got:
                self.take(s)
        tailored: AtsReport | None = await self.score() if "keywords" in ids else None
        if tailored is not None and any(c.id == "keywords" and not c.passed for c in tailored.checks):
            # The job post's words: the model picks the lines the candidate's own work supports them in.
            resp = await generate(ai.suggest_request(self.data, tailored, llm, mode="tailor", job_text=job,
                                                     focus=None, check="keywords"))
            try:
                for s in ai.parse_suggestions(resp, self.data, facts=self.facts, job_text=job):
                    self.take(s)
            except (ValueError, json.JSONDecodeError) as e:
                log.warning("resume keyword pass unusable: %s", e)
        if ids & {"has_skills", "skills_count"} and fixes.skills_needed(self.data) > 0:
            resp = await generate(ai.skills_request(self.data, llm, fixes.skills_needed(self.data)))
            try:
                idea = ai.parse_skill_ideas(resp, self.data, [x for s in self.review for x in s.after.split(", ")])
            except (ValueError, json.JSONDecodeError):
                idea = None
            if idea:
                self.review.append(idea)

    def openers(self, ids: set[str]) -> None:
        """Bullets still opening with a duty ("Responsible for") after the AI, led by the verb instead (free)."""
        if ids & {"action_verbs", "clear_writing"}:
            for s in fixes.opener_suggestions(self.data):
                self.take(s)

    def trim_length(self, ids: set[str]) -> None:
        """Still over 1,000 words after the AI tightened the long bullets: the weakest bullets go, oldest roles first
        and a round at a time (5 per role, then 4, 3, 2), until it fits. The current role keeps at least 4."""
        if "length" not in ids or word_count(self.data) <= MAX_WORDS:
            return
        order = _sorted_roles(self.data.experience)  # most recent first
        why = "Trimmed to fit 1-2 pages: the weaker bullets of older roles go first."
        for keep in (5, 4, 3, 2):
            for rid in reversed(order):
                floor = max(keep, LATEST_ROLE_KEEPS) if order and rid == order[0] else keep
                for s in fixes.trim_role(self.data, rid, floor, why):
                    self.take(s)
                    if word_count(self.data) <= MAX_WORDS:
                        return

    def questions(self, ids: set[str], end: AtsReport) -> list[Question]:
        """For "needs a number": enough lines to pass, the ones the AI had a question for first."""
        sized = next((c for c in end.checks if c.id == "quantified"), None)
        if "quantified" not in ids or sized is None or sized.passed:
            return []
        bullets = [p for p in sized.paths if get_at(self.data, p)]
        total = sum(1 for p, (_, t) in ai.editable_fields(self.data).items() if ".bullets." in p and t.strip())
        need = max(1, math.ceil(total * 0.5) - (total - len(bullets)))
        out: list[Question] = []
        for p in sorted(bullets, key=lambda p: p not in self.asked)[:min(MAX_QUESTIONS, need + 1)]:
            text = get_at(self.data, p) or ""
            if not is_quantified(text):
                out.append(Question(path=p, text=text, question=self.asked.get(p, GENERIC_QUESTION)))
        return out


async def fix_resume(body: FixIn, user: User, can_spend: Callable[[], Awaitable[bool]],
                     generate: Generate) -> tuple[FixOut, bool]:
    """The fix, and whether the AI was used (so the caller knows whether the credit was worth spending)."""
    fix = _Fix(body)
    start = await fix.score()
    ids = {c.id for c in start.checks if not c.passed and (body.check is None or c.id == body.check)}
    if fix.facts:
        ids.add("quantified")
    fix.mechanical(ids, start, user)

    used_ai = False
    calls = 0

    async def counted(req: LLMRequest) -> LLMResponse:
        nonlocal calls
        resp = await generate(req)
        calls += 1
        return resp

    upgrade = False
    ai_error: str | None = None
    ai_ids = ids & AI_CHECKS
    if ai_ids and not await can_spend():
        upgrade, ai_ids = True, set()
    if ai_ids:
        made = (len(fix.applied), len(fix.review), len(fix.asked))
        try:
            await fix.rewrite(ai_ids, get_llm_provider(), counted)
        except HTTPException as e:  # the AI is down, or the last credit went meanwhile: keep the free fixes
            upgrade = e.status_code == status.HTTP_402_PAYMENT_REQUIRED
            ai_error = None if upgrade else AI_DOWN
        # Used means something the AI wrote is in the answer: a reply that came back garbled, or one the grounding
        # checks threw out whole, gives the person only the free fixes, so the credit isn't spent on it.
        used_ai = calls > 0 and (len(fix.applied), len(fix.review), len(fix.asked)) != made
    fix.openers(ids)
    fix.trim_length(ids)
    if "tech_names" in ids or used_ai:  # last, so lines the AI just wrote are spelled right too
        for s in fixes.casing_suggestions(fix.data):
            fix.take(s)

    end = await fix.score()
    log.info("resume fix %s: %s -> %s in %s model calls", body.check or "all", start.score, end.score, calls)
    questions = fix.questions(ids, end)
    return FixOut(suggestions=_collapse(body.data, fix.applied), review=fix.review, questions=questions,
                  design=fix.design_patch, order=fix.order, score_before=start.score, score_after=end.score,
                  remaining=[c for c in end.checks if c.id in ids and not c.passed], upgrade_required=upgrade,
                  ai_error=ai_error,
                  # Only for questions a paid AI pass asked: a free (no-AI) answer can't mint free AI calls.
                  followup=followup_token(user.id, {q.path: q.text for q in questions})
                  if questions and used_ai and not upgrade else None), used_ai
