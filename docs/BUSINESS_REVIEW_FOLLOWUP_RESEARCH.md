# Review follow-up research

Reviewed 2026-10-30. Four public files from four projects were retrieved through the available GitHub route.
The [source manifest](BUSINESS_REVIEW_FOLLOWUP_SOURCES.json) records URLs, timestamps, byte counts and SHA-256.
This is a targeted source comparison; hosted accounts, private editions and real external delivery were not tested.

| Source | Observed behavior | Decision for Orbit Business |
| --- | --- | --- |
| [Novu README](https://github.com/novuhq/novu) | Notification workflows, multi-channel delivery, digests and per-user preferences are described as distinct features. | Separate reminder eligibility from delivery. Start with the existing in-app channel, an explicit opt-in and personal pause; do not imply email/push delivery from an inbox notification. |
| [ntfy README](https://github.com/binwiederhier/ntfy) | Publish/subscribe notifications, multiple clients and delayed/scheduled notification use cases. | Delivery timing needs an explicit contract and user controls. This release uses UTC due dates and a bounded schedule, without installing another notification service. |
| [Prefect automation schemas](https://github.com/PrefectHQ/prefect/blob/main/src/prefect/server/events/schemas/automations.py) | Reactive/proactive trigger posture, thresholds and time windows are explicit schema fields. | Define what counts as overdue, check current state at execution and persist cooldown/count state. A timer must not bypass access or independence rules. |
| [Argo suspend example](https://github.com/argoproj/argo-workflows/blob/main/examples/suspend-template.yaml) | Human suspension and timed resumption are separate operations. | Review deadlines never auto-approve. Handoff is an explicit human action that preserves evidence and requires a new named decision. |

## Delivered scope

A due-date workflow, optional capped internal reminders, a personal pause, scoped inbox filters and an audited
handoff chain. The new reviewer receives the same captured evidence and inherited reminder budget; no model or
background worker selects a reviewer. The existing AI progress brief receives aggregate delay/pause counts only.
No third-party runtime/code was copied, and no new model, package or connector was installed.

## Remaining gaps

1. Company/user notification preference center and digest batching across workflows, with per-channel consent
   and frequency caps before any external delivery is introduced.
2. Calendar-aware business days and time zones, explicit office-hours policies and localized due-date displays.
   Current semantics are UTC calendar dates, not a business-day SLA.
3. Reviewed absence/delegation policies, quorum approvals and escalation ownership. Automatic reviewer replacement
   would need explicit policy, access revalidation and an observable correction path; it is not shipped here.
4. Provider receipts, bounce handling, durable delivery jobs and revocation checks for a selected external channel.
   An in-app database notification is not proof of external delivery.
5. Operational monitoring of scan latency/failures and bounded-batch scheduling for larger installations; no
   throughput or availability benchmark is claimed by these functional tests.
6. A live-model evaluation of progress advice on approved, redacted examples. Mocks test privacy and contracts,
   not the usefulness of generated suggestions or a model's hiring expertise.

These are follow-up recommendations, not installed integrations or commercial feature-parity claims.
