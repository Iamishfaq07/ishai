# Business AI knowledge workflows: research and decisions

Primary GitHub repository overviews and selected retrieval/answer implementation files were read on
28 October 2026. This extends [the earlier Business workflow research](BUSINESS_RESEARCH_2026_10.md).
The previous hiring-request update was merged to main at `65998706` before this work began.

## Sources reviewed

| Primary source | Capability observed | Decision in this release |
| --- | --- | --- |
| [Onyx overview](https://github.com/onyx-dot-app/onyx/blob/main/README.md) | Enterprise knowledge with source metadata, permissions, connectors and scoped agents | Apply tenant/audience checks before retrieval and again after generation. Connector sync is future work; the shipped library is manually authored Business text. |
| [Haystack overview](https://github.com/deepset-ai/haystack/blob/main/README.md), [BM25 retriever](https://github.com/deepset-ai/haystack/blob/main/haystack/components/retrievers/in_memory/bm25_retriever.py), [answer builder](https://github.com/deepset-ai/haystack/blob/main/haystack/components/builders/answer_builder.py) | Explicit retrieval filters, ranked document context and generated-answer source references | Keep retrieval and citation validation separate. Orbit uses a small bounded lexical ranker and verifies exact quotes; Haystack is not embedded or copied. |
| [LlamaIndex](https://github.com/run-llama/llama_index/blob/main/README.md) | Data connectors, indexing and configurable retrieval/query interfaces | Separate private authoring, published reference snapshots and answer generation so future retrieval can change without changing publication authority. |
| [RAGFlow](https://github.com/infiniflow/ragflow/blob/main/README.md) | Document understanding, knowledge compilation and retrieved-source workflows | Add a useful compilation step now: cited checklist → private draft playbook → explicit publication. This does not implement RAGFlow's document parsing, knowledge graphs or general agent runtime. |
| [Dify](https://github.com/langgenius/dify/blob/main/README.md) | AI workflows, RAG, provider/model management and observability | Reuse Orbit's configured provider and durable metering; show mock/live provenance and enforce company quotas. Dify is not installed; its additional license conditions matter if adopted later. |
| [Ragas](https://github.com/vibrantlabsai/ragas/blob/main/README.md) | Retrieval/answer/workflow evaluation tools | Add deterministic retrieval and citation-abstention cases now. A representative employer dataset and live-model evaluation are needed before claiming broad answer-quality performance. |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix/blob/main/README.md) | Tracing, versioned evaluation datasets and prompt/model experiments | Keep provider usage/cost records and explicit source snapshots. Distributed traces, employer review datasets and live-model experiments remain follow-up work. Phoenix is not deployed. |
| [Open WebUI](https://github.com/open-webui/open-webui/blob/main/README.md) | Role/group controls, document knowledge, hybrid retrieval, content extraction and connector tooling | Make audiences and published-versus-draft boundaries visible in the UI. Future imports need permission reconciliation/deletion propagation; no drive/wiki connector is claimed here. Its current licensing/branding conditions require review before reuse. |

These are project descriptions and inspected implementation patterns, not independent performance or reliability
certifications. No third-party implementation or model weights were copied. No new runtime package was installed.
Exact dependency/license review remains necessary if any framework is adopted at a selected version.

## Product direction implemented

The missing workflow was helping a hiring team consult **its own approved process**, while preserving who can
read it and which published version supported the answer. The release adds:

1. A Business policy/playbook library with private drafts, published snapshots, review dates and version downloads.
2. Two AI tools: source-cited question answering and a practical checklist builder.
3. An explicit learning loop: inspect citations → download working notes → create a private playbook draft → review
   and publish. A model-generated checklist does not silently become official guidance.
4. Freshness and withdrawal controls: overdue-source notices, archive/delete, audience changes and stale-generation
   rejection. The company can remove future access without pretending already-read copies can be recalled.
5. Retrieval/citation evaluations over a small fictional corpus, including unsupported questions and invalid quotes.

The implementation is documented in [Business knowledge studio](BUSINESS_KNOWLEDGE.md). It is intentionally a
bounded text corpus with lexical matching. It does not claim semantic retrieval, file conversion, live web
research, legal interpretation, automated employment decisions or an enterprise search benchmark.

## Next research-backed integrations

| Priority | Next step | What must be resolved before shipping |
| --- | --- | --- |
| 1 | Approved document import from Drive, SharePoint or a company wiki | Source ACL mapping, explicit connection scope, incremental sync, revocation/deletion propagation and recovery after missed webhooks. |
| 2 | Hybrid retrieval and reranking | Evaluate embeddings/rerankers on consented company documents, multilingual queries, cost/latency, access filtering and abstention. Upgrade only with measured improvement over lexical retrieval. |
| 3 | Policy-review inbox and document ownership | Named owners, review schedules, opt-in reminders, escalation/delegation and acknowledgement history without duplicate reminders after publication. |
| 4 | Hiring-request policy references | Link a submitted requisition to specific published policy versions, surface source changes during approval, and define whether policy changes invalidate pending approvals. |
| 5 | Evaluation/observability workspace | Employer-approved datasets, human usefulness/faithfulness ratings, source-version-aware evaluations and content redaction for telemetry. |
| 6 | Team learning bundles | Reviewed onboarding or interviewer-prep packs assembled from approved source versions, with accessible exports and an explicit publication lifecycle. |

These rows are proposals. The shipped features and unavailable validation are stated separately in the workflow
guide. Orbit Personal behavior is unchanged; shared changes register Business models, routes, types and mock cases.

## Retrieval record

SHA-256 prefixes of the primary material read in this workspace (not Git commit IDs):

| Material | SHA-256 prefix |
| --- | --- |
| onyx | `3a49fe9680a156fc` |
| haystack | `e016e944fa840265` |
| haystack-bm25 | `79c830b6405863e8` |
| haystack-answers | `0b68cf0de48ae07c` |
| llamaindex | `625c49e7dedf8482` |
| ragflow | `665333bd40c1f7e3` |
| dify | `3c7fe487f1e89e6f` |
| ragas | `af20b2258507b12b` |
| phoenix | `3141ebe833b7b3a4` |
| open-webui | `8fd5f1fb10d0252c` |
