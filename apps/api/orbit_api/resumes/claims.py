"""Keep an AI rewrite honest: it may reword the candidate's text, never add facts.

The suggestion prompt forbids invented numbers and tools, but a model sometimes adds "by 40%" or "using Kubernetes"
anyway, and a candidate who pastes that in is then asked about it in an interview. These checks run on every rewrite,
against the whole resume (not just the field being rewritten, since a bullet may reuse a fact from elsewhere in it):

- a figure that appears nowhere in the resume becomes a bracketed placeholder the candidate must fill in;
- a tool or technology that appears nowhere in the resume drops the suggestion.
"""

import re

from orbit_api.live.keyterms import tech_terms
from orbit_api.resumes.schema import ResumeData

# 40%, $2M, 1,500, 3.5x, 10k, 5+ — but not the digits inside "S3", "k8s", "Python3", "24/7" or a year.
_NUMBER = re.compile(r"(?<![\w./\[])(\$?\d[\d,]*(?:\.\d+)?)(\s?(?:%|[kKmMbB]\b|[xX]\b|\+))?(?![\w/\]])")
_YEAR = re.compile(r"(?:19|20)\d\d")
# Generic business and engineering shorthand that isn't a tool the candidate can be quizzed on.
_GENERIC = frozenset({"kpi", "kpis", "roi", "okr", "okrs", "sla", "slas", "saas", "b2b", "b2c", "qa", "ux", "ui",
                      "hr", "it", "ceo", "cto", "cfo", "vp", "pm", "pr", "faq", "api", "apis", "ci", "cd"})


def _normal(digits: str, suffix: str | None) -> str:
    return digits.replace(",", "") + (suffix or "").replace(" ", "").lower()


def _figures(text: str) -> list[tuple[re.Match[str], str]]:
    out = []
    for m in _NUMBER.finditer(text):
        if not m.group(2) and _YEAR.fullmatch(m.group(1)):
            continue  # dates aren't figures a rewrite can inflate
        out.append((m, _normal(m.group(1), m.group(2))))
    return out


def _placeholder(m: re.Match[str]) -> str:
    whole = m.group(0)
    if "%" in whole:
        return "[X%]"
    if whole.startswith("$"):
        return "[$X]"
    return "[N]x" if whole.lower().endswith("x") else "[N]"


def invented_terms(after: str, corpus: str) -> list[str]:
    """Tools and technologies `after` names that the resume never mentions."""
    haystack = corpus.lower()
    seen: set[str] = set()
    out = []
    for term in tech_terms(after):
        key = term.lower()
        if key in seen or key in _GENERIC or key in haystack or key.rstrip("s") in haystack:
            continue
        seen.add(key)
        out.append(term)
    return out


def fill_invented_figures(after: str, corpus: str) -> tuple[str, int]:
    """`after` with every figure the resume doesn't contain replaced by a placeholder, and how many were."""
    known = {n for _, n in _figures(corpus)}
    pieces: list[str] = []
    last = 0
    count = 0
    for m, normal in _figures(after):
        if normal in known:
            continue
        pieces += [after[last:m.start()], _placeholder(m)]
        last = m.end()
        count += 1
    return "".join(pieces) + after[last:], count


# ---- import: everything the model read must be in what it was given ------------------------------------------

def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def _url_key(url: str) -> str:
    return _squash(re.sub(r"^\s*(?:https?://)?(?:www\.)?", "", url.lower())).rstrip("/")


def ground_import(data: ResumeData, source: str) -> tuple[ResumeData, list[str]]:
    """The imported resume with anything the source text doesn't back removed, and what was removed.

    The import prompt says "copy facts exactly", but a model sometimes adds a plausible skill, a placeholder-looking
    email, a profile link or a metric that the resume never had. Contact details and skills are what recruiters and
    ATS software read first, so each is checked against the source: an email, phone number or link it doesn't contain
    is blanked, a skill it never lists is dropped, and a figure it never states becomes a placeholder.
    """
    out = data.model_copy(deep=True)
    notes: list[str] = []
    flat = _squash(source)
    digits = re.sub(r"\D", "", source)
    b = out.basics
    if b.email and _squash(b.email) not in flat:
        notes.append("an email address that isn't in the source")
        b.email = ""
    phone = re.sub(r"\D", "", b.phone)
    if b.phone and (len(phone) < 7 or phone[-7:] not in digits):
        notes.append("a phone number that isn't in the source")
        b.phone = ""
    kept = [link for link in b.links if _url_key(link.url) and _url_key(link.url) in flat]
    if len(kept) != len(b.links):
        notes.append(f"{len(b.links) - len(kept)} link(s) that aren't in the source")
        b.links = kept

    seen: set[str] = set()
    dropped = 0
    groups = []
    for group in out.skills:
        items = []
        for item in group.items:
            key = item.lower().strip()
            if key in seen:
                continue  # the same skill listed in two groups
            seen.add(key)
            if _squash(item) in flat:
                items.append(item)
            else:
                dropped += 1
        if items:
            group.items = items
            groups.append(group)
    out.skills = groups
    if dropped:
        notes.append(f"{dropped} skill(s) the source never lists")

    figures = 0

    def fix(text: str) -> str:
        nonlocal figures
        fixed, n = fill_invented_figures(text, source)
        figures += n
        return fixed

    b.summary = fix(b.summary)
    for e in out.experience:
        e.bullets = [fix(t) for t in e.bullets]
    for p in out.projects:
        p.description = fix(p.description)
        p.bullets = [fix(t) for t in p.bullets]
    if figures:
        notes.append(f"{figures} figure(s) the source never states")
    return out, notes
