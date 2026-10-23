# Career quality checks

Run `uv run python -m evals.career_quality --output /tmp/career-quality.json` from `apps/api`.
The runner fails on a wrong event or a quote absent from its source. Reports contain case IDs,
aggregate counts and the dataset SHA-256; they do not log message text. The checked-in dataset
is synthetic and contains no customer data. It is a regression set, **not** a held-out accuracy
benchmark. Hindi/Hinglish cases currently require abstention by the English rules engine.

Use this contract for future model comparisons: freeze a separately labelled holdout before
prompt changes, record model/prompt/version and latency/cost, and have humans adjudicate
ambiguous classifications. Block release on unsupported offer/rejection changes, fabricated
source quotes or incorrect application identity. The current suite does not evaluate mailbox
matching, calendar reconciliation, speech, resume parsing or provider responses.

Semantic ordering remains a bounded comparison using the existing configured BGE embedder.
The ordinary feed retains its eligibility filters. Before promoting it to default, collect
consented relevance judgements across roles and countries, compare Recall@k/NDCG against the
ordinary feed, and measure filter violations, latency and cost. No new model-quality claim
is made by mocked ordering tests or this message suite.
