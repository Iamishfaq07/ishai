# Business workspace design

This pass improves the signed-in Business shell, dashboard and launchpad. It preserves the shipped tools and existing API authorization rules, and does not change Orbit Personal.

## Finding workspaces

The previous navigation exposed 19 items as a flat desktop list and a horizontal strip on mobile. The new navigation groups those same destinations into Overview, Hiring, Coordination, Relationships, Knowledge and Company. Search matches the workspace label and purpose group, after applying the same role/capability rules as the previous shell. It never expands a member's access.

The desktop sidebar stays within the viewport and scrolls independently for long workspace lists. The company card shows the current role and verification status. A Business launchpad link replaces the previous sidebar's Personal weekly-studio suggestion, keeping this company navigation focused on company work. The existing header workspace switch remains available.

On mobile, a native disclosure shows the current workspace and opens a searchable vertical menu. Nested job pages still identify their Jobs parent through path boundaries. Navigation closes the menu, clears its search, and moves keyboard focus to the stable main content container. Escape closes the menu and returns focus to its summary. Browser history changes close the disclosure too. This is an inline disclosure, not a modal or overlay with a focus trap.

## Dashboard and launchpad

Both pages now have a dark introduction panel with original vector artwork and direct links to the relevant Business workspaces. The diagram illustrates planning, review, team coordination and knowledge; it does not show live completion, verification or hiring outcomes. Labels and explanatory HTML carry the same message without relying on the artwork.

The dashboard adds role-aware next-step cards, a clearer empty-jobs panel, responsive metrics and visual source/funnel bars. Counts, percentages and links remain present as text. Source shares and job-stage bars use the existing API values, without generated performance statistics. The daily chart retains its exact-values table and zero baseline; its integer scale now avoids repeating the same tick for a one-applicant chart.

Business page titles use a consistent desktop size and more readable subtitles. The header uses an original orbital mark. Existing motion tokens govern finite graphic entrances, icon hover feedback and the menu chevron; reduced/off preferences remain effective. There are no decorative animation loops, image downloads or new animation dependencies.

## Interviewer dashboard correction

The existing dashboard requested company analytics for interviewers even though the server rejects that role with 403. The client now skips the forbidden request and presents an interview-work panel with a link to the existing hiring desk. It shows no company metric placeholders or fabricated zeros. The server's authorization behavior is unchanged.

## Verification and limits

Navigation tests preserve the established owner, hiring-manager and interviewer gates, combined label/group search, and exact/nested route matching. Browser coverage checks a real disposable company's empty dashboard, then its published job and confirmed local application, visual source/funnel data, desktop search, mobile navigation and Escape/focus behavior. The interviewer branch uses an explicitly mocked company presentation response to verify that the UI makes no analytics request; it is not a substitute for server authorization testing.

Public showcase, company launchpad and candidate/recruiter saved-search browser flows run alongside the new design flow. Desktop and mobile dark/reduced-motion screens receive accessibility checks, overflow checks and screenshots. Business unit tests, existing design rules, application and E2E TypeScript, targeted lint, production client/SSR/prerender build and unchanged bundle budgets are checked.

No backend endpoint, model, database migration, entitlement, notification or provider connection is added. The dashboard is still a fetched view rather than a live event subscription. The navigation's role-aware visibility is guidance; destination APIs remain authoritative.
