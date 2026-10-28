# Business workflow research: reading, ownership and the next gaps

Primary GitHub documentation and selected implementation/schema files retrieved on 28 October 2026.
This is a focused product comparison, not an exhaustive Internet survey or independent vendor evaluation.
No third-party code was copied, no dependency installed and no external provider connected.

## Why this batch

Orbit Business already offers structured hiring, requisition approval, interview coordination, operations
automations, published knowledge, cited answers and owner review reminders. The missing link in that knowledge
workflow was **the team reader**: finding changed guidance, recording an explicit personal acknowledgement and
showing current-member coverage. Another general chatbot would duplicate existing functionality.

The new [reading desk](BUSINESS_READING_DESK.md) closes that bounded gap with personal reading queues,
content-bound receipts, current-member reporting, downloadable artifacts and read-only AI reading guides.

## Sources inspected and resulting decisions

| Primary source | Observation | Decision for Orbit |
| --- | --- | --- |
| [Moodle completion implementation](https://github.com/moodle/moodle/blob/main/public/lib/completionlib.php) | Constants distinguish manual completion, automatic completion, incomplete, complete and graded pass/fail. `completion_can_view_data` separately checks self-access and reporting capabilities. | Keep reading acknowledgements explicit and separate from grading. Restrict individual team reporting to owners/admins. No automatic receipt from opening a page or generating a guide. GPL source was inspected as a design reference only. |
| [Frappe HRMS training-result schema](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/training_result/training_result.json), [employee results](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/training_result_employee/training_result_employee.json), [training events](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/training_event/training_event.json) | Training results link to an event and employee rows with hours, grade and comments; events have course, trainer, location and time fields. | A read receipt does not establish training attendance or competence. Do not introduce employee grading or attendance claims into the hiring-policy library. HRMS remains a reference, not a dependency. |
| [Docmost README](https://github.com/docmost/docmost/blob/main/README.md) | Collaborative documentation includes spaces, groups, permissions, comments, history, search and attachments. Core AGPL and enterprise paths have different licenses. | Keep published access distinct from private authorship. Group-scoped collections and controlled document import remain useful follow-ups; the current audience model is unchanged. |
| [Onyx README](https://github.com/onyx-dot-app/onyx/blob/main/README.md) | Hybrid retrieval, organization knowledge, agents, MCP actions, self-hosting and permission-aware context are documented. | Extend the existing tenant-scoped assistant. Do not add external agent actions just to explain policy. Continue checking permissions after network generation. No Onyx code or service adopted. |
| [Formbricks README](https://github.com/formbricks/formbricks/blob/main/README.md) | Link/in-app surveys, templates and targeted user groups. Core AGPL and enterprise features are separated. | Candidate experience feedback is still a meaningful missing Business workflow. It needs opt-in requests, response retention and useful aggregate reporting; it is not replaced by reader acknowledgements. |
| [Sentence Transformers README](https://github.com/huggingface/sentence-transformers/blob/main/README.md) | Dense embeddings, cross-encoder reranking, sparse and multi-vector retrieval, including examples for `all-MiniLM-L6-v2` and `ms-marco-MiniLM-L6-v2`. | Orbit's existing knowledge retrieval is lexical. Benchmark semantic retrieval on consented company policy questions before adding a model/index. A library example is not evidence that its model fits Orbit's languages, document lengths or deployment budget. No Hugging Face model downloaded or evaluated here. |
| [Docling README](https://github.com/docling-project/docling/blob/main/README.md) | PDF/layout/table parsing, DOCX and other formats, OCR and local execution; code and individual models have distinct license considerations. | Policy import is a practical next addition, with parser resource limits, preview, provenance and explicit publication. This batch remains a manual text library; it does not claim file ingestion. |
| [Promptfoo README](https://github.com/promptfoo/promptfoo/blob/main/README.md) | Prompt/model comparisons, automated evaluations, CI and adversarial testing. | Add adversarial contract tests now: bad quotes, stale content and revoked access. Live-model usefulness, omission, injection resistance and cost still require a separate approved dataset/provider evaluation. Mock tests cannot establish those results. |

The initial historical Moodle `lib/completionlib.php` URL returned 404; the current `public/lib` source above
was retrieved successfully. README claims were treated as descriptions, not independently verified results.
If a project/model is adopted later, select and review an exact version and its license first.

## Remaining product opportunities

| Priority | Missing workflow | Concrete addition and acceptance criteria |
| --- | --- | --- |
| 1 | Candidate experience feedback | Explicit recruiter survey requests after a selected stage; one response per request; accessible forms; anonymous reporting only above a documented minimum cohort; retention/delete behavior; no effect on selection decisions. |
| 2 | Policy import and provenance | PDF/DOCX extraction with bounded files/pages/runtime, editable preview and source attribution; importing creates a draft, never a publication. OCR/layout accuracy evaluated on representative documents. |
| 3 | Calendar-aware coordination | Google/Microsoft consent, selected calendars, busy-time intersection, revocation, webhook renewal and missed-event reconciliation. Existing scheduling checks Orbit bookings; it does not prove external calendar availability. |
| 4 | Semantic knowledge retrieval | Compare lexical vs dense/hybrid/reranked retrieval on a permission-aware dataset. Measure retrieval recall, quote accuracy, unanswerable questions, changed/deleted documents, latency and cost. Keep ACL filtering before retrieval and deletion propagation through the index. |
| 5 | Headcount fulfillment and HR handoff | Allocate approved positions to actual hires, release allocations when hires fall through, export reviewed joining fields through explicit provider mappings and idempotent delivery history. |
| 6 | Reading assignments and digests | Optional audience/group assignments with a due date and clearly disclosed recipients; opt-in reminders, member preferences, deduplication and revocation. Current reading coverage reports availability, not mandatory assignment. |
| 7 | Approved model evaluation suite | Versioned employer-approved examples, expected source passages and adversarial access/prompt cases; compare provider outputs with human review. Track errors and costs before changing default models. |

These are proposals, not integrations shipped or credentials configured by this release.

## Retrieval evidence

SHA-256 hashes identify the exact retrieved bytes, since upstream branches can move.

| Retrieved file | SHA-256 |
| --- | --- |
| Moodle public/lib/completionlib.php | `16cad9d4e268cf2b150f6d6aaf3755efe1b268d65d99e0f5976b6768b72daf62` |
| Docmost README | `dd05f459978695449638d22d53315dfd4cde1f481b3bb48ec50a6f6523f54828` |
| HRMS training_result.json | `d53db07ff1ff0af60203474da3cd65bad00876795e339ffba318bfdadd0909ce` |
| HRMS training_event.json | `1dc1e5f18aa4718a8c256ec3953e9bd777c008707335329c160d56231b0d4ef2` |
| HRMS training_result_employee.json | `3337c81632af0f86b9df04594d68373a4d33114fa419b96c8cfdf491fe68922e` |
| Formbricks README | `048c85541d709d334e5c4a67def86a9c89932576c30fcb99bceaf85f5be036c9` |
| Onyx README | `3a49fe9680a156fcbf48253af2fee472e7530c5e3ef50f9b9d57a0ccf6a6ca29` |
| Sentence Transformers README | `bdc79bef246a7c7a290b297abea3ac6bf5958481b923b177287a47c0b471ea5e` |
| Promptfoo README | `7fd57809624e22da73bf6b6feb027c9e09aec74e0099bdea711fe2e276e87c4a` |
| Docling README | `ce605634509dc87d79182131ad001e5fddf6053963b9045b971c6e87e6b9bfa1` |
