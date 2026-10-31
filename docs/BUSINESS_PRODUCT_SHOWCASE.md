# Business product showcase and launchpad

The public `/business` page now introduces the shipped Business workspace rather than only the original applicant tracker. An original vector system illustration connects planning, attraction, coordination and learning. Four selectable workflow tours show team responsibilities, while a dedicated AI section describes drafts, source evidence and reviewable summaries. Every graphic is labeled as illustrative; it contains no live customer data or performance claims.

## Tool discovery

The directory describes 15 existing Business workspaces. Search combines terms with the selected work category. Each entry explains its purpose and, where applicable, its AI assistance. Public links open the company chooser with an allowlisted relative tool destination. The chooser now supports all cataloged tools plus the launchpad and new-job editor; external URLs, traversal and unknown input are ignored.

Signed-in teams find the same directory at `/business/app/:cid/launchpad`, reachable from Business navigation. It uses the company's API-provided permissions to display workspace links. Restricted entries explain that an owner or admin can help coordinate access. This is discovery guidance, not authorization: existing API role checks, company boundaries and plan limits still apply inside each tool. No new provider integration, model, entitlement or automated hiring decision is introduced.

## Rollout planner

Public visitors and signed-in teams can select one of four curated goals:

- Launch a role.
- Unblock the team.
- Build a talent community.
- Align team knowledge.

Each goal provides four steps with suggested owners, concrete readiness criteria and links to shipped workspaces. The `rollout` query parameter remembers the selected goal; malformed values fall back to role launch. Checkmarks are isolated by goal, remain only in component memory, and reset when the page is left or reloaded. They are neither company records nor evidence of completed setup. Downloads include the selected checklist and its self-reported checkmarks as Markdown, with these limitations stated in the file. No personal information, browser persistence, network write, or model call is needed to plan or export.

This planner does not create a Workflow Studio playbook or run, assign real people, publish policies or jobs, approve hiring requests, or send messages. Team members use its workspace links to perform those actions through the existing tools. Role-specific access may require a colleague's participation. Public goal selection and checkmarks are not transferred through account creation; download the plan before leaving.

## Design and delivery

The page uses original inline vector artwork, icons, product illustrations, existing design tokens and finite entrance/hover animations. It adds no stock photography, third-party image fetch, animation library, tracking, dependency or database migration. Motion uses `motion-ok` gates and existing fade behavior for reduced/off settings. All workflow information also appears as HTML; decorative illustrations are hidden from assistive technology. The public page, directory, checklist and FAQ render into the existing static HTML/Markdown build. Metadata and structured product descriptions match the expanded page.

## Verification

- Catalog tests cover permission-sensitive discovery, goal isolation in exports, combined search, malformed goal fallback and allowlisted destinations.
- Browser coverage exercises the workflow tour, plan navigation, goal-specific checkmarks, reset, actual Markdown download, directory empty/results states, dark mobile layout, accessibility and reduced-motion graphics.
- A signed-in browser flow creates a disposable company, opens its launchpad through the chooser, confirms planning edits make no Business API writes, and follows the real talent-community route.
- Existing design-rule tests, metadata/prerender tests, TypeScript, targeted lint, the production/prerender build and unchanged bundle budgets are checked.

Current limits: checklist progress is session-local, there are no shared assignments or team status reports, and this does not evaluate live AI output quality. Existing Workflow Studio remains the place for saved playbooks, real owners, independent reviews and audit history.
