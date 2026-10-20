# Personal application inbox

The existing `/jobs/applications` review queue now supports finding and understanding saved applications without adding a navigation destination.

## Find and return to an application

- Search by role, company, site or next-step wording. Multiple words must all match.
- Filter by **All**, **Needs action**, **In progress**, **Applied** or **Not proceeding**.
- Sort by next action, recently updated or oldest update. Unknown outcomes and required input come first in the default order; cancelled records stay in history.
- Search, view and sort are stored in `q`, `view` and `sort` URL parameters. Typing replaces the current URL entry; selecting filters and opening a packet support Back/Forward. Unrelated query parameters remain intact.
- Opening a packet works independently of the list filters, including existing emailed links. Closing it retains the search. A new packet gets a new detail component instance, keeping draft questions and retry confirmation separate.
- Empty search results offer a reset. Initial list failures offer retry instead of showing an empty inbox or setup prompt.

Search operates on the loaded API response, which retains the existing 200-record cap. The count explicitly describes loaded applications. Employer interviews and offers remain in the tracker, linked alongside these filters.

## Understand the current state

Every row explains its next step. The detail panel has a three-stage graphic: **Prepare**, **Apply**, **Result**. Only the stage derived from the saved packet state is highlighted. It is not a completion percentage, hiring probability, or set of completed milestones.

- Prepared materials are labelled as prepared, including the PDF preview.
- A lease means processing; submission is not yet confirmed.
- A self-reported manual application is identified separately from an Orbit-recorded submission. Its saved materials are not claimed to be the employer's received payload.
- Unconfirmed attempts explicitly ask the candidate to check the employer site and email. Failed or expired states do not imply certainty that nothing was submitted.
- Retry still requires the existing confirmation tied to the packet ID and update timestamp when submission is uncertain. No retry, approval or external action is triggered by search, sorting or the stage display.

`submission_uncertain` is now included in the owned packet summary as well as detail. It is computed from the existing submission-start record and confirmation status. This is an additive response field; no database migration or new permission is introduced.

## Progressive detail and accessibility

Automation status and controls are available in one disclosure. The main screen focuses on finding applications. The packet detail and optional AI second reader are downloaded when a detail panel is opened; generating AI advice still requires its existing explicit action.

Filter fields have associated labels. Result counts use an atomic `role="status"` message so changes can be announced without moving focus, following [W3C guidance on status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). Row hover motion respects reduced motion. Status meaning is expressed in words as well as colour.

## Verification

- Unit coverage includes all packet statuses, multi-word search, literal `all`/`action` queries, sort stability, invalid dates, source-array immutability, manual outcomes and uncertain attempts.
- HTTP tests verify list/detail uncertainty consistency and cross-account isolation.
- Desktop and 360px browser fixtures exercise search, filters, history restoration, empty results, prepared material wording, the retry confirmation gate, list failure recovery, accessibility and overflow. Existing focus-to-application and AI second-reader flows remain covered.
- Test scenarios use local records and mock AI. The UI confirmation test does not press Retry or submit to an employer.

The application entry bundle is smaller after moving details on demand. Existing bundle thresholds remain unchanged. No candidate usability study has been conducted for this change.
