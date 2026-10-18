"""The answer bank: about 30 common screening questions, how each is recognised on a form, and how it may be answered.
The rules are code (rules.py). Each question is answered from one place, chosen here and not by any setting:

- **profile**: the facts the candidate confirmed (setup.py): contact details, years, notice period, salary *only if
  they gave it*, and work authorisation and sponsorship per country, set explicitly by them.
- **bank**: an answer the candidate wrote. Legal attestations (arbitration, an AI policy, background checks,
  "I certify…", data consent) are only ever answered from here, and agreements that differ by employer (arbitration,
  an AI policy) are answered once per company.
- **generated**: text Orbit writes for this job from true facts only: "why this company", the cover letter, how the
  candidate found the post (Jobs AI found it on the company's careers page or a feed).
- Voluntary self-identification (gender, race, veteran status, disability…) is "decline to self-identify" unless the
  candidate set an answer, and a required one with no decline option stops the packet.

Anything else a form asks becomes a "needs an answer" question for the candidate when it's required, and is left
blank when it isn't. Nothing here guesses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from orbit_api.auto_apply.forms import FormQuestion, Option
from orbit_api.auto_apply.setup import Facts
from orbit_api.job_portal.geo import countries_in
from orbit_api.job_portal.postings import all_cities
from orbit_api.resumes.schema import ResumeData
from orbit_api.sessions.loop_memory import same_company

Source = Literal["bank", "profile", "generated"]
BankKind = Literal["text", "textarea", "yes_no", "select", "number", "date"]
DECLINE = "Decline to self-identify"
_DECLINE_RE = re.compile(r"decline|prefer not|don.?t wish|do not wish|not (?:to )?(?:say|disclose|answer|specify)|"
                         r"rather not|choose not|no answer|not declared|wish not", re.I)
MAX_ANSWER = 4000


@dataclass(frozen=True)
class Seed:
    key: str
    label: str  # how the setup wizard asks it
    kind: BankKind
    pattern: re.Pattern[str]
    legal: bool = False
    eeo: bool = False
    # Answered from the facts, the resume or the job (no bank value needed); a bank value, when the candidate gave
    # one, is used where the facts are silent.
    derived: bool = False
    per_company: bool = False  # an agreement that differs by employer: answered once per company
    default: str = ""
    help: str = ""


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


# First match wins, so the narrow ones come first (sponsorship before work authorisation, EEO before the rest).
SEEDS: tuple[Seed, ...] = (
    # -- voluntary self-identification: "decline" unless the candidate chose otherwise
    Seed("eeo_gender", "Gender (voluntary)", "select", _p(r"^\s*gender\b|\bgender identity\b|identify your gender|"
                                                          r"disclose your gender|describes your gender|\bsex\b"),
         eeo=True, default=DECLINE),
    Seed("eeo_race", "Race / ethnicity (voluntary)", "select", _p(r"\brace\b|ethnic"), eeo=True, default=DECLINE),
    Seed("eeo_hispanic", "Hispanic or Latino (voluntary)", "select", _p(r"hispanic|latin[oax]"), eeo=True,
         default=DECLINE),
    Seed("eeo_veteran", "Veteran status (voluntary)", "select", _p(r"veteran"), eeo=True, default=DECLINE),
    Seed("eeo_disability", "Disability (voluntary)", "select", _p(r"disabilit"), eeo=True, default=DECLINE),
    Seed("eeo_orientation", "Sexual orientation (voluntary)", "select", _p(r"sexual orientation|lgbt"), eeo=True,
         default=DECLINE),
    Seed("eeo_pronouns", "Pronouns (voluntary)", "select", _p(r"pronoun"), eeo=True, default=DECLINE),
    # -- legal attestations: only an explicit answer
    Seed("sponsorship", "Will you need visa sponsorship?", "yes_no",
         _p(r"sponsor|visa|h-?1b|immigration (?:case|status|support)"), legal=True, derived=True,
         help="Set per country under Work authorisation."),
    Seed("work_authorized", "Are you legally authorised to work there?", "yes_no",
         _p(r"(?:legally |lawfully )?(?:authori[sz]ed|eligible|permitted|right) to work|work (?:authori[sz]ation|"
            r"permit)|right to work"), legal=True, derived=True, help="Set per country under Work authorisation."),
    Seed("arbitration", "Arbitration agreements", "select", _p(r"arbitrat"), legal=True, per_company=True,
         help="Agreed once per company, by you."),
    Seed("ai_policy", "An employer's AI policy for applications", "select",
         _p(r"\bai (?:policy|partnership|guidance|usage|use)\b|use of (?:ai|artificial intelligence)|"
            r"artificial intelligence (?:policy|tools)"), legal=True, per_company=True,
         help="Read the employer's policy; answered once per company, by you."),
    Seed("background_check", "Will you consent to a background check?", "yes_no",
         _p(r"background (?:check|verification|screen)"), legal=True),
    Seed("criminal_record", "Criminal record questions", "yes_no",
         _p(r"convicted|criminal|felony|offen[cs]e"), legal=True),
    Seed("certify_true", "I certify the information I give is true", "yes_no",
         _p(r"\bcertify\b|\battest\b|information (?:provided|given|submitted) (?:is|are) (?:true|accurate)|"
            r"true and (?:complete|accurate)"), legal=True),
    Seed("data_consent", "Consent to processing my application data", "yes_no",
         _p(r"privacy (?:policy|notice)|personal data|data (?:processing|protection|retention)|\bgdpr\b|"
            r"consent to (?:the )?(?:processing|storage|retention)"), legal=True),
    Seed("non_compete", "Are you bound by a non-compete or similar agreement?", "yes_no",
         _p(r"non-?compete|non-?solicit|restrictive covenant"), legal=True),
    Seed("age_18", "Are you 18 or older?", "yes_no", _p(r"\b18\b.{0,20}(?:years|older|age)|age of 18|legal age"),
         legal=True),
    Seed("security_clearance", "Security clearance", "text", _p(r"security clearance|clearance level"), legal=True),
    # -- from the confirmed facts, the resume or the job
    Seed("notice_period", "Notice period", "text", _p(r"notice period|notice (?:in|of) days|serving notice"),
         derived=True),
    Seed("earliest_start", "Earliest start date", "text",
         _p(r"earliest .{0,30}start|start date|when can you (?:start|join)|available to (?:start|join)|"
            r"date of joining|joining date|availability"), derived=True),
    Seed("current_salary", "Current salary (only if you choose to give it)", "text",
         _p(r"current (?:salary|compensation|ctc|pay|package)|present (?:salary|ctc)|salary history|"
            r"(?:last|previous) (?:drawn )?(?:salary|ctc|compensation)"), derived=True),
    Seed("expected_salary", "Expected salary", "text",
         _p(r"expect\w* (?:salary|compensation|ctc|pay|package)|salary (?:expectation|requirement)|desired (?:salary|"
            r"compensation|pay)|compensation (?:expectation|requirement)|\bectc\b"), derived=True),
    Seed("located_or_relocate", "Located there, or open to relocating", "yes_no",
         _p(r"located .{0,60} or .{0,30}relocat|based .{0,60} or .{0,30}relocat"), derived=True),
    Seed("relocation", "Willing to relocate?", "yes_no", _p(r"relocat"), derived=True),
    Seed("located_in", "Where you're based", "yes_no",
         _p(r"(?:are|do) you (?:currently )?(?:based|located|living|live|reside|residing)"), derived=True),
    Seed("years_experience", "Total years of experience", "number",
         _p(r"(?:total|overall|professional|work|relevant|industry)?\s*years? (?:of )?(?:total |overall |"
            r"professional |relevant |work |industry )?(?:work )?experience"), derived=True),
    Seed("current_title", "Current job title", "text", _p(r"current (?:job )?(?:title|role|designation|position)"),
         derived=True),
    Seed("highest_degree", "Highest degree", "text",
         _p(r"highest (?:level of )?(?:degree|education|qualification)|education level"), derived=True),
    Seed("previously_employed", "Have you worked at this company before?", "yes_no",
         _p(r"(?:have|did) you (?:ever )?(?:previously )?(?:worked|been employed) (?:for|at|by)\b|former employee|"
            r"previously (?:worked|been employed|employed) (?:for|at|by)\b"), derived=True),
    Seed("how_heard", "How did you hear about the job?", "text",
         _p(r"how did you (?:hear|find|learn|get to know|come across)|where did you (?:hear|find|see)|"
            r"(?:referral|lead|job) source"), derived=True),
    # -- written for this job from true facts
    Seed("why_company", "Why this company? (written for each job from your facts)", "textarea",
         _p(r"\bwhy\b.{0,40}(?:work|join|interested|want|apply|excit)|\bwhy [A-Z][\w.]*\??$|what (?:draws|attracts|"
            r"excites|interests) you|motivat\w+ (?:to|for) (?:apply|join)|interest in (?:this|the) (?:role|position|"
            r"company)"), derived=True),
    Seed("cover_letter", "Cover letter / additional information", "textarea",
         _p(r"cover letter|additional information|anything else|additional comments|tell us more"), derived=True),
    # -- the candidate's own answers (empty until they give one)
    Seed("previously_interviewed", "Have you interviewed with this company before?", "yes_no",
         _p(r"interviewed (?:with|at|for)|applied (?:to|at|with) .{0,30} before|previously applied")),
    Seed("onsite_ok", "Open to working on site some days a week?", "yes_no",
         _p(r"in (?:the )?office \d|(?:\d|three|four|five) days? (?:a|per|/) ?week|work(?:ing)? (?:from|in) "
            r"(?:the |our )?office|on-?site|hybrid")),
    Seed("travel", "Willing to travel for work?", "yes_no",
         _p(r"(?:willing(?:ness)?|able|open) to travel|travel (?:up to|requirements?|\d+ ?%)")),
    Seed("languages", "Languages you speak", "text", _p(r"languages? (?:do you|you) speak|fluent in|proficien\w+ in "
                                                       r"(?:english|hindi|german|french|spanish)")),
    Seed("referral", "Were you referred? By whom?", "text", _p(r"referr")),
)
SEED_BY_KEY = {s.key: s for s in SEEDS}


def norm_label(label: str) -> str:
    low = re.sub(r"\(optional\)|\*", " ", label.lower())
    return " ".join(re.sub(r"[^\w\s]", " ", low).split())[:180]


def seed_for(label: str, description: str = "") -> Seed | None:
    text = " ".join(label.split())
    for s in SEEDS:
        if s.pattern.search(text):
            return s
    # A short label with the real question in its description ("AI Policy for Application", then the policy).
    if description and len(text) < 60:
        for s in SEEDS:
            if (s.legal or s.eeo) and s.pattern.search(description[:600]):
                return s
    return None


def bank_norm(seed: Seed | None, label: str, company_key: str) -> str:
    """Where an answer to this question is kept: the seed's key (per company for agreements), or the label's words."""
    if seed is None:
        return norm_label(label)
    return f"{seed.key}@{company_key}"[:200] if seed.per_company else seed.key


# ---- answering ---------------------------------------------------------------------------------------------------


class Answer(BaseModel):
    question_id: str | None
    label: str
    kind: str
    value: str | list[str]
    source: Source
    required: bool = False
    options: list[str] | None = None


class Missing(BaseModel):
    question_id: str | None
    label: str
    kind: str
    required: bool = True
    options: list[str] | None = None
    why: str = ""  # what makes it the candidate's to answer
    bank_key: str = ""  # where the answer is saved for next time
    legal: bool = False


@dataclass
class Context:
    facts: Facts
    resume: ResumeData
    bank: dict[str, str]  # norm -> the candidate's answer
    company: str
    company_key: str
    title: str
    job_country: str | None
    job_cities: list[str]
    direct: bool  # found on the company's own careers page (not a feed)
    generated: dict[str, str] = field(default_factory=dict)  # "why_company", "cover_letter"


def _yes(options: list[Option]) -> Option | None:
    return next((o for o in options if re.match(r"\s*(yes|i am\b(?! not)|i do\b(?! not)|true|agree)", o.label,
                                                re.I)), None)


def _no(options: list[Option]) -> Option | None:
    return next((o for o in options if re.match(r"\s*(no\b|i am not|i do not|false|not )", o.label, re.I)), None)


def pick(options: list[Option], raw: str | bool) -> Option | None:
    """The option that says `raw`: yes / no for a boolean, else the same words, else one that contains them."""
    if isinstance(raw, bool):
        return _yes(options) if raw else _no(options)
    want = norm_label(raw)
    if not want:
        return None
    if want in ("yes", "true"):
        return _yes(options)
    if want in ("no", "false"):
        return _no(options)
    for o in options:
        if norm_label(o.label) == want or norm_label(o.value) == want:
            return o
    for o in options:
        have = norm_label(o.label)
        if have and (have.startswith(want) or want.startswith(have)):
            return o
    hits = [o for o in options if want in norm_label(o.label)]
    return hits[0] if len(hits) == 1 else None


def _decline(options: list[Option]) -> Option | None:
    return next((o for o in options if _DECLINE_RE.search(o.label)), None)


def _fit(q: FormQuestion, raw: str | bool | None, source: Source) -> Answer | None:
    """`raw` written the way this question takes it, or None when it can't be without changing what it says."""
    if raw is None or raw == "":
        return None
    options = [o.label for o in q.options] or None
    if q.kind in ("select", "multiselect") or (q.kind == "boolean" and q.options):
        o = pick(q.options, raw)
        if o is None:
            return None
        value: str | list[str] = [o.label] if q.kind == "multiselect" else o.label
        return Answer(question_id=q.id, label=q.label, kind=q.kind, value=value, source=source, required=q.required,
                      options=options)
    if q.kind in ("boolean", "checkbox"):
        if isinstance(raw, str):
            low = norm_label(raw)
            if low in ("yes", "true", "agree", "i agree", "y"):
                raw = True
            elif low in ("no", "false", "n"):
                raw = False
            else:
                return None
        if q.kind == "checkbox" and raw is False:
            return None  # an unticked box is no answer: a required one stops the packet
        return Answer(question_id=q.id, label=q.label, kind=q.kind, value="Yes" if raw else "No", source=source,
                      required=q.required)
    if isinstance(raw, bool):
        raw = "Yes" if raw else "No"
    if q.kind == "number":
        m = re.fullmatch(r"\s*(\d[\d,]*(?:\.\d+)?)\s*", raw)
        if not m:
            return None
        raw = m.group(1).replace(",", "")
    return Answer(question_id=q.id, label=q.label, kind=q.kind, value=raw[:MAX_ANSWER], source=source,
                  required=q.required)


def standard_value(standard: str, facts: Facts, ctx: Context) -> str:
    if standard == "location":
        return facts.location()
    if standard == "full_name":
        return facts.full_name()
    if standard == "cover_letter":
        return ctx.generated.get("cover_letter", "")
    value = getattr(facts, standard, "")
    return value if isinstance(value, str) else ""


def _years(v: float | None) -> str | None:
    if v is None:
        return None
    return str(int(v)) if float(v).is_integer() else f"{v:.1f}"


def _country_asked(q: FormQuestion, ctx: Context) -> str | None:
    found = countries_in(q.label)
    return found[0] if found else ctx.job_country or ctx.facts.country or None


def _lives_in(label: str, facts: Facts) -> bool | None:
    """Whether the candidate lives where the question names; None when it names nowhere Orbit can read, or the
    candidate didn't say where they live."""
    if not facts.city.strip():
        return None
    named = all_cities(label)
    mine = all_cities(facts.city)
    if named and mine:
        return bool(set(named) & set(mine))
    countries = countries_in(label)
    if countries and facts.country:
        return facts.country in countries
    return None


def _derived(seed: Seed, q: FormQuestion, ctx: Context) -> str | bool | None:
    f = ctx.facts
    key = seed.key
    if key in ("sponsorship", "work_authorized"):
        auth = f.auth_for(_country_asked(q, ctx))
        if auth is None:
            return None
        return auth.needs_sponsorship if key == "sponsorship" else auth.authorized
    if key == "notice_period":
        if f.notice_period_days is None:
            return None
        return str(f.notice_period_days) if q.kind == "number" or "day" in q.label.lower() else \
            f"{f.notice_period_days} days"
    if key == "earliest_start":
        if f.earliest_start.strip():
            return f.earliest_start.strip()
        if f.notice_period_days is not None:
            return "Right away" if f.notice_period_days == 0 else f"After my {f.notice_period_days}-day notice period"
        return None
    if key == "current_salary":
        return f.current_salary.strip() or None  # salary history: only what the candidate chose to give
    if key == "expected_salary":
        return f.expected_salary.strip() or None
    if key == "relocation":
        return f.willing_to_relocate
    if key == "located_or_relocate":
        here = _lives_in(q.label, f)
        if here or f.willing_to_relocate:
            return True
        if here is False and f.willing_to_relocate is False:
            return False
        return None
    if key == "located_in":
        return _lives_in(q.label, f)
    if key == "years_experience":
        if re.search(r"experience\b.{0,25}\b(?:in|with|using|on|as)\b", q.label, re.I):
            return None  # years with one skill or role: only the candidate knows
        return _years(f.years_experience)
    if key == "current_title":
        return f.current_title.strip() or None
    if key == "highest_degree":
        return f.highest_degree.strip() or None
    if key == "previously_employed":
        if any(same_company(e.company, ctx.company) for e in ctx.resume.experience if e.company):
            return True
        return None  # not on the resume: the candidate's own answer (bank), if they gave one
    if key == "how_heard":
        if q.options:
            words = r"career|company website|website|job board|online|internet|other" if ctx.direct else \
                r"job board|online|internet|website|other"
            o = next((o for o in q.options if re.search(words, o.label, re.I)), None)
            return o.label if o else None
        return "The company's careers page" if ctx.direct else "An online job board"
    if key in ("why_company", "cover_letter"):
        text = ctx.generated.get(key, "")
        return text or None
    return None


def answer(q: FormQuestion, ctx: Context) -> Answer | Missing | None:
    """The truthful answer to one question, a Missing when it's required and has none, or None to leave it blank."""
    if q.kind == "file" and q.standard in ("resume", "cover_letter"):
        return None  # the resume is the packet's file; a cover letter goes in as text
    seed = seed_for(q.label, q.description)
    norm = bank_norm(seed, q.label, ctx.company_key)
    mine = ctx.bank.get(norm) or (ctx.bank.get(norm_label(q.label)) if seed is not None else None)

    def missing(why: str) -> Missing | None:
        if not q.required:
            return None
        return Missing(question_id=q.id, label=q.label, kind=q.kind, options=[o.label for o in q.options] or None,
                       why=why, bank_key=norm, legal=bool(seed and seed.legal))

    if q.kind == "file":
        return missing("The form asks for a file only you can give.")

    # Voluntary self-identification: the candidate's choice, else decline.
    if q.section == "eeo" or (seed is not None and seed.eeo):
        if mine and (a := _fit(q, mine, "bank")):
            return a
        if q.options:
            d = _decline(q.options)
            if d is not None:
                return Answer(question_id=q.id, label=q.label, kind=q.kind, source="bank", required=q.required,
                              value=[d.label] if q.kind == "multiselect" else d.label,
                              options=[o.label for o in q.options])
        return missing("A required self-identification question with no way to decline.")

    if q.standard is not None and q.standard not in ("resume", "cover_letter"):
        a = _fit(q, standard_value(q.standard, ctx.facts, ctx), "profile")
        return a or missing("Add this to your Orbit Apply profile.")

    if seed is not None and seed.legal:
        # Attestations: the candidate's explicit answer only (work authorisation per country, set by them).
        if seed.derived and (a := _fit(q, _derived(seed, q, ctx), "profile")):
            return a
        if mine and (a := _fit(q, mine, "bank")):
            return a
        return missing("A legal question: Orbit answers it only with an answer you set yourself.")

    if mine and (a := _fit(q, mine, "bank")):
        return a
    if seed is not None and seed.derived:
        source: Source = "generated" if seed.key in ("why_company", "cover_letter", "how_heard") else "profile"
        if (a := _fit(q, _derived(seed, q, ctx), source)) is not None:
            return a
    if q.standard == "cover_letter" and (a := _fit(q, ctx.generated.get("cover_letter"), "generated")):
        return a
    return missing("Orbit has no answer to this from what you approved.")


def seeds_for_setup() -> list[Seed]:
    """The bank's questions as the setup wizard lists them: everything a candidate can pre-answer."""
    return [s for s in SEEDS if not (s.derived and not s.legal) or s.key in ("previously_employed",)]
