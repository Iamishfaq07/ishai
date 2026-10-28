# Hiring capacity research and product decisions

Primary source files retrieved on 28 October 2026. This follows the missing headcount-fulfillment workflow
identified in [the Business comparison](BUSINESS_RESEARCH_2026_10.md) and [the reading-desk backlog](BUSINESS_READING_RESEARCH.md).
No third-party code was copied and no dependency or external integration was added.

| Primary source inspected | Observed implementation | Orbit decision |
| --- | --- | --- |
| [Frappe HRMS job requisition](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_requisition/job_requisition.py) | Associates job openings with requested position counts; records Filled state and time-to-fill. | Connect existing approved requests to linked jobs and show current recorded fulfillment. Preserve the approved request instead of editing approval state from a report. |
| [Frappe HRMS job opening](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/job_opening/job_opening.py) | Validates planned vacancies; closing a linked opening updates its requisition to Filled. | Orbit explicitly distinguishes closed-with-vacancies from filled. A closed job alone is insufficient evidence that the approved positions were hired. Ambiguous shared links produce unknown counts. |
| [Frappe HRMS staffing plan](https://github.com/frappe/hrms/blob/develop/hrms/hr/doctype/staffing_plan/staffing_plan.py) | Checks overlapping plans and planned vacancies/cost envelopes against parent/subsidiary staffing plans. | Keep approved envelopes separate by currency and expose overages. Department allocations, fiscal periods, subsidiary hierarchies and hard company-wide budget gates remain future workflows. |
| [Novu README](https://github.com/novuhq/novu/blob/next/README.md) | Describes notification workflows, digests, multiple channels and member preferences. | Reuse Orbit's durable in-app notifications with explicit opt-in, revision checks and deduplication. Avoid adding another delivery service just for capacity signals. Cross-channel preferences and digests remain follow-ups. |

The HRMS source is a GPL project used for comparison, not embedded or translated into Orbit. Novu also has
community/enterprise licensing boundaries. Review exact versions/licenses if a dependency is adopted later.
Repository documentation and code are evidence of these patterns, not independent proof of vendor reliability.

## What shipped

- Hiring-capacity desk spanning approval, job handoff, current recorded hires, remaining positions and overages.
- Separate annual approved/remaining cost envelopes per currency, with explicit unknown accounting.
- Scoped snapshots and downloads without applicant identities or documents.
- Quoted AI delivery/budget planning from bounded aggregate facts, with post-generation freshness checks.
- Opt-in, owner-assigned internal alerts for due targets and fulfillment/link gaps, with durable deduplication.
- Automatic watch disablement when approval is no longer current.

See [workflow, accounting and rollout details](BUSINESS_CAPACITY.md).

## Still missing and useful next work

1. **Candidate experience feedback.** Explicit post-stage survey requests, accessible responses, privacy-aware
   aggregate reporting and retention. This remains separate from candidate evaluations and selection.
2. **Durable position allocation / HRIS employee ledger.** A confirmed position allocation should survive deletion
   of recruiting records while respecting privacy rules. It needs reviewed employee identifiers, allocation
   release/replacement workflows and chosen HRIS field mapping. Current capacity deliberately uses current
   application records and does not claim this ledger exists.
3. **Fiscal/department staffing plans.** Period-scoped cost envelopes, independent approval of transfers and clear
   treatment of contractors/replacements. Current approvals are per requisition and do not constrain all hiring.
4. **Preferences and digests.** Member-controlled frequency/channel choices and escalation. Current capacity alerts
   stay in-app, with per-request opt-in and one notification per unresolved signal episode.
5. **External calendar reconciliation and policy ingestion.** These remain useful integration gaps with explicit
   OAuth/parser/provenance work, as described in the earlier backlog. No new connector is claimed here.

## Retrieved-byte evidence

| Source file | SHA-256 |
| --- | --- |
| HRMS job_requisition.py | `a7389683d8fa3d752eb1bcd8e0d18f7844f4cefd56baf2bd2b74c7356dacdc26` |
| HRMS job_opening.py | `c02525915301d826729091fc3dc1d2a9dac85be70198fa03b33b9eeb65e1702c` |
| HRMS staffing_plan.py | `8d6bad505c0ffc963676086a18682602803371ac67e4ca0326c663da3cb72d64` |
| Novu README | `1e3f2e1690ac106e44b24f4adb74968e27ddba73c083003f1ae97c610448fe3d` |
