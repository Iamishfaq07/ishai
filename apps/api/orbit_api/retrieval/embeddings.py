"""Embedders: the dense half of hybrid retrieval (the lexical half is BM25, `lexical.py`).

- `hash`: a local feature-hashing embedder (unigrams + bigrams + char trigrams of long tokens). Needs no
  dependencies or memory, at <1 ms per text. It's the default.
- `bge-small`: BAAI/bge-small-en-v1.5 via fastembed (ONNX, CPU, 384 dims, about +200 MB RAM). It's clearly
  better on the retrieval benchmark, including the held-out set (tests/retrieval_eval.py). Enable it with
  ORBIT_EMBEDDER=bge-small. It loads in the background at boot; until it's ready, retrieval ranks with BM25 alone
  rather than mixing embedding spaces.

Each stored chunk records its `embedding_model`; chunks embedded by another model are re-embedded when a session
loads them, so switching models needs no migration script. All embedders produce EMBEDDING_DIM (384) vectors, the
pgvector column size.
"""

import hashlib
import itertools
import logging
import math
import re
import threading
from typing import Any, Protocol

from orbit_api.config import get_settings
from orbit_api.db import EMBEDDING_DIM

log = logging.getLogger(__name__)

_TOKEN = re.compile(r"[a-z0-9+#]+")
_STOP = frozenset(
    "a an the and or of to in on for with at by from is are was were be been i you we they he she it my your "
    "our me us do did does can could would should will what how why when where which who this that these "
    "those tell about as so if then than into over under up down out".split()
)


class Embedder(Protocol):
    dim: int
    model_id: str  # stored per chunk; a mismatch means "re-embed"
    relevance_floor: float  # dense cosine below this doesn't count as a match on its own

    @property
    def ready(self) -> bool: ...

    def embed(self, text: str) -> list[float]: ...  # documents

    def embed_query(self, text: str) -> list[float]: ...


class HashingEmbedder:
    dim = EMBEDDING_DIM
    model_id = "hash-v2"  # v2: chunks are embedded without their shared "Role — Company:" heading
    relevance_floor = 0.12
    ready = True

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

    def embed_query(self, text: str) -> list[float]:
        return self.embed(text)


class FastEmbedEmbedder:
    """A local ONNX sentence embedder (no network at query time; the model downloads once to the cache dir)."""

    dim = EMBEDDING_DIM
    relevance_floor = 0.40
    _QUERY_PREFIX = "Represent this sentence for searching relevant passages: "  # bge's retrieval instruction

    def __init__(self, model: str, cache_dir: str | None) -> None:
        self.model_name = model
        self.model_id = model
        self._cache_dir = cache_dir
        self._model: Any = None
        self._lock = threading.Lock()
        self.load_error: str | None = None

    @property
    def ready(self) -> bool:
        return self._model is not None

    def warm(self) -> bool:
        """Load the model (blocking; run in a thread). Safe to call repeatedly."""
        with self._lock:
            if self._model is None and self.load_error is None:
                try:
                    from fastembed import TextEmbedding

                    self._model = TextEmbedding(self.model_name, cache_dir=self._cache_dir, threads=1)
                    log.info("embedder %s loaded", self.model_name)
                except Exception as e:  # missing package, download failure, bad model name
                    self.load_error = f"{type(e).__name__}: {e}"
                    log.error("embedder %s failed to load; retrieval uses BM25 + hashing: %s",
                              self.model_name, self.load_error)
        return self._model is not None

    def _one(self, text: str) -> list[float]:
        if not self.warm():
            raise RuntimeError(f"embedder {self.model_name} unavailable: {self.load_error}")
        return [float(x) for x in next(iter(self._model.embed([text])))]

    def embed(self, text: str) -> list[float]:
        return self._one(text)

    def embed_query(self, text: str) -> list[float]:
        return self._one(self._QUERY_PREFIX + text)


def cosine(a: list[float], b: list[float]) -> float:
    """Dot product of two unit vectors. math.sumprod runs in C: the generator it replaced was 86% of the time a
    question spent between firing and its LLM request (~8 ms with a few hundred chunks, on the event loop)."""
    if len(a) != len(b):  # a vector from another embedder: compare what overlaps, as zip() did
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
    return math.sumprod(a, b)


_hash = HashingEmbedder()
_neural: FastEmbedEmbedder | None = None


def get_embedder() -> Embedder:
    """The configured embedder. A neural one that failed to load degrades to hashing (logged at error level)."""
    global _neural
    s = get_settings()
    if s.embedder == "hash":
        return _hash
    if _neural is None:
        _neural = FastEmbedEmbedder("BAAI/bge-small-en-v1.5", s.embedding_cache_dir)
    return _hash if _neural.load_error else _neural
