# Personal Orbit career launchpad

## Candidate workflow

Open **Jobs AI → Today → Open career launchpad**, or search for fresher, student,
internship or career change in **Find a tool**. The launchpad lives inside Today;
the four main workspaces stay the same.

1. Choose student / fresher, changing careers, or next career move.
2. Choose an owned resume, edit it, open the existing student resume starter, or
   import a resume. The starter opens a chooser; following its link creates nothing.
   Education and personal projects are useful evidence without claiming paid experience.
3. Enter a role yourself or explicitly request AI role ideas. Example searches include
   customer support, graduate analysis and design, as well as software roles.
4. Review source quotes, proposed learning experiments and ways to check the learning.
   These are exploratory ideas, not live vacancies or claims of qualifications.
5. Review the role, city, experience preset and job types; explicitly save the search.
6. Continue to matching jobs, Saba practice with the chosen role carried into its
   existing setup, or the existing weekly plan.

The manual path works without a resume or AI. Resume creation/import, editing,
job matching, practice and weekly planning reuse existing product workflows. They
are not new implementations of those tools.

## Search behavior

- Replaces the saved target-role list with the chosen title.
- A nonblank city replaces saved locations; a blank city keeps them.
- The explicitly chosen fresher preset sets `level=fresher`, `years=0` and full-time
  jobs, plus internships when checked. This is displayed before saving.
- Other career stages preserve saved level and years. The internships checkbox adds
  or removes internships while preserving other job types; an empty remaining set
  uses the standard full-time, part-time and contract types.
- Skills, workplace settings, sources, portals, exclusions, sponsorship, alerts and
  other account settings are preserved. Search setup does not enable auto-apply or
  provide consent to submit applications.
- Existing listing requirements and matching filters still apply. A fresher preset
  does not guarantee that every result accepts candidates with no experience.

## AI and ownership

`GET /v1/jobs/launchpad` returns owned resume references, visible career facts,
current preferences and a source fingerprint. Contact fields, links, hidden sections
and the candidate's name are not included in the AI facts. Free-text career fields
are still the candidate's text; they can contain personal details the candidate entered.

`POST /ideas` requires verified email and an owned resume containing facts. The
existing `workflow_ai.preview` reserves one durable request before calling a model:
five daily requests per candidate, resetting at midnight UTC, including failures.
Facts are fenced as reference data. Output is bounded to three distinct roles;
each must identify a supplied fact and repeat its complete text exactly. Unknown
IDs, fabricated quotes, duplicate titles and malformed output are rejected. Reasons
and experiments are still AI prose that candidates must review; quote validation
does not prove that a role is suitable. Mock-provider output is labelled as demo AI.
No AI response writes a resume, preferences, applications or weekly goals.

`POST /search` requires the reviewed fingerprint, locks the account, checks current
resume and profile data, and updates only the existing search profile. Stale inputs
receive 409, including source changes during an AI request. The response includes
the new context so a candidate can edit and save again without a spurious conflict.
Normal preference saves use the same account lock. A candidate can still deliberately
replace preferences through the existing profile editor or its explicit AI-read action.

Frontend requests use a sequence guard so responses from a previous selection or an
unmounted launchpad cannot replace the current screen. Refreshing stale settings keeps
the candidate's draft title, city and stage, but clears AI suggestions for the old source.
The first automatic Jobs AI profile read is suppressed while this reviewed setup is open.

## GitHub research, 20 October 2026

Primary repositories and actual source files inspected:

- [Career Ops](https://github.com/career-ops-hq/career-ops/tree/ca5e70b9321daf4765f5143a4aa4d2d135f0d397),
  `modes/titles.md` and `modes/upskill.md`: adjacent role exploration grounded in
  quoted CV evidence, candidate-confirmed targeting, and actionable learning gaps.
  Native adaptation: quoted role ideas, prospective experiments and explicit search review.
  This PR does not implement its full CLI or aggregate tracked-JD gap analysis.
- [Reactive Resume](https://github.com/reactive-resume/reactive-resume/tree/44929ad102d382588eea8ed87d943e385fb9cf80),
  `packages/schema/src/resume/data.ts` and `default.ts`: structured resume data and
  empty section defaults. Native adaptation: connect Orbit's existing structured
  Campus starter and import/editor instead of adopting a second editor.
- [AI Career OS](https://github.com/semirturgay/ai-career-os/tree/cc3fce2a1b7a1d6c86de75c09ab6fc0ad03a2dd8),
  `app/schemas/match_analysis.py`: typed, evidence-carrying strengths, gaps and
  recommendations. Native adaptation: bounded role ideas with source facts and a
  checkable next experiment. No hiring probability or opaque readiness score.
- [JobSpy](https://github.com/speedyapply/JobSpy/tree/8dd83cdd194b6e27f6487eb09b2b2a10117d9a1c),
  `jobspy/model.py`: normalized job types and search inputs. Native adaptation:
  reviewable full-time/internship targeting using Orbit's existing typed job preferences.
  No additional scrapers, proxy behavior or employer access workarounds were imported.

All four reported MIT licenses at inspection. No third-party source code was copied,
installed or executed; the integration uses Orbit's APIs, data models, AI provider
and matching system. These are workflow adaptations, not claims that their entire
products or automation engines have been integrated.

## Verification

Focused API coverage includes ownership, manual search without a resume, preservation
of unrelated filters, fresher and career-change behavior, grounded AI output, failure
quotas, source changes during generation, hidden sections and concurrent saves.
Browser coverage checks desktop and 360px phone layouts, source quotes, repeat saves,
history, no-resume setup, stale-settings recovery, accessibility and overflow.
The existing Jobs workspace browser tests and full web unit suite are regression gates;
production build and existing bundle budgets must pass without budget increases.
