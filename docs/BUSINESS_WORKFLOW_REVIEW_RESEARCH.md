# Targeted human-review workflow research

Reviewed 2026-10-30. Four public source files were retrieved across four projects. Exact URLs, retrieval times,
byte counts and SHA-256 hashes are recorded in [the manifest](BUSINESS_WORKFLOW_REVIEW_SOURCES.json).
This extends the [workflow research](BUSINESS_WORKFLOW_RESEARCH.md); it is a source comparison, not a live
vendor evaluation, legal signing assessment or proof that Orbit implements a general workflow engine.

| Source inspected | Observed behavior | Applied decision |
| --- | --- | --- |
| [Windmill README](https://github.com/windmill-labs/windmill) | Human approval can suspend a workflow; the example waits for approval and handles rejection. The text distinguishes an awaiting approval from occupied worker execution. | Keep a persisted pending record rather than holding a request/worker open. Represent changes requested explicitly, with evidence and a new round. |
| [trstringer/manual-approval README](https://github.com/trstringer/manual-approval) | Named approvers, minimum approvals, denial handling and `exclude-workflow-initiator-as-approver` are explicit settings; the initiator exclusion is optional in that action. | Orbit's checkpoint requires one named reviewer and always excludes requester/owner. Do not infer independence merely because someone clicks an approval button. No GitHub issue/comment integration is installed. |
| [Argo suspend-template example](https://github.com/argoproj/argo-workflows/blob/main/examples/suspend-template.yaml) | Manual suspension and a duration-based delay are separate steps. The timed suspension example automatically resumes; manual suspension is resumed explicitly. | A human checkpoint must never auto-approve on timeout. This release has no timer that converts pending review to approved. |
| [Prefect `flow_runs.py`](https://github.com/PrefectHQ/prefect/blob/main/src/prefect/flow_runs.py) | Pause/suspend/resume paths, run input and timeout handling are explicit execution concepts. | Bind the human decision to a persisted run/evidence record and re-check access/current state before resuming checklist progress. |

## Delivered boundary

Optional checkpoint policy is set by a person in the playbook editor. A run freezes that definition. Prerequisite
completion enables a review request; another eligible person sees it in their private inbox and acknowledges the
captured evidence before deciding. Rejection keeps the checkpoint incomplete and a later request gets a new round.
Immutable decision fields and snapshot history are preserved through ordinary correction, with explicit invalidation
when an approved checkpoint is reopened. No external signing provider or autonomous agent participates.

## Next gaps

1. **Multiple independent reviewers / quorum:** define required roles, all/any/quorum semantics, abstention and
   reviewer replacement without reducing an already-reviewed requirement. This release uses one named reviewer.
2. **Time-bound review operations:** internal reminders and delegation with explicit settings, deduplication,
   frequency caps and absence handling. No automatic approval or new outbound channel follows from a deadline.
3. **Live-source approvals:** version/hash all referenced documents and job settings, invalidate a pending approval
   when a referenced source changes, and provide an evidence-diff view. The shipped scope is the frozen run record.
4. **Retention and formal signatures:** explicit evidence-retention settings, export manifests and a chosen signing
   provider where a real legal or financial authorization is required. A JSON hash is not a signature service.
5. **Reviewed AI assistance:** source-cited summaries of an authorized evidence packet only after a separate data
   review, access/deletion tests and live-model evaluation. The shipped progress brief receives aggregate counts only.

No code or dependencies from these repositories were vendored. Real GitHub approvals, hosted accounts, external
messages and live model quality were not tested. Project-specific licenses and enterprise editions would need a
separate adoption review before integrating their runtime or services.

The [follow-up release](BUSINESS_REVIEW_FOLLOWUPS.md) delivers bounded in-app reminders, personal pausing and
explicit reviewer handoff. Quorum, automatic delegation and external message delivery remain future work.
