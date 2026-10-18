"""Text helpers shared by the Business AI: normalising, word counts, and checking that a quoted line really is in the
source (the evidence check).

Evidence is accepted when it is in the source verbatim (after case, spacing and punctuation are normalised) or near
verbatim: at least `NEAR_VERBATIM` of the quote's words appear, in order, inside one source line (or two adjacent
lines). Quotes of four words or fewer must match exactly. What's returned is the source's own line, so stored
evidence is always the resume's (or the answer's) words, never the model's paraphrase.
"""

import re
from difflib import SequenceMatcher

from orbit_api.documents.uploads import sanitize_text

NEAR_VERBATIM = 0.85
SHORT_QUOTE_WORDS = 4
MAX_EVIDENCE_CHARS = 400

_TOKEN = re.compile(r"[\w+#]+(?:[.'][\w+#]+)*", re.UNICODE)
_DOTTED = re.compile(r"\b([a-z])\.(?=[a-z])")
_DEGREE_SPACE = re.compile(r"\b([bm])\.\s+(?=(?:tech|sc|com|e|a|s|arch|ed|pharm|des)\b)")


def clean(text: str) -> str:
    """Plain text with invisible characters gone, curly quotes straightened and runs of spaces collapsed (lines are
    kept: resumes are read line by line)."""
    t = sanitize_text(text or "").replace("’", "'").replace("‘", "'").replace("“", '"')
    t = t.replace("”", '"').replace(" ", " ")
    # A tab is a table cell boundary (DOCX tables, PDF columns): keep it as a separator.
    return "\n".join(re.sub(r" {2,}", " ", re.sub(r"\s*\t+\s*", " | ", line)).strip(" |") for line in t.split("\n"))


def fold(text: str) -> str:
    """Lower-cased, with dotted abbreviations joined ("B. Tech" -> "btech", "B.E." -> "be."), for matching."""
    t = text.lower().replace("node.js", "nodejs").replace("next.js", "nextjs").replace("react.js", "reactjs")
    t = _DEGREE_SPACE.sub(r"\1", t)
    for _ in range(3):
        t = _DOTTED.sub(r"\1", t)
    return t


def tokens(text: str) -> list[str]:
    return [t.strip(".'") for t in _TOKEN.findall(fold(text)) if t.strip(".'")]


def word_count(text: str) -> int:
    """Words as a reader counts them, in any script (Hindi included): markdown symbols aren't words."""
    return len([w for w in re.split(r"\s+", re.sub(r"[#*_>`|-]+", " ", text)) if any(ch.isalnum() for ch in w)])


def _in_order(quote: list[str], line: list[str]) -> int:
    """How many of the quote's words appear in `line`, in the quote's order."""
    return sum(b.size for b in SequenceMatcher(None, quote, line, autojunk=False).get_matching_blocks())


def find_quote(quote: str, lines: list[str]) -> str | None:
    """The source line `quote` comes from (as the source has it), or None when the source doesn't say it."""
    q = tokens(quote)
    if not q:
        return None
    qset = set(q)
    toks = [tokens(line) for line in lines]
    need = len(q) if len(q) <= SHORT_QUOTE_WORDS else max(SHORT_QUOTE_WORDS + 1, int(NEAR_VERBATIM * len(q) + 0.999))
    singles = [(t, lines[i]) for i, t in enumerate(toks)]
    pairs = [(toks[i] + toks[i + 1], f"{lines[i]} {lines[i + 1]}") for i in range(len(lines) - 1)]
    # One line first; two adjacent lines only for a quote that runs across a line break.
    for candidates in (singles, pairs):
        best: tuple[int, str] | None = None
        for span, text in candidates:
            if not span or len(qset & set(span)) < min(need, len(qset)) * 0.8:
                continue
            if len(q) <= SHORT_QUOTE_WORDS:
                hit = any(span[j:j + len(q)] == q for j in range(len(span) - len(q) + 1))
                score = len(q) if hit else 0
            else:
                score = _in_order(q, span)
            if score >= need and (best is None or score > best[0]):
                best = (score, text)
                if score == len(q):
                    break
        if best is not None:
            return best[1].strip()[:MAX_EVIDENCE_CHARS]
    return None
