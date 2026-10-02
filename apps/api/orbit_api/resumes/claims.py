"""Keep an AI rewrite honest: it may reword the candidate's text, never add facts.

The suggestion prompt forbids invented numbers and tools, but a model sometimes adds "by 40%" or "using Kubernetes"
anyway, and a candidate who pastes that in is then asked about it in an interview. These checks run on every rewrite,
against the whole resume (not just the field being rewritten, since a bullet may reuse a fact from elsewhere in it):

- a figure that appears nowhere in the resume becomes a bracketed placeholder the candidate must fill in;
- a tool or technology that appears nowhere in the resume drops the suggestion.
"""

import re

from orbit_api.live.keyterms import tech_terms

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
