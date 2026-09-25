"""Retrieval benchmark (launch brief §18): paraphrased interview questions → the resume/JD fact that should come
back. Documents go through the real chunker; each retriever is scored on Recall@1, Recall@3 and MRR.

Run:  uv run python -m tests.retrieval_eval [--neural]   (from apps/api; --neural needs fastembed)
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from orbit_api.documents.parsing import chunk_document
from orbit_api.live.events import QuestionType
from orbit_api.retrieval.embeddings import Embedder, HashingEmbedder
from orbit_api.retrieval.index import IndexedChunk, SessionIndex

FIXTURES = Path(__file__).parent / "fixtures" / "retrieval"


@dataclass(frozen=True)
class Case:
    q: str
    qtype: QuestionType
    expect: str


def load_cases(name: str = "cases.json") -> list[Case]:
    raw = json.loads((FIXTURES / name).read_text(encoding="utf8"))
    return [Case(c["q"], QuestionType(c["type"]), c["expect"]) for c in raw]


DOCS = {"dev": (("resume.md", "resume"), ("jd.md", "job_description")),
        # Held out: written without looking at the retriever's theme cues; never tune against it.
        "holdout": (("holdout_resume.md", "resume"),)}


def build_chunks(embedder: Embedder, which: str = "dev") -> list[IndexedChunk]:
    out: list[IndexedChunk] = []
    for name, kind in DOCS[which]:
        text = (FIXTURES / name).read_text(encoding="utf8")
        for i, d in enumerate(chunk_document(text, kind, name)):
            out.append(IndexedChunk(f"{name}:{i}", kind, d.category, d.label, d.text, d.verified,
                                    embedder.embed(d.text)))
    return out


Retriever = Callable[[str, QuestionType], list[IndexedChunk]]


def _matches(expect: str, text: str) -> bool:
    # Very short expectations (a skill like "R" or "Go") must be the whole chunk, not a substring.
    return text.strip().lower() == expect.lower() if len(expect) <= 3 else expect.lower() in text.lower()


@dataclass
class Result:
    name: str
    recall_at_1: float
    recall_at_3: float
    mrr: float
    ms_per_query: float
    misses: list[str]


def evaluate(name: str, retrieve: Retriever, cases: list[Case] | None = None) -> Result:
    cases = cases if cases is not None else load_cases()
    r1 = r3 = 0
    rr = 0.0
    misses: list[str] = []
    started = time.perf_counter()
    for c in cases:
        ranked = retrieve(c.q, c.qtype)[:10]
        rank = next((i + 1 for i, ch in enumerate(ranked) if _matches(c.expect, ch.text)), None)
        if rank == 1:
            r1 += 1
        if rank is not None and rank <= 3:
            r3 += 1
        rr += 1 / rank if rank else 0.0
        if rank is None or rank > 3:
            misses.append(f"{c.q!r} (rank {rank})")
    n = len(cases)
    return Result(name, r1 / n, r3 / n, rr / n, (time.perf_counter() - started) * 1000 / n, misses)


def legacy_retriever(which: str) -> Retriever:
    """The pre-hybrid scorer (hash cosine over full text + category boosts), for comparison."""
    from orbit_api.retrieval.embeddings import cosine

    boosts_by_type = {
        QuestionType.behavioral: {"experience": 0.12, "project": 0.1, "achievement": 0.12},
        QuestionType.resume: {"experience": 0.15, "summary": 0.15, "project": 0.08, "education": 0.05},
        QuestionType.leadership: {"experience": 0.12, "achievement": 0.1},
        QuestionType.technical: {"skill": 0.06, "project": 0.06, "excerpt": 0.04},
        QuestionType.culture: {"requirement": 0.12, "company": 0.15, "summary": 0.06},
    }
    h = HashingEmbedder()
    chunks = build_chunks(h, which)

    def run(q: str, qtype: QuestionType) -> list[IndexedChunk]:
        qv, b = h.embed(q), boosts_by_type.get(qtype, {})
        scored = [(cosine(qv, c.embedding) + b.get(c.category, 0.0) + (0.04 if c.verified else 0.0), c)
                  for c in chunks]
        return [c for s, c in sorted(scored, key=lambda x: x[0], reverse=True) if s > 0.02]

    return run


def hybrid_retriever(embedder: Embedder, which: str) -> Retriever:
    """The production SessionIndex with the given embedder (chunks embedded the way uploads embed them)."""
    from orbit_api.retrieval.index import chunk_body

    base = build_chunks(HashingEmbedder(), which)
    chunks = [IndexedChunk(c.id, c.doc_kind, c.category, c.label, c.text, c.verified,
                           embedder.embed(chunk_body(c.category, c.text))) for c in base]
    index = SessionIndex(chunks, embedder)

    def run(q: str, qtype: QuestionType) -> list[IndexedChunk]:
        return [h.chunk for h in index.search(q, qtype, k=10)]

    return run


def report(results: list[Result]) -> str:
    lines = [f"{'retriever':<22} {'R@1':>6} {'R@3':>6} {'MRR':>6} {'ms/q':>7}"]
    for r in results:
        lines.append(f"{r.name:<22} {r.recall_at_1:>6.2f} {r.recall_at_3:>6.2f} {r.mrr:>6.2f} {r.ms_per_query:>7.2f}")
    for r in results:
        if r.misses:
            lines.append(f"\n{r.name} misses (not in top 3):")
            lines += [f"  - {m}" for m in r.misses]
    return "\n".join(lines)


def run_all(neural: bool) -> str:
    embedders: list[tuple[str, Embedder]] = [("hash", HashingEmbedder())]
    if neural:
        from orbit_api.retrieval.embeddings import FastEmbedEmbedder

        bge = FastEmbedEmbedder("BAAI/bge-small-en-v1.5", None)
        bge.warm()
        embedders.append(("bge-small", bge))
    out = []
    for which, cases_file in (("dev", "cases.json"), ("holdout", "holdout_cases.json")):
        cases = load_cases(cases_file)
        results = [evaluate(f"legacy ({which})", legacy_retriever(which), cases)]
        results += [evaluate(f"hybrid {n} ({which})", hybrid_retriever(e, which), cases) for n, e in embedders]
        out.append(report(results))
    return "\n\n".join(out)


if __name__ == "__main__":
    import sys

    print(run_all(neural="--neural" in sys.argv))
