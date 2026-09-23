"""Per-session in-memory retrieval over the documents the user selected (spec §23–§24).

At session start the selected documents' chunks (already embedded at upload time) are loaded once;
every question is then scored locally in well under the 200 ms retrieval budget without a DB
round-trip. pgvector remains the store and serves library-wide search.
"""

from dataclasses import dataclass

from orbit_api.live.events import QuestionType
from orbit_api.retrieval.embeddings import cosine, get_embedder

# category boosts per question type
_BOOSTS: dict[QuestionType, dict[str, float]] = {
    QuestionType.behavioral: {"experience": 0.12, "project": 0.1, "achievement": 0.12},
    QuestionType.resume: {"experience": 0.15, "summary": 0.15, "project": 0.08, "education": 0.05},
    QuestionType.leadership: {"experience": 0.12, "achievement": 0.1},
    QuestionType.technical: {"skill": 0.06, "project": 0.06, "excerpt": 0.04},
    QuestionType.coding: {"skill": 0.04, "excerpt": 0.05},
    QuestionType.system_design: {"project": 0.08, "experience": 0.05, "excerpt": 0.05},
    QuestionType.culture: {"requirement": 0.12, "company": 0.15, "summary": 0.06},
    QuestionType.salary: {"requirement": 0.05},
    QuestionType.follow_up: {"experience": 0.06, "project": 0.06},
}


@dataclass(frozen=True)
class IndexedChunk:
    id: str
    doc_kind: str  # resume | job_description | notes | other
    category: str
    label: str
    text: str
    verified: bool
    embedding: list[float]


@dataclass(frozen=True)
class Hit:
    chunk: IndexedChunk
    score: float


class SessionIndex:
    def __init__(self, chunks: list[IndexedChunk]) -> None:
        self._chunks = chunks

    def __len__(self) -> int:
        return len(self._chunks)

    def search(
        self, query: str, qtype: QuestionType, *, k: int = 6, min_score: float = 0.12, doc_kind: str | None = None
    ) -> list[Hit]:
        if not self._chunks:
            return []
        q = get_embedder().embed(query)
        boosts = _BOOSTS.get(qtype, {})
        hits: list[Hit] = []
        for c in self._chunks:
            if doc_kind and c.doc_kind != doc_kind:
                continue
            sim = cosine(q, c.embedding)
            if sim <= 0.02:
                continue
            score = sim + boosts.get(c.category, 0.0) + (0.04 if c.verified else 0.0)
            if score >= min_score:
                hits.append(Hit(c, score))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:k]

    def by_category(self, doc_kind: str, categories: tuple[str, ...], limit: int) -> list[IndexedChunk]:
        return [c for c in self._chunks if c.doc_kind == doc_kind and c.category in categories][:limit]
