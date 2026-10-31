# Business automation playbook drafts

The Automation Center now offers starting templates and a clearer distinction between local draft settings and the playbook used by background checks.

## Template workflow

Select a job, then choose a draft:

| Template | Internal follow-up conditions |
| --- | --- |
| Candidate response | Stalled stage after 3 days, unanswered question after 24 hours, scheduling request after 24 hours |
| Panel readiness | Missing feedback after 24 hours, completed assessment awaiting review after 24 hours, preparation check within 24 hours of an interview |
| Offer coordination | Offer review within 24 hours before expiry, accepted-offer handoff after 48 hours |

Applying a template replaces all draft rule choices and preserves the draft's selected task owner. It starts disabled and makes no API write. An existing saved playbook continues using its saved settings until an explicit save. The user reviews the enabled rules, thresholds and owner, optionally previews current conditions, then saves. Enabling background work remains an explicit checkbox choice, and the server still requires an open job.

Templates are curated settings, not AI-generated decisions or new backend triggers. All eight existing conditions remain configurable. Preview uses the existing read endpoint and creates no tasks. Saved background checks still create internal follow-up work only; they do not send candidate messages, advance applicants or make hiring decisions.

## Draft validation and ownership

Enabled thresholds are represented as editable strings until validation succeeds. Clearing a number keeps its rule enabled and shows a validation issue, rather than silently turning the rule off and disabling its input. Preview and save require integer thresholds within the existing per-rule limits. Disabled conditions convert to `null` in the existing API recipe.

Unavailable default owners remain visibly selected with an explanatory option. The user must choose a current coordinator or Unassigned before saving. A checked automation enable control can be unchecked while a job is paused or closed, fixing the previous UI state that prevented disabling an already-enabled playbook in that situation.

## Saved revisions and manual runs

Local drafts retain their reviewed base revision. A queue refresh no longer remounts the editor solely because another user saved newer settings. Instead, it preserves the local draft, displays the changed-source notice and blocks preview/save/manual run until the current saved settings are explicitly reloaded. The draft can be downloaded before that reload. Save still passes the frozen base revision to the unchanged server conflict check.

Manual runs are also disabled while the local draft differs from its saved reference. This avoids interpreting a run of saved settings as a run of the current draft. Discard restores the reviewed saved values. Successful saves and runs update the editor's confirmed source from the API response, while a subsequent queue refresh updates the surrounding view.

The draft download is JSON working data with job ID, reviewed/latest revision, string threshold fields and validation issues. It is not an importable server recipe or a shared saved template. Drafts remain local to the role view; changing roles, leaving or reloading the page loses local edits unless downloaded. Action locks and unmount guards prevent duplicate UI actions and late responses updating a departed editor.

## Queue pagination correction

Queue responses are tagged with the current company/job/status/ownership/refresh selection. A late load-more response cannot append tasks to a different selected view. A per-request token prevents overlapping pagination and ensures an older request cannot clear a newer request's loading state. Merges deduplicate task IDs. Role changes remount local automation state, and roles without automation access skip the settings/queue requests. Loading a new view no longer displays placeholder zero counts as if they were loaded metrics.

The queue remains a fetched, paginated view rather than a transactionally frozen snapshot. Existing server scope, pagination, revisions, scheduling interval, task action authorization and automation behavior are unchanged.

## Verification

Draft tests cover schema roundtrips, field-order-independent comparisons, complete template replacement, owner preservation, disabled defaults, editable empty fields and integer/range validation. Browser coverage uses real company/job settings for template preparation, no writes before explicit save, preview, JSON download, stale revision preservation/reload, explicit activation and disabling a paused role's playbook. Explicit presentation fixtures check an unavailable owner and a late pagination response after changing the queue filter.

The original desktop and mobile enterprise automation flows run alongside this coverage with real local application/task data: preview, activate, handle follow-ups and add manual work. Mobile dark/reduced-motion accessibility and overflow checks include the new template editor. Business unit tests, design rules, application/E2E types, targeted lint, the production client/SSR/prerender build and unchanged bundle budgets are checked.

No backend endpoint, migration, dependency, entitlement, AI provider, external delivery or Personal feature changes are included.
