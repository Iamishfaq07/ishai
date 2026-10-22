---
version: 1
slug: "src-pages-home-tsx"
primary_target: "src/pages/Home.tsx"
related_targets: ["src/pages/jobs/JobMission.tsx"]
---

# Surface brief: Today and the job page

Scope: signed-in Today (`/`) and each job's page (`/jobs/mission/:id`), then the shell around them. Mode: Operate. Audience and truth: PRODUCT.md. Phase 1 of the full redesign chosen 2026-10-22 (critique 22/40: Today false alarm and no focus; job page an unscannable wall).

## Direction contract

THESIS: Every job is a route and the search is the set of routes; each screen says where you are and names the next stop. Refuses the stat-tile dashboard and the tool-card catalogue.

OWN-WORLD: Trail-map paper: warm paper ground, graphite ink, contour-tint neutral steps for surfaces (tone steps, not boxed cards), one deep teal-green for the route line and the next action only, stops as ring markers on a 2px line (filled = passed, ringed = next, hollow = ahead). Humanist title face for page titles and the next-stop line; Plex Sans for UI; 13px minimum; flat, no lift, no glass.

STORY: Open Orbit, read the next stop and why, do it in one tap; scan this week's stops across all jobs; open a job and see its route and only the current stage's work.

FIRST VIEWPORT: Shell: sidebar Today, Jobs, Prepare, Me, then Copilot apart. Main: date line; "Next stop" at 32-40px title face with its reason and one teal primary button; below it the This-week route strip (dated stops across jobs, the signature move); below that "Your routes" rows, each with a mini route line. No stat tiles. Phone: same order, strip scrolls sideways, primary within thumb reach.

FORM: Route map; position 3 of my ordered list; seed:b2ba0dba1c867f9c.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions
- Exact title face and accent hex (chosen at build, checked for AA).
- Whether the Orbit mark stays (PRODUCT.md: undecided).
