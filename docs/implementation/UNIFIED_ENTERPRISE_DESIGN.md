# Enterprise visual language and connected Today

2026-10-21. Base982099e5 (owner-merged PR448). Branch orbit-enterprise-visual-language-2026-10-21. IMPLEMENTED / UNVERIFIED.

## Direction and scope

Owner explicitly asked to replace the purple appearance with an enterprise design. This supersedes the earlier purple/deep-space preference. Original Orbit geometry remains; IBM Plex Sans is the shared body/heading/wordmark default across web and desktop; the default is now warm paper (#F5F5F4), graphite (#101214), neutral opaque surfaces and Slate blue (#365F80 at accent600). Accent is for the next action, links, selection and focus. Status labels remain textual; stage marks move to neutral/steel, with offer green. No hired-probability or fictitious progress graphic is introduced.

Changes span shared tokens/preset, appearance preferences, PageHeader, OrbitLogo, web theme metadata, public site surfaces, SVG favicon/offline page, Today, My Career, Prepare, career identity, Discover heading, Opportunity Room header and timeline marks. Shared web/desktop/business components inherit visual tokens; business records, navigation, Saba/provider behavior and permissions are not merged into personal context.

## Design decisions

- One foundation: current indigo utility classes continue to read accent CSS variables. Do not mass-replace class strings or create a second component library. Neutral zinc values lose the violet cast. App and public dark surfaces use matching graphite values.
- Default accent becomes slate. Existing saved nebula (the former default) resolves to slate at load; nebula remains a compatibility palette alias with the same values and is hidden as a duplicate swatch. Other explicitly selected colours remain available. No stored resume-template colors are rewritten. Text size/motion/theme preferences remain separate. Appearance swatches are solid, wrap when needed and use existing keyboard interaction.
- Shared panel names stay compatible, with opaque surfaces and no glass blur. The global body no longer paints a colour wash. The existing SpaceBackdrop/CosmicBackground slot is now a static neutral canvas, including desktop, without star/orb layers or their loops; its class/export stay compatible with desktop glass-mode hiding. Menus/dialogs/toasts retain their existing elevation. No font, animation, image or UI dependency added.
- Shared logo uses the existing vector geometry with a solid accent and decorative animation opt-in; explicit busy state retains its activity behavior. SVG favicon/offline page follow the palette. Existing binary PWA/native icons and social-preview assets are not regenerated; their visual alignment is remaining work, not a completed asset rollout.
- Shared PageHeader and workspace-* structure unify heading hierarchy, whitespace, dividers, surface roles and descriptive text. No new provider/model/authorization/data authority.

## Today: connected operational layout

Before: equal horizontal stage shortcuts separated the next-action card from the application list. Generic Apply/Interview links returned to the tracker without carrying a selected opportunity.

After: the existing deterministic next action and small priority queue lead the main column; saved opportunities use compact rows with employer, title, recorded status/date and explicit room action. A secondary journey rail uses descriptive steps and job-bound existing tab links (resume/practice/interview/offer) when a role is selected or only one active role exists. Multiple roles remain independent. With no selected role the same links lead to general tools. This is navigation, not a completion inference, new artifact association or forced wizard.

The list selector is explicitly labelled as list scope. Copy explains that the next-action planner considers the whole search, while shortcuts follow the shown opportunity. No change to server ranking, deadlines, polling cadence, source ownership, source approvals, submission status or automation consent. Undated/invalid dates sort after real dates with stable ID ordering; invalid dates are not printed. Existing account-scoped async/auth boundaries remain in place. No private text added to URLs, storage or telemetry.

The next-action heading is h2 on Today, with existing saved-source reason/date and one primary CTA. Empty/load/error states stay real; placeholder bars do not invent metrics. No additional primary destination. Advanced activity/permissions/weekly tools remain disclosed in the rail.

## Accessibility, motion and responsive intent (not proof)

One-column content below the wide desktop breakpoint, a bounded secondary rail on wide screens, wrapping opportunity rows and text, native ordered navigation/disclosures, visible existing focus styles and minimum-height links. No stage is communicated only by colour. Existing Full/Gentle/Off and live OS motion handling remain authoritative. New workspace styles add no animation loop, and retain normal document scrolling rather than nested page scrolling.

No viewport/theme/zoom/contrast/keyboard/screen-reader/motion inspection has been run. Existing screenshots predate this design. Do not call this WCAG-certified, pixel-verified or performance-tested.

## Research used (ideas only)

- [Atlassian design tokens](https://atlassian.design/foundations/design-tokens): shared named design decisions across themes.
- [Atlassian colour](https://atlassian.design/foundations/color): neutral surfaces and purposeful saturated emphasis.
- [Carbon colour](https://www.carbondesignsystem.com/building-blocks/foundations/color/overview): role-based UI shell and theme structure.

Public documentation was read on2026-10-21. No external code, component library, brand asset or UI design was copied. These sources inform direction; they do not validate Orbit's implementation.

## Verification, rollout and rollback

Owner says NO TESTING. No tests, typechecks, lint, builds, browser visits, screenshots, contrast tools, provider calls, native checks or migrations were executed. Source inspection/edits plus Git/PR operations only. Python invocations edited text files; one initial uv invocation synchronized its local environment automatically, then subsequent edits used --no-sync; no Orbit runtime/check command was executed.

No schema/migration, new endpoint, server data write, background AI cost, dependency or production deployment in this PR. No workflow/required gate weakened, no skip-CI marker or rerun requested. Automatic remote CI is not a local validation pass; prior billing limitations remain an external gate.

Rollback: revert this visual/navigation slice; no database rollback. Old nebula storage values remain intact on disk, so an older build reads its previous palette. A slate preference saved by a new build falls back to the older build's default if rolled back. Existing route URLs and query aliases remain.

Deferred acceptance when the owner permits: compile/type/lint/test, initial paint and persisted preferences across web/desktop, old nebula/custom choice/blocked storage, 0/1/20 opportunities, wrong/deleted job and account switch, global-vs-list action scope, all room tab aliases, 320/360/390/768/1024/1440/1920, light/dark/200% zoom/keyboard/screen reader/Full/Gentle/Off, actual contrast of every changed token/status, screenshot manifest and bundle/performance budgets. Known prior backend/migration/provider/dependency/operator gates remain open. Production NO-GO; open draft PR for review, do not merge/deploy automatically. The full redesign and remaining V6 phases are not complete.
