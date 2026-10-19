"""The numbers and rules of Orbit Apply, in one place (docs/DECISIONS.md D84). These are code, not settings: the
candidate can choose a limit *under* a cap, never past it, and no setting turns a rule off.

The rules (orbit-business-autoapply.md §2.5):
1. Answers come only from what the candidate approved: the master resume, the confirmed facts and the answer bank.
   Nothing invents experience, skills, degrees, salary history, notice period or work authorisation. A required
   question without a truthful answer stops the packet (`needs_answer`) until the candidate answers it once.
2. Legal attestations (work authorisation, sponsorship, background checks, "I certify", arbitration, an AI policy)
   are answered only from an explicit answer the candidate set. Voluntary self-identification (EEO) is "decline to
   self-identify" unless the candidate chose otherwise.
3. Tailoring only reorders and rewords true facts. It never adds a skill or a tool the master resume doesn't show
   (tailor.py checks the result, and a test proves it).
4. No job board automation: LinkedIn, Indeed, Naukri, Glassdoor and similar are a one-click hand-off to the
   candidate. No captcha solving and no stored job-site passwords: a captcha, a login or an email check comes back
   as "needs you".
5. Caps and pacing are enforced by the server. A daily cap of at most 25, two applications per company per 30 days,
   3-8 minutes between submissions to the same ATS board, 60 seconds between any two, quiet hours, and a per-site
   kill switch.
6. Billing counts confirmed submissions only. A lease that expires or ends any other way gives its credit back.
"""

from datetime import timedelta
from typing import Literal

# ---- caps --------------------------------------------------------------------------------------------------------
DEFAULT_DAILY_LIMIT = 10
MAX_DAILY_LIMIT = 25  # hard: no plan, setting or admin raises it
PER_COMPANY_LIMIT = 2  # applications (submitted or on the way) per company
PER_COMPANY_WINDOW = timedelta(days=30)
MAX_FRESH_DAYS = 30  # a post older than this is never applied to
DEFAULT_FRESH_DAYS = 14
DEFAULT_THRESHOLD = 60  # the Jobs AI match score a job needs
MIN_THRESHOLD = 45  # the lowest the candidate may set: below this a match isn't worth an application
PREPARED_AHEAD = 2  # open packets kept ready, as a multiple of the daily limit

# ---- pacing ------------------------------------------------------------------------------------------------------
LEASE = timedelta(minutes=15)
MIN_GAP = timedelta(seconds=60)  # between any two of one candidate's submissions
TENANT_GAP_S = (180, 480)  # random, per packet: between two submissions to the same ATS board
PACKET_TTL = timedelta(days=5)  # a prepared packet nobody leased is dropped (the post may have changed)
MAX_ATTEMPTS = 3  # leases that ran out before the packet is given up
RESULT_GRACE = timedelta(hours=2)  # a late result for a lease that ran out still counts (it may have submitted)

# ---- the kill switch ---------------------------------------------------------------------------------------------
KILL_WINDOW = 20  # the last N results on a site
KILL_MIN_RESULTS = 8  # fewer than this says nothing
KILL_RATE = 0.4  # a captcha / blocked / failed share at or over this pauses the site
KILL_LOOKBACK = timedelta(hours=24)
KILL_PAUSE = timedelta(hours=6)
BAD_REASONS = frozenset({"captcha", "blocked"})

# ---- billing -----------------------------------------------------------------------------------------------------
# Applications included per 30-day allowance window, by plan. The Free plan's are a trial, once per account.
FREE_TRIAL_APPLICATIONS = 5
PLAN_APPLICATIONS: dict[str, int] = {"basic": 60, "pro": 150, "premium": 300, "unlimited": 750}
CREDIT_KIND: Literal["apply"] = "apply"  # top-ups: credits.py entries of this kind, one per confirmed application

# ---- proof -------------------------------------------------------------------------------------------------------
MAX_SCREENSHOT_BYTES = 1_500_000
MAX_PAYLOAD_CHARS = 200_000

# ---- consent -----------------------------------------------------------------------------------------------------
CONSENT_VERSION = "2026-10-19.3"
AI_LINE = "Prepared with Orbit AI from my verified profile."
CONSENT_TEXT = (
    "I ask Orbit to apply to jobs for me, as my agent, within my filters and limits. The facts, answers and resume I "
    "approved are true, and I'll keep them up to date. Orbit submits directly to employers on Orbit Business, sharing "
    "my approved resume, contact facts and answers under their application notice. For supported external employer "
    "forms it uses my connected browser or, if I separately authorise it, Orbit's hosted browser. "
    "It stops and asks me whenever a form needs something I haven't answered, "
    "never bypasses a captcha or login, and never applies on job boards for me. I can pause or withdraw consent.")

# Executor results, and what each means for a packet.
RESULT_STATUSES = ("submitted", "needs_you", "failed", "skipped")
RESULT_REASONS = ("captcha", "login", "email_verification", "unknown_question", "form_changed", "blocked", "error")
BROWSER_ATS = ("greenhouse", "lever", "ashby")
ATS_SUPPORTED = (*BROWSER_ATS, "workday", "smartrecruiters", "workable", "recruitee")
HOSTED_CONSENT = (
    "I authorise Orbit's hosted browser to send applications using my approved resume and answers within my "
    "filters and limits, even when my device is off. Employers receive the same application data. "
    "A login, verification code, human check or missing required answer will come back to me. "
    "I can pause applications or switch back to my browser at any time.")
