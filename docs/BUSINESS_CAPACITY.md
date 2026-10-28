# Business hiring capacity

Business → Hiring capacity connects approved hiring requests to their linked job's current recorded hires.
It adds delivery/budget AI briefs and opt-in internal capacity alerts. Orbit Personal behavior is unchanged.

## Workflow

1. Create, submit and independently approve a hiring request in **Hiring requests**.
2. Open **Hiring capacity** to see approved positions, the target date and approved annual envelopes.
   Approved requests without a job remain visibly **Awaiting job handoff**.
3. Explicitly create the linked job draft through the existing request handoff. Publish and recruit through
   the existing job workflow. The capacity desk does not publish jobs or change approval requirements.
4. When a human moves an application to a hired stage, the next refresh counts it as a recorded hire.
   Moving it back into recruiting restores the remaining position. Accepted offers alone are not hires.
5. Review target dates, paused/draft jobs, closed jobs with remaining positions and overages. Open the request
   or linked pipeline to make a decision. No job or request is automatically closed or reopened.
6. Optionally prepare a quoted AI brief focused on delivery gaps or budget assumptions. Download the brief
   or the entire visible capacity snapshot as JSON.

## Accounting and limits

This is request fulfillment from **current application records**, not a payroll/HRIS employee ledger.
Hired and active counts include only email-confirmed applications without a pending deletion request.
Withdrawn, rejected, unconfirmed, deleted and deletion-pending records do not contribute. Later retention
deletion can therefore reduce recorded fulfillment. No candidate names, emails, resumes, evaluations, private
conversation contents or applicant link tokens appear in snapshots or AI facts.

Remaining positions are calculated independently per request, with a floor of zero. Overage is shown explicitly;
overfilling one request does not offset vacancies in another. A closed job is not treated as proof of fulfillment.
Converted requests whose job was deleted show unknown fulfillment rather than zero. A job linked to multiple
approved/converted requests is flagged as ambiguous and its hires are not counted against either request.

Approved envelopes equal approved positions × annual budget per position. Known remaining envelopes use known
remaining positions × that approved per-position amount. They do not measure spend, savings, offered salaries
or payroll. Each currency has its own total; no conversion is attempted. Missing budgets/unknown fulfillment
are disclosed in the excluded-request count for remaining envelopes.

Owners/admins/recruiters see requests according to existing requisition visibility. Hiring managers see their
own requests and can see linked-job counts only while they also have job access. Removing them from a hiring
team changes that request's counts to unknown and removes the pipeline link. Interviewers cannot access the
desk. Other companies' request/job identifiers remain unavailable.

The view includes at most 200 visible approved/converted requests, prioritizing enabled watches and then newest
requests. Totals, exports and AI cover that selection; a truncation message discloses the cap. Search and queue
filters operate within the loaded selection. Use **Refresh capacity** for current signals; the snapshot includes
its UTC date and a content version used by AI freshness checks. Unlinked jobs are outside these totals.

## Optional internal alerts

Owners/admins can enable a watch per approved or handed-off request and assign a current active owner/admin.
Responsibility does not grant access. Watches default off; at most 100 can be enabled per company.

Signals eligible for alerts:

- Target date reached while remaining fulfillment is positive or unknown.
- More recorded hires than approved positions.
- Closed job with known remaining positions.
- Missing linked job or a job linked to multiple approved requests.

Paused/draft jobs are visible for planning but do not alone trigger alerts. Notifications are generic internal
Orbit notifications linking to the capacity desk; no policy/candidate contents, emails or external messages are
sent. The existing Business automation loop checks after 30 seconds and then about every five minutes while
the API runs. **Run opted-in capacity alerts** reconciles the same watches immediately.

Company transaction locks deduplicate across concurrent requests, API replicas and retries. The episode key
includes the request, signal combination, approved positions, target date and owner. Count changes that leave
the same signal combination unresolved do not repeatedly alert. A healthy reconciliation clears the episode;
a later gap can alert again. Reassignment or explicitly re-enabling a watch starts a fresh episode. An unavailable
owner is reported and skipped. Suspended companies are skipped. Failures are isolated per company and from
the other Business sweepers. Alert delivery never changes hiring state.

Reopening/cancelling a request, or otherwise invalidating its approval, automatically disables its watch and
increments the watch revision. Re-approval does not opt it back in. Deleting a request cascades its watch.

## AI

Delivery and budget modes use up to eight request summaries, prioritizing the review queue. Each fact states
approved positions, known/unknown recorded hires, remaining positions, active applications, state, target date
and approved annual per-position budget. This is a bounded planning brief, not a full company staffing audit.

The configured LLM receives those aggregates only. Each usable tip must exactly quote a supplied fact and
include a practical suggestion and verification step. Quote attribution does not prove every suggestion correct.
The prompt does not grant tools or permission to change records. AI cannot approve, hire, publish, close jobs,
change budgets, predict candidate outcomes or convert currencies.

The company has ten capacity-brief attempts per UTC day, including provider/validation failures. Reservation
uses existing durable provider accounting. Access, company status and the snapshot version are checked before
and after generation; changed counts, settings or access can reject a stale result. AI tests use mock providers;
no live-model quality evaluation or external provider connection was performed here.

## API and rollout

Prefix `/v1/business/companies/{company_id}/capacity`:

| Method/path | Purpose |
| --- | --- |
| `GET /` | Scoped approved-position snapshot, currency envelopes and bounded AI facts |
| `POST /brief` | `{version, focus: "delivery" | "budget"}` → quoted read-only suggestions |
| `PUT /{request_id}/watch` | Owner/admin configuration with `{base_revision, enabled, owner_id}` |
| `POST /alerts/run` | Owner/admin reconciliation of opted-in internal alerts |

Strict contracts reject unexpected fields, non-integer revisions and non-boolean enable flags. Alert settings
use optimistic revisions and refreshed authorization under a company lock. Alert actions/configuration are
recorded in the existing Business audit log without copying applicant content.

Migration `f0a4b8d2e615` joins the separately released reading and upstream job-hidden migration branches;
it has no schema operations. Upgrades from either branch are tested. Migration `f1b5c9e3a726` then adds
`biz_capacity_watches` and its company/enabled index. It creates no watches automatically and does not alter
existing requests or Personal tables. Apply migrations before API deployment. No production migration or
deployment was run in this task.

Tests cover accounting, access, deletion/reopening, currency separation, ambiguous links, AI quotes/freshness,
revoked access, company quotas, concurrent alert deduplication, opt-in/re-enable, the watch/report caps,
approval invalidation, migration roundtrips and the full Chromium approval→handoff→hire→reopen workflow.
