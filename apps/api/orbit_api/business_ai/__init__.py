"""Orbit for Business: the AI module (Phase 1). A pure module: no routes, no database, no web code. The Business
routes import it (DECISIONS D83; research note orbit-business-autoapply.md §5.2 item 7 and §6.2).

Interface
---------
    async def write_job_description(brief: JobBrief) -> JobDraft
    async def parse_applicant_resume(text: str) -> ParsedResume
    async def rank_applicant(job: JobSpec, resume: ParsedResume, answers: list[ScreeningAnswer]) -> Ranking
    def redact_for_ranking(resume, answers, job=None) -> RedactedProfile   # what the ranking is allowed to read

None of the three raises because the model is down, slow or answering badly: each has a deterministic path
(the JD writer a template from the brief, `JobDraft.source == "template"`; the parser its regex extraction; the
ranking keyword matching, `model_version` ending "deterministic-only"). Models are in `schemas.py`; `JobDraft` has two
additive fields beyond the agreed interface (`inclusive_language_notes`, `source`).

Limits per model call (llm.py): a token cap and a timeout (JD 3,000 tokens / 60 s, parse 2,500 / 45 s, rank
1,500 / 30 s), JSON output validated by pydantic, one retry (a plain retry after a failure, or a repair prompt
showing the model its invalid answer), so at most two calls per function call. Usage and estimated cost are logged.

Scoring (ranking.score, "score-v1"): deterministic, from the matches, never a number the model gives.
    credit: yes = 1, partly = 0.5, no = 0
    must   = mean credit of the must-haves                  weight 70
    nice   = mean credit of the nice-to-haves               weight 20
    band   = experience band: at or above its lower bound 1; under it by a year or less, or years unknown, 0.5;
             otherwise 0. Above the band is never marked down (it would act as an age proxy).   weight 10
    score  = round(100 * sum(weight * part) / sum(weight of the parts that apply)); a part with nothing to measure
             (no nice-to-haves, no band) drops out. Location is never scored: it becomes a caution for a person.

Fairness rules
--------------
- Protected attributes never reach the ranking: `redact_for_ranking()` strips the name, contact details, links,
  photo references, gender (words, titles, pronouns), age (date of birth, "27 years old", education years), marital
  and family status, religion, caste, nationality and origin (work-authorisation statements stay only when the job's
  location rules ask for it), disability and health, and the location line. The model, the deterministic matcher
  and the evidence check all read only that text, so two resumes that differ only in those details get the same
  score and matches (tests/test_business_ai.py, the bias consistency test).
- Evidence is checked: every quote the model gives is looked up in the redacted resume and answers (verbatim or
  near-verbatim, text.find_quote) and replaced by the source's own line; a "yes"/"partly" whose quote isn't there is
  downgraded to what keyword matching finds, and a caution says so.
- No auto-reject: there is no reject output. Model text recommending rejection is removed; cautions are things a
  person should check, worded neutrally. A requirement that screens on a protected characteristic is never scored.
- Auditable: `Ranking.model_version` is "<prompt version>+<score version>+<model id>" (or "match-v1+score-v1+
  deterministic-only"). It's audit data for logs and admin screens: customer-facing text never names the model
  provider.
- Job descriptions: inclusive wording (coded words replaced and listed), no discriminatory requirements, nothing the
  brief doesn't state (figures, benefits, company claims), 300-700 words, English or Hindi (others best-effort).
"""

from orbit_api.business_ai.jd import write_job_description
from orbit_api.business_ai.ranking import rank_applicant, score
from orbit_api.business_ai.redact import RedactedProfile, redact_for_ranking
from orbit_api.business_ai.resume import parse_applicant_resume
from orbit_api.business_ai.schemas import (
    Education,
    Experience,
    JobBrief,
    JobDraft,
    JobSpec,
    ParsedResume,
    Ranking,
    RequirementMatch,
    ScreeningAnswer,
    ScreeningQuestion,
)

__all__ = [
    "Education",
    "Experience",
    "JobBrief",
    "JobDraft",
    "JobSpec",
    "ParsedResume",
    "Ranking",
    "RedactedProfile",
    "RequirementMatch",
    "ScreeningAnswer",
    "ScreeningQuestion",
    "parse_applicant_resume",
    "rank_applicant",
    "redact_for_ranking",
    "score",
    "write_job_description",
]
