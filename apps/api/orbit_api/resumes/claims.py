"""Keep an AI rewrite honest: it may reword the candidate's text, never add facts.

The suggestion prompt forbids invented numbers and tools, but a model sometimes adds "by 40%" or "using Kubernetes"
anyway, and a candidate who pastes that in is then asked about it in an interview. These checks run on every rewrite,
against the whole resume (not just the field being rewritten, since a bullet may reuse a fact from elsewhere in it):

- a figure that appears nowhere in the resume drops the suggestion (invented_figures);
- a tool or technology that appears nowhere in the resume drops the suggestion.

Nothing here writes a [placeholder]: AI text is always finished text the candidate can use as it is. Where a figure
the source never gave has to go (an import, a cover letter), the words carrying it are taken out instead
(strip_invented_figures).
"""

import re
from functools import lru_cache

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
        if not m.group(2) and _YEAR.fullmatch(m.group(1).rstrip(",")):
            continue  # dates aren't figures a rewrite can inflate (nor is "Aug 2020," before a comma)
        out.append((m, _normal(m.group(1), m.group(2))))
    return out


@lru_cache(maxsize=32)
def _known_figures(corpus: str) -> frozenset[str]:
    # Once per corpus, not once per line checked against it (an import checks hundreds of lines against one source).
    return frozenset(n for _, n in _figures(corpus))


def invented_figures(text: str, corpus: str) -> list[str]:
    """The figures in `text` that appear nowhere in `corpus` (as written, e.g. "35%")."""
    known = _known_figures(corpus)
    return [m.group(0) for m, normal in _figures(text) if normal not in known]


# The words that carry a figure: "by over 35%", "to 120 ms", "for 3M users", ", saving 10 hours a week", "(40%)",
# "35% faster". Taking out the whole phrase leaves a sentence that still reads ("Cut page load time across the
# storefront").
_QUALIFIER = r"(?:(?:about|around|nearly|almost|roughly|approximately|over|more than|up to|under|less than|" \
             r"an estimated|a)\s+)?"
# One unit word after the figure ("users", "ms", "hours"), never a linking word that starts the next phrase, then an
# optional rate ("a day", "per sprint").
_LINKING = (r"(?:across|for|in|on|at|to|from|with|after|before|by|of|and|or|the|than|while|so|which|that|as|into|"
            r"per|a|an|each|every|last|this|next|during|over|within|since|until)")
_UNIT = (r"(?:\s+(?!" + _LINKING + r"\b)[a-zA-Z][\w-]*)?"
         r"(?:\s+(?:a|an|per|each|every)\s+(?:day|week|month|year|hour|minute|second|quarter|sprint|release))?")
_FIGURE_PHRASE = (
    r"(?:\s*,?\s*(?:saving|cutting|reducing|adding|generating|reaching|growing|by|of|to|from|for|across|"
    r"with|at|over|within|in)\s+" + _QUALIFIER + "<FIG>" + _UNIT + r")"
    r"|(?:\s*\([^)]*<FIG>[^)]*\))"
    r"|(?:<FIG>\s+(?=(?:faster|slower|more|less|fewer|higher|lower|better|cheaper|bigger|smaller)\b))"
)


def strip_invented_figures(text: str, corpus: str) -> tuple[str, int]:
    """`text` without the figures `corpus` never gives, and how many went. Each goes with the words that carry it
    ("by 35%"); one that can't be lifted out cleanly takes its sentence with it when there are others, else just the
    number goes ("shipped 12 releases" -> "shipped releases")."""
    count = 0
    for fig in invented_figures(text, corpus):
        pattern = re.compile(_FIGURE_PHRASE.replace("<FIG>", re.escape(fig)), re.IGNORECASE)
        stripped, n = pattern.subn("", text, count=1)
        if not n:
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
            kept = [s for s in sentences if fig not in s]
            stripped = " ".join(kept) if kept and len(kept) < len(sentences) else \
                re.sub(r"(?<![\w.])" + re.escape(fig) + r"(?![\w])", "", text, count=1)
        text = re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"[ \t]{2,}", " ", stripped)).strip()
        count += 1
    return text, count


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


# ---- import: everything the model read must be in what it was given ------------------------------------------

def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def _url_key(url: str) -> str:
    return _squash(re.sub(r"^\s*(?:https?://)?(?:www\.)?", "", url.lower())).rstrip("/")


# The scale after a grade ("8.6 / 10", "3.7 out of 4"): implied by "CGPA" or "GPA", so the source needn't write it.
_GRADE_SCALE = re.compile(r"(?:/|\bout of)\s*(?:4|5|10|100)(?:\.0+)?(?!\d)", re.IGNORECASE)
_DECIMAL = re.compile(r"\d+(?:\.\d+)?")


def _grade_stated(grade: str, source: str) -> bool:
    """Whether the source gives this grade: its numbers ("8.6" of "8.6 / 10 CGPA"; "8.60" counts), or for one in
    words ("First Class"), the words."""
    numbers = _DECIMAL.findall(_GRADE_SCALE.sub("", grade))
    if not numbers:
        return _squash(grade) in _squash(source)
    stated = {f"{float(n):g}" for n in _DECIMAL.findall(source)}
    return all(f"{float(n):g}" in stated for n in numbers)


def ground_import(data: ResumeData, source: str) -> tuple[ResumeData, list[str]]:
    """The imported resume with anything the source text doesn't back removed, and what was removed.

    The import prompt says "copy facts exactly", but a model sometimes adds a plausible skill, a placeholder-looking
    email, a profile link or a metric that the resume never had. Contact details and skills are what recruiters and
    ATS software read first, so each is checked against the source: an email, phone number or link it doesn't contain
    is blanked, a skill it never lists is dropped, and a figure it never states is taken out with its words. A CGPA
    or percentage the source never gives is blanked too: campus filters cut on it.
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
    grades = 0
    for ed in out.education:
        if ed.grade and not _grade_stated(ed.grade, source):
            ed.grade = ""
            grades += 1
    if grades:
        notes.append(f"{grades} grade(s) the source never gives")

    figures = 0

    def fix(text: str) -> str:
        nonlocal figures
        fixed, n = strip_invented_figures(text, source)
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
