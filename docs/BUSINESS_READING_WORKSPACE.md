# Business reading workspace

The Team reading desk now supports direct document links and a more comfortable published-text reader, while preserving the existing explicit acknowledgement and source-version checks.

## Direct links and navigation

Opening guidance sets `?document=<UUID>` in the reading-desk URL. Reloads and browser Back/Forward keep the selected document or return to the list. The link fetches the current published wording, not a historical version. Sharing a link does not grant company membership or document access; the existing API checks the current reader's company and published audience.

Only complete document UUIDs are accepted by the client, with uppercase values normalized. Malformed values show a reading-list warning without requesting an arbitrary document path. Opening a valid but unavailable document still goes through the server and its existing error response. Selecting team coverage clears the document selection. Reading state resets when the company or role changes.

## Reader display controls

- Choose regular or larger text, using the existing design scale.
- Expand the reading area to use the full page height instead of a nested scroll region.
- Navigate up to twelve contiguous passages derived from the publication's paragraph boundaries.

The reader uses a comfortable line width. Passage navigation scrolls and focuses the original text; it does not summarize, edit, omit or mark passages as read. Grouping preserves every source character, including whitespace. An outline label uses a short literal source excerpt rather than an invented heading. When a document has more than twelve paragraphs, neighboring paragraphs are grouped into at most twelve passages.

The displayed estimate counts whitespace-separated words and explicitly assumes 200 words per minute. It is a rough reading aid, not a language-aware timing model, a timer, or evidence of comprehension. Preferences stay within the mounted reader and reset when it is left or the page reloads. They are not stored as employee activity or sent to a model.

## Explicit acknowledgements

Opening a link, navigating passages, changing text size or expanding the source does not record an acknowledgement. The original self-confirmation checkbox and button remain required. The server continues to compare the publication's content hash, so changed guidance must be reloaded and read before a current receipt can be recorded. AI reading guides remain a separate explicit action with their existing source citations and quota; this batch adds no model call.

## Refresh ordering correction

The old list and team-coverage refresh code protected successful responses with a generation counter but handled failures outside that guard. An older failed request could therefore overwrite a newer successful view with an error. Successes and failures are now committed only by the current request. Document reads have the same generation guard, and stale or unmounted requests cannot reset the current source, confirmation or AI guide. Current read failures still clear the confirmation and guide and show an error.

## Design and verification

The reading list has an original book illustration and refreshed publication cards. The reader uses existing components, typography, focus styles and finite motion preferences. The underlying published text remains plain text, including any literal markup; it is never rendered as HTML.

Tests cover exact passage reassembly, mixed line endings and Unicode, bounded outlines, empty input, fixed-rate estimates and malformed direct links. A browser flow uses a real company and publication to verify URL reload/history, exact DOM source text, focus navigation, display controls, invalid links, no Business writes or reading receipt from those controls, and delayed failures after successful list/coverage refreshes. Desktop and mobile dark/reduced-motion views receive accessibility and overflow checks and screenshots.

The existing multi-user reading flow also runs: published text excludes private drafts, optional AI help does not acknowledge, receipts require explicit action, changed wording conflicts are respected, withdrawal removes the current receipt and admin coverage updates. The review inbox browser flow runs alongside it. Business unit tests, design rules, application/E2E types, targeted lint, the client/SSR/prerender build and unchanged bundle budgets are checked.

No backend endpoint, database migration, dependency, entitlement, external delivery or Personal feature changes are included.
