# Hiring workflow research: consented rediscovery and enterprise execution

Reviewed 2026-10-29. This extends [the broader hiring market review](BUSINESS_HIRING_MARKET_RESEARCH.md).
This pass examined **12 public source files across nine projects**, including four additional projects:
Documenso, Temporal, Unleash and OpenFeature. Exact URLs, retrieval times, byte counts and SHA-256 hashes
are in [the source manifest](BUSINESS_TALENT_RESEARCH_SOURCES.json). These are retrieved source snapshots,
not hands-on tests of hosted vendor products or proof of every commercial feature. Branch URLs can change;
the hashes identify what was inspected. No vendor code was copied, SDK installed or hosted integration activated.

## What the sources show

| Project and inspected material | Observed workflow | Implication for Orbit Business |
| --- | --- | --- |
| Greenhouse Harvest prospect pools and Candidate Ingestion prospect pools | Active/hidden pools, pool IDs and prospect stages are explicit resources. | A candidate pipeline is not a reusable talent community. Add a separate, purpose-specific lifecycle before adding nurturing stages. |
| Greenhouse Harvest candidates | Candidate deletion and field-selective anonymization are distinct API operations; candidate records can carry applications. | Reusing an application must not prevent deletion. Implement database cascades and hide pending deletions before asynchronous removal. Do not confuse anonymization with deleting a consented profile. |
| Lever Postings API README | `consent.marketing` and `consent.store` are separate fields, with compliance-policy identifiers described for the relevant contract. | Consent to apply must not imply ongoing contact. Orbit's new permission covers recruiter discovery and portal suggestions only; mailbox/nurture consent remains separate work. |
| Odoo 19 `hr_talent_pool.py` | Pools have company, manager, active state, description, tags and applicant relationships. | Company ownership and an explicit pause state matter. Named pool ownership and taxonomy governance remain later extensions. |
| Odoo 19 `hr_applicant.py` | Talent relationships and duplicate discovery using email/phone/LinkedIn are explicit. | Avoid silently merging applicants across roles. This release keeps memberships linked to the individual application; any future identity merge needs preview, provenance and reversible attribution. |
| Frappe HRMS Job Applicant JSON | A structured applicant record holds job, source, status, resume and related recruitment information. | Keep the existing application as the record of evidence. The community stores candidate-declared skills/interests, not another resume copy. |
| Formbricks README | Survey and experience management are a dedicated product area. | Keep the previously shipped experience questionnaire separate from discoverability consent. Survey participation cannot enroll someone into a talent community. |
| Documenso README | Self-hostable document signing; source states AGPLv3 licensing. | Orbit's offer acceptance history is not a signing-provider integration. A future connector needs an immutable document revision/hash, recipient identity, provider envelope, verified callbacks, cancellation and downloadable signed evidence. Evaluate API/service terms before adoption. |
| Temporal TypeScript SDK README | Durable workflow/activity orchestration, clients and workers are distinct components with runtime requirements. | Long-running integrations need durable state, retries, reconciliation and operator visibility. Installing an orchestration engine alone would not provide provider credentials, idempotency or tenant isolation. |
| Unleash README | Feature flags, controlled rollout and SDKs; hosted enterprise claims distinguish SSO/SCIM/change requests from the basic source offering. | Enterprise rollout needs cohort controls and kill switches. Never use a feature flag as authorization or consent. No SSO/SCIM parity is inferred from the open-source README. |
| OpenFeature specification README | Vendor-neutral feature flag evaluation API and SDK/provider abstraction. | A future Business rollout interface should avoid binding authorization or application data to a flag vendor. The provider failure default must preserve candidate withdrawal and deletion. |

## Product decision delivered in this batch

Build **Talent Communities** before campaign automation or semantic ranking:

1. Owner/admin creates a bounded-purpose community, chooses 30–365 days, and explicitly opens it.
2. A confirmed applicant sees the notice and purpose in their existing private status portal.
3. Candidate supplies skills/interests and explicitly agrees; the default is no membership.
4. Owner/admin/recruiter searches current profiles using literal skills/interest text, with cursor pagination.
5. Recruiter reviews the original application, then explicitly suggests an available role in the portal.
6. Candidate reviews the public job and separately chooses whether to apply, dismisses the suggestion, or leaves.
7. Expiry, changed terms, pending application deletion and company restrictions prevent continued discovery.

This adds a missing lifecycle rather than another application ranking assistant. Neither experience ratings nor
private interview feedback feed discovery. No external messages, automatic applications, scraping, protected
trait filters or Orbit Personal data joins are part of the workflow.

## Next concrete gaps, in priority order

| Next increment | Reviewable acceptance boundary | Dependency / reason to wait |
| --- | --- | --- |
| Consented nurture delivery | Separate channel opt-in and frequency cap, preview/approval, durable outbox, revocation before dispatch, delivery/bounce handling. | Needs a selected provider and explicit outbound-channel authorization. Portal consent alone is insufficient. |
| Talent operations ownership | Named active owner, candidate-visible purpose, saved searches with audience controls, expiring internal tasks. | Reuse current company membership checks; do not expose pool-wide profiles to assigned-only hiring managers. |
| Duplicate review | Show exact source records and conflicts; explicit merge/undo, consent provenance and deletion propagation. | No automatic email/phone merge. Candidate-level identity requires a deliberate data model beyond this release. |
| Offer signing connector | Versioned PDF/hash, approval, envelope id, signed/rejected/expired states, signature-verified callbacks and reconciliation. | Choose a provider and signing requirements; source README is not proof of legal suitability. |
| Integration operations console | Per-company credential status, signed event inbox, mapping version, retry/replay, dead-letter reason, idempotency and revoke. | Build one real provider end to end before promising a connector marketplace. |
| AI rediscovery evaluation | Candidate-authorized corpus; exact evidence, job-related criteria, deletion-aware retrieval, abstention, access and injection tests. | Current literal search is inspectable. No model-quality claim or automatic suitability ranking is justified by repo comparison. |
| Enterprise staged release | Business-only cohort flags, observable fallback and rollback; deletion/withdrawal always available. | Evaluate OpenFeature/provider integration after server-side authorization remains authoritative. |

These are recommendations, not shipped features or a claim to have checked every hiring site. Hosted product
pricing, private enterprise editions, live calendars/mailboxes, signing providers and live AI models were not tested.
