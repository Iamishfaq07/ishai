# Orbit Business: hiring-platform comparison and expansion decisions

Research date: 29 October 2026. Primary public repository documentation and selected implementations were
retrieved for the products below. The source catalog records URLs, hashes, retrieved sizes and failed lookups:
[retrieval evidence](BUSINESS_HIRING_RESEARCH_SOURCES.json).

This is a broad, evidence-based comparison of relevant platforms and workflow tools, not a claim that every
hiring website was audited. Live SaaS screens, current prices, paid tiers, provider SLAs and hands-on integrations
were not tested. This environment permits public GitHub sources; public source availability and SDKs do not
establish the complete capabilities of a hosted product. Unavailable URLs are recorded, not treated as missing
vendor features. No third-party implementation/assets were copied and no dependency or service was installed.

## Main finding and the extension built

Orbit already has substantial ATS execution: company careers pages and verification, application intake,
structured pipelines, interview plans and debriefs, scheduling within Orbit, offers, joining plans, headcount
approvals/capacity, process automations and a permission-aware knowledge library. Its larger gaps are the
systems around that execution: consented talent CRM, candidate experience measurement, external integration
reconciliation, reusable hiring-program operations and production evaluation/administration.

This batch closes the **candidate experience → process improvement** gap. The new hub adds:

- Per-job, opt-in feedback campaigns, configurable stage eligibility and invitation expiry.
- Automatic portal invitations, plus an explicit reconciliation run, with once-per-application uniqueness.
- Candidate notice/consent, a fixed short questionnaire, decline, self-download and withdrawal.
- Aggregate-only reports released in non-overlapping groups of five; no recruiter response-level view.
- Ninety-day contribution windows, scheduled raw-response cleanup and application-deletion propagation.
- Quoted AI process-improvement briefs from released aggregates, with quota and freshness checks.
- A reviewed team improvement plan with actions, progress, target review date and draft downloads.
- Links from the hiring pipeline to the correct job's experience workspace.

The implementation changes Orbit Business and its company application portal. It does not change Orbit Personal,
hire/reject candidates, send survey emails or connect external services. See [workflow and rollout](BUSINESS_CANDIDATE_EXPERIENCE.md).

## Verified product/tool observations

| Platform / primary evidence | Observed capability or implementation | Implication for Orbit Business |
| --- | --- | --- |
| [Greenhouse API docs](https://github.com/grnhse/greenhouse-api-docs), including Harvest prospect pools, scorecards, rate limits and recruiting webhooks | Prospect pools have stages; structured scorecards are API resources. Webhook documentation describes signature verification and retry behavior; Harvest documents pagination and throttling. | Orbit's structured interviews already cover part of this space. Add consented talent-pool lifecycle and a durable integration boundary before claiming ATS interoperability. Do not infer feature/pricing parity from API docs. |
| [Lever Postings API](https://github.com/lever/postings-api) | Public jobs, custom applications, privacy/marketing/storage consent fields, throttling and application retry/hosted-form guidance. | Preserve consent by purpose and application idempotency. Future job-board connectors need retry queues and field mapping; publishing a careers page alone is not multi-board synchronization. |
| [Workable Jobs Grok plugin](https://github.com/Workable/workable-jobs-grok-plugin) | Public search/details are separate from signed-in candidate profile/application/recommendation/withdrawal actions. | Useful evidence for scoped connector tools and explicit action authorization. This is a candidate-facing connector, not evidence of all Workable employer ATS capabilities. No Workable/MCP connection is shipped here. |
| [SmartRecruiters webhook client](https://github.com/smartrecruiters/sr-webhooks-client) | Subscription activation handshake, event metadata, changed-resource identifiers and callback acknowledgements. | A future Business connector should durably receive/verify events, reconcile the authoritative resource and retain delivery history. A webhook handler alone is not a complete sync workflow. |
| [Teamtailor Ruby SDK](https://github.com/teamtailor/teamtailor-rb) and [partner documentation source](https://github.com/teamtailor/tt-partner-docs) | Account API access through resource wrappers and a partner-integration documentation surface. | Stable typed resource boundaries and integration setup matter. Exact partner permissions, versions and live behavior need validation before implementing a connector. |
| [Odoo recruitment applicant model](https://github.com/odoo/odoo/blob/19.0/addons/hr_recruitment/models/hr_applicant.py) | Talent-pool relationships, candidate reuse, duplicate-related identity matching, sources and refusal reasons are explicit data/workflow concepts. | Orbit needs consented company talent pools and a reviewed duplicate/merge workflow. Do not silently join people across jobs or reuse data from Orbit Personal. |
| [Frappe HRMS job applicant schema](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_applicant/job_applicant.json) and [interview feedback schema](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/interview_feedback/interview_feedback.json) | Applicant lifecycle and structured interview feedback are distinct records. Earlier staffing-plan research also covers requisitions and vacancies. | Keep process-experience feedback separate from interviewer evaluations and hiring decisions. Current capacity is recruiting-record fulfillment, not an employee ledger. |
| [OpenCATS](https://github.com/opencats/OpenCATS) | Describes the ATS lifecycle from posting/application to candidate selection/submission and an active modernization roadmap. | Mature recruiting is a connected operational workflow; avoid filling the product with isolated generators. Applicant tracking coverage alone does not establish enterprise operating readiness. |
| [Horilla HRMS](https://github.com/horilla-opensource/horilla) and [recruitment models](https://github.com/horilla-opensource/horilla/blob/master/recruitment/models.py) | Survey-template records linked to recruitment, skills, recruitment stages, candidate records and onboarding flags. | Reusable questionnaires and lifecycle handoff are useful patterns. These generic recruitment surveys are not assumed to be the same as candidate-experience measurement. Orbit's current questionnaire is deliberately fixed/versioned. |
| [Formbricks](https://github.com/formbricks/formbricks) | In-app/link/email surveys, targeting, templates and experience-analysis positioning. | Implement a focused candidate-feedback loop with explicit opt-in, retention and aggregate reporting. No Formbricks service or source is embedded. |
| [HeyForm](https://github.com/heyform/heyform) | Conversational forms, conditional logic, exports and webhook/integration support. | Accessible short forms and clear post-submit controls matter. Custom form builders need versioned question schemas and privacy review; they are a separate follow-up. |
| [Cal.com](https://github.com/calcom/cal.com) | Calendar/scheduling integrations and documented Google Calendar consent/credential setup. | Orbit scheduling currently knows Orbit bookings. Real external availability needs provider OAuth, selected calendars, revocation, renewals and missed-event reconciliation. |
| [Activepieces](https://github.com/activepieces/activepieces) | Human-input interfaces, approval/wait pieces, versioned integrations and reusable automation templates. | Keep automation opt-in, persisted and reviewable. The new feedback campaigns enroll eligible applications without sending emails or making hiring decisions. |
| [n8n](https://github.com/n8n-io/n8n) | Multi-step AI/workflow automation, integrations, human approvals and observability. | A future recipe builder should have explicit permissions, revisions, execution history and action previews. Do not expose arbitrary generated-code execution as an enterprise feature. |
| [Novu](https://github.com/novuhq/novu) | In-app and other notification channels, workflows, digests and preferences. | Orbit has internal notifications/opt-in sweepers. Preferences, digest scheduling, delivery receipts and channel reconciliation remain missing. No messaging provider is added for feedback invitations. |
| [Metabase](https://github.com/metabase/metabase) | Interactive dashboards, filters, subscriptions, alerts and AI query assistance. | Recruiting analytics need documented cohorts/denominators and access boundaries. Feedback reports intentionally avoid arbitrary filters or one-response updates that can expose contributors. |
| [Twenty CRM](https://github.com/twentyhq/twenty) | Objects, views, workflows and agents as extensible CRM building blocks. | Useful for a future recruiting relationship workspace with owned records/tasks. It is a general CRM reference, not a claim of a ready-made ATS integration. |
| [Presidio](https://github.com/microsoft/presidio/blob/main/README.MD) | Context-aware PII detection/de-identification and configurable recognizers for text/images. | Relevant to future transcript/import redaction, with measured accuracy and human review. The new experience survey avoids free text and does not require an entity-detection model. |
| [Langfuse](https://github.com/langfuse/langfuse) | LLM tracing, prompt management, evaluations, datasets and experiments. | Orbit's provider accounting/quoted previews are a start. Approved datasets, redacted traces, model comparisons and deployment regression gates are still needed; mock tests do not measure live-model quality. |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | Prompt/model evaluations, adversarial tests and CI integration. | Test access revocation, malformed output and stale sources in code now; run a separate consented live-provider evaluation before making quality claims. |

## Current product coverage and prioritized gaps

| Area | Current Orbit capability inspected | Missing workflow / next implementation target |
| --- | --- | --- |
| Candidate experience | **New:** campaigns, portal feedback, grouped reports, AI suggestions and reviewed improvement plans | Evaluate adoption, translations and fixed-version question variants before adding more survey channels. |
| Talent CRM / rediscovery | Applications are scoped per company/job; no shared consented talent-pool lifecycle | Explicit opt-in pool membership, consent expiry/revocation, recruiter ownership, saved searches, reviewed merges and a return-to-role workflow. No automatic scraping or cross-Personal reuse. |
| Referrals | Standard application/source tracking | Employee referral submission, candidate consent, duplicate attribution review, referral status visibility and separately approved reward handling. No automatic payments. |
| External scheduling | Slots, panel coordination, change requests and Orbit booking conflicts | Calendar OAuth, busy-time intersection, selected calendars, webhook renewal/revocation and recovery from missed events. |
| ATS / HRIS integrations | Careers surfaces and internal APIs; reviewed joining plans | Company-scoped credentials, field mappings, signed incoming events, durable outbox/retries, source identifiers, reconciliation and reviewed employee handoff. Pick named providers and test their sandboxes. |
| Hiring programs / recipes | Durable predefined operations recipes, internal tasks and reminders | Versioned recipe templates, explicit role permissions, test/preview runs, human approvals and replay diagnostics before exposing a visual builder. |
| Recruiting communications | Company templates/service email, candidate questions and internal notifications | Recruiter mailbox consent, thread ownership, channel preferences, digests and provider delivery outcomes. Candidate consent to apply must not silently become consent to nurture/marketing. |
| Position / employee ledger | Approved requisitions and linked current recorded hires, separated currency envelopes | Durable position allocations, replacement/release workflows and HRIS identifiers that respect recruiting-data deletion. Fiscal/department plans and budget transfers need independent approvals. |
| Hiring analytics | Source/funnel/response-time analytics, control room, capacity and the new process-feedback reports | Cohort definitions, outcome-linked program reporting and permission-aware scheduled reports. Do not infer employee performance or causal hiring quality from process ratings. |
| Knowledge | Published drafts, ownership/reviews, cited answers, reading receipts and file-import previews | Reviewed source revisions, evaluated OCR/layout handling, consented semantic-retrieval evaluation and deletion-aware indexes. |
| Enterprise access | Current company roles/permissions and shared account-security features | No Business SAML/SCIM workflow was found in the inspected routes. Validate SSO/provisioning requirements, service-account scopes, delegated administration and export/retention controls. |
| AI operations | Source-quoted previews, durable company allowances and human review checkpoints | Employer-approved evaluation sets, trace redaction, cost/latency/quality comparisons, prompt version rollouts and incident rollback. No automated hiring authority is added. |

## Concrete follow-up slices

1. **Consented talent pools and rediscovery:** pool consent independent of an application, expiry/revocation,
   recruiter ownership, explicit link to a new job and a merge preview retaining source history. Acceptance:
   revoked/expired people disappear from searches and AI context; no cross-company/Personal joins.
2. **Integration operations:** one selected ATS/calendar/HRIS provider, tenant credential setup, signed event
   inbox, idempotent mapping, retry history and reconciliation. Acceptance: replay and reordered events do not
   create duplicate people/actions; revocation stops access and a failed sync remains inspectable.
3. **Referral operations:** employee submission plus candidate-controlled consent, duplicate attribution and
   human reward approval. Acceptance: referrers cannot inspect private hiring feedback or other applications.
4. **Notification digests/preferences:** opt-in topics, channel/frequency choices, queue/delivery receipts and
   escalation. Acceptance: decisions/withdrawals cancel obsolete reminders, and replicas do not duplicate sends.
5. **Production AI evaluation:** a small versioned employer-approved dataset before changing models or adding
   agent actions. Acceptance: access, citation, unanswerable, deletion, prompt-injection, cost and latency cases
   are evaluated; live-quality results are distinguished from deterministic mock-contract checks.

These are proposed next slices, not features/integrations claimed to be shipped in this batch. Existing
capabilities were checked in the current Business modules, not validated as a complete enterprise certification.

## License and retrieval notes

The compared repositories include permissive, copyleft, source-available and commercial/enterprise boundaries
(for example n8n's Sustainable Use/enterprise licenses and mixed community/enterprise editions elsewhere).
No dependency was selected from them. Review the exact version and license before adopting code or services.
Greenhouse implementation references were pinned to repository revision
`271cd888061d3428575eba2f626fe3e1996485c3`; the catalog supplies each file's hash. Other source hashes identify
the retrieved bytes on moving branches. Failed guessed SDK URLs were resolved where possible using the
official organization repositories; they do not establish the absence of an API or a product capability.

The subsequent [talent community research](BUSINESS_TALENT_RESEARCH.md) delivers explicit consent,
expiry and withdrawal, recruiter discovery and reviewed portal role suggestions. Named ownership, saved
searches, identity merging and external nurture delivery remain separate follow-up work.
