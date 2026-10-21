# Product transformation review: resume to hired (21 October 2026)

An end-to-end audit of the signed-in product against the "AI-powered resume-to-hired platform" brief, external
research, a prioritized roadmap, and the slice implemented in this change. Design guidance came from three installed
skills: impeccable (audit, distill and polish passes, and its detector), emil-design-eng (interaction and motion
restraint) and design-taste-frontend (app-screen rules).

**Method:**
- The API and web app ran locally on current `main` (#451).
- A new personal account was registered.
- Playwright visited 19 signed-in routes at 1440×900 and 5 at 390×844, recording:
  - headings and titles;
  - sideways overflow;
  - console and page errors;
  - load time.
- Screenshots were read page by page.
- Findings below are what was seen, not assumed.

## 1. Product audit

### What already exists (do not rebuild)

The brief's seven stages are already covered. The list maps each stage to the code that covers it, so later work
connects to it instead of duplicating it.

| Stage in the brief | Already in Orbit |
|---|---|
| Smart onboarding | `/welcome` questions; resume import/parse (`resumes/`); career identity with a reviewed master resume (`pages/career/CareerIdentity.tsx`, `job_portal/candidate_identity.py`); career goals (`/jobs/profile`) |
| Resume intelligence | Resume Studio, ATS score and fixes, bullet strength, "How an ATS reads it", tailoring and the tailoring queue (`resumes/tailor_queue.py`), versions and lineage (`job_portal/resume_lineage.py`), cover letters, Evidence Vault |
| Job discovery | Feed from company career pages and boards (`job_portal/sources`), ranking, natural-language search (`search_parse.py`), duplicate fingerprint and "also posted on", explainable fit with real quotes (`job_portal/fit.py`), alerts |
| Assisted applications | Browser extension with review-first autofill, auto-apply agent with consent, limits and review queue (`auto_apply/`), application packets and screening answers |
| Tracking | Tracker, Kanban stages, journey timeline, duplicate-application refusal (`POST /tracker/manual` → 409 `already_tracked`), reminders, pasted-message stage updates (`job_portal/message_updates.py`), calendar intake, "Your search, in numbers" funnel (`SearchInsightsPanel.tsx`) |
| Interview prep | Saba mock and video interviews, company styles, STAR story bank, answer bank, loop memory, delivery coach, prep plans with countdown, Copilot |
| Offers | Offer AI: breakdown, in-hand pay, comparison, negotiation practice and counter-offer email |

### Issues found and fixed in this change

1. **Three layers of navigation on job pages.** Discover, Applications and People showed, in order:
   - the sidebar (Discover / Applications);
   - an in-page tab strip repeating it (Launchpad / Find jobs / Applications / People);
   - a row of tools;
   - a "Find a tool" button.

   "Applications" appeared twice on one screen.
2. **"All tools" used the house icon**, the same as Today.
3. **Main actions drawn as underlined links.** My Career's first step (Import my resume / Build from scratch / Explore
   jobs first) was three equal text links, so the most important action had no visual weight. Today's empty
   "Opportunities in motion" card had the same problem.
4. **A "Personal workspace" label above every page heading**, saying nothing the heading didn't.
5. **The cookie notice covered the sidebar's Settings link** on desktop for signed-in users.
6. **The Business switch:**
   - It used a Unicode glyph ("⇄") instead of a drawn icon.
   - Its label took a large part of the phone top bar for every personal user.
7. **An empty "Choose a saved resume" panel opened by default** on My Career when there were no resumes to choose.
8. **A failing UI test on `main`** (`design.test.ts`): it still expected the old "nebula" default after Slate blue
   replaced it.
9. **Documentation drift:** `docs/DESIGN.md` → "Navigation (web)" described the old grouped sidebar, not the current
   five-task navigation.

### Issues found, not fixed here (see roadmap)

- **Eyebrow labels on most panels** ("Recommended next action", "Career identity", "Your journey").
  - They are part of the owner's current editorial direction (`docs/DESIGN.md`, 21 Oct), so they stay.
  - The impeccable craft floor discourages them, so the owner should decide on them as a system-wide choice.
- **Overlap between Today, the Career launchpad (`/jobs`) and My Career.** All three show "where you are in the
  search" and a start-here set of actions.
  - Merging them is a product decision with routing and test impact.
  - Here the launchpad is now reached from Discover's tools instead of a top-level tab.
- **Every route takes about 1.7–2.3 s to settle locally** (Vite dev, SQLite, no CDN). That is a dev-server figure,
  not a production one. Production LCP, CLS and INP still need measuring.
- **The detector flags `text-indigo-*` as an "AI colour palette".** This is a false positive: `indigo-*` is the token
  name the preset maps to the Slate-blue accent.

## 2. Research findings

Products, read through 2026 comparison articles (mostly vendor or affiliate blogs, so treat them as approximate):

- **Teal and Huntr:** trackers with resume tools and a save-job extension.
- **Simplify:** strongest free autofill, paid "Autopilot" credits.
- **Jobright:** matching and insider-referral suggestions.

Orbit already matches or exceeds each of these in its own area:
- tracking with real-quote fit explanations;
- review-first autofill;
- contact finder;
- interview practice, which none of them has.

Sources:
- [Rework: best AI tools for job seekers 2026](https://resources.rework.com/tools/ai-tools/best-ai-tools-for-job-seekers-2026)
- [Jobright vs Simplify](https://jobsaicopilot.com/jobright-vs-simplify/)
- [Glever: AI job application tools](https://glever.co/blog/best-ai-job-application-tools)
- [7 AI-assisted job search sites](https://bestjobsearchapps.com/articles/en/7-best-aiassisted-job-search-sites-for-2026-huntr-simplify-careerflow-more)

GitHub, judged for usefulness, upkeep and licence (concept references only; no code copied):

| Repository | What's useful | Note |
|---|---|---|
| [srbhr/Resume-Matcher](https://github.com/srbhr/Resume-Matcher) | Master resume + JD → tailored resume; embeddings and vector search topics | Active (Oct 2026). Orbit already adopted its tailoring-queue idea |
| [mugunthank7/MatchMyJD](https://github.com/mugunthank7/MatchMyJD) | Evidence-aware scoring, semantic embeddings, explainable gaps | Supports the roadmap item "semantic matching" below |
| [MahmoudElnahal/ats-resume-matcher](https://github.com/MahmoudElnahal/ats-resume-matcher) | Sentence-transformer embeddings for resume ↔ JD | Small; idea only |
| [torontodeveloper/job-application-agent](https://github.com/torontodeveloper/job-application-agent) | Playwright fills Greenhouse/Ashby/Lever, then stops for the human to submit | Same consent model as Orbit's auto-apply |
| [dutta-bikram/AI_autofill_agent](https://github.com/dutta-bikram/AI_autofill_agent) | Review table with a confidence score and the source of every filled answer | Worth adopting in the review queue (roadmap) |
| [Pickle-Pixel/ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) | Six-stage autonomous pipeline | AGPL-3.0 and auto-submits: not compatible with Orbit's consent rule |
| [browser-use](https://github.com/browser-use/browser-use) | General browser agent framework | Orbit's form agent uses Playwright directly; no need to switch |

Earlier research rounds are in `docs/PERSONAL_WORKFLOW_RESEARCH_2026_10.md` (Career Ops, JobOps, ApplyTrail and
others) and `docs/ORBIT_UX_FEATURE_ROADMAP.md`.

## 3. Roadmap (prioritized)

Ordered by user impact ÷ effort, with risk noted. Nothing below is built yet.

| # | Item | Impact | Effort | Risk / dependency |
|---|---|---|---|---|
| 1 | **Merge Today, the Career launchpad and My Career's "start here"** into one start surface (Today), with My Career only for identity and goals | High: removes the biggest remaining overlap | M | Route redirects (`/jobs` → Today), tests in `pages/jobs` and `pages/home` |
| 2 | **Semantic match score** next to the keyword score: embed the master resume and each posting (one cached vector per posting), show "similar in meaning" alongside the quoted-requirement fit | High | M–L | Embedding provider cost, a vector column (pgvector) or in-memory index; keep fit quotes as the source of truth |
| 3 | **Confidence and source per autofilled answer** in the auto-apply review queue (after AI_autofill_agent) | Medium–high: safer approvals | S–M | `auto_apply/review.py` already stores answers; add source and confidence fields |
| 4 | **One weekly email** of the daily and weekly actions that already exist (`job_portal/actions.py`, `weekly.py`), opt-in | Medium | S | SMTP is configured; needs a preference and unsubscribe |
| 5 | **Recruiter-view preview**: the parsed "How an ATS reads it" plus a 6-second skim layout | Medium | S | Reuses `atsReading.ts` |
| 6 | **Decide eyebrows as a system rule** (keep or drop) and apply it in one pass | Low–medium | S | Owner decision |
| 7 | **Measure production LCP, CLS and INP** on Today, Discover and Resume Studio; set budgets in CI once Actions billing is fixed | Medium | S | GitHub Actions is currently blocked by billing |

## 4. AI automation strategy

Orbit's existing agents already follow the brief's rules:
- the user approves before anything is submitted or sent;
- quotes are checked against the source;
- daily quotas apply;
- nothing invents qualifications or statuses.

These agents are:
- the auto-apply planner, form agent and review queue (`auto_apply/`);
- the next-step companion (`workflow_ai.py`, `workflow_advice.py`);
- the opportunity coach and requirement practice (`job_portal/opportunity_coach.py`, `requirement_practice.py`);
- the pasted-message updater.

The workflows the brief describes map onto them:

- **Resume to application:**
  1. Import the resume and confirm the master (career identity).
  2. Discover jobs, ranked and with explainable fit.
  3. Run the tailoring queue.
  4. Build the application packet.
  5. Review it in the queue; the user approves.
  6. The tracker records it.
- **Interview scheduled:**
  1. Calendar intake or a pasted message records the round.
  2. Prep plan with countdown, plus company research and loop memory.
  3. Saba mock interview.
  4. Review the session report.
  5. Draft a follow-up.
- **Rejection:**
  1. A pasted message marks the job rejected (after confirmation).
  2. The search funnel and weekly plan show where the search stalls.

Missing pieces, all on the roadmap:
- semantic matching (#2);
- a confidence and source column in the review queue (#3);
- a proactive weekly digest (#4).

Each of these keeps the same contract: visible progress, pause and cancel, user approval for anything outward-facing.

## 5. Implementation results (this change)

| Change | Where |
|---|---|
| One navigation layer on job pages in the personal shell: the area tab strip hides where the sidebar already names the area; Discover's tools gain "Launchpad"; Applications' tools gain "People" | `apps/web/src/pages/jobs/WorkspaceNav.tsx`, `pages/jobs/workspace.ts` (+ test) |
| "All tools" gets its own icon (grid), no longer the Today house | `apps/web/src/components/nav.ts` |
| My Career's first step: "Import my resume" is the primary button, "Build from scratch" secondary, "Explore jobs first" a link | `apps/web/src/pages/career/CareerIdentity.tsx` |
| Today's empty opportunities card: "Discover opportunities" is a secondary button | `apps/web/src/pages/Home.tsx` |
| Removed the "Personal workspace" label above Today, Prepare and My Career headings | `pages/Home.tsx`, `pages/CareerSpaces.tsx` |
| Cookie notice sits bottom-right beside the support button for signed-in users from `md` up, so it no longer covers Settings | `apps/web/src/components/CookieNotice.tsx` |
| Business switch: a drawn icon instead of "⇄"; the word shows from `sm` up | `apps/web/src/components/WorkspaceSwitch.tsx`, `packages/ui/src/icons.ts` |
| The "Choose a saved resume" picker shows only when there's a resume to choose | `pages/career/CareerIdentity.tsx` |
| Fixed the out-of-date design-prefs test (legacy "nebula" loads as Slate blue) | `packages/ui/src/design/design.test.ts` |
| DESIGN.md navigation section brought in line with the five-task navigation | `docs/DESIGN.md` |

No API, data model or route changes. Every old address still works.

## 6. Quality verification

**Checks run:**
- Web: `tsc` and eslint are clean. Vitest: 601 passed (including the updated `workspace.test.ts`). `vite build` succeeds.
- `packages/ui`: vitest 595 passed (one failure that was already on `main` is fixed). `tsc` is clean.
- Desktop: `tsc` is clean.
- impeccable `detect` on the changed files reported only the token-name false positive described above.

**Browser checks (Playwright, signed in):**
- These routes render with no sideways overflow at 1440 px and 390 px, and no page errors:
  - `/`, `/jobs/matches`, `/jobs/tracker`, `/jobs/outreach`, `/jobs`, `/career`, `/prepare`.
- The job pages show one navigation layer.
- "All tools" shows its grid icon.
- The cookie notice clears the sidebar.
- My Career's first step shows a primary button.

**Not verified:**
- the desktop app's own screens;
- production performance;
- GitHub CI, which is blocked by account billing, so it did not run.

## 7. Future opportunities

Beyond the roadmap:
- **Career transition analysis:** transferable skills from the evidence vault to a target role.
- **Portfolio page generation** from the master resume and confirmed evidence.
- **Experiments on the search itself:** for example, tailored versus untailored applications, measured in the
  existing funnel.
- **Salary planning** across offers and target roles, using the Offer AI market data already collected.
