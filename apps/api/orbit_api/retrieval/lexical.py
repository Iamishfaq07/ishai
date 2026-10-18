"""BM25 over a session's chunks (the lexical half of hybrid retrieval).

Exact terms matter in interviews: product names, "Kafka", "PCI-DSS", "IIT Madras". Dense vectors blur them;
BM25 keeps them sharp. The tokenizer lowercases, drops stopwords and applies a light stemmer so "migrating" /
"migration" / "migrated" meet, without pulling in NLTK.
"""

import functools
import math
import re
from collections import Counter

_TOKEN = re.compile(r"[a-z0-9+#]+(?:-[a-z0-9]+)*")
_STOP = frozenset(
    "a an the and or of to in on for with at by from is are was were be been i you we they he she it my your "
    "our me us do did does can could would should will what how why when where which who this that these "
    "those tell about as so if then than into over under up down out time any have has had".split()
)
_SUFFIXES = ("ations", "ation", "ating", "ated", "ments", "ment", "ings", "ing", "ies", "ied", "ers", "er", "ed", "es",
             "ly", "s")


@functools.lru_cache(maxsize=65_536)
def stem(tok: str) -> str:
    # Cached: building a session's index stems every word of every chunk (~30k calls for a big session, most of
    # its ~100 ms connect cost), from a vocabulary of a few thousand words.
    if len(tok) <= 4 or not tok.isalpha():
        return tok
    base = tok
    for suf in _SUFFIXES:
        if not tok.endswith(suf) or len(tok) - len(suf) < 3:
            continue
        if suf == "es" and not tok[:-2].endswith(("s", "x", "z", "ch", "sh")):
            continue  # "services" is service+s (→ the "s" rule), "processes" is process+es
        if suf == "s" and tok.endswith(("ss", "us", "is")):
            break  # "success", "status", "analysis": not plurals
        base = tok[: -len(suf)]
        base = base + "y" if suf in ("ies", "ied") else base
        break
    # A final silent "e" goes too, so "scale" / "scaled" / "scaling" and "service" / "services" meet.
    return base[:-1] if base.endswith("e") and len(base) > 4 else base


def tokenize(text: str) -> list[str]:
    out: list[str] = []
    for t in _TOKEN.findall(text.lower()):
        if t in _STOP:
            continue
        out.append(stem(t))
        if "-" in t:  # "fraud-detection" also matches "fraud" and "detection"; the compound keeps its exact match
            out += [stem(part) for part in t.split("-") if part and part not in _STOP]
    return out


class BM25:
    def __init__(self, docs: list[str], *, k1: float = 1.4, b: float = 0.6) -> None:
        self.k1, self.b = k1, b
        self._tf = [Counter(tokenize(d)) for d in docs]
        self._len = [sum(tf.values()) for tf in self._tf]
        self._avg = (sum(self._len) / len(self._len)) if self._len else 0.0
        df: Counter[str] = Counter()
        for tf in self._tf:
            df.update(tf.keys())
        n = len(docs)
        self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        # Term → the documents that have it (with its count there): a query visits only those, not every document
        # for every term (the same sums, added in the same order).
        self._postings: dict[str, list[tuple[int, int]]] = {}
        for i, tf in enumerate(self._tf):
            for t, f in tf.items():
                self._postings.setdefault(t, []).append((i, f))

    def scores(self, query: str) -> list[float]:
        out = [0.0] * len(self._tf)
        for t in set(tokenize(query)):
            postings = self._postings.get(t)
            if not postings:
                continue
            idf = self._idf[t]
            for i, f in postings:
                norm = 1 - self.b + self.b * (self._len[i] / self._avg if self._avg else 1)
                out[i] += idf * f * (self.k1 + 1) / (f + self.k1 * norm)
        return out
