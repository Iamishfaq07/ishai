"""What a post says about visa sponsorship and relocation, and the posting check: signs a post may not be a live
opening (a ghost job). Every check here is something the post or Orbit's own record shows, said as an observation,
never a verdict: a re-dated post can be a real one that's hard to fill.

After career-ops' posting-legitimacy block and the ghost-job research (posts left up for months, reposted to look
new, with no pay band and "always looking" wording).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

Visa = Literal["offered", "not_offered"]
Tone = Literal["good", "caution", "info"]

_HEAD = 12_000  # sponsorship and relocation lines sit in the body or the footer: read most of the post

_WORDS = r"(?:[\w/-]+\s+){0,4}?"
_SPONSOR = r"(?:visa|sponsor(?:ship)?|work\s+(?:permit|visa|authori[sz]ation)|h-?1b)"
_NO_VISA = re.compile(
    r"\b(?:unable|not\s+able|cannot|can\s*not|can't|won't|will\s+not|do\s+not|don't|does\s+not|doesn't|"
    r"are\s+not\s+(?:able|in\s+a\s+position)|is\s+not\s+(?:able|possible)|not\s+in\s+a\s+position)\s+"
    r"(?:to\s+)?(?:offer|provide|sponsor|support|consider)\s+" + _WORDS + _SPONSOR
    + r"|\bno\s+(?:visa\s+)?sponsorship\b"
    + r"|\b(?:visa\s+)?sponsorship\s+(?:is\s+|will\s+)?(?:not|un)\s*(?:be\s+)?(?:available|offered|provided|possible)"
    + r"|\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+|need\s+of\s+|needing\s+|any\s+)?(?:current\s+or\s+future\s+)?"
      r"(?:visa\s+|employer\s+|company\s+)?sponsorship"
    + r"|\bnot\s+(?:eligible|open)\s+(?:for|to)\s+(?:visa\s+)?sponsorship",
    re.I)
_VISA = re.compile(
    r"\bvisa\s+(?:sponsorship|support|assistance)\s+(?:is\s+|will\s+be\s+|can\s+be\s+)?(?:available|offered|provided)"
    r"|\b(?:we|will|can|happy\s+to|able\s+to)\s+(?:also\s+)?(?:offer|provide|sponsor|support|help\s+with)\s+"
    + _WORDS + r"(?:visas?|sponsorship|work\s+permits?|h-?1b)\b"
    r"|\b(?:visa|h-?1b)\s+sponsorship\s+(?:for|to)\b"
    r"|\b(?:offers?|including|includes|with)\s+(?:full\s+)?(?:visa\s+sponsorship|visa\s+support|relocation\s+and\s+visa)"
    r"|\bsponsorship\s+(?:is\s+)?available\b",
    re.I)
_NO_RELOCATION = re.compile(r"\b(?:no|not\s+offer(?:ing)?|unable\s+to\s+(?:offer|provide))\s+relocation"
                            r"|\brelocation\s+(?:is\s+)?(?:not|un)\s*(?:available|offered|provided|supported)", re.I)
_RELOCATION = re.compile(
    r"\brelocation\s+(?:assistance|support|package|bonus|allowance|stipend|budget|help|benefits?|costs?\s+covered)"
    r"|\brelocation\s+(?:is\s+|will\s+be\s+|can\s+be\s+)?(?:offered|provided|available|supported|covered)"
    r"|\b(?:help|support|assist)\s+(?:you\s+)?(?:with\s+)?(?:your\s+)?relocat(?:e|ion|ing)"
    r"|\b(?:we|will)\s+(?:also\s+)?(?:cover|pay\s+for)\s+(?:your\s+)?(?:relocation|moving)",
    re.I)


def visa_of(text: str) -> Visa | None:
    """What the post says about sponsoring a work visa: "not_offered" wins over a stray "visa support" line (a post
    that says both usually means "not for this role")."""
    head = text[:_HEAD]
    if _NO_VISA.search(head):
        return "not_offered"
    return "offered" if _VISA.search(head) else None


def relocation_of(text: str) -> bool:
    """The post offers help moving for the job."""
    head = text[:_HEAD]
    return not _NO_RELOCATION.search(head) and bool(_RELOCATION.search(head))


# ---- the posting check ---------------------------------------------------------------------------------------------

OLD_DAYS = 21  # posts are dropped at 30 days (postings.MAX_AGE): three weeks up is long for most roles
REDATED_DAYS = 7  # the post's date moved this much after Orbit first saw it: reposted to look new
EARLIER_DAYS = 14  # the same job was first seen elsewhere this long before

_EVERGREEN = re.compile(
    r"\b(?:always\s+(?:looking|hiring|on\s+the\s+lookout)|talent\s+(?:pool|community|network|pipeline)|"
    r"future\s+(?:opportunities|openings|roles|vacancies)|evergreen\s+(?:role|position|requisition|posting)|"
    r"general\s+(?:application|interest)|expression\s+of\s+interest|no\s+(?:current|immediate)\s+(?:opening|vacanc)|"
    r"(?:not|isn't)\s+(?:an?\s+)?(?:active|current)\s+(?:opening|vacancy|role)|pipeline\s+(?:role|requisition))\b",
    re.I)
_PIPELINE_TITLE = re.compile(r"\b(?:talent\s+(?:pool|community)|general\s+application|future\s+opportunit|"
                             r"open\s+application|expression\s+of\s+interest)", re.I)


@dataclass(frozen=True)
class Signal:
    kind: str
    tone: Tone
    text: str


def _days(a: datetime, b: datetime) -> int:
    return int((a - b).total_seconds() // 86_400)


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def posting_check(*, title: str, description: str, salary: str | None, posted_at: datetime, first_seen_at: datetime,
                  earliest_elsewhere: datetime | None, still_listed_at: datetime | None, direct: bool,
                  full_text: bool, now: datetime | None = None) -> list[Signal]:
    """What Orbit can see about whether this post is a live opening: cautions first, then what's reassuring."""
    now = now or datetime.now(UTC)
    posted, seen = _aware(posted_at), _aware(first_seen_at)
    out: list[Signal] = []
    age = _days(now, min(posted, seen))
    if age >= OLD_DAYS:
        out.append(Signal("old", "caution", f"Up for {age} days. Some roles take that long to fill, but "
                                            "answers slow down: apply soon and follow up."))
    if _days(posted, seen) >= REDATED_DAYS:
        ago = max(_days(now, posted), 0)
        out.append(Signal("redated", "caution",
                          f"Re-dated: Orbit first saw this post {_days(now, seen)} days ago, but it now says it went "
                          f"up {ago} day{'' if ago == 1 else 's'} ago. Reposting to look new is common for roles that "
                          "stay open for months."))
    if earliest_elsewhere is not None and _days(seen, _aware(earliest_elsewhere)) >= EARLIER_DAYS:
        out.append(Signal("earlier", "caution", "The same job was posted elsewhere "
                                                f"{_days(now, _aware(earliest_elsewhere))} days ago: it's older than "
                                                "its date here says."))
    if _PIPELINE_TITLE.search(title) or _EVERGREEN.search(description[:_HEAD]):
        out.append(Signal("evergreen", "caution", "The post reads like a talent pool or a standing ad (\"always "
                                                  "looking\", \"future opportunities\"), not one open role."))
    if not salary and full_text:
        out.append(Signal("no_pay", "info", "No pay range in the post. Ask for it early: many places now must say."))
    if still_listed_at is not None:
        out.append(Signal("listed", "good", "On the company's own careers page as of the last check."))
    elif not direct:
        out.append(Signal("not_direct", "info", "From a job board or search, not the company's own careers page: "
                                                "check it's on their site before you spend time on it."))
    if salary:
        out.append(Signal("pay", "good", "States a pay range."))
    if age <= 3 and not any(s.kind in ("redated", "earlier") for s in out):
        out.append(Signal("fresh", "good", "Posted in the last few days."))
    order = {"caution": 0, "info": 1, "good": 2}
    return sorted(out, key=lambda s: order[s.tone])
