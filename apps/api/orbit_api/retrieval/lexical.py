"""BM25 over a session's chunks (the lexical half of hybrid retrieval).

Exact terms matter in interviews: product names, "Kafka", "PCI-DSS", "IIT Madras". Dense vectors blur them;
BM25 keeps them sharp. The tokenizer lowercases, drops stopwords and applies a light stemmer so "migrating" /
"migration" / "migrated" meet, without pulling in NLTK.
"""

import math
import re
from collections import Counter

_TOKEN = re.compile(r"[a-z0-9+#]+(?:-[a-z0-9]+)*")
_STOP = frozenset(
    "a an the and or of to in on for with at by from is are was were be been i you we they he she it my your "
    "our me us do did does can could would should will what how why when where which who this that these "
    "those tell about as so if then than into over under up down out time any have has had".split()
)
_SUFFIXES = ("ations", "ation", "ments", "ment", "ings", "ing", "ies", "ied", "ers", "er", "ed", "es", "ly", "s")


def stem(tok: str) -> str:
    if len(tok) <= 4 or not tok.isalpha():
        return tok
    for suf in _SUFFIXES:
        if tok.endswith(suf) and len(tok) - len(suf) >= 3:
            base = tok[: -len(suf)]
            return base + "y" if suf in ("ies", "ied") else base
    return tok


def tokenize(text: str) -> list[str]:
    return [stem(t) for t in _TOKEN.findall(text.lower()) if t not in _STOP]


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

    def scores(self, query: str) -> list[float]:
        terms = set(tokenize(query))
        out = []
        for tf, length in zip(self._tf, self._len, strict=True):
            s = 0.0
            for t in terms:
                f = tf.get(t)
                if f:
                    norm = 1 - self.b + self.b * (length / self._avg if self._avg else 1)
                    s += self._idf[t] * f * (self.k1 + 1) / (f + self.k1 * norm)
            out.append(s)
        return out
