# Business review inbox design and request handling

The Business review inbox now provides a clearer queue for independent workflow checkpoints, with an original vector introduction, due-status badges, compact summaries, role/search discovery and explicit ordering. It remains an entry point into the existing evidence-review workflow, not a place to approve or change hiring outcomes automatically.

## Filter request correction

Previously inbox loading shared the same action lock as mutations. Changing the server view while a refresh was pending could drop the new load entirely. The older response could then appear beneath the newly selected filter.

The inbox now has its own lazy page and read lifecycle. Each effect has an active-response guard, and data is tagged with the view that produced it. Changing views can start the new request immediately; earlier responses and errors are ignored after cleanup. The selected view hides older-view data while its request is pending. A failure removes the previous queue and offers Retry. Manual reminder scans retain their own lock, error and notice state; their completion refreshes whichever view is currently selected.

The checkpoint evidence/decision panel remains in `WorkflowReviews.tsx`. The server's reviewer eligibility, company/job scope, independent review, consent and reminder limits are unchanged.

## Finding work within the loaded page

The server views remain all pending, overdue and paused reminders. They are applied by the API before the 50-request cap. Within the resulting page, reviewers can:

- Search role and checkpoint titles with case-insensitive literal terms, bounded to 120 characters.
- Select a role present in the loaded page.
- Order by due date, oldest request or role title.
- Reset these local controls without changing the selected server view.

Summary counts, role choices and search results explicitly cover the loaded page. A truncation warning explains that the API may have more current requests and that resolving work and refreshing exposes subsequent requests. Local search never claims to search the entire company queue. If a selected role disappears from a refreshed page, the selector says it is outside this loaded view, rather than silently widening the filter or appearing to select all roles.

## Dates and signals

Cards show the API's overdue signal, UTC due dates and the request timestamp. Active reminder pauses use the current browser timestamp and display the end time in the user's locale. Expired or invalid pause values do not count as currently paused. Due-today and undated labels help distinguish planned work without inventing an urgency score or candidate ranking. Refresh rechecks current assignments and server signals; the page is not a live subscription or clock.

The existing checkpoint links still open the frozen evidence and history before a named reviewer records a decision. Queue discovery issues no mutation, model call, external message or decision. Only an owner/admin's explicit reminder-scan button invokes the already-existing internal notification scan.

## Design and verification

The layout uses the existing Business shell, design tokens and components. Its vector illustration is decorative, describes review preparation, and does not represent live progress or an approval. Finite entrance motion honors reduced/off preferences. Empty states distinguish an empty server view from an unmatched local search; errors do not masquerade as empty queues.

Discovery tests cover literal matching, role scope within the input page, due/request/title ordering, source-array preservation and pause expiry. The browser presentation test uses an explicitly mocked inbox page to exercise delayed out-of-order responses, quick server-view changes, failure/retry recovery, local controls, a 50-row truncation signal and a role disappearing on refresh. It verifies desktop/mobile dark/reduced-motion accessibility, overflow and the absence of Business API writes during discovery.

The real multi-user review integration runs alongside that presentation test: invitation, due-date setup, an actual internal reminder, personal pause, independent handoff, retained evidence and a human approval. The Business Jobs browser flow also runs alongside it. Application/E2E TypeScript, targeted lint, Business unit tests, design rules, the production client/SSR/prerender build and unchanged bundle budgets are checked.

This batch adds no backend endpoint, migration, dependency, entitlement, external connector or Personal feature change.
