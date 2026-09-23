"""Embedding abstraction.

DeepSeek has no embeddings endpoint, so the default is a local feature-hashing embedder (unigrams +
bigrams + char trigrams of long tokens). It is fast (<1 ms per chunk), needs no network and no key,
and is good enough for lexical-semantic matching of resume facts to questions. A neural embedder
can be swapped in behind `Embedder` without touching callers; dimensions must match EMBEDDING_DIM.
"""

import hashlib
import itertools
import math
import re
from typing import Protocol

from orbit_api.db import EMBEDDING_DIM

_TOKEN = re.compile(r"[a-z0-9+#]+")
_STOP = frozenset(
    "a an the and or of to in on for with at by from is are was were be been i you we they he she it my your "
    "our me us do did does can could would should will what how why when where which who this that these "
    "those tell about as so if then than into over under up down out".split()
)


class Embedder(Protocol):
    dim: int

    def embed(self, text: str) -> list[float]: ...


class HashingEmbedder:
    dim = EMBEDDING_DIM

    def _features(self, text: str) -> list[tuple[str, float]]:
        toks = [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]
        feats: list[tuple[str, float]] = [(f"u:{t}", 1.0) for t in toks]
        feats += [(f"b:{a}_{b}", 0.7) for a, b in itertools.pairwise(toks)]
        for t in toks:
            if len(t) >= 6:  # tolerate inflections: "optimizing" ~ "optimization"
                feats += [(f"c:{t[i : i + 4]}", 0.25) for i in range(len(t) - 3)]
        return feats

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for feat, weight in self._features(text):
            h = int.from_bytes(hashlib.blake2b(feat.encode(), digest_size=8).digest(), "little")
            vec[h % self.dim] += weight if (h >> 32) & 1 else -weight
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=False))


_default = HashingEmbedder()


def get_embedder() -> Embedder:
    return _default
