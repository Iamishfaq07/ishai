# Orbit Business: workflow research and implementation

Primary repository documentation and selected source files were retrieved on 28 October 2026.
This is a focused comparison of tools relevant to Orbit Business, not an exhaustive market survey.
No third-party implementation was copied, and no new runtime dependency was added.

## Product gap selected for implementation

Orbit already provides job-description assistance, screening/ranking support, structured interview plans,
independent panel feedback, practical assessments, candidate scheduling, offers, joining plans,
follow-up automations and a cited operations brief. Adding another generic hiring chatbot would duplicate
existing surfaces. The larger gap was **before job creation**: explaining a staffing need, estimating a
cost envelope, obtaining independent approvals and preserving the version that was approved.

The new **Hiring requests** desk adds that workflow, with three grounded AI planning modes:

1. Clarify the business case, measurable outcomes and essential requirements.
2. Plan interview questions and work-sample evidence against those outcomes.
3. Prepare budget-review questions about headcount, annual cost and date assumptions.

AI returns quoted suggestions for human review. It has no authority to approve a request, choose an
employee, create a job, send messages or publish a role. Approved requests can be handed off explicitly
to one linked draft job. The internal business case and cost envelope do not become public salary fields.
See [the workflow and rollout guide](BUSINESS_REQUISITIONS.md).

## Sources and product decisions

| Project / primary material | Relevant capability observed | Decision for Orbit Business |
| --- | --- | --- |
| [Frappe HRMS](https://github.com/frappe/hrms), [job requisition schema](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_requisition/job_requisition.json), [requisition implementation](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_requisition/job_requisition.py), [staffing plans](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/staffing_plan/staffing_plan.py) | Requisition states, number of positions, links to openings and estimated staffing budgets | Implement the intake-to-approval gap in Orbit; retain a cost envelope distinct from salary and preserve submitted versions. HRMS is a GPLv3 reference, not a dependency. |
| [Activepieces](https://github.com/activepieces/activepieces/blob/main/README.md) | AI pieces, human-input interfaces and approval/wait steps | Model human review as a durable workflow step rather than a chat instruction. Orbit uses its own database and existing notifications. Activepieces has community and enterprise licensing boundaries. |
| [Windmill](https://github.com/windmill-labs/windmill/blob/main/README.md) | AI authoring with review, roles/resource scope, protection rules and development-to-production promotion | Separate generated suggestions from saved authority, recheck access after generation and require revision checks on writes. No workflow executor is embedded. |
| [Temporal](https://github.com/temporalio/temporal/blob/main/README.md) | Durable workflows and handling intermittent failures/retries | Persist approval steps and make job handoff idempotent. A dedicated workflow runtime remains a future scale decision; it is not introduced for this database workflow. |
| [LangGraph](https://github.com/langchain-ai/langgraph/blob/main/README.md) | Durable execution, human-in-the-loop state inspection and observability | Use explicit workflow state and review checkpoints. Reuse Orbit's bounded, metered AI preview mechanism instead of introducing a second agent runtime. |
| [Novu](https://github.com/novuhq/novu/blob/next/README.md) | Notification workflows, multichannel delivery, digests and preferences | Deliver internal approval notifications now through Orbit. Notification preferences, digests and provider delivery receipts remain separate integrations. |
| [Open WebUI](https://github.com/open-webui/open-webui/blob/main/README.md) | Retrieval/document knowledge, tools and self-hosted AI workflows | A future Business policy assistant should cite tenant-scoped documents and respect their permissions. This release cites only the saved requisition; it does not claim document ingestion or enterprise RAG. |
| [Formbricks](https://github.com/formbricks/formbricks/blob/main/README.md) | Targeted surveys, shareable links and team collaboration | Candidate experience surveys and trend reporting are a useful next product slice. No surveys are sent in this release. Core and enterprise code have different licensing conditions. |
| [Docling](https://github.com/docling-project/docling/blob/main/README.md) | Structured document conversion, PDF layout/table handling, OCR and AI integrations | Evaluate on consented Business hiring documents before replacing current parsing. Useful for future policy/brief ingestion; OCR quality, resource limits and model artifacts need measurement first. Not installed here. |
| [Hugging Face smolagents](https://github.com/huggingface/smolagents/blob/main/README.md) | Tool-using agents and model/tool integrations | A future connector agent needs restricted tool permissions and explicit action previews. This release uses no generated-code execution or autonomous external actions. |

Repository README files describe their projects, not independent verification of enterprise reliability.
Licenses must be reviewed at the selected version if any implementation or dependency is adopted later.
A historical LangGraph notebook URL returned 404; the available current repository overview was used instead.

## Prioritized next Business workflows

| Priority | Workflow | Concrete result | Integration work still required |
| --- | --- | --- | --- |
| 1 | External calendar availability | Recruiters can propose slots that account for approved Google/Microsoft busy time | Provider OAuth, scoped calendars, webhook renewal, revocation and missed-event reconciliation; Orbit currently checks its own bookings. |
| 2 | Hiring-request policy controls | Department-specific approval templates and a configurable publishing gate | Policy versioning, authorized delegates, escalation, administrator recovery and a documented migration for existing jobs. This release governs requests created in the desk, not all job creation. |
| 3 | Business knowledge assistant | Answers about hiring policy with document quotes and access-aware citations | Tenant-isolated ingestion, deletion propagation, document ACLs, retrieval evaluation and provider configuration. |
| 4 | Candidate experience feedback | Survey requests after selected stages, with aggregate process insights | Opt-in sending, accessibility, retention, low-count reporting controls and delivery outcomes. |
| 5 | HRIS handoff | Approved joining information exported to a chosen HR system | Explicit field mapping, reviewed export, idempotency and retry history per provider. |
| 6 | Multichannel operations | Approval digests, notification preferences and overdue-step escalation | User preferences, scheduling, provider status and backoff; avoid duplicate reminders after a decision. |
| 7 | Headcount fulfillment | Track how many approved positions are actually filled | Link approved position allocations to hires and reopened roles. The new request records planned positions; its single draft job does not track actual hiring fulfillment. |

These are follow-up proposals, not features claimed to be shipped or configured. Provider integrations need
real credentials and end-to-end validation. This implementation changes Orbit Business only; shared changes
register Business routes, tables and test contracts, without changing Orbit Personal behavior.
