# Business workflow and interaction research

Reviewed 2026-10-30. This extends the [hiring market](BUSINESS_HIRING_MARKET_RESEARCH.md) and
[talent lifecycle](BUSINESS_TALENT_RESEARCH.md) reviews with **12 source files from eight repositories** focused on
workflow execution, AI drafting, visual design and evaluation, including implementation files as well as READMEs. Sources were fetched through the available
public GitHub route; this is a focused source comparison, not a claim to have tested every hiring platform.
The [manifest](BUSINESS_WORKFLOW_RESEARCH_SOURCES.json) records exact URLs, retrieval times, bytes and SHA-256.
No third-party source, runtime, workflow engine or animation dependency was copied or installed.

| Source | Observed capability in retrieved README | Product decision |
| --- | --- | --- |
| [Kestra](https://github.com/kestra-io/kestra) | Declarative workflows; visual/code/AI editing, draft revisions, topology, execution checks and quotas. | Separate an editable definition from each frozen execution. Add bounded prerequisite graphs, revision checks and explicit starts before considering event triggers. These observations do not imply Orbit has Kestra's execution engine. |
| [Windmill](https://github.com/windmill-labs/windmill) | Developer-oriented workflows and internal apps, including generated interfaces and script/flow execution. | A useful workflow needs an operational UI and ownership, not just a prompt box. Orbit's steps link to existing workspaces; this release executes no scripts or arbitrary URLs. |
| [Activepieces](https://github.com/activepieces/activepieces) | Visual automation and an integration/piece ecosystem, with AI and agent tooling described in the source. | Connector breadth requires tenant credentials, approval and failure handling. Begin with an inspectable internal checklist; do not present generic model text as a working integration. |
| [Prefect](https://github.com/PrefectHQ/prefect) | Python workflow orchestration, tracked execution and recovery-oriented workflow concepts. | Track runs independently and preserve the definition they started with. Retries must not create duplicate runs or silently update a historical playbook. |
| [xyflow](https://github.com/xyflow/xyflow) | React Flow/Svelte Flow and graph/system packages for node-based interfaces. | Connections must reflect real prerequisite semantics. A bounded 12-step graph can use a small SVG and semantic form/list UI without adding a canvas dependency or hiding controls behind drag gestures. |
| [Motion](https://github.com/motiondivision/motion) | Declarative UI animation and interaction tooling. | Add restrained progress/hover transitions, preserve focus and respect reduced motion. Existing CSS is sufficient for this release; no animation runtime is necessary. |
| [Carbon Design System](https://github.com/carbon-design-system/carbon) | A reusable enterprise design system with design and implementation resources. | Reuse Orbit's shared fields/buttons/icons; keep readable hierarchy, explicit status text, keyboard controls and mobile wrapping. Orbit does not import or claim certification against Carbon. |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | LLM evaluation, testing and security evaluation tooling. | Verify malformed output, invented citations, stale requirements, access changes and durable quotas. Source comparison and mock-provider tests cannot establish live-model quality. |

The implementation-level review also checked Kestra's `Flow.java` (tasks, triggers, checks and revision
handling), Prefect's `flows.py` (retry/delay, timeout and lifecycle-hook arguments), xyflow's `NodeWrapper`
(focusability, key handling and ARIA attributes), and Motion's reduced-motion hook. Those files support the
specific design decisions above: execution checks belong in the server contract, keyboard access must accompany
visual graphs, and reduced-motion behavior needs an explicit implementation. Orbit uses native forms, SVG and
CSS media preferences for its smaller scope rather than adopting those runtimes.

## Implemented: Workflow Studio

The missing slice was role-level coordination. Orbit already has applicant automation tasks, hiring plans,
capacity and candidate handoffs. It lacked a reusable, cross-workspace preparation playbook with separate runs.

This batch adds:

- Three starting playbooks: role launch, interview readiness and hiring process improvement.
- A visual dependency map, template cards, distinct icons and editable step forms.
- Up to 12 ordered steps, prerequisite validation, due-day offsets and server-owned workspace links.
- Saved revisions and manual runs that retain their original definition after later edits.
- Active coordinator ownership, progress, blocked/ready/overdue signals and correction notes.
- Two AI workflows: a cited role-requirement-based draft, and an aggregate-only progress brief.
- Local review before an AI draft becomes saved work; no automatic start, mail, application or hiring decision.
- Custom vector graphics and lightweight motion with reduced-motion support; no external image dependency.

The implementation applies these interaction and reliability patterns within Orbit's existing authorization,
provider accounting and audit conventions. It does not embed a general-purpose automation engine.

## Remaining gaps and next acceptance boundaries

1. **Approval checkpoints:** explicit reviewer identity, independent approval, rejection/revision paths and stale
   definition invalidation. A completed checklist step is not approval or proof that linked work occurred.
2. **Event-triggered execution:** versioned trigger subscriptions, durable event inbox/outbox, idempotent start
   keys, pause/cancel reconciliation and operator-visible failures. Not implemented by a periodic UI refresh.
3. **External integrations:** build one selected ATS/calendar/signing provider with scoped tenant credentials,
   verified callbacks, delivery status and revocation before adding a marketplace of connector logos.
4. **Workflow observability:** append-only run events and reviewed retention, failure categories and replay rules
   before adding scripts or background step execution. Current runs retain task state and the company audit trail.
5. **Evaluated AI drafting:** redacted, approved test cases for job relevance, unsupported claims, fairness,
   dependency quality, access revocation, cost and latency on selected live models. Current mocks prove contracts.
6. **Visual editing at scale:** evaluate a graph library if real usage needs many nodes, branching or canvas
   navigation. Drag-and-drop should always have an equivalent keyboard/form workflow.

Hosted editions, private vendor capabilities, model benchmarks, external account access and vendor licensing
suitability were not verified by this review. The source hashes document what was inspected, rather than
turning a marketing README into an independently measured capability claim.
