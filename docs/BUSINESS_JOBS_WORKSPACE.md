# Business jobs workspace

The Business jobs page now supports discovery and prioritization across the roles a member can access. It replaces the previous status-only table with a responsive card view and retains an explicit table view for comparison.

## Find and organize roles

- Search title, department, location and workplace text with case-insensitive terms. All terms must match somewhere in the role's searchable text; this is literal search, without Boolean operators or AI ranking.
- Combine status chips with the “Jobs with new applicants” checkbox.
- Sort by recent update, new applicants, total applicants or job title. Ties use update time and role ID for consistent ordering.
- Switch between cards and the stacked mobile table. Open a pipeline from either view; permitted editors can open a role's existing editor directly from a card.

Portfolio counts and status-chip counts cover the entire list returned by the API for the current member. The results label states how many of those jobs match the current filters. “New applicants” uses the API's existing count of active applications in the role's first application stage; it does not mean a new time-based notification or contact attempt.

The illustrated empty state offers an appropriate next step for editors and for members awaiting assigned work. An unmatched filtered view keeps the discovery controls visible and offers a reset. Refresh retrieves current list data and counts; there is no live subscription or cached result service.

## URL behavior

The query parameters `status`, `q`, `sort`, `display` and `new` preserve the current view through reloads and browser Back/Forward. Typing replaces the current history entry; deliberate status, sort and display changes create history entries. Search input is bounded to 120 characters. Unknown status, sort and display values fall back to the normal defaults. Reset clears recognized view parameters and keeps unrelated URL parameters.

Controls update immediately while the router commits URL transitions. A reference to the latest intended parameters composes fast interactions, so typing just after selecting a status does not discard that status. Committed navigations synchronize the controls before paint, including browser history changes. Native checkbox state stays responsive during those transitions.

These URLs contain the company path and staff-entered filter text. Sharing a URL does not grant access: the destination still requires sign-in and current company permissions. No server-side saved view, cross-company search or automatic sharing is introduced.

## Loading and editor separation

`JobsList.tsx` is a separate lazy route from `Jobs.tsx`, which now contains the editor. Browsing and filtering roles does not request the editor module. The existing editor, assistant, saving and publication flows remain in their own route. The list's refresh effect now clears previous errors, guards late responses after unmount, and reloads when the company role changes. A successful retry therefore displays the recovered list instead of retaining the old error.

## Scope and verification

The existing jobs endpoint remains authoritative for accessible roles and applicant counts. Filters operate on that returned list and do not add API mutations, model calls, status changes, candidate messages or application actions. This batch adds no database migration, dependency or Personal feature change.

Pure discovery tests cover combined matching, malformed URL values, bounded input, stable ordering, non-mutating sorting and counts. The browser flow uses real disposable company/job records and a controlled fetch failure to check retry recovery, rapid filter composition, reload and Back/Forward behavior, card/table parity, empty results, desktop/mobile dark/reduced-motion accessibility, overflow and the handoff to the unchanged editor. It also asserts that discovery produces no Business API writes and that the editor module is absent from list browsing requests. Public Business showcase, company launchpad and dashboard/navigation browser flows run alongside it.

Application and E2E TypeScript, targeted lint, Business unit tests, design rules, the production client/SSR/prerender build and unchanged bundle budgets are checked. Browser fixtures use local APIs and test providers; this does not evaluate live AI output quality or external delivery.
