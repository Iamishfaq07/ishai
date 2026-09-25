# Retrieval

How Orbit finds the resume, job-description and notes facts behind an answer.

## Pipeline
1. **Upload.** Documents are chunked into facts (`documents/parsing.py`): one resume bullet, JD requirement or
   notes excerpt each. Each chunk is embedded **without** its shared "Role — Company (years):" heading, so the
   bullets of one job don't all look alike, and the embedder's id is stored with it (`embedding_model`).
2. **Session start.** The selected documents' chunks are loaded into an in-memory `SessionIndex`. Chunks embedded
   by a different model are re-embedded once and saved back, so switching embedders needs no migration script.
3. **Each question** (`retrieval/index.py`):
   - The query is widened with interview-theme cues (`themes.py`). For example, a question about "stakeholder
     conflict" also looks for "disagreement", "resolved" and "negotiated", because resumes describe events while
     interviewers name themes.
   - The query is then ranked by **reciprocal-rank fusion** of dense similarity (the embedder) and **BM25**
     (`lexical.py`, with light stemming).
   - A chunk is returned only if it matches lexically or clears the embedder's relevance floor.
   - Verified facts break ties. There are no per-question-type category boosts: they hurt on the benchmark.
4. **The prompt** gets the top 6, plus the JD anchor facts for question types that need them
   (`context_builder.py`).

## Embedders (`ORBIT_EMBEDDER`)
| | `hash` (default) | `bge-small` |
|---|---|---|
| Model | local feature hashing | BAAI/bge-small-en-v1.5, quantized ONNX via fastembed |
| Extra RAM | none | measured: API 107 MB → 274 MB resident with the model warm |
| Query cost | 0.5 ms | ~10 ms here; slower on a 0.1-CPU host |
| Network | none | downloads the model once (67 MB) to `ORBIT_EMBEDDING_CACHE_DIR` or the temp dir |

- **Loading:** bge-small loads in the background at boot. Until it's ready, retrieval uses BM25 alone rather than
  mixing embedding spaces.
- **Failure:** if it can't load (a download failure, for example), Orbit logs an error and falls back to hashing.
- **Privacy:** both run on the server. No document text leaves it for embedding, and there's no embedding bill.

## Benchmark (`tests/retrieval_eval.py`)
The benchmark maps paraphrased interview questions to the fact that should come back, and scores Recall@1,
Recall@3 and MRR. The documents go through the real chunker.
- **dev:** 22 questions on a backend-engineer resume and JD.
- **holdout:** 16 questions on an ML-engineer resume. They were written *without* looking at the theme cues, and
  the set is never tuned against.

`uv run python -m tests.retrieval_eval [--neural]` (from `apps/api`) prints:

| Retriever | dev R@1 / R@3 / MRR | **holdout** R@1 / R@3 / MRR |
|---|---|---|
| legacy (hash, full text, category boosts) | 0.23 / 0.50 / 0.38 | 0.25 / 0.38 / 0.36 |
| hybrid + hash | 0.77 / 0.95 / 0.86 | 0.38 / 0.50 / 0.49 |
| hybrid + bge-small | 0.82 / 0.91 / 0.88 | **0.56 / 0.81 / 0.71** |

The dev gains from theme expansion are partly overfitting: the cues were written after looking at dev failures.
The holdout numbers are the honest ones, which is why bge-small is recommended where memory allows.
`tests/test_retrieval.py` keeps floors just below these numbers. The neural floor runs with `ORBIT_TEST_NEURAL=1`.

Bugs found along the way:
- The chunker dropped 1–2 character skills (Go, R, C#).
- The category boosts pushed 12 experience chunks above the education line, so "Where did you study?" never found
  it.
