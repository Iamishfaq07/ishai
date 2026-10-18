"""Per-session hybrid retrieval over the documents the user selected (spec §23–§24; launch brief §17).

At session start the selected documents' chunks are loaded once; every question is then ranked locally, with no
DB round-trip, by reciprocal-rank fusion of:
- **dense similarity** (the configured embedder: hashing, or the local bge-small ONNX model);
- **BM25** over the same texts (exact terms: "Kafka", "PCI-DSS", "IIT Madras").

Both run on the *bullet itself*, not its shared "Role — Company (years):" heading (which made every bullet of a job
look alike), and the query is widened with interview-theme cues (`themes.py`). Chosen on the retrieval benchmark
(tests/retrieval_eval.py): the old category boosts hurt on both the dev and the held-out set, so verified facts
only break ties now. A chunk must match lexically or clear the embedder's relevance floor to be returned.
"""

from dataclasses import dataclass

from orbit_api.live.events import QuestionType
from orbit_api.retrieval.embeddings import Embedder, cosine, get_embedder
from orbit_api.retrieval.lexical import BM25
from orbit_api.retrieval.themes import expand

RRF_K = 60
_TIE_BREAK = 1e-4  # a verified fact wins a tie, nothing more


def chunk_body(category: str, text: str) -> str:
    """What gets embedded/indexed: an experience/project bullet without its "Role — Company (years): " heading."""
    if category in ("experience", "project") and ": " in text:
        return text.split(": ", 1)[1]
    return text


@dataclass(frozen=True)
class IndexedChunk:
    id: str
    doc_kind: str  # resume | job_description | notes | other
    category: str
    label: str
    text: str
    verified: bool
    embedding: list[float]  # [] when it isn't in the current embedder's space (then ranked lexically only)
    doc_title: str = ""


@dataclass(frozen=True)
class Hit:
    chunk: IndexedChunk
    score: float


class SessionIndex:
    def __init__(self, chunks: list[IndexedChunk], embedder: Embedder | None = None) -> None:
        self._chunks = chunks
        self._embedder = embedder
        self._bm25 = BM25([chunk_body(c.category, c.text) for c in chunks])
        # The last query's scores over every chunk: retrieval searches the same question up to four times (all
        # chunks, then the stories, the job post, the answer bank), each a subset of the first.
        self._memo: tuple[str, Embedder, bool, dict[int, float] | None, list[float]] | None = None

    def __len__(self) -> int:
        return len(self._chunks)

    @property
    def chunks(self) -> list[IndexedChunk]:
        return list(self._chunks)

    def search(self, query: str, qtype: QuestionType, *, k: int = 6, doc_kind: str | None = None,
               min_score: float | None = None) -> list[Hit]:
        """Top-k chunks for `query`. `qtype` is accepted for callers/telemetry; ranking no longer boosts by it.
        `min_score` is kept for backwards compatibility and ignored."""
        if not self._chunks:
            return []
        expanded = expand(query)
        embedder = self._embedder or get_embedder()
        n = len(self._chunks)
        allowed = [i for i in range(n) if not doc_kind or self._chunks[i].doc_kind == doc_kind]
        score = dict.fromkeys(allowed, 0.0)
        matched: set[int] = set()

        every_sim, lex = self._query_scores(expanded, embedder)
        dense_ok = every_sim is not None and any(self._chunks[i].embedding for i in allowed)
        if every_sim is not None and dense_ok:
            sims = {i: every_sim[i] for i in allowed if self._chunks[i].embedding}
            for rank, i in enumerate(sorted(sims, key=lambda i: sims[i], reverse=True)):
                score[i] += 1 / (RRF_K + rank + 1)
                if sims[i] >= embedder.relevance_floor:
                    matched.add(i)
        lexical = sorted((i for i in allowed if lex[i] > 0), key=lambda i: lex[i], reverse=True)
        for rank, i in enumerate(lexical):
            score[i] += 1 / (RRF_K + rank + 1)
            matched.add(i)
        for i in allowed:
            if self._chunks[i].verified:
                score[i] += _TIE_BREAK
        ranked = sorted(matched, key=lambda i: score[i], reverse=True)
        return [Hit(self._chunks[i], score[i]) for i in ranked[:k]]

    def _query_scores(self, expanded: str, embedder: Embedder) -> tuple[dict[int, float] | None, list[float]]:
        """(dense similarity of every chunk that has a vector, or None when there's no dense ranking; BM25 of every
        chunk) for this query, from the memo when it's the last one asked."""
        memo = self._memo
        if memo is not None and memo[0] == expanded and memo[1] is embedder and memo[2] == embedder.ready:
            return memo[3], memo[4]
        sims: dict[int, float] | None = None
        if embedder.ready and any(c.embedding for c in self._chunks):
            qv = embedder.embed_query(expanded)
            sims = {i: cosine(qv, c.embedding) for i, c in enumerate(self._chunks) if c.embedding}
        lex = self._bm25.scores(expanded)
        self._memo = (expanded, embedder, embedder.ready, sims, lex)
        return sims, lex

    def by_category(self, doc_kind: str, categories: tuple[str, ...], limit: int) -> list[IndexedChunk]:
        return [c for c in self._chunks if c.doc_kind == doc_kind and c.category in categories][:limit]
