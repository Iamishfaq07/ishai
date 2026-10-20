# Implementation log

## Personal Orbit V6: preparation continuity and a clearer next task (2026-10-21)

- Preparation now starts with one suggested unchecked task and the current day. Upcoming days and history open on request, reducing long-page scrolling. A clearly labeled rehearsal path works before an interview is booked.
- Completion details stay with the job after rescheduling. Review matching earlier research/requirement work before reusing it; fresh rounds keep their own warm-up, logistics and practice checks. Legacy records remain labeled history. Changed task content and same-day time changes cannot inherit unrelated checkmarks.
- The existing AI coach now follows the checklist's browser offset and understands rehearsal/completion counts. Explicit requests, grounding, invalidation and shared quota remain in place. No autonomous sends/submissions/calendar changes.
- Additive nullable completion metadata migration `d51e7c9a240b`; deploy backend before the web client. See [scope, privacy, rollback and remaining work](implementation/V6_PREP_CONTINUITY.md).

## Personal Orbit V6: reviewed invitations and preparation guidance (2026-10-20)

- Import a supported `.ics` invitation into a chosen saved job, review original/local times and explicitly confirm date/stage. Continue directly to existing preparation and saved-date actions. Multiple events require selection; duplicate choices, stale saves, unsupported time zones and recurrence are handled explicitly.
- Existing opportunity coach now grounds interview help in the saved date and unchecked preparation tasks. Optional disclosure in the preparation plan; explicit model request, shared quota, source quotes, owned links and invalidation after completion. No automatic submissions, calendar sync or mailbox access.
- Narrow layout, review focus, reduced motion and stale-result guards reuse the current UI. Preparation checks serialize while saving and discard responses after a job/date/stage change.
- See [scope and limitations](implementation/V6_INTERVIEW_INTAKE.md), the current verification addendum and screenshots. No migration or new dependency.

## Orbit for Business: the job assistant (2026-10-19)

- **"Orbit assistant" beside the job editor** (DECISIONS D85, PROTOCOL.md "Orbit for Business"): describe a job in a
  few words (examples, optional quick fields, a paste box for an old post) and **Fill the job** fills title,
  department, place / remote / countries, employment type, level, pay (only as written), the description, must-haves,
  nice-to-haves, screening questions with knock-outs from stated requirements, and stages when a process is
  described. AI-filled fields are marked with their own Undo; "Undo fill" restores the form. **Refine** with short
  instructions changes only the named fields ("Changed: 1 question added"). Assumptions and inclusive-language notes
  are shown; a salary hint when no pay was given. Two columns from `lg` (sticky, collapsible), a bottom sheet on
  phones; lazy-loaded. Replaces the "Write with AI" brief dialog.
- **`business_ai.fill_job`** (job_fill.py, job_facts.py): Indian and global pay formats normalised (LPA/CTC/lakh/Cr,
  $/€/£/AED, k, per month/hour), Hindi prompts, protected characteristics refused before anything reads them, one
  repair, a deterministic fill when the model is down; the mock model answers it for development.
  **`POST /v1/business/companies/{cid}/jobs/assist`** shares the AI writer's daily limit and usage recording.
- Tests: 42 API (test_business_job_fill.py: 18 prompts, pay never invented, knock-outs, refusal, refine, fallback,
  permissions, tenancy, usage), 7 vitest (assist.test.ts). Live eval scripts/eval_job_fill.py (14 calls, no problems,
  ~$0.0006 per fill). E2E 36/36 on a local stack with the mock model (fill, refine, per-field undo, publish, JSON-LD
  salary, axe clean light/dark/phone). No migration.

## Orbit for Business: review fixes (2026-10-19)

The remaining findings of the PR #400 review (#401 fixed 1, 2, 5 and 13); DECISIONS D82 and D83 amendments.
- **Domains** by the Public Suffix List (tldextract, bundled snapshot): bare suffixes refused, registrable domains
  compared, vendored free-mail and throwaway-mail lists, subdomain mailboxes verify by DNS only; the careers badge reads
  "Verified: acme.com".
- **No email relay**: until an applicant's address is confirmed only Orbit's fixed confirmation goes out; company
  emails, rejections and interview invites wait ("Waiting for the applicant to confirm their email"), bulk results say
  how many. An unconfirmed signed-out application is replaced by the next from that address; the bot check runs before
  the per-email limit.
- **Ranking** resists prompt injection: lines addressed to AI reviewers are left out (with a caution), quotes must name
  the requirement, and the summary is built from the matches.
- **Retention**: each application keeps the retention it was given; the sweep also deletes undecided applications on
  long-closed jobs and requested deletions after 30 days (with reminders at 7 days and 1 day).
- **Status links** are random per application (hashed, and sealed for later emails); existing links keep working.
- Smaller: control characters out of titles, names and subjects; .ics CR escaping and 75-octet folding; the
  sanitizer never cuts its output; plan limits under a row lock and a clean 409 for a doubled invite accept; more
  routes refuse a suspended company; re-ranking rate-limited; blind review masks subjects, answers and parsed
  experience; removed members leave hiring teams and interviewer lists.
- Migration `25f71d009e96` (biz_applications: `status_token_sealed`, `retention_months`, `deletion_reminders`; existing
  rows filled in place). Dependency: `tldextract`. Tests: tests/test_business_review.py (27, one or more per finding),
  6 injection tests in test_business_ai.py, web vitest (badge, bulk-result message).

## Orbit Apply: auto-apply for candidates, the server side and the web app (2026-10-19)

- **`orbit_api/auto_apply`** (DECISIONS D84, PROTOCOL.md "Orbit Apply"). The server plans each application and the
  candidate's own browser submits it. The setup: the master resume approved by its content hash, the confirmed
  facts (work authorisation and sponsorship per country, notice period, salary only if they give it), an answer
  bank of ~37 common screening questions, filters, Automatic (the default) or Review first, a daily limit (10 by
  default, 25 at most), quiet hours, the AI line, and versioned consent.
- **The planner** picks from Jobs AI's own ranking. It applies the threshold (the reason is kept), freshness (30 days
  at most, no re-dated or standing ads), the salary floor, excluded companies and two per company per 30 days, and
  dedupes against packets, the tracker and the same job on other sources. It reads each employer's public form
  (Greenhouse `questions=true`, Lever's apply page and question cards, Ashby's posting GraphQL) and answers it only
  from approved data. A required question with no truthful answer stops the packet (`needs_answer`) until the
  candidate answers once; the answer goes to the bank and unblocks every waiting packet. Legal attestations take only
  an explicit answer, kept per company for agreements. Self-identification is "decline". LinkedIn, Indeed and Naukri
  listings resolve to the employer's own ATS when Jobs AI has the same job, else they become a one-click hand-off.
- **Tailoring** rewords through Resume AI's tailoring prompt and reorders bullets, skills and projects. A truth check
  against the master drops anything adding a skill, a tool, a figure or a role, with a diff. A short cover letter and
  "why this company" are written from true facts (template fallback), with the AI line on by default. A plain-text PDF
  of the tailored resume is served by a 15-minute signed link.
- **The executor contract**: `GET /v1/apply/next` (204 + `Retry-After` + why, or a packet leased for 15 minutes),
  `POST /v1/apply/{id}/result` (proof, tracker "Applied (Orbit Apply)", the tailored resume kept as the version sent,
  needs-you email at most every 6 hours) and `GET /v1/apply/status`. An extension-scoped token reaches these three
  only (`SCOPED_PATTERNS` added for the id in the path).
- **Server-enforced pacing**: one lease at a time, 60 s between any two, a random 3-8 minutes per ATS board, quiet
  hours, the daily and per-company caps at lease time, and a per-site kill switch (40% of the last 20 results in a
  day hitting a captcha, a block or a failure pauses the site for 6 hours; the admin can pause or lift it at
  `/v1/admin/apply/sites`).
- **Billing**: the plan's applications per 30-day window (Basic 60, Pro 150, Premium 300, Unlimited 750; Free a
  5-application trial), then top-up credits of kind "apply". Only a confirmed submission is charged, and any other end
  of a lease gives the hold back.
- Migration `4a93a7c927ef` (on `b75cd70a02a8`, Orbit for Business): five new tables and `job_applications.applied_via`. The
  tracker shows
  "Applied (Orbit Apply)" in a job's journey.
- **Web**: Jobs AI → Applications (`/jobs/applications`) and its setup wizard (`/jobs/auto-apply`), a chunk of its
  own.
- Tests: 41 new (recorded real forms from Anthropic's Greenhouse board, Meesho's Lever page, and Notion's and
  Sarvam's Ashby postings). They cover each ATS's form and its answers, salary history and legal questions never
  invented, per-country work authorisation, decline-by-default EEO, board hand-offs and ATS resolution, the planner's
  filters, threshold, dedupe and company cap, needs_answer, Review first, the lease and result contract with proof,
  the tracker and the quota, lease expiry and late results, pacing, the daily cap, quiet hours, the kill switch,
  credits refunded on failure, tailoring that never adds a skill, and scoped-token isolation. Full suite: 2,914
  passed.
- E2E (`tools/e2e/auto-apply.mjs`, headless Chromium against `apps/api/scripts/e2e_auto_apply.py` on 8039, with
  recorded forms and the mock AI, and Vite on 5202). The run: the setup wizard, the planner preparing 5 packets from
  fixture jobs, a needs_answer packet answered once and ready, then `apps/api/scripts/fake_executor.py` with an
  extension token. It submitted with a screenshot, its next ask was held for pacing, and it hit a captcha (needs
  you). The Applications view showed the proof and "Finish in one click", and the tracker showed "applied via
  orbit_apply". axe clean on 6 screens; 18/18 checks.
## Orbit for Business, Phase 1 core (2026-10-19)

- **A company workspace on the same login** (DECISIONS D82, docs/PROTOCOL.md "Orbit for Business"): `/business`
  (the public page, prerendered) and the app at `/business/app`. Companies verify their website's domain by a
  verified Orbit email at it, a 6-digit code to a work address there, or a DNS TXT record; free-mail and hosting
  domains can't; unverified companies draft but can't publish. Roles (owner, admin, recruiter, hiring manager,
  interviewer), invites by email with seats, transfer of ownership; a deleted owner's company passes to its admin.
- **Jobs**: sanitized rich-text description, locations / remote with countries, salary with show/hide, screening
  questions with knock-out rules (flagged and sorted last, never rejected), editable stages, hiring team, the AI
  writer (orbit_api.business_ai, D83, behind business/ai_port.py, with its template fallback and inclusive-wording
  notes shown), publish / pause / close / reopen, closing itself after valid-through.
- **Careers pages as HTML** from the Worker: `/company/<slug>` and its job pages with Google for Jobs JobPosting JSON-LD
  while open (410 without it once closed), `/sitemap-jobs.xml`, an embeddable widget (`/embed/company/<slug>`,
  `/embed.js`), "Report this job", and Indexing API pings when `ORBIT_GOOGLE_INDEXING_SA_JSON` is set.
- **Applying**: one click from an Orbit account with a preview of exactly what's shared (the chosen resume's text is
  copied; the job joins the candidate's Jobs AI tracker as "Applied via Orbit" and follows the company's moves), or
  signed out with a PDF/DOCX; consent with the notice's version and time; one per email per job; the confirmation
  email's link opens the applicant's status page (confirm, pick an interview time, ask for deletion).
- **Pipeline**: board and list, keyboard moves, bulk move and reject (with an optional email), tags, notes with
  @mentions, 1-4 scorecards with hire/no-hire, 3-5 interview slots with an .ics for both sides, templates with
  variables sent from Orbit with Reply-To the member, blind review, ranking with reasons ("Matches 6/8 must-haves",
  evidence lines, "basic match" when the model was unavailable; the model version only in the audit log and the
  Orbit admin), "Interview with Saba (coming soon)".
- **Data and money**: analytics (sources, the stage funnel, time to first response), CSV export, delete-on-request,
  a 12-month default retention for rejected applicants, an append-only audit log, AI calls stored per company
  (`provider_requests.company_id`); Free / Starter / Growth limits enforced, plans granted by the Orbit admin
  (checkout not wired yet), and `/admin/business` for verification, suspension, take-downs and reports.
- Migration `b75cd70a02a8` (new `biz_*` tables, `provider_requests.company_id`). Tests: 48 API (test_business_*) plus
  the IDOR matrix's 12 public and 11 admin Business routes; web vitest (business model, worker careers pages). E2E:
  headless Chromium against the local API and `wrangler dev`, 30 checks (sign-up → verify → invite → publish →
  JSON-LD in the HTML → both applies → tracker → ranking → moves, reject with email, scorecard → analytics → export →
  delete → close is a 410), axe clean on 8 pages.

## Orbit for Business: the AI module (2026-10-19)

- **`orbit_api/business_ai`**, a pure module the Business routes import (DECISIONS D83; no routes, models or
  migrations): `write_job_description` (an inclusive 300-700 word draft in English or Hindi from a brief, nothing the
  brief doesn't say), `parse_applicant_resume` (regex extraction first, the model only structures roles and
  education, everything grounded in the source; Indian formats: CTC, notice period, "Mar'19 - Till date", B.Tech,
  Class XII) and `rank_applicant` (requirement matches with quotes checked against the resume, a fixed score formula,
  neutral cautions, `model_version` for the audit log, never a rejection). `redact_for_ranking()` takes the name,
  contact details, gender, age, marital status, religion, caste, nationality, photo and health mentions out before
  anything ranks. Each function has a deterministic path when the model is down, slow or answers badly twice.
- The mock provider answers the three request types, so dev mode without a key gives working output.
- `ParsedResume.summary`: the summary/profile/objective paragraph (regex first, the model only if it is missing and only in the resume's words), redacted like every other line and used as ranking evidence, work-authorisation statements included.
- Tests: 74 (golden parses of 17 synthetic resumes, Indian and global, fresher to senior, messy PDF/DOCX text and a
  pasted run-on line; 7 job specs; redaction; the evidence check; the score formula; model answers that invent
  evidence, recommend rejection, time out or aren't JSON; the JD checks; and the bias consistency test: identity
  swaps give the same prompt, score and matches). Opt-in live eval `scripts/eval_business_ai.py` (31 calls): 0 points
  of score change across identity swaps and repeat runs, 100/100 quotes verified.

## The desktop app signs in with Google, in the browser (2026-10-19)

- **Continue with Google on the desktop sign-in screen** (DECISIONS D81, docs/PROTOCOL.md "Desktop sign-in with
  Google"). It opens the user's own browser at the API's Google sign-in, and Orbit is signed in when the browser comes
  back: the token goes to the keychain as an email/password sign-in's does. RFC 8252 loopback with PKCE: the app
  (google_sign_in.rs) makes an S256 challenge and a state, listens once on 127.0.0.1 on a port the OS picks, waits
  five minutes at most, one attempt at a time, with Cancel; the tab gets a plain "You're signed in to Orbit" page
  (or "return to the app"), and Orbit comes forward. The button shows only when the server has Google set up.
- **API**: `/v1/auth/google/start` takes `desktop_port`, `desktop_challenge` and `desktop_state` and carries them in
  the signed state cookie. After Google a desktop sign-in gets no web session: a 60-second, single-use code (SHA-256 at
  rest) bound to the challenge, sent to `http://127.0.0.1:<port>/callback` (only there; a malformed request goes to the
  web sign-in page). Refusals (Cancel on Google's page, suspended, Google off, too many attempts...) go to the same
  place with a code the app turns into words. New `POST /v1/auth/desktop/exchange` `{code, verifier}` answers as
  `/v1/auth/login` does, two-step sign-in included (required, as on the web after Google). No new redirect URI in
  Google's console: both today's (through the site's /api) and api.orbitanswer.com's work.
- The sign-in screen's form column is now its `main` landmark (axe: landmark-one-main, region).
- Tests: 27 API (full flow, PKCE mismatch, reuse, expiry, sign-out-everywhere, bad ports, every refusal, the rate limit,
  suspended, 2FA, both redirect URIs), 10 Rust (PKCE vector, URL building, the listener, Cancel and the deadline, one
  attempt at a time, Tauri's IPC retry joining its attempt), 13 vitest (the screen's states and messages). E2E: an
  isolated test build over CDP against a local API with Google stubbed, the browser half in headless Edge: 28 checks
  (sign-in into the keychain, Cancel, a reload while waiting, Google's Cancel, the 2FA step, axe clean in each state).

## Cloudflare Web Analytics is let through (2026-10-18)

Cloudflare adds its Web Analytics beacon to every page it serves, and the site's Content-Security-Policy blocked it: a
console error on every page and no data in Cloudflare's dashboard. The policy now allows its script
(static.cloudflareinsights.com) and its report endpoint (cloudflareinsights.com), nothing wider. It counts page views
and real visitors' page speed (Core Web Vitals by country, how the India routing is watched) without cookies; the
privacy policy says so under Cloudflare.

## The product pages paint in 1.5-1.8 s on a phone with nothing moving, and LinkedIn AI's score grid has no gaps (2026-10-18)

- **The built pages paint first, then start the app** (DECISIONS D79, dated note; docs/PERFORMANCE.md): a page built
  as HTML lists the app's scripts in `#orbit-app` instead of loading them with the page, and `public/app-start.js`
  (inline in index.html like the theme script, so the CSP hashes it) loads them once the first contentful paint is
  reported; a background tab starts at once, and 3 s is the most it waits. The built pages also preload IBM Plex
  Sans's latin file beside the stylesheet, so their text is drawn in it from the first paint. Lighthouse mobile
  (simulated, median of 3), LCP before → after: Resume AI 2.79 → 1.66 s, the copilot 2.55 → 1.51 s, Jobs AI 2.63 →
  1.65 s, Practice 2.70 → 1.81 s, LinkedIn AI 2.55 → 1.67 s, the front page 2.82 → 1.73 s; scores 91-94 → 99,
  accessibility 100, TBT 0-70 ms. The inline scripts no longer carry their files' comments.
- **CLS 0, measured with the API answering**: the earlier measuring builds had `/api` mangled by Git Bash (now noted
  in PERFORMANCE.md "How to measure"), which hid that the hero's free line grows by a line when the server answers
  and pushes the picture under it down (CLS 0.02-0.07 on Resume AI, Jobs AI, the copilot and Practice; 0.006 on the
  front page once its app started after the paint). The line's words are unchanged; `SameBox`
  (marketing/SameBox.tsx) keeps its answered height from the first paint by laying out the answered form with
  today's values (`WELCOME_LIKE`, the jobs page's daily checks, the cheapest pack in dollars) invisibly in the same
  grid cell, its words as aria-hidden CSS generated content, so screen readers and the built HTML's text get only
  the line as it stands; the answer is then drawn afresh in that box. Lighthouse with the API answering: CLS 0 and
  no layout shift on every product page and the front page, LCP 1.65-1.80 s, scores 99-100. After the answer every
  hero is pixel-for-pixel as before. A unit test covers SameBox and the prerender test checks the five heroes.
  SameBox is a 0.5 kB chunk of its own; the front page's budget goes from 206 to 207 kB for it (206.2 measured).
- **LinkedIn AI's section bars** sit two to a row with no empty cell: Experience with its roles, and a bar that would
  be alone on its row (the public page's seventh, Custom URL), take the whole row (`wideBars`, pages/linkedin). The
  product pages' toolkits (five cards, one wide) left an empty cell from 768 to 1023 px; the wide card spans from md
  up now. A unit test covers `wideBars`, and the prerender test checks every toolkit at two and three columns and the
  LinkedIn hero's bars. Before and after shots: `C:\Users\Ishfaq\tools\orbit-drive\linkedin-grid\`.

## Saba's room: fewer voice requests, a join that says where it is, controls that always fit (2026-10-18)

DECISIONS D76 (2026-10-18 note).

- **Acknowledgements.** After her first line the room asked `/v1/voice/speak` for all five ("Mm-hmm.", "Okay.",
  "Right.", "Got it.", "I see."): five more requests and characters an interview, at most one said every other answer,
  and they crossed her next line's requests (on the mock stack, four of the five overlapped her opening line's).
  `AckWarmer` (naturalVoice.ts) now keeps the two most natural ready, for her own voice only, one request each time
  she goes quiet and only while she's listening (never while one of her lines is being written, on its way or
  playing), and one more each time she says one: on the mock stack, a three-answer round asked for four, each between
  her lines (the first crossed her next one only because the scripted reply came the instant she stopped). Cache
  Storage still serves a returning user for nothing, and "never the same twice in a row" works with what's kept. A new
  offline-page service worker no longer deletes the page's caches (it wiped her clips).
- **Her first words.** Her hello (the small talk's line, the same each time) is kept on the device like the
  acknowledgements: a returning user heard her 1.57 s after Join, now 0.25 s, with no speak request. The server sends
  it while the transcriber's sockets are still connecting (it needs neither the model nor them), not after their
  handshake. The room says where the call is: "Connecting…" until the socket is up, "Saba is joining…" until her line
  is in, then her voice "about to speak…" (it said "Connecting you with Saba…" all that time, and "listening" for a
  moment while it still asked which voice she has); the join moment ends as soon as she can be heard.
- **The control bar.** The room is 100dvh tall (100vh where a browser lacks dvh) with the home bar's inset under its
  controls, a camera tile or caption can't grow past the room any more, the caption scrolls (newest words in view)
  instead of running over the controls, and an opened transcript gives way first on a short screen. A phone on its
  side gets its own layout: the transcript beside the call, your camera in her tile's corner, the controls in one row.
  Before, on 844×390 the camera tile covered End and her caption ran over the dock, and with the transcript open the
  dock ran off the bottom on 740×360 (its note) and 568×320 (the bar, by 14 px). Checked at 390×844, 360×800, 540×960
  (1080×1920 at 2×), 375×548, 844×390, 740×360, 568×320, 1440×900 and 1280×720 with the iPhone insets emulated; axe
  finds nothing in the room at 390×844 and 844×390, light and dark. An e2e test keeps the dock whole on a tall phone
  and on its side.

## Resume AI: the score toast keeps up, "Found" is past, "mobile bookings" isn't a skill (2026-10-18)

Three things seen while filming the launch videos.

- **The first-80 toast follows the score.** Fixes land a few seconds apart (74, 82, 97, 99), and the toast kept the
  score that crossed 80 while the header moved on. While it's up it now says the header's score, and a drop back
  under 80 closes it (`atsMilestone.ts`; the toast queue's new `updateToast` rewrites a toast in place on its old
  clock).
- **"Found…" on a role you've left isn't called present tense.** The "+ed" reading took it for the present of "to
  found" ("founded"); "Forecast" had the same problem. Both are action verbs now, and irregular pasts spelled like a
  present ("Cut", "Set", "Read", "Wound") are never flagged; the presents "Find", "Speak", "Rebuild" and "Rewrite" are
  recognised, so they're still flagged on a past role.
- **"Mobile" and "Embedded" count only as the skill.** "40% of mobile bookings" or "embedded with the sales team" no
  longer make a job keyword, a skill "your resume already shows", a keyword match or a Jobs AI skill match: the word
  needs a word beside it that makes it the skill ("mobile apps", "iOS and Android", "embedded systems"), a list of
  skills, or a Skills section (`ats.skill_mentions`, `names_skill`). The skills that are also everyday words ("Go",
  "REST", "Excel", "Swift") now count on a resume only as the product, as they already did in a job post, or as
  listed in Skills; "Sales" is a topic, not a suggested skill. Cached job posts re-read their skills (keywords v4).

## Google sign-in starts at the API's own address (2026-10-18)

"Continue with Google" opens its start at api.orbitanswer.com when the web app already calls the API there (D80), one
trip through the slow edge proxy fewer. Google still returns through the site's /api (the redirect URI it has), so the
state cookie is now shared across the site like the session cookie. The client's `urlFor(path)` says where a page the
browser opens itself should go.

## The desktop app plays the interviewer's natural voice (2026-10-18)

The desktop app's Content-Security-Policy had no `media-src`, so `default-src 'self'` refused the `blob:` URLs the
mock interviewer's natural voice plays from: every line was made (and counted against the day's voice characters),
then read by the computer's voice anyway. `media-src 'self' blob:` now lets it play, and a Rust test keeps it there
(found by the 0.1.43 smoke test; 0.1.41 and 0.1.42 had the same policy).

## Product pages that show the product working (2026-10-18)

The public product pages, rebuilt on one section kit and in the depth of a good product page (DECISIONS D79;
DESIGN.md "Product pages").

- **The section kit** (`apps/web/src/marketing/kit/`): `HeroShowcase` (breadcrumbs, a two-tone headline, the
  actions, what's free, the product playing on the right), `FactsBand`, `StepsWithUI`, `Carousel`, `ToolkitGrid`,
  `ComparisonBlock`, `FaqBlock`, `CrossSell` and `FinalCta`, with the small pieces the renders are drawn from (rings
  that count, bars that fill, keyword chips that light up, rows that tick, typed text) and their motion (`usePlay`,
  `useClock`, `.kp-*` in site.css).
- **Resume AI** (`/resume-ai`): the sample resume with two of its other templates behind it and the ATS score
  counting from 82 to 98 as the check's four fixes are made (the real check's numbers, with Play again); the facts;
  import, score and tailor, download, each with its render; all ten real templates in a carousel; Fix with AI with
  the rewrite typed in and its changed words marked, the check part by part, the job post's keywords (11 of 15), a
  cover letter and interview prep; "A chatbot gives you text. Resume AI gives you a resume."; the prices; the
  questions; Jobs AI, Practice and the copilot next.
- **Jobs AI** (`/jobs`): an example match whose score counts up and skills light, then the fit check; the server's
  job counts (once there are enough) beside the four applicant-tracking systems and the 30 days a post is kept; the
  search profile, the matches and the tracker as steps; the tracker with a card moving to Interviewing, where the jobs
  come from, the Mission room, outreach typed in and interview day; the questions.
- **LinkedIn AI** gets a page (`/linkedin-ai`, in the Products menu, the sitemap and llms.txt): the real score ring
  and section bars climbing from 47 to 94 as five fixes go in (the audit's numbers); the fix card with Copy and Done
  on LinkedIn; the keywords, the About, the free fixes and the score trail; the real recruiter-search preview, which
  switches between the profile as LinkedIn has it and with the fixes.
- **Interview copilot** (`/interview-copilot`): the live answer streaming in; the ten languages, the server's median
  first word (else the two ways to listen), Shorter in one tap, no audio kept; the steps; sources from your
  documents with a suggested detail marked, the languages, Shorter/Longer/Simpler, the real code block and the Windows
  app's compact window; where AI help is allowed, as before.
- **Practice** (`/mock-interview`): the video room with Saba asking, her bars rising and falling with the words and
  the caption coming in word by word, then listening; the one-tap rounds and the interview guides counted from their
  own lists; the review's ring and per-answer scores, a stronger way to say it, the answers due again, the story bank
  and a company's style.
- **Every product page**: a title within 60 characters and a description of 120 to 160, one h1, breadcrumbs, its own
  link-preview card (new ones for the copilot, Practice and LinkedIn AI: `og/render.mjs` now renders only the cards
  named), FAQ markup from the same words the page shows (`worker/faqs/`), and the phones' sticky bar.
- **Motion**: Full plays each render once when it scrolls into view and rests on the final frame; Gentle, Off, data
  saver and the built HTML show the final frame at once, the words and numbers finished.
- **Fixes on the way**: the built pages drew a count-up's starting number (`useCountUp` in a server render: the
  Resume AI page's HTML said 54 for a score of 98); the old Resume AI hero shifted the page as it measured itself (CLS
  0.137 on a phone); a decorative resume no longer adds its section names to the page's headings.
- **Speed** (Lighthouse mobile, PERFORMANCE.md): Resume AI 85 → 92 (CLS 0.137 → 0, LCP 2.96 → 2.82 s; the public
  renders use Arial instead of downloading Inter, the templates behind the hero draw just after the first paint); the
  copilot 96 → 94, Jobs AI 95 → 93, Practice 94 → 91 (their HTML is 17 to 18 kB gzipped instead of 10 to 12), LinkedIn
  AI 93. The public pages have JavaScript budgets of their own; Home, the front page and Mock went up 1 kB for the
  chunk names in the entry's preload map.
- **Checked**: typecheck, lint and every unit suite (web 473, ui 550, desktop 68, extension 9); the build's prerender
  (each product page finished in its HTML, every render `data-still`, the FAQ markup word for word); the whole
  Playwright suite (37), with a new `product-pages.spec.ts` (sections, no sideways scroll at 360 and 390, Full, Gentle
  and Off, the carousel, the FAQ, the menu and the search preview) and axe on every public page, `/linkedin-ai`
  included, in both themes at 1280 and 390.
- **Not built**: pages for Code AI, Offer AI and Learning AI (D79 says why).

## Saba is Aurora for everyone, and keeps her natural voice (2026-10-18)

Saba's voice is Aurora at the normal pace for everyone, with no setting to change it; only the admin can still pick a
voice and pace, to test. She no longer switches to the device's voice after her greeting on a slow connection
(DECISIONS D76).

- **One voice**: Aurora ("bright and lively") is the default and comes first; `GET /v1/voice` says `can_choose` (the
  admin only), a voice or pace saved on a device counts only then, and `/v1/voice/speak` ignores anyone else's pace.
  The Interviewer voice card in Settings, its section link and the picker in the video interview's camera check are
  the admin's only (marked Admin), with no loading flash for anyone else. A panel still gives each interviewer a
  different voice.
- **A natural voice that holds**: 10 s (was 7) before a line falls back to the device's voice; a piece that hits a
  network drop or a 500, 502 or 504 is asked for once more; a long first sentence starts with its first clause, so
  the first request is shorter; a slow or failed line falls back for that line only, and the next one is natural.
  Only today's allowance being used up or the voice being off turns it off for the call: the per-second limit or the
  host restarting no longer does.

## Faster sign-in: the web app calls the API directly (2026-10-18)

From India each call through the site's /api proxy took 1-7 s (Cloudflare's free plan routes it via London, Paris or
Seattle); the API's own address answers in 0.3-0.5 s (DECISIONS D80).

- **Cookies shared across orbitanswer.com**: the session and two-step cookies are set for the whole site in
  production, so api.orbitanswer.com gets them (same site, still first-party, SameSite=Lax); an older host-only cookie
  is moved over on the next reply through the proxy; signing out clears both kinds.
- **Direct calls**: once the API says the cookies are shared, the web app sends its calls straight to
  api.orbitanswer.com, except billing, the region, Support, the resume allowance and sign-up, which need the country
  the edge states. If that address can't be reached from someone's network, the app goes back through the proxy for a
  day (reads retried at once, writes never sent twice).
- **Google sign-in**: Google's signing keys are fetched once an hour instead of on every sign-in.

## Saba talks like a person on a call (2026-10-18)

Saba, the AI video interviewer, is heard or says why not, her words appear as she says them, and the call goes like
a conversation (DECISIONS D76). Found with headless Chrome measuring her output on the page, then on a real call with
the real speech-to-text, voice and AI model and a synthetic candidate.

- **Never silent**: her own voice from the speakers no longer stops her; her audio never goes through Web Audio (a
  suspended context made it silent); "Tap to hear Saba" when the browser won't play without a tap; natural voice,
  then the device's, then a note; a stalled clip is restarted; each is logged to the API.
- **In sync**: her line appears word by word as she says it, in the caption and the transcript ("about to speak…"
  while her voice is on its way); in full when her voice is off or Motion is Off; screen readers hear it once.
- **Turns**: a turn ends when the candidate's voice stops (the server hears it in the mic audio), not on the
  transcriber's bursts, and a short answer gets longer to go on; talking over her stops her within about half a
  second, and what they said meanwhile is kept; the mic isn't held back while her voice is on its way; a line cut off
  before a word was heard is taken back (and never in the transcript); her reply comes in growing pieces with a
  cached "Mm-hmm." when it's slow.
- **Conversation**: hello with their first name and small talk, the plan, a specific reaction before each question,
  repeat, rephrase or a moment when asked, a check-in after a long silence, a hint after "I don't know", "Do you have
  any questions for me?" answered honestly, and a goodbye.
- **Voices**: Vesta (default), Aurora, Pluto and Arcas, picked in the setup with a sample and a pace; one connection
  to Deepgram kept open; text shaped for speech; even loudness.
- **Review**: a rubric per answer quoting the candidate, one improvement, a stronger answer from their own words with
  placeholders, speaking stats, the top three to practise and Practise again; its output budget now fits it (a real
  review had been cut off mid-JSON).

## The desktop app, redesigned, and its installer (2026-10-18)

The Windows app and its installer, redesigned (DECISIONS D77; DESIGN.md "The desktop app"; WINDOWS_RELEASE.md "The
installer").

- **The workbench look**: the desktop app is `html.app-shell` like the signed-in web app. A 40 px title bar with the
  mark, Home / Documents / History / Settings as tabs, the account menu (Plan & billing, Orbit on the web, Sign out),
  transparency and Windows' own minimize, maximize and close.
- **Home is a dashboard**: Start a session and Practise first; quick starts with their spots; recent sessions with
  each review's score; Upcoming interviews from the Jobs AI tracker (Prepare opens New session with that interview);
  minutes left; and "More from Orbit", one of Orbit's web tools per visit (hideable for good).
- **New session in four visible steps**: Session (illustrated cards), Listen to (a tile per app with its own icon
  and a live meter read from Windows' mixer, nothing captured; a tile per output and per microphone; Test your
  audio), Documents (kind marks, the 20-document limit said up front) and Answers, with a step rail and Start always
  in reach. Every earlier behaviour is kept. Deleting a document from here now asks first.
- **A welcome tour** once per device: what the copilot does, what it hears and when, Orbit on the web, how to start.
  Skippable; Settings → About replays it.
- **The live overlay fits**: compact shows "Listening" in full (the window's options moved into one menu, the window
  buttons to the header's end), expanded lets the title give way before the status, and "Capture active" no longer
  repeats what the Mic and Interviewer chips say.
- **Documents, History and Settings** use the shared components: kind filters and search, score rings, the
  sliding-underline tabs, a section rail with spots, About Orbit with the version and Report a problem.
- **The tray menu**: Orbit X.Y.Z, Open Orbit, New session…, Past sessions, Orbit on the web, Settings, Quit Orbit.
- **The installer**: the brand's header and sidebar bitmaps and icon, Welcome and Finish pages in Orbit's words,
  "What you get with Orbit" on the installing page, and an unticked "Explore Orbit's free tools on the web" on
  Finish. Passive (the updater) and silent installs are unchanged: no extra page, no panel.
- **Checked**: axe (WCAG 2.2 AA) finds nothing on Home, Documents, History (list and a session), Settings, New
  session, the welcome tour and the live overlay, light and dark; the shared `Dropzone` is now named by the words it
  shows.
- **Microsoft Store policy**: "Inappropriate or harmful" on an answer's thumbs-down (11.16; API reason
  `inappropriate`, in the admin's report, never a style hint), Report a problem (the contact form's new `report`
  topic), and a one-time note in Setup to check that people on the call are okay with Orbit transcribing it (10.5.3).

## Microsoft Store submission: the package, the listing and the owner's steps (2026-10-18)

Orbit for Windows on the Microsoft Store as **Orbit AI Career Assistant** (Store ID `9NJ1ZXGTCZKL`): free, and
Microsoft signs the MSIX (DECISIONS D78; owner guide `docs/MICROSOFT_STORE.md`).

- **The package.**
  - `AppxManifest.xml` carries the reserved name and the Partner Center identity (`store-identity.json`); tiles say
    "Orbit".
  - MaxVersionTested is Windows 11 26H2.
  - Three capabilities: runFullTrust, microphone, internetClient.
  - The tiles and icons come from the brand mark at every scale, plus the taskbar's target sizes (plain, unplated,
    light-unplated): `marketing/brand/render-msix-assets.mjs` renders them, and makepri indexes them into one
    `resources.pri` (`priconfig.xml` without resource packs, which had hidden every tile but the 100% one).
- **Versioning.** The Store refuses a first part of 0, so Orbit X.Y.Z is package (X+1).Y.Z.0: 0.1.42 is 1.1.42.0.
- **`package-msix.ps1`:**
  - stops with the missing field names while the identity is empty;
  - clears `VITE_*` and checks the production API address is in the build;
  - checks the exe's version;
  - writes the `.msixupload`.
- **`check-msix.ps1`** runs the App Certification Kit's static checks without installing anything: manifest, image
  sizes and qualifiers, the 204,800-byte limit, default images, PRI candidates, x64 binaries, no redistributable
  runtime, path lengths.
- **The listing** (`marketing/store/listing/`):
  - text: description, short description, features, search terms, What's new for 0.1.42;
  - settings: properties, age rating guidance, pricing (with the 10.8 citations);
  - screenshots and captions, a 300 × 300 app tile icon;
  - certification notes with the `runFullTrust` justification and reviewer placeholders.
- **Website.** A Microsoft Store badge ("Download from the Microsoft Store", `StoreBadge`, Microsoft's own artwork in `public/badges/`) on Home's
  Windows card and the interview assistant page. It sits behind `VITE_MS_STORE_LIVE`, **off** until certification
  passes; while off, nothing on the site changes.
- **Dry run on the release commit:**
  - `release-desktop.ps1 -Version 0.1.42`, without `-Publish`; dep-info showed `ORBIT_KEYRING_SERVICE` unset.
  - Then `package-msix.ps1 -Version 0.1.42`, which produced `Orbit_0.1.42_x64.msixupload`: 4,298,091 bytes,
    package 1.1.42.0, identity `Orbitanswer.OrbitAICareerAssistant`.
  - All 27 package checks pass, and makeappx validated the manifest.
  - The App Certification Kit itself wasn't run: it requires administrator rights and installs and launches the
    package. Nothing was installed or uploaded.
- **Tested:**
  - web: vitest (the badge is off by default and renders nothing; the direct-install link once live), tsc, eslint;
  - the scripts: an empty identity fails with the field names; `-Test` and Store packages pass every check.

## Product audit: every product driven end to end, and what it found (2026-10-18)

Three personas (a new free user in India, a paying user abroad in dollars, the admin) drove every product on a
local stack at 1440, 820 and 390 px, light and dark, with axe on every route (DECISIONS D73). Each fix has a test.

- **Signed in stays signed in**: any failed session check (offline, a timeout, a 5xx while the API restarts)
  signed the user out to the sign-in page. Only 401/403 do now; anything else shows "Can't reach Orbit" with Try
  again, and checks again when the browser is back online.
- **Security** (the red team's follow-ups):
  - The account's owner is emailed when a passkey is added, two-step sign-in goes on or off, or the password is
    reset or changed (auth/alerts.py). Without SMTP the same events are in the app: Settings → Recent security
    activity, and a notice on Home for a change in the last fortnight until "It was me" on that device.
  - The admin can turn two-step sign-in off for someone who lost their phone and codes, saying how they checked
    it's them (audit log); every device is signed out and the owner is emailed.
  - One open order carries the first-purchase discount; in production, orders are made only through the website
    (the edge's signed country decides the currency; the desktop app already buys there).
  - The Worker's own answers (301s, robots.txt, security.txt, plain 404s) carry the security headers.
- **Money and minutes**: rupees grouped everywhere (₹26,499), minutes left rounded down the same way everywhere,
  credits bought before a plan stay in view while it runs, the support bot names packs as Billing does and knows
  there's nothing to cancel, the admin's payments page by page.
- **Data**: Delete transcript also takes each answer's quoted question; the Markdown export has the answers, the
  scorecard and the user's own time; the video interview's Q1 is the question, not Saba's greeting; Practice's
  one-tap rounds no longer say "the questions from your prep".
- **Dead ends and confirmations**: a non-admin on an admin page is told it's the admin's; the extension page
  says how to get it; deleting a confirmed claim and untracking a saved job ask first; sign-up says why it can't go
  on; Billing says when payments aren't open; Code AI won't spend a review on the starter code; a too-large upload
  says so (its 413 carries CORS headers); an empty jobs feed isn't called an outage; error pages speak plainly.
- **ATS keywords** leave out where the job is (Austin, TX; Bengaluru). **Admin**: last active counts every tool,
  and an account that only signed in says so.
- **Desktop** (next release): Setup remembers answer length, style and Auto-answer; a video interview rejoins in
  the browser; "Not connected" instead of "Capture active" with no connection; a left click on the tray icon shows
  Orbit; no "Buy more interview minutes" on plans; audio errors name the button that's there; History lists
  answers from chat.
- **New**: `/pricing` with rupee and dollar prices (from the server, `?currency=` on the public listings, display
  only), `/interview-copilot` and `/mock-interview` product pages, all built as HTML; "?" opens the keyboard
  shortcuts anywhere in the app.
- **Accessibility**: axe 0 on every route checked (WCAG 2.2 AA, light and dark, 1440 and 390 px); the first Tab
  stop is Skip to content; small targets, name mismatches, nested links and two contrast misses fixed.
- **Performance follow-ups**: the video room loads only for a video interview (Live 234 kB, budget 246), its mic
  meter wakes on iOS, and its full screen respects the safe areas. Plan & billing and Offer AI hold one placeholder
  until their data is in, then draw everything at once (layout shift 0.42/0.84 and 0.11/0.45 on desktop/phone, now
  0.01 and under; Home 0.03-0.07).
- **Tests**: `tools/e2e/product-audit.spec.ts`; API tests in test_security_alerts.py, test_pricing_page.py and the
  suites each fix touched.

## Micro-interactions: presses, states, lists and exits that feel like one product (2026-10-18)

- **Interaction rules** (DECISIONS D74; DESIGN.md "Interaction"): a press is one fill step darker and 97% at Full
  motion (80 ms in, 140 ms out) on every button and button-link; hover only with a real hover (no stuck tint after a
  tap); keyboard focus an accent outline that reads on any surface; Gentle keeps the fades, Off is instant.
  `interaction.test.ts` holds them, including no off-scale durations.
- **Button states at a locked width**: `loading` + `loadingText` (ring spinner, "Saving…"), `done` ("Saved", a tick
  drawing in, announced, a short buzz on Android), `disabledReason` (a tooltip and description; still focusable),
  `CopyButton` ("Copied"). Sixteen hand-swapped busy labels moved over (stories, answers, documents, tracker, offers,
  people, add a job, contact, settings, mock and video interview, admin payments); copy buttons on the transcript,
  referral link, counter-offer and negotiation emails, the outreach kit, interview prep, the follow-up and answer
  cards and code blocks now morph.
- **Selection and controls**: checkboxes and radios drawn in the accent with a popping tick; a gliding switch thumb;
  tabs and segmented controls re-measure on resize; a product's tabs slide their pill between pages; a chosen
  template gets a tick; the stepper and progress bar animate between steps.
- **Lists and overlays**: `useFlip` on the tracker (a card glides across columns), the story bank, answers and
  documents; dialogs, sheets, side panels and confirms play an exit; toasts stack and close up smoothly; a details
  grows open when opened by hand; content fades in after a skeleton; one route fade; tooltips portaled and warm.
  Opening a dialog no longer blanks or jumps the page behind it (the scroll lock holds `<html>`), and focus going
  back to the public menu's button no longer scrolls the page.
- **Icon buttons and desktop**: 40 px targets with a mouse (and the touch layer's 44 px on phones) without changing their size; styled tooltips instead of
  the browser's. Desktop: Setup's title-bar buttons and Start button, the window buttons, the close dialog's
  choices and the live control bar press and tint like the rest.
- **Tokens everywhere**: stray `duration-150/200/300/500/700` and hand-written timings moved to the scale; progress
  fills and the mock round's clocks slide (transform) instead of resizing. Gallery: `/dev/components` → "Interaction".

## Faster where it was slow, and built for phones (2026-10-18)

- **Measured first** (DECISIONS D72; PERFORMANCE.md has the budgets, the before and after, and how to measure): a
  heavy account among 2,000 on a seeded local Postgres, the live path with mock providers, signed-in pages under a
  phone's budget (4x CPU, slow 4G), Lighthouse on the public pages, 25 pages at 360-768 px. Never production.
- **API**: the admin cost report ran a query per account (4,002 for 2,000; 1.4 s): 13 queries, 0.36 s. Resume AI's
  list scored every resume on every visit (60 ms for 30): scores kept by content, 5 ms. The interview-style list is
  built and gzipped once (16 → 3 ms), the practice queue 15 → 9 ms, the tracker 27 → 17 ms, admin stats one pass
  over the activity tables, gzip at level 6. No index was missing; no migration.
- **Live copilot**: retrieval between a question firing and its LLM request 8.3 → 2.3 ms (C dot products, BM25
  postings, scores kept for the four searches of one question, a cached stemmer), the same prompts byte for byte.
- **Web**: the 400-job tracker held a phone's main thread 3-5 s on open; it draws one layout, in batches, with the
  More menu on demand: longest task 0.19 s, taps 80 ms. Typing in the resume editor no longer re-reads every evidence
  claim per keystroke, and the preview follows the form a moment later (keystroke p50 104 → 76 ms). Home no longer
  pulls in the whole billing page for its usage card (first load 216 → 197 kB gzip).
- **Phones** (touch screens only; a mouse sees no change): 16 px text fields (iOS zoomed into 119 per width), tap
  areas of at least 44 px (targets under 24 px: 239 → 26), safe-area insets for the shell, bottom nav, live page,
  sheet and support chat; the support chat sits above the keyboard; on iOS the microphone comes back after a call,
  Siri or the screen locking; an offline page instead of the browser's error (service worker for failed page loads
  only, two kill switches); the theme script cached a day.
- **Guards**: `tests/test_query_budget.py` (SQL per request for the hot endpoints; fails on the old cost report) and
  `scripts/bundle-budget.mjs` (`pnpm --filter @orbit/web budget`, a CI step after the build).

## LinkedIn AI fixes it like Resume AI (2026-10-18)

- **A score by section** (DECISIONS D75): headline, About, each of the latest three roles, skills, search keywords,
  education and certifications, the custom URL, out of 100 from LinkedIn's PDF; Featured, photo and banner,
  recommendations and activity count once Orbit can see them (a pasted page, or the photo checklist applied). Bars
  grow in; "What would raise it" lists each fix with the points it adds, biggest first.
- **How a recruiter's search shows you**: an Orbit-drawn search result (name, headline cut where search cuts it,
  place, current role) and the About before "see more", for Orbit's copy or as read.
- **Fix with AI, a part at a time** (`POST /v1/linkedin/fix`): three headlines in different styles, the About (an
  opening that fits before "see more", then the rest), one role's bullets (figures only where the profile or resume
  states them, [X%] placeholders otherwise), Featured ideas, a recommendation request to a past manager; free, with no
  AI: skills in the order employers search for them, a custom URL, the photo checklist, Open to work settings. Written
  from your LinkedIn, your resume or both. An AI fix is a single Resume AI fix (1/5 of a credit), said before it's
  spent, refunded if it fails; "Rewrite everything" stays at one credit. Out of credits opens the usual dialog.
- **Suggestions you paste**: each card has before → after with the changed words marked, the character count against
  LinkedIn's limit, Copy, Apply to my Orbit copy (the score moves, the card sweeps once), Put it back, Edit, "Done on
  LinkedIn" (kept with the profile) and the steps to paste it on LinkedIn, checked against LinkedIn's Help Center. A
  progress bar, the score as read → now → with every fix, and Copy all for the headline, About and skills.
- Stored as JSON on the profile's existing row: no migration. Reading the profile again keeps the suggestions and
  ticks the ones LinkedIn now has.

## Spot graphics for every section, and KashSec Academy promoted (2026-10-18)

- **Spot graphics** (DECISIONS D70; DESIGN.md "Scenes"): `Spot`, a section's own 40 px picture in the scenes' hand,
  its accent part drawing in once and lifting on hover; 65 kinds. On Settings, Plan & billing, Offer AI, Practice's
  rounds, Code AI's eight patterns (cards coming in one by one), Jobs AI's profile, Resume AI's panels and each
  check to fix by category, the story bank, answers, evidence, the copilot's setup and the Mission room. One per card;
  never on rows, fields or buttons.
- **KashSec Academy** (DESIGN.md "KashSec Academy"): a feature card with its own scene (terminal, shield, lesson path,
  in KashSec's teal) as Learning AI's band; a front-page section "Free from the Orbit team"; a footer link; Home's
  dismissible "More from us"; and "Preparing for a security role?" on matches, a job's page, the Mission room,
  Practice and the cybersecurity analyst guide when the role is in security. Its own words only, one card in a view,
  every link in a new tab with `utm_campaign=<placement>`.

## Search, phase 2: guides, links, security.txt (2026-10-18)

- **Orbit's own interview guides** at `/guides/<slug>` (`pages/guides/`): "Tell me about yourself" for freshers,
  HR-round questions for freshers, and what happened to Google's Interview Warmup. Built to HTML like the company
  guides, with an Article in the structured data, breadcrumbs and a "last reviewed" date. All three are drafts
  (`published: false`): reachable at their address for the owner to read, but noindex, out of the sitemap and not
  linked from the site until approved (DECISIONS D67). `/guides` lists the published ones and is noindex until there
  are some.
- **Company and role guides link to each other**: each company guide suggests role guides for the kinds of job it's
  known for, and each role guide suggests company guides (`ROLES_FOR_COMPANIES`, `COMPANIES_FOR_ROLES`).
- **Policies at their own address everywhere**: the app, the cookie notice and the policies link to `/privacy`,
  `/terms`, `/cookies` and `/refund` (they went through a 301 from `.html`); the dev server and `vite preview` answer
  those addresses too (`policyPages.ts`). The terms', cookies' and refund policy's descriptions say more (120–160
  characters).
- **`/.well-known/security.txt`** (RFC 9116): the contact form, an expiry date, the language and its canonical
  address; `/security.txt` redirects there. No bounty is offered.
- **The favicon** is made from the new app icon (marketing/brand/orbit-app-icon-1024.png).
- **The resume sample on `/resume-ai`** no longer adds a second `<h1>` (its name is a paragraph there; the editor's
  preview and the PDF keep the heading).
- **Faster first paint**: the theme script is inline in the built page (`inlineTheme.ts`; the CSP allows it by hash),
  one render-blocking request fewer.
- The new preview images (`/og/*`), the sign-in font (`/fonts/*`) and the maskable icon are served without the Worker
  and cached for a day; llms.txt and llms-full.txt list the company and role guides.

## Red team: account takeover paths closed (2026-10-18)

An attacker's-eye pass over the API, web app, Worker, desktop app and extension (docs/SECURITY_REVIEW.md "Red team,
18 October 2026"; DECISIONS D71). Every finding was reproduced on a local stack before it was fixed.

- **A reset link no longer skips two-step sign-in** (High). The new password is set; with 2FA on, the answer is a
  challenge, and the web reset page goes on to the code step.
- **No pre-account takeover** (High). Someone who registered another person's address without proving it could add
  a passkey that still opened the account after the owner reset the password. Adding a passkey or an authenticator
  now needs a verified email. The first proof of the inbox (a reset, or Google claiming the address) removes any
  passkeys and 2FA set up before it.
- **Throttles hold under concurrent guesses** (Medium). Wrong passwords and wrong codes are counted before the check,
  not after it. A code is checked under the account lock, and the code step has a per-network limit.
- **Desktop updater refuses downgrades** (Medium). `requireSignedVersion` is on; every release since 0.1.41 signs its
  version. Smaller desktop fixes:
  - reveal-in-folder is no longer granted;
  - switching server forgets the saved token;
  - rustls is patched;
  - the unused zip extractor (and its three advisories) is gone.
- **Smaller fixes:**
  - the Worker drops forwarding headers that visitors send, and never follows the API's redirects;
  - the extension's Fill skips fields nobody can see;
  - the natural voice needs a verified email.
- **Tests:** `apps/api/tests/test_security_redteam.py`, `apps/web/worker/index.test.js`, the desktop updater tests
  and `api.test.ts`, and the extension's `fields.test.ts`. Each test fails on the old code.

## Scenes for every feature, and a touch of motion (2026-10-18)

- **Nine new scenes** in the house style (DECISIONS D68; DESIGN.md "Scenes"): LinkedIn AI, Code AI, Learning AI,
  the video interview, plan and credits, security, people and referrals, the admin inbox and support, interview day;
  and `WorkingScene`, the AI reading, writing or matching. Hand-written SVG in `packages/ui/src/components/scenes/`,
  ink and one accent, flat, light and dark, decorative.
- **Where they show**: CosmicEmptyState variants for each; a small scene in the page header of LinkedIn AI, Code AI,
  Learning AI, the video interview and Plan & billing (lg up); People, the admin inbox, support and payments,
  two-step sign-in while it's off, and a job, offer or problem that isn't there; the session review (nothing
  captured, and the scorecard before a review exists); Home's next step and "You're set up"; the first welcome
  question; the Interview tab without a date and Home's interview card; desktop Home, History and Documents. One
  scene in a view, never in dense tables or forms.
- **AI waits over two seconds** show `WorkingState` instead of a big spinner: matching jobs, reading or importing a
  resume, Resume AI's prep tabs, letter and AI panel, outreach writing, a review being written.
- **Motion**: each scene plays one small touch the first time it's in view (strokes draw on, the offer balance
  settles, a card slides into its column, ticks draw in) and rests; Gentle fades, Off shows the final frame; only the
  AI-working scene loops, at Full, while the wait lasts. `scenes.test.ts` holds the rules.
- **Success moments** now fire once per device: the first offer (Offer AI or the tracker) and the first ATS score
  past 80.

## The front door, enterprise and product-led (2026-10-18)

- **One public layout** (DECISIONS D66; DESIGN.md "The front door"): every signed-out page sits in `PublicLayout`
  (`apps/web/src/marketing/`): a sticky header with a Products menu of all eight tools, Pricing, Security, Contact,
  Sign in and Start free; a full-screen phone menu (a dialog that keeps focus); a footer with the products, the
  company's pages, the policies, the honest line and a theme switch. White canvas (`html.site`), dark mode the
  workbench's blue-grey twin, IBM Plex Sans headings, one accent, no sky, glass, glows or gradient headlines. The
  logo's wordmark is outlined (`BrandLogo`), so the front door loads no font for it.
- **The front page**, redesigned: a hero that says what Orbit is, with the live session drawn in HTML and an answer
  from the resume streaming in once (Full motion only); the four products as an index, then a section each with a
  real screen of the app (light and dark WebP, lazy, sized); the other four tools with their own anchors; how it
  works; why Orbit (factual, with a stage table); security and privacy (from the privacy policy); the server's own
  plans and packs; the questions; one closing panel. A slim sticky Start free bar on phones and tablets after the
  hero (waits for the cookie note, steps aside near the end, `×` hides it for good). No pop-ups, timers or scarcity.
- **Product pages** (Resume AI, Jobs AI) on one template (`ProductPage.tsx`); Contact, How Orbit works, the warm-up
  and the 404 in the shared layout; sign-in and sign-up with a quiet product panel instead of the dark planet one.
- **Google sign-in** drawn to Google's branding rules (the standard G, Google Sans Medium 14/20 as a 2 KB subset in
  `public/fonts`, 40 px, Google's light and dark fills), "Sign in with Google" / "Sign up with Google".
- **Cookie note**: same words and button, a slim site card (bottom left on wide screens, opposite the support button).
- **Link previews**: a card per public page (`apps/web/og/render.mjs` writes the SVGs and renders
  `public/og/<page>.jpg`, 53 to 92 KB); `worker/meta.js` points each page at its own (`PAGE_IMAGES`).
- **App icons**: the mark on a flat ink tile (web icons, a new maskable icon in the manifest, a 1024 px master for
  the desktop's icons in `marketing/brand`).
- **Marketing assets** (`marketing/`): `screens/` (seed a local stack with fictional demo data, capture the real
  screens; the live session is fed scripted events through a WebSocket proxy), `store/` (5 Microsoft Store
  screenshots at 1366 x 768 and 2560 x 1440), `ads/` (42 creatives: 4 products x 5 sizes x India and global, plus a
  1500 x 500 banner; prices only when passed at export).
- **First paint**: on an address with a public face its chunk starts with the session check, and a browser nobody
  has signed in on gets the page straight away instead of a spinner; the 404 is a lazy page. Front-door text falls
  back to a metric-matched local font until Plex arrives, so the built page's first paint stays the largest paint.
  Measured on the front page against main (both built as HTML), production build over HTTP/2 with the API proxied
  (Lighthouse 13, median of 3): mobile with real throttling LCP 3.02 s to 2.09 s (the first paint), score 91 to 96;
  mobile simulated slow 4G LCP 2.40 s to 2.74 s (the built page is bigger: 19 KB of HTML instead of 14), score 95 to
  93; desktop LCP 0.52 s to 0.57 s, CLS 0.022 to 0. First-load JavaScript the same (189 KB), fonts 85 to 75 KB (Space
  Grotesk no longer loads), CSS 26 to 27 KB. Below the fold the product screens add weight, lazily: 315 to 355 KB on a
  phone (their phone crops are 25-39 KB), 634 KB on a desktop.
- **The interview guides** (/companies, /roles and every guide) sit in the same layout: the site's header and footer,
  the guides' own tabs (Companies, Roles, Free warm-up), the type scale and hairline cards. The header, its Products
  menu, the phone menu and the footer link the guides.
- **Built as HTML, in the right look**: every prerendered page opens with `<html class="site">`, so its first paint is
  the front door's (no sky behind the built copy); the app keeps the class on a public page and drops it when it hands
  over to anything else. The product screens are plain markup (both themes' pictures, CSS shows one), so the built
  HTML carries them, sized, and only the shown one is fetched.
- **One list of link-preview cards**: `PAGE_IMAGES` (worker/meta.js) feeds the Worker and the build's `<head>`; new
  cards for /companies and /roles, which every company and role guide shows.
- **The desktop app's icons** come from the same 1024 px master (the mark on the flat ink tile); users get them with
  the next desktop release.
- **Contact**: "Who runs Orbit" names both currencies (rupees in India, US dollars elsewhere), so the page built for
  India doesn't tell anyone abroad they pay in rupees.
- **Marketing exports out of git**: the ad PNGs, the Store PNGs and the raw captures are made again by their scripts
  (`marketing/.gitignore`) and delivered outside the repository; the sources and what the site serves stay.
- **Accessibility**: `tools/e2e/public-pages.spec.ts` runs axe (WCAG 2.2 AA) on thirteen public pages (guides
  included), light and dark, at 1280 and 390 px, with a no-sideways-scroll check and the menus' keyboard behaviour:
  0 violations. Fixed on the way:
  the sample resume's preview is inert (focusable links inside an image), the sample match's "match" label meets AA,
  the pipeline's stage buttons take their names from their words.

## Search engines and AI assistants (2026-10-18)

- **Real status codes** (DECISIONS D67): an address that isn't a page answers **404** with noindex instead of the app
  with 200 (a "soft 404" to Google); the body is still the app, so visitors get its "This page isn't here", and
  crawlers read static links to the main pages. The app's own pages (sign-in and every signed-in page) answer 200
  with `X-Robots-Tag: noindex`; invite links `/r/<code>` too, with their canonical left at `/`. The Worker now runs
  first for every page address (`run_worker_first: ["/*", "!/assets/*", …]`, `not_found_handling: "none"`), using
  the route list in `apps/web/worker/routes.js`, which a test keeps in step with `App.tsx`.
- **One address per page**: `http://` and `www.` go to `https://orbitanswer.com`, and trailing slashes, `.html`,
  `/index.html`, doubled slashes, capitals in fixed addresses and the old resume/jobs addresses go to their page, all
  in a single 301 (Cloudflare's own were 307s, which search engines don't treat as a move).
- **robots.txt** (written by the Worker): every public page open, including the scripts, styles, favicon and preview
  image pages need (the old allow-list blocked them, so Google rendered an empty page and X/LinkedIn couldn't load
  the image); the API and signed-in pages closed, as exact paths (the public API reads the pages draw from stay
  open); every search and AI crawler named; AI training crawlers allowed by default (`AI_TRAINING_CRAWLERS=block` to
  opt out); previews and `*.workers.dev` closed and noindex.
- **Head tags**: each public page gets what it lacks: canonical, `hreflang` `en`/`x-default`, Open Graph and Twitter
  tags, and structured data (Organization, WebSite, WebApplication, the Windows app, breadcrumbs: no ratings, prices
  or FAQ markup); the front page gets the search engines' verification codes when they're set as `vars`
  (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `YANDEX_VERIFICATION`, `NAVER_SITE_VERIFICATION`,
  `SEZNAM_VERIFICATION`). `/technical` now gets its own title and preview (it showed the front page's).
- **New files**: `llms.txt` and `llms-full.txt` (what Orbit is, for AI assistants), `favicon.ico` (search results
  don't take SVG), the IndexNow key, and `apps/web/scripts/indexnow.mjs` to tell Bing, Yandex, Naver, Seznam and
  Yep about changed pages after a deploy (it checks the key file is live first; dry run unless `--send`).
- **Sitemap and policies**: the built sitemap (src/prerender) lists `/privacy`, `/terms`, `/cookies` and `/refund`
  with the date each page shows (the `.html` addresses redirected, to addresses robots.txt blocked); the privacy
  policy has a description, and the policies' titles say what they are ("Privacy policy | Orbit AI").
- **With the question bank's built pages**: one source of structured data (`worker/site.js`) for the built pages and
  the Worker; unknown guides (`/companies/xyz`) and the built copies' own addresses (`/_prerender/*`) answer 404;
  titles fit in 60 characters (guides fall back to shorter wordings, the product pages' titles were tightened) and
  guide descriptions in 160. Signed out, the app keeps a public page's served title and description once it loads
  (`src/lib/servedHead.ts`): it used to swap in its tab titles ("Resume AI · Orbit", "Uber interview guide · Orbit"),
  which is what Google, reading pages after their scripts run, would have indexed. `/technical`'s tab title moved
  into the route titles.
- **Caching**: icons, the preview image and the camera coach's model are cached for a day (a week for the model)
  instead of being revalidated on every visit.
- Owner setup (Search Console, Bing, Cloudflare's AI-bot settings, IndexNow): docs/SEO.md. Tests:
  `apps/web/worker/seo.test.js` (status codes, redirects, headers, robots.txt read as Google reads it, llms.txt,
  sitemap, structured data, the route list against `App.tsx`) and `apps/web/scripts/indexnow.test.mjs`.

## Interview day: a tracked job, a prepared copilot, and a wrap-up (2026-10-18)

- **Prepare for interview** on a tracked job (the tracker card while applied or interviewing, and the job's own page)
  opens the Mission Room's new **Interview** tab (`?tab=interview`): the interview's date and time and its round (HR,
  technical, managerial or final, and its number; saving a date offers to move the job to Interviewing), the job post
  (its summary and links; a job added by hand takes a pasted post), **the resume version sent** (the newest frozen
  version by default, or any other version or resume picked), the **likely questions** for this job (Resume AI's
  interview prep, from that version and the post: "Uses 1 resume credit. You have N." is said beside the button
  before anything is spent, and an empty wallet offers credits instead; they're kept on the job, so they're paid for
  once, and Regenerate says it's another credit), the story-bank stories that fit the job's
  requirements, the company guide (through `/v1/interview-styles`, so the bigger question bank shows up here too), and
  the rounds so far with their scores.
- **Practise this interview** starts a mock with the job's documents, the company's style and an interviewer for the
  round type (a recruiter for HR, an engineer for technical…); with likely questions ticked, it drills those.
- **Start copilot for this interview** opens setup (`/start?application=`) with the job loaded: role, company, the
  round as the stage, the job's requirements, and exactly two documents ticked, the job post (saved to Documents once
  and linked to the job, as Prepare does) and the version sent (one document per version, shared by every job it was
  sent to). A banner says what was loaded. The desktop app's setup lists **Upcoming interviews** from the tracker and
  fills itself the same way (needs a desktop release). No AI and no credit until the session starts.
- **Documents Orbit saves itself don't use the plan's**: the Free plan's 3 documents stopped practice everywhere
  after three rounds. Now a document Orbit saves from what the user already has in Orbit, to run a practice round or a
  session, is marked `origin: "orbit"` and doesn't count: a job's Prepare and Full prep, Grill my resume, Resume
  prep's "Practise N out loud", the video interview's job post, and an interview's job post and version sent. Up to 10
  of those per account; past that Orbit refuses the next one with a message naming what to delete (nothing is deleted
  for it), and an interview still starts, linked to the job, with the banner saying which document isn't loaded.
  Uploads and pastes into Documents count exactly as before. Documents marks Orbit's "saved by Orbit, not counted in
  your plan"; Plan & credits counts only the user's own.
- **The grounding is checked**: a test drives a live session started this way on the mock provider and finds the
  post's requirement, the sent resume's bullet, the company and its guide, the role and the round in the answer
  prompt (`tests/test_interview_day.py`).
- **After the round**: the session's page has a wrap-up for the job. "How did it go?" suggests a next round (its type
  and date), or waiting to hear (a date to follow up), an offer, or not this time, and says what confirming does;
  nothing moves until the user confirms. The thank-you note is the call's own follow-up (no credit) or Outreach (1
  resume credit), both labelled. The tracker card links the latest round's summary and scorecard ("Last round · 4/5").
- **Home** shows "Interview today" / "Interview tomorrow" for a tracked job dated then, with Prepare and Start copilot.
- API: `GET/PUT /v1/jobs/tracker/{id}/interview`, `POST .../interview/questions`, `POST .../session-context`, `POST
  .../wrap-up` (job_portal/interview.py); `application_id` on `POST /v1/sessions` (checked against the owner) and on
  sessions; the tracker's `round_type`, `round_number` and `last_round`. A job's rounds are counted by that link
  first, the company name only for sessions not started from another job. Migration `35a47e5f80ca`. DECISIONS D64.

## The live copilot in ten languages (2026-10-18)

- **Setup → Interview language** (web and desktop): English (the default, unchanged), Auto-detect, हिन्दी (Hindi),
  Hinglish, Español, Français, Deutsch, Português, Italiano, Nederlands, 日本語, Русский: the ten languages Deepgram's
  Nova-3 streams in multilingual mode, plus Hinglish. **Answer in**: "Same as the interview" by default, or any other
  (hear Hindi, answer in English). Remembered on the device, saved with a setup, shown on the session list and page.
  `ORBIT_LIVE_LANGUAGES=false` hides them and makes every live session English again (DECISIONS D62).
- **Transcription**: `language=multi` for Hindi, Hinglish and Auto; Nova-3's own model for the others; English timings
  and keyterms in every language; filler words on the mic in English only.
- **Question detection**: each line is read in its own language (`live/multilingual.py`, cue tables in
  `live/language_cues.py`): question words, requests, yes/no openers and Japanese か endings, fillers, check-ins,
  follow-ups, unfinished endings, question types and size cues, scored like English; English lines (also inside a
  Spanish or Hindi session) go to the English detector as they are. Words in every script (Devanagari vowel signs
  kept; Japanese by script runs). Fixed on the way: two Hindi questions read as one duplicate, Hindi backchannels or a
  real answer by the candidate weren't seen, and a Hindi final that Deepgram delivered after the candidate had started
  answering swallowed the next question.
- **Answers** in the answer language and its interview register (tú/usted, vous, Sie, です・ます, आप), code and the
  format's labels in English, length targets that keep their speaking time (Japanese counted in characters), token
  budgets grown for the script. The classifier, the review, the follow-up email and the rolling summary know the
  language; the report says what it's written in (`language`); speaking stats count words in any script without the
  English pace and filler tips. Read aloud uses a voice in the answer language.
- **Rendering**: non-Latin text in the answer card, question card, transcript and chat is tagged with its language so
  the right face draws it (system Devanagari and Japanese faces after IBM Plex in the shared stack; Plex Cyrillic on
  the web, fetched only for Russian), with taller lines for Hindi and Japanese. Key points tick in any script.
- **English is unchanged**: a golden comparison against main of detection (every field) over 70 English lines, turn
  clean-up, sizing, the Deepgram URL, the classifier request, nine answer prompts, the report prompt, the parser, the
  finalizer and a whole engine run is byte-identical; Auto-detect reads that English corpus exactly as English does.
- **Measured with real providers** on synthetic interviewer audio (Edge neural voices, a statement then two
  questions per language, a candidate answering after each; 15 Deepgram streams, 9 DeepSeek calls): character
  accuracy of Deepgram's transcript fr 100%, nl 100%, pt 98%, it 97%, de 96%, es 94%, Hinglish 94%, ru 92%, ja 89%
  (one product name misheard), Auto 88%, Hindi 64% (Deepgram writes the English loanwords in Latin script, which is
  right for spoken Hindi but scores low against an all-Devanagari script; one word dropped). Every question fired in
  every language (Auto 3/3), no statement did, 1.8–3.0 s after the speech ended on Balanced timing. Answers came back
  in the right language and script in all eight answer checks, first words in 0.7–1.0 s.
- API: `GET /v1/auth/me` `live_languages`; `POST /v1/sessions` and saved setups keep `language` / `answer_language`
  (PROTOCOL.md). No migration. Tests: `tests/test_live_languages.py` (102), `packages/ui/src/live/languages.test.ts`
  (9); `tests/test_english_only.py` now runs with the flag off. Needs a desktop release for the desktop pickers.

## Web flow sweep: what a click got wrong (2026-10-18)

Every screen driven on a local stack (mock AI), at 1440×900, 820×1180 and 390×844, light and dark. Fixed:

- **Documents**: the page said and checked "up to 10 MB", but the API takes 5 MB; a bigger file failed as "Can't
  reach Orbit" (the refusal carries no CORS headers). It now says 5 MB and refuses the file before sending.
- **Billing**: a purchase's result (added, a failed card, back from PayPal) sat under every pack on a phone and far
  below a plan's button, so a purchase looked like it did nothing; it now scrolls into view. Outside India with
  dollar checkout off, the note no longer says "Pay once over UPI"; it says paying in dollars isn't open yet, with
  a link to tell us. India's wording is unchanged.
- **Live session setup** ticks at most 20 documents (the API's limit), the newest resume and job post first, the
  same rules as the desktop's Setup: past 20 saved documents Start was refused ("at most 20 items").
- **Support chat**: `X-Orbit-Support-Token` is allowed through CORS, so a reopened chat reads its thread when the
  API is on another origin (local dev, e2e; production web goes through the same-origin proxy). Send waits for
  the chat to open, instead of dropping a message sent while it was opening.
- **Session Q&A** lists answers no detected question carries: chat answers, and every answer after "Delete
  transcript" (which keeps them, as it says).
- **Not found**: a deleted resume, session or coding problem says "That … isn't here" with a link back, instead of
  the API's message with no way out or a Retry that can only fail.
- **Offer form**: the joining bonus is "In lakh", not "In lakh a year", and equity and other pay say their unit.
- **My answers**: a short answer takes "a few seconds" to say, not "about 1 min".
- **Admin payments**: the tab's count drops as soon as a payment is approved or rejected.
- **Plans**: the Free card says "Your current plan" only on the free plan, not for the admin's Unlimited or a plan
  given for a while. **Tracker numbers**: a job added straight in as interviewing no longer makes "Typical wait: 0
  days" before any answer; a real answer within the day reads "Same day".
- **Practice**: the preset a link points at (`/mock?preset=hr5`) is ringed again (the app shell's cards had
  dropped the box-shadow a ring is drawn with).
- `tools/e2e/web-flow-sweep.spec.ts` covers the upload limit, the purchase message on a phone, the dollar note,
  22 saved job posts on /start, the support chat across origins, not-found pages and the offer form's units.

## Referrals: invite links, creator and campus codes (2026-10-18)

- **Off until switched on** (`ORBIT_REFERRALS`, DECISIONS D61). Defaults to review first: a friend gets 10% off their
  first purchase (`ORBIT_REFERRAL_DISCOUNT_PERCENT`), the inviter 30 interview minutes when that payment lands
  (`ORBIT_REFERRAL_REWARD_MINUTES`), at most 10 a month (`ORBIT_REFERRAL_MONTHLY_CAP`). docs/BILLING.md "Referrals".
- **Invite friends** on Plan & billing: the account's link (`/r/<code>`), Copy, Share and WhatsApp, and how many
  joined, paid and the minutes earned. A link's code is kept first-party for 30 days and sent with the sign-up, with
  a password or with Google; the sign-up page says what it gives.
- **Have a code?** on Plan & billing, before the first purchase: a creator's, a campus's or a friend's. Its discount
  comes off the order on the server (Razorpay, PayPal and UPI, ₹ and $), the prices on the page show it, and the order
  keeps the code and what came off.
- **The reward is paid once**, inside the approval of the friend's first payment, whichever of the checkout, the
  webhook, the reconciler or a UPI approval confirms it. Self-invites (same account, inbox or network, or two accounts
  inviting each other) are blocked; a refund or chargeback takes back the reward minutes not used yet and flags it.
- **Admin → Referrals**: make creator and campus codes (label, discount, commission, expiry, max paying accounts),
  switch them off, and see sign-ups → paying → revenue (₹ and $ apart) → commission owed per code, with a CSV export
  and a list of blocked and refunded referrals to look at.
- Migration `467956f519dd`: `referral_codes`, `referrals`, `payments.referral_code_id` and `payments.discount_minor`.

## Rupee prices cut, dollar prices unchanged (2026-10-18)

- **India pays less** (DECISIONS D60): about 30% under Parakeet AI's own rupee prices, as the owner checked them today.
  Credits: 1 credit ₹2,299 → ₹1,649, 3 credits ₹3,599 → ₹2,599, 8 credits ₹7,199 → ₹5,199, 15 credits ₹10,899 →
  ₹7,749; AI credits stays ₹499. Unlimited: Weekly ₹4,799 → ₹3,499, Monthly ₹9,199 → ₹6,599, Yearly ₹35,999 →
  ₹26,499 (≈ ₹2,178 a month). Minutes and credits in each pack are unchanged.
- **Everyone else pays what they did**: each pack and plan has its own dollar price now (`price_usd_cents` in
  `billing/packs.py` and `billing/monthly.py`, also accepted in `ORBIT_CREDIT_PACKS_JSON` / `ORBIT_MONTHLY_PLANS_JSON`),
  pinned at $7.99 / $33.99 / $53.99 / $106.99 / $161.99 and $70.99 / $135.99 / $531.99. Before, a dollar price was
  the rupee price converted, so the cut would have taken dollars down with it. A test pins every dollar price.
- The pricing pages, Plan & billing, the out-of-credits offers and the support bot read the prices from the server,
  so they show the new ones as they are. The support bot's typed-price matching knows the new rupee numbers.
- An order opened before the cut is still settled at the price it was made for, by the checkout, the webhook or the
  reconciler (test added); a payment of the new price against an old order isn't taken as paying it.
- docs/BILLING.md: the price tables (with Parakeet's rupee prices and the dollar column), the dollar-pricing rules,
  and the stale credit-pack table at the top replaced by a pointer.

## Company and role interview guides, readable without JavaScript (2026-10-18)

- **A question bank of 100 company guides and 32 role guides** (was 25 guides with about four questions each):
  1,934 practice questions (1,389 for companies, 545 for roles), each with what a good answer covers. Companies:
  India's IT-services firms (TCS, Infosys, Wipro, HCLTech, Tech Mahindra, LTM (formerly LTIMindtree), Cognizant,
  Capgemini, Accenture…), Indian product companies (Flipkart, Swiggy, Zomato, Razorpay, Paytm, PhonePe, CRED, Meesho,
  Zoho, Freshworks…), global tech, consulting and the Big Four, banks and payments, and industry and public-sector
  employers in India, Europe, the UK and the US; 88 of them cite the company's own pages they were checked against
  (170 links). Roles: campus placement, MBA placement, software, data, product, design, business, core engineering,
  teaching and nursing. Each guide: a hedged summary, the rounds candidates commonly report (an "Outside India"
  version where India's are campus-specific), what interviewers listen for (the company's published values where it
  has them), questions by section (behavioral, role and technical, fit), tips, the company's own pages it was checked
  against, and the date.
- **Written by Orbit and checked by the build** (DECISIONS D63): one JSON file per guide in
  `apps/api/orbit_api/question_bank/`, validated against `schema.py` when the API starts, by the tests and by
  `uv run python -m orbit_api.question_bank`. It refuses "real", "actual", "leaked" or "asked at" questions, question
  sites by name, pay figures, head counts and promises, and a process stated as certain. The guides say they're
  practice questions in the style of a company's interviews and that Orbit isn't affiliated with it.
- **Public pages**: `/companies` and `/roles` (grouped, searchable) and a page per guide, with "Practise a mock
  interview in its style" (Practice, with the company or the role and its round filled in) and "Warm up free on these
  questions" (`/warmup?track=company:<slug>`: the free warm-up on that guide's questions, no account). Linked from
  the public footer, the phone menu, Practice and the company card there ("The full guide").
- **The mock interviewer and the copilot use them**: the 25 old guides' text is unchanged and every new company is
  matched the same way (the Mission Room's Company tab and Practice's "What to expect" too); a typed role ("Senior Data
  Analyst", "SDE-2") now finds its role guide, so a mock asks what that job's interviews test and the live copilot
  knows what its interviewers check. `/v1/interview-styles` adds each company's `market`, so Practice suggests
  India-only companies only in India.
- **Readable by crawlers and assistants that don't run JavaScript**: the build renders the public pages to HTML with
  the app's own components (`src/prerender`: one registry of public routes with title, description, canonical
  address, preview image, structured data and date; the sitemap comes from it). The guide pages are files the assets
  serve; the front page, Resume AI, Jobs AI, the warm-up, Contact and How Orbit works are served built by the Worker
  (`worker/prerendered.js`), except a signed-in visitor's own home. The app takes over when it loads, in the same frame
  (`lib/prerender.tsx`). Structured data is breadcrumbs, the page and who publishes it: no ratings, reviews or FAQ
  markup. The sitemap has 144 addresses (was 10); robots.txt allows /companies and /roles.
- **The warm-up** is titled as a free alternative to Google's Interview Warmup (saying Orbit isn't affiliated with
  Google) and links to the guides.
- Sign-in from a link with a query (`/mock?company=Amazon`) now comes back to it with the query.

## Design round 3: one workbench, in both themes and on phones (2026-10-18)

- **Dark mode is the light theme's twin** (DECISIONS D58): the dark canvas finally applies (the body's own
  `dark:bg-zinc-950` had outranked it), and inside the workbench the ink's darkest steps are the canvas/surface/line
  family, so bars, fields, dialogs and cards are one blue-grey, not violet black under blue-grey cards.
- **The live session is part of the workbench**: a still canvas and opaque panels instead of the sky, no glow around
  the panel; Answer, the auto-answer switch and the chat bubble are the solid accent; the timer and capture pill use
  the product face; the architecture critique is a strip, not a card in a card. The video interview room loses its
  gradients and backdrop wash.
- **No glow left in the app**: empty states show the Orbit scenes (`CosmicEmptyState`) or a flat `SpotIllustration`;
  Home's tool cards lose their colour glow, spotlight and corner orbits; Practice's picture is the PracticeScene; Resume
  AI's first visit drops its blurred blobs and gradient stage; the saved-setup panel, the job page header and the
  pricing cards are flat. Cards that are links darken their border instead of rising; loading placeholders are ink.
- **Consistent pages**: `PageHeader` keeps its actions beside a long subtitle, takes a `back` link (`BackLink`: All
  sessions, All offers, All problems, Tracker) and shows its icon from `sm` up; session and offer detail actions are
  regular size; the copilot's Sessions page has one way to start a session; the Resume AI pointer is a quiet line at
  the foot of the copilot's library pages.
- **Rows line up**: fields and regular buttons are all 38 px (every button variant has a 1 px border), so a field
  and its button sit level (Offer AI's pay check, LinkedIn AI's link, Settings, the Evidence finder). Buttons cast no
  shadow; danger text is rose-700.
- **Accent only where it means something**: section icon tiles are the neutral `IconTile`, heading icons and the
  mission's "Next step" are ink, the Resume AI page's Jobs AI card has no AI chip, "Get credits" is bordered while
  credits are left (amber when they're out), and every pricing badge is the accent pill.
- **Sentence case**: small labels and table headings across the app and the live components drop tracked capitals;
  the front page's loop labels drop cyan mono.
- **Phones**: a long mission title wraps instead of being cut; Resume AI's Preview button sits centred, clear of the
  support button; the editor's toolbar fits one row on desktop and wraps cleanly on a phone; the LinkedIn link field
  has a real width. No page scrolls sideways at 390 px.
- **Accessibility**: a fuller axe sweep (every page, detail pages included, both themes) found three issues the old
  route list missed (names that didn't include the visible words, a scrolling preview the keyboard couldn't reach,
  Delete at 4.3:1); all fixed, 0 violations.
- **One component system** (`packages/ui`, shared with the desktop app; DESIGN.md "Components"): elevation tokens
  (menu < popover < dialog < toast) and a z-index scale; overlay motion (dialogs fade in from 97%, phone sheets rise,
  menus drop, side panels slide; fades at Gentle). Button gains `destructive` and `link`, a spinner that keeps the
  width, pressed styling and `block`; IconButton, ButtonGroup, MenuButton, SplitButton, Popover, Tooltip, Callout,
  Badge, Kbd, Checkbox, RadioGroup, Slider, SearchInput, SegmentedControl, Table (sortable header, phone card view),
  StatTile, Avatar, ProgressBar, Stepper, Pagination, Breadcrumbs, Tabs, DialogActions; Field gains `required`,
  `error` (wired to the control) and `counter`. Adopted across the app: the confirm dialog, the New and account
  menus, the command palette, toasts (info and warning tones), Documents and admin tables, status pills, the tracker's
  numbers, a session's tabs, Settings' appearance switches, banners, shortcut hints, icon actions and dialog footers.
- **An illustration per product**: six new Orbit scenes (copilot, offer, stories, answers, evidence, documents) join
  the set, and every product's empty screen shows its own.
- **`/dev/components`**: a gallery of every component in its states, in development builds only.
- Docs: DESIGN.md (dark twin, live session, field heights, sentence case, page header, empty-state art, the component
  inventory with tokens and do/don't), D58.

## API follow-ups: plans on their own clock, atomic allowances (2026-10-18)

- **Plans for a while** (paid months and admin grants, DECISIONS D57): allowances run in 30-day windows from when the
  plan was bought or given, so use from before never counts, and every window (a week's too) has the plan's whole
  allowance (Premium: 3,000 live and 1,500 mock minutes); and a new plan never cuts short time already given or paid:
  the same plan bought again follows on with its own whole allowance (a week renewed early too), a higher one runs now
  with the rest of the other waiting behind it, a lower one waits its turn. A paid week no longer ends an admin's
  Unlimited. Migration `c6e8a0b2d4f6` adds `users.grant_started_at`, `grant_paid`, `grant_queue` and backfills the
  start of running grants. The Weekly pricing card says its hours are "to use in the week" instead of "a month".
- **Allowances checked atomically**: screenshot uploads at the same moment can't overrun the month's (answers being
  written count), the natural voice's daily characters are taken before the provider is asked, and a Free account
  counts only screenshots taken on Free.
- **Credits and limits**: a cancelled resume AI request (the client went away) gives its credit back; a garbled code
  review doesn't use one of the day's, and the day ends at the person's own midnight.
- **Accounts**: a Google-only account sets a password only after a recent sign-in (as for two-step sign-in and
  passkeys); Google sign-in's limit and "not set up" answers go back to the sign-in page instead of bare JSON.
- **Smaller fixes**: a UTR is accepted only on a manual UPI order; the Jobs mission's "today/tomorrow" uses the
  person's day (`tz_offset`); suggestions parked on a resume have bounded text; voice usage names only the caller's
  own session; the live connect reads a session's metered time through the usage index.
- The shared client sends `tz_offset` for the mission and code AI calls; the desktop app picks it up in its next
  release (until then it's UTC, as before).

## The three switched-off features, checked before they're switched on (2026-10-18)

- Hindi/Hinglish mocks (`ORBIT_MULTILINGUAL`), the camera coach (`ORBIT_VIDEO_MOCK`, in Practice and the AI video
  interview) and the Career Evidence Vault (`ORBIT_EVIDENCE_VAULT`) were driven end to end with each flag on: headless
  Chrome at 1440×900 and 390×844, light and dark, a fake camera only (a public-domain portrait, and Chrome's default
  with no face), axe, other users' data, the export and account deletion. Fixed:
- **Hindi and Hinglish one-tap rounds were in English.** The 5-min HR round and "Tell me about yourself" ask fixed
  questions, which were English whatever the Language picker said, and so were a drill's lead lines ("Let's try this
  one again"). Both are now in the round's language (`apps/web/src/pages/mockPresets.ts`,
  `practice_language.DRILL_LEAD`); "हमारी कंपनी" / "hamari company" names the company as "our company" does.
- **A Hindi review could be cut off.** The same text costs about 2.2x the tokens in Hindi (1.5x in Hinglish, measured
  with DeepSeek-V3's tokenizer), and the review's output budget was sized for English, so its JSON could stop half-way
  and the round got no review. The review's and the interviewer's budgets now grow with the language
  (`practice_language.max_tokens`, at most 8,000).
- **The video interview's controls on a phone.** With the camera coach's button, seven 48 px buttons pushed Mute mic and
  End off screens 360–437 px wide. Below 440 px they're 40 px (`tools/e2e/video-room.spec.ts` checks 360 px; the e2e
  API now runs with `ORBIT_VIDEO_MOCK=true`).
- **The camera trend** showed a session where no face was found as "0%" facing the camera; it shows "–" now.
- **Evidence:** the "It's true" button's accessible name starts with its visible words (axe: label in name).
- **Privacy policy:** the camera coach saves how long it measured as well as the three numbers it named.

## Desktop sweep: Setup, the window and shortcuts (2026-10-18)

- **Start works with many saved documents**: New session ticked every ready resume and job description. Jobs AI
  saves a job description for every job prepared, so an account past 20 couldn't start any session ("List should
  have at most 20 items after validation, not 22"). The default is capped at the session limit and keeps the newest
  resume and job description; a 21st tick is refused with a note (`apps/desktop/src/sessionDocs.ts`).
- **Quick starts keep their type**: Home's "Coding" or "Meeting" no longer lands on the last saved setup's type (the
  saved setup still fills in the role, documents and notes).
- **A microphone plugged in during New session** clears "No microphone found", which held Start back until the
  screen was left: the list is read again on focus, on the refresh button, and every 3 s while there's none.
- **The window stays on the screen**: the expanded panel (Home, History, Settings, a session opened expanded) is never
  bigger than the screen's work area, and a window inside it moves up or left as it grows, so a small laptop's
  taskbar no longer hides a session's Answer / Pause / End bar. A window put partly off-screen stays where it is.
- **An unpinned window stays unpinned** at the next launch (the live window's pin applied only once a session opened).
- **"Open" on Home** opens that session's review, not the History list.
- **Mock rounds are titled "Mock interview — role"**, not "Mock interview — the AI asks, you practise — role".
- **Global shortcuts register one change at a time**: two quick changes in Settings could leave a shortcut dead and
  marked "Taken by another app".
- Checked on an isolated test build against a local mock API, with the audio and screen capture commands stubbed in
  the webview. Needs a desktop release.

## API bug sweep after the read-only database incident (2026-10-18)

- **A read-only database fails readiness** (DECISIONS D56): `/ready` asks Postgres whether writes are refused
  (`transaction_read_only`, `pg_is_in_recovery()`) and answers 503 `"database": "read_only"`; the admin Overview
  warns (`database_read_only`). The device "last used" touch no longer turns every signed-in read into a 500 when
  the write is refused.
- **Google sign-in never ends on a bare 500**: an unexpected error in the callback is logged, rolled back (no half
  made account) and sent to `/login?error=server`, which the sign-in page explains.
- **Two-step sign-in and passkeys work for accounts made with Google** (they were refused with "That password isn't
  right"); with no password to ask for, a sign-in in the last 15 minutes stands in for it. Wrong codes to turn two-step
  sign-in off or make new recovery codes are throttled like sign-in's (5 per 15 minutes).
- **Resume credits match what was delivered**: "Fix with AI" no longer spends a credit when nothing the AI wrote could
  be used, a later AI pass failing no longer refunds the earlier passes' delivered work, and a tailor-queue job cut
  off by its timeout or a deploy gives its credit back before the retry pays.
- **Sign out everywhere** also voids live-session tickets minted in the minute before it.
- **Job alerts**: weekly profiles not yet due no longer fill every sweep and starve daily alerts.
- **Jobs mission**: copying a sent version keeps to the 20-resume limit.
- **Practice streak** counts the person's own days (`/v1/progress?tz_offset=`), not UTC ones.

## Render retired (2026-10-17)

- The old Render service is suspended (DECISIONS D55): the API runs only on Railway, at `api.orbitanswer.com`.
  Desktop 0.1.40 and older called Render directly and need a fresh install from orbitanswer.com; 0.1.41 and the
  website are unaffected.
- The Worker's cron no longer pings Render (`LEGACY_API_URL` removed), `render.yaml` is deleted, and the API no
  longer reads `RENDER_GIT_COMMIT` / `RENDER_EXTERNAL_URL`. docs/DEPLOY.md and docs/BILLING.md name Railway and
  `api.orbitanswer.com` (Razorpay and PayPal webhook URLs included).

## Screenshots of the whole problem, not its first screen (2026-10-17)

- **"Scroll to the end"** on the desktop's screenshot screen (a switch, remembered; also a button on the preview of an
  ordinary capture): drag over a coding problem longer than the screen and Orbit turns the mouse wheel over it, one
  notch at a time, captures each screen once the scroll settles, and joins them where they overlap
  (`apps/desktop/src-tauri/src/scroll_capture.rs`). Then it scrolls the problem back and puts the mouse where it
  was. Moving the mouse stops it early; the preview says why a capture stopped ("the mouse moved", "the screens
  stopped lining up", the length limit, or "that area didn't scroll").
- **Joined cleanly**: a pane's tab bar and its Run/Submit bar come once, not between every screen; a sliver of the
  editor dragged in beside the problem and the pane's scrollbar are cut off; a ticking timer or a hover highlight
  doesn't stop the join. Orbit's own window floating over the problem is left out of the captures for those seconds
  (still on screen; back to the user's Window privacy choice after), or it would have been joined in again and
  again.
- **Read whole by the model**: the server cuts a tall capture into overlapping parts about a screen high
  (`apps/api/orbit_api/live/shots.py`, at most 8) and tells the model how to read them in order; still one
  screenshot, one answer, one credit, nothing stored. "Try again" and "now in Java" send every part again.
- Checked on a long practice problem rendered by Chrome at 100% and 150% scaling: every step lines up, and the joined
  image is the whole problem, tabs and buttons once. Test builds compiled with `ORBIT_SCROLL_DEBUG_DIR` write each
  capture and step there; `ORBIT_SCROLL_FRAMES=<dir> cargo test --lib joins_frames_from_a_folder -- --ignored`
  joins saved frames offline. Windows only (DECISIONS D54); the web app keeps single screenshots. Needs a desktop
  release.
## The API moves to Railway, behind api.orbitanswer.com (2026-10-17)

- **One address for every client**: the web Worker's `API_URL`, the web app's live sockets and the desktop app
  (from 0.1.41) use `https://api.orbitanswer.com`, a DNS-only `CNAME` to the Railway service (Singapore). A future
  host move is a DNS change; installed apps follow it with no release (DECISIONS D53).
- **Railway-aware API**: `/health` reports the commit from `RAILWAY_GIT_COMMIT_SHA` (Render's `RENDER_GIT_COMMIT`
  still works); download links use `ORBIT_API_PUBLIC_URL`, else the host's own address (`RENDER_EXTERNAL_URL`, then
  `RAILWAY_PUBLIC_DOMAIN`).
- **The move, gently**: Render keeps serving desktop 0.1.40 and older (and offers them the update) until they've
  moved on; the Worker's cron keeps it warm meanwhile (`LEGACY_API_URL`, to be removed with the Render service). A
  saved server override naming a retired Render address is ignored by the desktop app.
- **A warning for a proxied API record**: the admin Overview says so when desktop calls arrive through Cloudflare's
  proxy (`api_cloudflare_proxied`), where every user near one edge would share sign-in limits and welcome credits.
- Docs: DEPLOY.md's Railway section and the cutover steps; `render.yaml` marked legacy.

## Jobs AI outside India: 117 more company boards, SmartRecruiters per country, pay from Greenhouse, a gentle refresh (2026-10-17)

The company boards were chosen for India. Outside it, a feed had the global companies' posts (Stripe, Databricks,
Okta…) and little else: SmartRecruiters was asked for India's posts only, and Offer AI's pay ranges had almost
nothing outside the US. Now:

- **117 more boards** hiring in the US, the UK, Canada, Germany and the rest of Europe, and Australia, each checked
  live with the feed's own parsers (`companies.py` goes from 147 to 264): 69 on Greenhouse (Anthropic, Airbnb,
  Datadog, Waymo, DoorDash, Robinhood, Deliveroo, Monzo, HelloFresh, GetYourGuide, Adyen, Culture Amp…), 5 on Lever
  (Spotify, Zoox…), 39 on Ashby (Notion, Ramp, Plaid, Harvey, Cohere, Wealthsimple, Wayve, ElevenLabs, Enpal…) and
  4 on SmartRecruiters (Ubisoft, Canva, Western Digital, Delivery Hero). Left out: boards over the 30 MB answer cap
  (Anduril, SpaceX), with plain-http job links (Block, Squarespace), or mostly gym or catering jobs (Equinox, Sodexo).
- **SmartRecruiters is asked one country at a time**: India as before (the same calls, first), then each of
  `ORBIT_JOBS_BOARD_COUNTRIES` (default US, GB, CA, DE, AU) for the boards that aren't India-first. Swiggy, PhonePe and
  ixigo stay India only.
- **Pay from Greenhouse**: the pay range a post publishes (`pay_transparency`, required in most of the US and Canada)
  is its salary, so Offer AI's market has Greenhouse boards' ranges too. A post that's also open in India shows only a
  rupee range (a dollar one is the US pay).
- **India**: its boards, their order and SmartRecruiters' India calls are unchanged; every post an India user could be
  shown before still is, with the same card. The new boards' own posts in India or open to it are listed too (84 in
  this run: Supabase, Ubisoft in Pune, ZoomInfo, ElevenLabs, Anthropic…).
- Posts listed by country, from a real first refresh of every keyless source (local, real network): US 1,757 → 6,222,
  UK 269 → 1,331, Germany 113 → 1,186, Canada 255 → 744, Australia 89 → 220, India 2,187 → 2,243 (5,943 → 14,207 in
  all). With a pay range: US 449 → 3,092, Canada 72 → 319, UK 11 → 75.
- The cost, the same machine and network back to back: a first refresh of an empty cache takes 382 s → 1,132 s
  (SmartRecruiters' 183 country lists and ~2,000 text calls, a second apart; every other source is done by 502 s)
  and 108 → 236 s of CPU, nearly all of it reading skills from new posts. A refresh 6 hours later takes 204 s → 893 s
  and 25 → 53 s of CPU (for the first day it also fetches the text of SmartRecruiters' posts still without it, 40 per
  board and country a run). Peak memory over both is about the same (190 → 198 MB working set; measured unpaced, two
  boards at a time). The cache grows from 46 to 103 MB (SQLite; 33 → 74 million characters of post text).
- **Gently**: this first went out as #355, and its first refresh crash-looped the API on its free instance (a tenth of
  one CPU): reading skills from thousands of new posts took all of it, health checks waited seconds, the host
  restarted the server, and the restart started the refresh again. #357 reverted it. Now the refresh stays a small
  background load wherever the API runs ([DECISIONS.md](DECISIONS.md) D52): its own CPU work is kept to
  `ORBIT_JOBS_CPU_SHARE` of one CPU (0.04 by default, `job_portal/pace.py`); it reads one board at a time across
  sources (was two) and at most 12 of a source's due boards a run (never fetched first, India's first, then the
  longest waiting), with 10 minutes' rest between a source's runs; it writes 100 rows a transaction with a pause after
  each; and ranked feeds re-rank at most every 5 minutes while it writes, not after every board. A first pass of every
  board now takes several runs (SmartRecruiters' 183 lists about 4 hours, inside their 6-hour TTL). Where CPU is
  billed by use, the pacing also caps what the refresh costs.
- Measured under a 0.1-CPU, 512 MB cap (the worst case: a Windows job object around a local API, an empty cache, the
  real network, `/ready` every 2 s and the feed every 30 s until the refresh went idle):

  | | `/ready` over 5 s | slowest `/ready` | slowest feed | peak memory | server CPU |
  | --- | --- | --- | --- | --- | --- |
  | before #355 (India's boards, unpaced) | 21 of 160, 15 s in a row at worst | timed out | 35.6 s | 163 MB | 41 s in 8.2 min |
  | now (every board, paced) | 0 of 461 | 0.30 s | 1.5 s | 157 MB | 31 s in 15.3 min |

  The paced run is each source's first run (12 boards each of Greenhouse, Lever, Ashby and SmartRecruiters, and the
  feeds): 1,992 posts (India 1,084, US 431, Canada 93, UK 59, Australia 28); the rest arrive in the later runs.

## Orbit for the US, the UK and everywhere else, with India kept as it is (2026-10-17)

- **Prices and payment text in the visitor's currency everywhere**: the support bot's prices and payment answers
  (PayPal abroad, no UPI or UTR chips), the out-of-credits message and dialog, the Free tier and comparison while
  plans load, Help, Contact, the front page and the Resume AI page. India's wording is unchanged.
- **Signed-out pages know the visitor's country**: `GET /v1/region` returns the country Cloudflare saw, and the web
  uses the saved country, then that, then the browser's guess (no cookie). Password and Google sign-ups keep it.
- **Resume AI by country**: GPA, or First/2:1 in the UK, instead of CGPA; local schools and degrees; no Class 10/12,
  date of birth or declaration outside India; "Student / new grad" and a Graduate template; US/CA resumes start on
  Letter; a sample resume per country.
- **Jobs, Practice, Offer AI and onboarding**: Naukri only in India; local examples, cities and outreach; "Entry
  level" and "recruiter screen" outside India; Hindi only in India; Offer AI leads with first-year value abroad and
  says monthly take-home is India-only for now; EUR and other currencies work; "Base salary / Target bonus /
  Signing bonus". Scam reporting by country (FTC and IC3, Action Fraud).
- **Policies**: terms, refund, privacy and cookie pages cover US dollars and PayPal; UK and EU buyers get a 14-day
  cancellation right and a GDPR section. The AI model provider is named by its role.

## The API outside India: each user's own job market (2026-10-17)

- **Google sign-up** keeps the country it came from (Cloudflare's, through the web app), as a password sign-up keeps
  the browser's guess. Signing in again never changes it; Settings does.
- **No country saved yet:** job search, portals and cities, the LinkedIn audit's keywords, Offer AI's pay range and
  the Practice page's company guides follow where the request came from, then India as before.
- **Live copilot:** told the job market and its currency outside India ("Job market: the United Kingdom… in GBP"),
  and a student or new graduate is ENTRY-LEVEL there; India's prompt is unchanged, FRESHER and all.
- **Mock interviews:** a panel outside India is Emma, Daniel, Maya, Omar and James (India keeps Anita, Rahul, Meera,
  Arjun and Vikram). Accenture's spoken-English test, Cognizant's GenC rounds and Deloitte's group discussion are
  India's only; elsewhere those guides read as candidates there report them, and Google's estimation question is set
  in the user's biggest city (New York, London) instead of Bengaluru.
- **Offer AI:** the plan for an offer that isn't in rupees says base salary, target bonus and signing bonus (a rupee
  offer keeps fixed pay, variable and joining bonus). A new offer sent without a currency gets the user's own. A "$" in a Canadian,
  Australian, New Zealand, Singapore or Hong Kong post is that country's dollar ("CA$", "A$", "S$" read as written),
  and pay lines naming CHF, SEK, JPY and other local currencies are read.
- Small words: the search box says "Entry level" outside India; a referral request is "LinkedIn or email" outside
  India; the contact form's phone hint says "your country code", not "+91".

## PayPal for buyers outside India (2026-10-17)

- **Outside India, plans and packs are paid in US dollars through PayPal**: a PayPal account, or a card where PayPal
  offers guest checkout. Buy goes to PayPal's own page, and the buyer comes back to Plan & billing with it added.
  Backing out at PayPal says nothing was charged. Buyers in India keep Razorpay (or UPI) in rupees.
- Credited only when PayPal says the capture COMPLETED for exactly the order's amount, once: on the buyer's return,
  or by PayPal's webhook or the reconciler when they approved and closed the tab. A pending capture shows as
  "Confirming with PayPal"; refunds and chargebacks are recorded, and the credits are kept.
- Off until `ORBIT_PAYPAL_CLIENT_ID` and `ORBIT_PAYPAL_CLIENT_SECRET` are set (`ORBIT_PAYPAL_ENV` sandbox or live,
  `ORBIT_PAYPAL_WEBHOOK_ID` for webhooks). Set-up steps in docs/BILLING.md.
- Payment history and the admin's Payments show a dollar refund in dollars (it said ₹).

## Two-step sign-in (2026-10-16)

- **Settings → Two-step sign-in:** scan a QR code with an authenticator app (Google Authenticator, Microsoft
  Authenticator, 1Password and others) and enter its code. You get 10 single-use recovery codes, shown once.
- **Signing in** with it on: after the password, or after Google, Orbit asks for the 6-digit code (or a recovery
  code). This works on the web and in the Windows app, including its "sign in again" prompt.
- Codes can't be reused, wrong codes are limited to 5 per 15 minutes, and turning it off needs a code. The secret is
  stored encrypted; recovery codes only as hashes.
- The export says whether it's on and since when; never the secret.

## Settings → Devices: sign out one device (2026-10-16)

- **Settings → Devices** lists where the account is signed in ("Chrome on Windows", "Safari on iOS", "Orbit for
  Windows"), when each signed in and when it was last used, and marks "This browser".
- **Sign out** on any one ends it at once: its token stops working on its next request, even a copied desktop token.
  "Sign out of all devices" still ends them all.
- Signing out in a browser now ends that device on the server too, not only its cookie.
- Each sign-in is a row in `user_sessions`, named by the token's `sid` (kept across renewals). No IP address is
  kept, only a coarse name from the browser. Tokens from before this change keep working until they expire, so
  nobody is signed out by the update. The rows are in the data export and deleted with the account.

## Job Mission Room: Company tab (2026-10-16)

- **Company** in the Mission Room: how the company interviews (Orbit's guide when it has one: the rounds, what they
  listen for, tips, as candidates commonly report it), and **what it asked you before**. Those are the questions from
  your own sessions named for that company, with when the last one was and the stories you've already told them. Then
  one link to practise in the company's style.
- Nothing is shown as "the questions they'll ask". With no guide, the job post is the guide.

## Offer AI: What if (2026-10-16)

- **What if** on each offer: sliders for a raise or cut on the fixed pay (−30% to +50%), how much of the variable is
  paid out, the joining bonus, and what the equity turns out to be worth. The offer and the what-if version sit side
  by side, with each change marked, down to the first year and (in India) **each month's in-hand pay to the rupee**.
- The same tax model as the offer itself (new regime FY 2026-27, PF, professional tax), with its assumptions listed.
  Nothing is saved, and the offer doesn't change. `POST /v1/offers/{id}/scenario`, owner only, no AI.

## Speaking feedback: pauses and time to start (2026-10-16)

- "How you sounded" on a session gains **Time to start** (the median time from the end of a question to your first
  words) and **Pauses mid-answer** (silences of 3 s or more inside one answer). Both come from the transcript's own
  timings, with no AI.
- A new tip when answers usually start after a long silence: a short opener fills it.
- **How these are measured** (folded under the card): approximate, and about how you spoke. Nothing about how good
  an answer was, how confident you are, or how you'll be judged. One older tip that mentioned "confidence" is
  reworded to match.

## Interview prep plan with countdown (2026-10-16)

- **A day-by-day plan to the interview** in the Job Mission Room's new **Prep plan** tab. It opens first when the job
  has an interview date. Each day has up to three tasks:
  - an example for an open requirement from the fit check;
  - a mock round;
  - the practice questions due again;
  - STAR stories until you have three.

  The day before and the interview day are light: warm-up, logistics, review. Every task has a **Start** link and a
  tick.
- **It follows the date:** move the interview in the tracker and the plan is rebuilt. Ticks on the old interview
  day's tasks don't carry to the new days.
- **Home:** "Coming up" shows the nearest plan's progress.
- No AI and no cost: built from your own records. New table `job_plan_checks` (in the export, deleted with the job).

## Job Mission Room (2026-10-16)

- **One tracked job as a workspace** (`/jobs/mission/<id>`). Open it from the tracker ("Mission room"), a job's page
  once it's tracked, or Home's "Coming up".
- **Six stages:** Discover, Prove, Prepare, Apply, Interview, Negotiate. Each is ticked only when a record exists
  (a fit check, a linked resume or practice round, applied, interviewing, an offer). There are no percentages.
- **Next step with the reason:** for example, "Practise for this interview. Why: it's in 2 days." "Not now" hides it
  for 3 days on this device.
- **Evidence & fit:** each requirement quotes the job post next to the resume line that shows it. One the resume
  doesn't show says so: "add it only if it's true".
- **Resume kit:** pick the resume for the job, then **freeze the version you sent**. The copy outlives later edits
  and even deleting the resume, and opens again as a new resume.
- **Practice, Timeline and Offer:** rounds counted for the company, the job's journey, and an offer from Offer AI,
  linked by you (never matched by name).
- **Data:** a new `resume_snapshots` table and `job_offers.application_id`. Both are in the account export and are
  deleted with the job or the account. Migration `b7d9f1a3c5e7` round-trips on SQLite and Postgres.
- The journey now says "Resume for this job" (not "tailored"), since a resume can also be linked by hand.

## Redesign, part 2: Home is a Mission Dashboard (2026-10-16)

- **One line on where the search stands**, counted from the tracker. For example: "4 applications in progress ·
  1 offer · next date tomorrow (Hooli)". Nothing is estimated: there's no readiness score and no hiring probability.
- **Two columns on desktop.** The work goes on the left: your next step, due today, follow-ups, **Applications** (a
  count per stage with a thin bar of the same counts, each stage named, never colour alone) and set-up. **At a
  glance** goes on the right:
  - **Coming up:** interviews and follow-ups with a countdown;
  - **Last 7 days:** finished mock and live sessions, and the best ATS check;
  - credits and usage.
- The large "career loop" diagram left Home; it stays on the public front page.
- New `pages/home/dashboard.ts`, with unit tests for every figure.

## Redesign, part 1: a calm app shell with a task sidebar (2026-10-16)

- **Desktop sidebar** replaces the crowded top bar. It's grouped by task: Home; Prepare (Practice, Resume AI,
  Learning AI); Apply (Jobs AI, LinkedIn AI); Interview & offer (Copilot AI, Offer AI). Plan & credits, Settings,
  Admin (admin only) and Support sit at the foot. Every AI tool keeps its AI mark. The sidebar collapses to icons
  (remembered on the device; collapsed by default under 1280 px). Links are unchanged.
- **Top bar:** a wide "Search or jump to…" (Ctrl K), a **New** menu (live session, mock interview, resume, job
  search, offer) and the account menu.
- **Phones:** five destinations (Home, Jobs, Resume, Practice and Explore). Explore lists the other AI tools as
  cards, then plan, settings, admin, support and sign out.
- **Calm surfaces inside the app:** no starfield, dot grid or light orbs behind work, and cards and form fields are
  opaque. The cinematic sky stays on the public pages.
- **Jobs AI** opens with a short header and one primary action instead of a marketing banner.
- The cookie bar now sits beside the support button on desktop, clear of the sidebar.

## Launch hardening, part 2: window privacy is the user's choice (2026-10-16)

- **Desktop window privacy:** the desktop app used to always keep its window out of screen capture and the taskbar,
  while the privacy policy said it didn't hide. Now there are two separate settings, both **off** until the user
  chooses (Settings → Window privacy):
  - a privacy shield (Windows display affinity);
  - hide from the taskbar.

  Home asks once about the shield, in plain words, with nothing preselected. Changes apply to every window at once.
  The region-selection overlay keeps its own protection.
- **Copy matches the code:** the privacy policy (updated 16 October 2026), terms, landing FAQ, README and desktop
  README now describe the shield as optional, as a request Windows doesn't always honour, and as not hiding Orbit from
  Task Manager, other apps or anyone watching.
- **Windows app labelled Beta** (Home card, account menu, landing) with a one-line SmartScreen note, until
  `VITE_DESKTOP_SIGNED=true`.
- Desktop crate builds and tests on Linux again: the non-Windows audio path is updated for cpal 0.18 (`description()`,
  `u32` sample rate, owned stream config).

## Launch hardening, part 1 (2026-10-16)

- **Proxy secret:** in production without a usable `ORBIT_PROXY_SECRET`, `/ready` now answers 503 (`proxy_secret:
  missing`), so a deploy without it fails its health check instead of serving. Welcome credits are held (nothing is
  granted, because one-welcome-per-network can't be enforced on a spoofable address). The admin overview shows a red
  "Proxy secret missing" banner.
- **`/health`** is public, so it now returns only the status and the commit. Provider names and env moved to the
  admin's `/v1/admin/providers`.
- **Browser storage never throws:** every `localStorage` / `sessionStorage` use in web, desktop and the shared UI goes
  through `safeLocal` / `safeSession` (`packages/ui/src/storage.ts`). When storage is blocked or full, values are
  kept in memory for the page. ESLint now rejects direct access.
- **Live session:** closing or reloading the tab mid-interview asks first (the browser's own prompt).
- **Feature-flagged pages:** a link to a page that is off for the account (Evidence) goes back to its section with a
  note, instead of a red "Not found".
- **Cookie note:** now a slim one-line bar with a close button, beside the support button (not over it). It no
  longer covers forms or buttons on phones.

## Saved transcripts keep held-back lines in place (2026-10-11)

- A microphone line that sounds like the interviewer (no headphones: the mic may be hearing them) is held back 1.5 s
  to check before it's shown. It was stored with the time it was released, and stored transcripts are ordered by that
  time, so "Thanks for having me" could land after the interviewer's next line in a session's transcript, and the
  report could pair an answer with the wrong question. It's now stored as of when it was heard.
- A session's summary says "1 question · 1 follow-up", not "1 follow-ups" (web and desktop).

## A session's page on phones; no more "0 min" (2026-10-11)

- **Follow up** (a session's page, web and desktop): on phones its explanation was squeezed into a column a word wide
  beside the button. The text now keeps a readable width and the button goes full width under it.
- A session shorter than a minute said "0 min"; it now says "under a minute" (web and desktop).

## Practice: progress figures that explain themselves (2026-10-11)

- **Practice → Your progress:** "Sessions this week" (every session, live and mock, over the last 7 days) sat right
  under the weekly goal (practice rounds this calendar week) and read as if the two disagreed. It's now "Sessions,
  last 7 days" with "Live and mock" under it.
- A figure with nothing to show yet says "Not yet" and when it will (pace: "After a round where you answer out
  loud"; average score: "After your first review") instead of a bare dash. The pace says what's easy to follow:
  120–160 words a minute, the range the session report uses.

## Session lists say each thing once (2026-10-11)

- A session started without a name is titled after its type ("Phone / room audio", "Interview — SDE II"), and the
  line under it repeated that: "Phone / room audio · Phone / room audio · 9:07 PM". Home's recent sessions, Sessions,
  and the desktop app's Home and History now leave out the type and role when the title already says them; a session
  you named still shows them ("HackerRank round · Coding interview").

## Resume AI: a quieter credits line on phones (2026-10-11)

- While you have resume credits, the note above your resumes and in the editor is one short line on phones ("12
  resume credits left. AI actions use one; the rest is free.") with a small Get credits button, instead of a paragraph
  that took a third of the first screen. From 640 px up it reads as before. Out of credits, it stays the full amber
  note.

## Resume AI for returning users; the phone status bar follows the theme (2026-10-11)

- **Resume AI:** once you have resumes, the page opens with a compact "Resume AI" header (Create a resume, Import)
  and your resumes right under it, instead of the full introduction every time. Someone with no resumes yet still
  gets the introduction, with the picture and what Resume AI does.
- **Phones:** the status bar (and an installed app's title bar) is white in light mode and the night-sky colour in
  dark, matching the top bar, instead of always dark. It changes with the theme setting too.

## Jobs AI: export the tracker, add dates to your calendar (2026-10-11)

- **Export CSV** (Jobs AI → Tracker): every tracked job as a spreadsheet, with company, role, location, status, the
  applied and next dates, the link, your notes and when you added it. Opens in Excel or Google Sheets (UTF-8 with a
  byte-order mark, so ₹ and Indian-language names come through); a cell that starts with = + - or @ is kept as text,
  never run as a formula.
- **Add to calendar** on any job with a next date (not on "Not this time"): a calendar file for that day, "Interview:
  SDE II, Swiggy" while interviewing, otherwise "Follow up: …", with the job's link and your notes. Google Calendar,
  Outlook and phone calendars import it. Made in the browser; nothing is sent anywhere.

## Look and feel: the live answer on phones, a quieter transcript (2026-10-11)

- **Live session, phones:** the answer's tools (Read aloud, Shorter, Longer, Simpler) show as icons, so the toolbar
  fits on one row instead of two and the answer starts higher up. Each keeps its name for screen readers and as a
  tooltip; from 640 px up the words come back.
- **Live session, transcript:** "swap" (fix a line given to the wrong speaker) shows on the line under the pointer or
  when tabbed to, not on every line. On touch screens it stays visible. Web and desktop app (shared components).

## Desktop: drop a file to upload (2026-10-10)

- **Desktop → Documents → Upload a file:** the "Choose file" button becomes the same drop zone as the web app: drag a
  file from Explorer onto it (it lights up and says "Drop it here") or click / press Enter to browse. Same types and
  size limit.
- The main window's own file-drop handler is now off (`dragDropEnabled: false` in tauri.conf.json): on Windows it
  takes dropped files before the page sees them, and nothing in the app used it.

## Look and feel: the desktop app's New session screen (2026-10-10)

- **Desktop → New session** opens with a "New session" title (and who you're signed in as under it) instead of a
  stray line, and on a wide window the form, the ready check and Start Session sit in one centred column at a
  readable width rather than stretching edge to edge. A narrow window still fills it.

## Look and feel: the desktop app's lists (2026-10-10)

- **Desktop → History:** the same rows as the web app's Sessions: each type's icon (mock interviews in orange), the
  question count as a chip, the length only once there is one, and a chevron on the ones that open. A session's own
  page carries its type's icon and no stray "· —".
- **Desktop → Home, recent sessions:** no more "· —" for sessions without a length.
- **Desktop → Documents:** each document's kind as an icon in its colour (resume green, job description blue, notes
  amber), like the web app.

## Look and feel: fold the resume form (2026-10-10)

- **Resume editor → Content:** each section's title folds it away (a chevron shows which way), so the form fits on a
  phone screen and you open only what you're working on. Folded sections stay folded when you switch to Score and
  back. The section's own button (Add role, Write with AI…) stays in reach while folded.
- A fix or "Show me" that points into a folded section opens it before jumping there, and the preview and ATS score
  still read every field.

## Look and feel: Jobs AI profile sections, a welcoming orb (2026-10-10)

- **Jobs AI → Profile** on wide screens: under the "Looking for" summary, an "On this page" list of its five sections
  marks the one you're reading and jumps to the others (the same list Settings has; both now share it).
- **Welcome:** the first question opens with Orbit's breathing orb, and each choice's arrow slides toward you on hover
  (Full motion only).

## Look and feel: the applications tracker (2026-10-10)

- **Jobs AI → Tracker:** each card carries its status as a colour edge (grey saved, indigo applied, sky interviewing,
  green offer, rose not this time), so the one-column phone list reads at a glance, and the board's columns get the
  same colour along their top. Each company gets an initial on a tile whose colour comes from its name, so the same
  company looks the same everywhere and neighbouring cards differ.

## Look and feel: resume preview on phones, credit tiles that fit (2026-10-10)

- **Resume editor on phones and tablets:** the preview sits under the whole form, a long scroll away, so a floating
  "Preview" button (above the tab bar) jumps straight to it and hides while the preview is on screen. On the Letter
  tab it says "Preview letter". Wide screens keep the side-by-side layout and never show it.
- **Credits:** the interview-minutes and Resume AI tiles sit side by side only when the card has room for both and
  stack otherwise, so Home's Usage card beside Recent sessions no longer squeezes them.

## Look and feel: a session's page, job matches (2026-10-10)

- **A session's page:** the title carries its type's icon, and the line under it drops the stray "· —" when the session
  has no length. "Nothing was captured" uses the same illustrated empty state as the rest of the app (web and desktop).
- **Jobs AI → Matches:** with no matches to show, "Search on other sites" appeared twice on wide screens (in the list
  and in the sidebar); now only the list shows it.

## Look and feel: session and document lists (2026-10-10)

- **Sessions:** each row starts with its type's icon (interview, coding, phone, meeting, assessment; mock interviews
  in Practice's orange), the question count is a chip, the length shows only once there is one (no more "— · 0
  questions"), and a chevron marks the rows that open.
- **Documents:** each document starts with an icon for its kind in a matching colour: a resume in Resume AI's green, a
  job description in Jobs AI's blue, notes in amber.

## Look and feel: drop a file, story coverage bar (2026-10-10)

- **Documents → Upload a file:** the browser's bare "Choose File / No file chosen" control gives way to a drop zone:
  drag a file onto it (it lights up and says "Drop it here") or click / press Enter to browse. Same types and size
  limit, still a real file input underneath for keyboards and screen readers.
- **Story bank → Coverage:** "3 of 12 covered" gets a progress bar that fills as you add stories.

## Look and feel: credits and packs (2026-10-10)

- **Your credits** (Plan & billing, and Usage on Home): interview minutes and Resume AI credits are two tiles in their
  products' colours with the balance as a big number that counts up, instead of small text rows. With nothing left,
  Home's card links straight to a top-up. The Plan & billing card no longer stretches to the packs' height.
- **Packs:** what each includes is a list of green checks with the numbers in bold, the price per interview minute sits
  under the price, and only the best-value pack's button is filled (the rest are outlined), so the eye lands on one.
- Fixed: the best-value pack's amber ring didn't show in dark mode (the card's own shadow covered it).

## Look and feel: Home's tools, Settings sections (2026-10-10)

- **Home, Your tools:** the four products are cards in a two-column grid (one column on phones, mark beside the
  name) instead of a plain list. Each has its colour as a soft glow in the corner with a hairline orbit and planet,
  like the front page's product pictures; the planet moves a little along its orbit on hover (Full motion only), and
  the cards rise in one after another as they scroll into view.
- **Settings:** each section heading has its icon (Appearance, Keyboard shortcuts, Account, Privacy, Advanced), and
  wide screens get an "On this page" list beside the cards that marks the section you're reading and jumps to the
  others. Still one page, so find-in-page keeps working.

## Look and feel: the practice report (2026-10-09)

- **The overall score** reads "4/5" instead of a bare 4, its ring takes the colour of how it went (green 4–5, accent
  3, amber 1–2) and fills on arrival (Full motion only).
- **What went well / To improve / Practice next** each get their own colour, icon and top edge, so the three read
  apart at a glance instead of as three identical cards. In the web app and the desktop app (shared component).

## Look and feel: orbs in live screens, a picture on Practice (2026-10-09)

- **Live interview, waiting for a question:** the static Orbit mark gives way to the dotted listening orb (a slow
  "breathing" orb when Auto answer is off), on a soft halo.
- **Mock interview:** the empty space under the question now shows who has the floor, readable from across the room:
  the composing orb with "Interviewer" while the interviewer speaks, the listening orb with "Listening to you" on a
  green halo when it's your turn. "The interviewer is getting ready…" shows the connecting orb.
- **Practice** on wide screens: the scorecard picture (the same one as the front page) sits beside the ways to start
  a round, with what you get after each one, instead of an empty third of the screen.

## Look and feel: livelier front page, scroll animations, solid bars (2026-10-09)

- **Product pictures on the front page** are bigger and layered, each on a soft stage in its product's colour with
  Orbit's hairline orbits: the AI interviewer's question over the round's scorecard, a resume page under its ATS
  score card, and the best job match on top of a stack of others. Their numbers count up as they come into view
  (the practice score to 7.5, the ATS score from 54 to 82, the match to 78%), and the checklist lines come in one
  by one. The hero's live-interview window gets a floating "ATS score 82, +28 after 3 fixes" badge on wide screens.
- **Scroll animations:** sections of the front page and the Resume AI and Jobs AI pages rise into place the first
  time they scroll into view, and card grids (features, prices) come in one after another. New `Reveal`,
  `useInView`, `useCountUp` and `CountUp` in the shared UI package; they follow the Animations setting (Full moves,
  Gentle only fades, Off shows everything at once), and nothing is hidden when printing or without JavaScript.
- **Fixed: text showing through the bars.** On phones, page text scrolling under the bottom tab bar showed through
  its labels, and the same under the top bar. Both are now solid (with a soft shadow above the tab bar).
- Resume AI's public page counts its sample ATS score up to 98.
- **Resume AI and Jobs AI in the app** show the same product pictures in their headers (a resume under its ATS
  score card; the best job match on a stack), instead of the generic icon in an orbit. The pictures live in
  `components/productArt.tsx`, shared with the front page.

## The story bank moves to the interview copilot (2026-10-08)

The owner asked for the story bank under the interview copilot rather than Practice: it's where live answers find
"Tell me about a time…" stories. The copilot's tabs are now Sessions · Documents · Story bank (with Start live session
beside them), and Practice is mock interviews alone, one page with no tab row. Home's copilot row links the story bank,
and its next step and search entries carry the copilot's mark. With mock interviews switched off, Practice leaves the
nav (the phone bar then has five tabs). Checked with `tools/orbit-drive/nav-split-drive.mjs` (20/20).

## Contact page and the admin's Inbox (2026-10-08)

The owner asked for a contact page "as a form to enter details and those will be into my inbox of admin account".
Messages now wait in an **Inbox in the admin console**; by the owner's choice **no email is sent** when one arrives
(docs/DECISIONS.md D50). One migration, `b5d7e9f1a3c6` (the `contact_messages` table).

- **Contact page** (`/contact`, `pages/Contact.tsx`, `lib/contactForm.ts`; public, signed in or out): name, email,
  an optional phone or WhatsApp number, the topic (General question, Payment or credits, Technical problem, Report a
  job, Business or partnership, Feedback, Other, each with a line on what helps us answer), the message with a
  character count (10 to 3,000), and the bot check when the server asks for one (signed out only). Signed in, the
  name and email start filled in. Clear success (with a reference like `C-1A2B3C4D` to quote) and errors, including
  a friendly one for rate limits. Mobile-first, every field labelled, errors tied to their fields and focused.
  Its own link preview from the Worker (`worker/meta.js`; `/contact` added to `run_worker_first`).
- **Every "Contact us" link is back**, as a router link: the public footer, the signed-in footer, Help, sign-in and
  sign-up, and the front page's "Something else? Contact us". `CONTACT_PAGE` is `/contact` and no longer waits for
  `LEGAL_PAGES_PUBLISHED`; Terms and Refund stay hidden drafts. The draft `docs/legal-drafts/contact.html` is
  superseded (README updated). Help's **Talk to a person** opens the form, with the WhatsApp and email buttons
  beside it when `VITE_SUPPORT_WHATSAPP` / `VITE_SUPPORT_EMAIL` are set. The public privacy page points to it.
- **Report this job → Send it to Orbit** (Jobs AI, `jobs/SafetyCard.tsx`): opens the form on "Report a job" with
  the job and the chosen reason filled in (`?topic=report_job&listing=…&reason=…&from=…`). The server reads the
  job's title, company and link from its own job cache, never from the page.
- **API** (`contact/routes.py`): `POST /v1/contact`, 201 with the reference. Plain text only (names lose line breaks
  and control characters; messages keep their lines), a bounded context, and no typed text in any email header.
  Spam protection: a honeypot field (a bot gets "received" and nothing is kept), 5 an hour and 20 a day per network,
  a daily cap for everyone (`ORBIT_CONTACT_DAILY_CAP`, 300, counted in the table), Turnstile for signed-out senders
  when configured. The network is stored as a keyed hash, never the IP. It needs no CSRF token (signed-out visitors
  have none; the Origin check still applies), so a cookie session links the message to the account only when the
  request carries that session's token.
- **Inbox** (`/admin/inbox`, `pages/AdminInbox.tsx`, `admin/MessageDrawer.tsx`, `admin/inbox.ts`; API
  `admin/inbox.py`): tabs To answer · Unread · Done · Spam · All with counts, a topic filter, search (name, email,
  phone, words, or the reference) and paging. A message opens in a panel (`?m=`), which marks it read: the sender
  and a link to their account (`/admin/users?user=`) when they were signed in, the reported job (its post and its
  page in Jobs AI), how many messages came from the same network in 30 days, the replies, a private note, and
  Mark done / Reopen / Spam / Mark unread / Delete (confirmed). **Reply**: "Send reply" emails the sender from
  Orbit's address with Reply-To the admin and closes the message; "Reply in your mail app" is a `mailto:` with
  "Re: <topic> (C-…)" and the message quoted (the only way on a server without SMTP). The unread count shows on the
  console's new **Inbox** tab, in the admin's top bar ("3 unread") and on Settings. Every change is audited and the
  audit log shows it against the sender's account, with a link to the message.
- **Email**: `OutgoingEmail.reply_to` (a `Reply-To` header over SMTP; the dev outbox logs it) and `send_now` (sent in
  the request, so the admin sees a failure).
- **Privacy** (docs/PRIVACY.md): deleting an account keeps its messages without the link (`ON DELETE SET NULL`); the
  data export includes the account's own messages (not the admin's note or the network hash); messages marked done
  or spam are deleted 12 months later (`ORBIT_CONTACT_RETENTION_DAYS`, 365) by the session sweeper.
- **Tests**: `tests/test_contact.py` (33), the routes added to the IDOR route matrix, the public-route list and the
  OWASP CSRF checks; vitest for the form (`lib/contactForm.test.ts`) and the Inbox (`admin/inbox.test.ts`).

## Interview copilot and Practice: separate items on the top bar (2026-10-08)

The owner asked for the interview copilot and Practice to each have their own place in the nav: they were one
"Interview" item whose tabs mixed mock interviews with live sessions.

- **Top bar:** Home · **Interview copilot** · **Practice** · Resume AI · Jobs AI. The copilot's tabs are Sessions and
  Documents, with Start live session beside them; Practice's are Mock interviews (with prep and progress) and the
  Story bank. The addresses are unchanged, so nothing redirects.
- **Practice is its own product** (`ProductId` "practice", orange: a hue none of the seven accents uses): its mark
  in the nav, Home's "Your tools" (a copilot row with live sessions and a Practice row with mock interviews), the
  next steps and the search palette.
- **Phones:** six tabs (Home, Copilot, Practice, Resume, Jobs, Me), which fit a 360 px screen.
- **The top bar fits at any width and text size:** it measures itself and uses full names, short ones or icons alone
  (named on hover and for screen readers). Breakpoints couldn't decide it, because the text size setting scales the
  labels but not the breakpoints: at 1024 px with large text the full names ran ~100 px into the search button.
- Checked in headless Chrome (`tools/orbit-drive/nav-split-drive.mjs`, 20/20): the current item and tabs on every
  copilot and Practice page, the bar at 1440 to 768 px with normal and large text, the phone bar at 390 and 360 px.

## Mini pack: ₹499 for 15 interview minutes and 5 AI credits (2026-10-07)

The cheapest pack was ₹1,999, a big first purchase next to Indian copilots at about ₹499 an hour and Naukri's paid
plans (research/web-roadmap-2026-10-07.md). **Mini** (`billing/packs.py`) costs the same ≈ ₹33 an interview minute as
Starter, so it lowers the first purchase without undercutting anything, and Plus (≈ ₹27) and Pro (≈ ₹22) stay the
better value. It's now the cheapest pack with resume credits, so "out of credits" offers it first ("Packs start at
₹499"). Plan & billing shows the four packs two by two with "Best value" still on Plus (the second-largest); the front
page shows Free and the four packs in one row. `ORBIT_CREDIT_PACKS_JSON`, if set, still replaces the list.

## Front door, first run and navigation (2026-10-07)

A first-time visitor at `/` used to read "Welcome back / Sign in". Now Orbit has a public front page, a three-question
welcome after sign-up, a Home that leads with one next step, and a nav with one place per product. No migration and
no new AI cost.

- **Front page** (`pages/Landing.tsx`, signed out at `/`): "Practise interviews, fix your resume, find jobs.", a live
  answer card drawn in HTML (plays once when seen; the finished card under reduced motion, the Animations switch or
  Save-Data), the three products with small labelled mocks, how it works, **prices from `GET /v1/billing/packs`**
  (never hard-coded) with a "what uses what" table, questions people ask first, and the line "Built for practice,
  and for interviews and calls where notes or AI help are allowed. Check the rules first." Real numbers only: the
  public job counts, once there are 50 or more. "Try a practice question first" goes to `/warmup` (Workstream C's
  page; a placeholder until it lands).
- **Welcome** (`pages/Welcome.tsx`, `lib/onboarding.ts`, right after sign-up): what you want to do first; your
  experience and the job you want; where you want to work. A tap each, all skippable. The answers stay in this
  browser per account; the role, experience and city also go into the Jobs AI search profile (`PUT
  /v1/jobs/profile`), so the first matches are the right jobs. From a product page's "Start free", the visitor goes
  back there after. Fixed on the way: sign-up's own "already signed in" redirect used to win over the navigation after
  sign-up, so new accounts landed on Home instead of where they were sent.
- **Home** (`pages/Home.tsx`): **"Your next step"** first, picked from the answers and the account's data (an
  interview on the tracker in the next 3 days first, then the goal's steps, skipping what's done; a follow-up a week
  after applying), with the two after it; then follow-ups (Workstream C's `jobs/FollowUps.tsx`, a placeholder that
  renders nothing until it lands); **"Get set up"** across all three products (account pre-ticked; a ring once two
  are done); a row per product; recent sessions and usage. On a 390 x 844 phone the next step's button is in the
  first screen.
- **Nav** (`components/Layout.tsx`): Home, Interview, Resume AI, Jobs AI on the top bar; the same plus **Me** on the
  phone tab bar (12 px labels, five fit 360 px). Interview is current on Practice, Sessions, Story bank, Documents and
  New session, which share **Interview tabs** with "Start live session" beside them. Same addresses, nothing
  redirects. Each product has one colour for its mark (`components/products.tsx`: Interview = accent, Resume AI =
  emerald, Jobs AI = sky). **Me** is a sheet: Plan & credits, Settings, Help, the Windows app, Sign out; the desktop
  account menu has the same, with arrow keys.
- **Search** (`components/CommandPalette.tsx`, `lib/palette.ts`, a lazy chunk): Ctrl+K / ⌘K anywhere in the app,
  "/" outside text fields, or the search button. Pages, actions (start a mock or a live session, make a resume, find
  jobs, buy credits, help, switch theme, sign out) and your recent resumes, sessions and tracked jobs. It knows the
  words people type ("cv", "jd", "upi") and forgives a missing letter. A combobox over a listbox.
- **Help** in one place (`components/HelpDialog.tsx`, a lazy chunk; account menu, Me, the footer under every page,
  search): contact (`VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_WHATSAPP`, else the contact page), short answers (what's
  free, UPI and the UTR, "is it allowed?", hearing the interviewer), the words Orbit uses in plain language, and the
  shortcuts.
- **Sign-in and sign-up**: show/hide on password fields, a strength hint, "Takes about a minute", a plain headline,
  the "where it's allowed" line, links to the front page, terms, privacy and contact, 32 px tap targets.
- **Trust pages, DRAFTS, not published**: Terms, Refund and Contact are in `docs/legal-drafts/` (with how to publish
  them), not served, until the owner fills in the bracketed details (legal name, address, support contacts,
  grievance officer, courts, GST) and the refund rules. `LEGAL_PAGES_PUBLISHED` in `lib/contact.ts` hides every link
  to them meanwhile (footer, Help, sign-in, sign-up, the front page's refund answer and "Contact us"); Privacy stays.
- **Link previews**: description, Open Graph and Twitter tags in `index.html`, a 1200 x 630 image
  (`public/og-image.png`, 77 KB, from `og/og-image.svg`), and per-page titles for `/`, `/resume-ai`, `/jobs` and
  `/warmup` from the Worker (`worker/meta.js`, HTMLRewriter; those four paths are now in `run_worker_first`; the
  `/api` proxy and the keep-warm cron are unchanged). The manifest has a description and shortcuts.
- **Routes** (one commit, on top of the Outreach move): `/` is the front page signed out (`publicPageFor` in
  `routes.ts`), `/welcome` (signed in, outside the nav), `/warmup` (public). The tab title on the front page says
  what Orbit is.
- **Entry chunk**: the front page, welcome, search and Help are lazy chunks. First-load JavaScript is about 3 KB gzip
  more than before (`index-*.js` is 11 KB gzip bigger, but it now includes the old separately preloaded `api-*.js`
  chunk, 8 KB).
- **Not done here**: the product homes' marketing hero collapsing after first use (Resume AI's home and Jobs AI's
  overview are Workstream C's phase 2 files); `/terms`-style short addresses work on Cloudflare (it serves
  `terms.html` for `/terms`) but not in `vite dev`, where links use the `.html` names.

## Practice and Jobs AI depth: Interview Warm-up, one-tap mocks, honest matches, track any job (2026-10-07)

Workstream C, phase 1 of the web roadmap (research/web-roadmap-2026-10-07.md, I1-I4 and J1-J4, J6).

- **Interview Warm-up** (`pages/Warmup.tsx`, for a public `/warmup` route that App.tsx adds): free, no sign-in, no AI
  and no minutes. Seven tracks (campus HR round, Tell me about yourself, software engineer, data analyst, customer
  support / BPO, sales, MBA) with 145 questions (`lib/warmup/bank.ts`); five a round, the introduction first. Answer by
  typing, or by voice where the browser has SpeechRecognition (Indian English; typing elsewhere), and get rule-based
  tips at once (`lib/warmup/checks.ts`): spoken length, structure for the kind of question (STAR; now, before, next;
  steps; assumptions; a real weakness; a reason tied to them; an example), numbers, fillers and hedges (Indian
  English and Hinglish too), and "I" against "we", then a round summary. Typed answers never leave the page. Signed
  out it ends on "Get an AI score and a mock interview: free account"; signed in, on a 5-minute HR mock.
- **One-tap mocks on Practice** (`pages/Mock.tsx`, `pages/mockPresets.ts`): a 5-minute HR round (the campus HR
  questions as a fixed drill), Tell me about yourself (long, with a follow-up, then the 30-second version), a 15-minute
  technical round for the role in the Jobs AI profile, and Salary talk with a ₹ offer. The job post picked above
  applies to all; the full form moves under "Customise". `?preset=`, `?role=` and `?jd=` link straight to one.
- **India copy**: ₹ LPA examples instead of dollars in negotiation practice, the profile's role as the placeholder, a
  5-minute length, and Prep says why "Generate my questions" can't be pressed yet.
- **A weekly practice goal** (`lib/weeklyGoal.ts`, `WeeklyGoal` in Progress.tsx): "This week: 2 of 3", counting mock
  interviews and warm-up answers, weeks in a row, and a freeze that covers one missed week. No reminders. With no
  sessions yet, Progress shows it with "Do a 5-minute HR round" instead of nothing.
- **An honest match**: no match % until there's a resume or skills to match against (`matchBasis`); until then the
  feed is the newest jobs, newest first, with "Add your resume to see how you match" in its place. The match label is
  12 px at -800 shades (AA in light mode).
- **Trust and freshness, only where the data backs it**: "Early applicant" (under 48 h old by the earlier of the
  post's date and when Orbit first saw it), "Direct from careers page" (company boards) and "Still open · checked 3h
  ago" (company boards, checked within a day). The API now sends `first_seen_at` and `still_listed_at` (company
  boards only: a board's refresh drops posts taken down; feeds and searches are never re-checked). A "Stay safe"
  card on job pages and the tracker, and "Report this job" (email or WhatsApp to Orbit when `VITE_SUPPORT_EMAIL` /
  `VITE_SUPPORT_WHATSAPP` are set, copy the details, cybercrime.gov.in and 1930). Nothing is stored.
- **Track any job**: "Add a job you found elsewhere" on the tracker (`?add=1`). Paste a Naukri, LinkedIn or any link
  (`POST /v1/jobs/tracker/link` reads the title, company and city from the address; nothing is fetched) or type it;
  a company's own page can be read for its text and saved for Practice. `POST /v1/jobs/tracker/manual` saves it with
  `listing_id = "ext:<hex>"` and `source = "manual"` (no migration), refuses the same job twice (409
  `already_tracked`), tracks a link that's a post in the feed as that post, and allows 20 a burst, 60 an hour.
- **Follow-ups** (`pages/jobs/FollowUps.tsx`, no required props, for Home): "Follow up with Razorpay: applied 7 days
  ago" (write it in Outreach, or done for a week), "Interview with Bosch tomorrow" (practise now). Also on Jobs AI's
  overview.
- **Matches on a phone**: the filters in a bottom sheet ("Filters · 2"), Fresher and Internship chips (words the
  search box understands), salary as a chip, and cards keep Apply and Save (the fit check and the rest are on the
  job's page).
- Tests: `tests/test_jobs_manual.py` (33), and vitest for the warm-up checks and bank, the presets, the weekly goal,
  and the honest-match, badge and follow-up rules.

## Look and feel: Orbit scenes, page transitions, contrast and a light default (2026-10-07)

Part two of the look and feel foundation, on top of the motion levels and feedback primitives below.

- **Eight Orbit scenes** (`packages/ui/src/components/scenes/`, one module each, so a page carries only the ones it
  shows): Welcome (a planet with a moon per product: interview, resume, jobs), Resume (a page in orbit with its ATS
  ring), Jobs (a constellation of Bengaluru, Pune, Hyderabad and remote), Practice (a microphone and the scorecard
  that comes back, one thing still to work on), Tracker empty (three ghost columns), No results (a telescope on an
  empty patch of sky), Offline (a dish losing its satellite) and Celebration (a burst). Drawn like a star atlas:
  hairline orbits, paper surfaces, one subject in the accent and one aurora highlight; no gradients or glass, so they
  hold in light and dark and in all seven accents (checked side by side). Decorative unless given a `title`; one
  small, finite motion each at Full only. For `EmptyState`'s `art`; `SpotIllustration` stays for small spots. Each
  is 1.3–2.7 KB of source and in no bundle until a page uses it.
- **Page transitions:** `withViewTransition(update, to?)`, `viewTransitionOk()` and `useViewTransitionOk(to)` (for
  React Router's `viewTransition`), with `::view-transition-*` rules on the motion tokens: a 160 ms crossfade, and
  a morph for elements given a `view-transition-name`. Gentle crossfades without the morph; Off and `/live/*` never
  start one (checked with `getAnimations()` on the transition's pseudo-elements). Not wired into the nav yet.
- **Contrast** (axe WCAG 2.2 AA, 390 px): "Get credits" on Resume AI and the Billing "Best value" badge were white on
  amber (2.1:1); now amber-950 on amber-400 (9:1), and the badge's 10 px capitals are 12 px. In light mode
  `text-emerald-600` and `text-amber-600` draw in -700 (3.8:1 → 5.5:1, 3.2:1 → 5.0:1), which clears Documents' status
  line. Error notes' Retry is a 24 px target. Signed-in Resume AI, Billing and Documents are now clean in both themes,
  as login, Home, Practice, Profile and Settings were: 8 of the 11 scanned pages (18 of 22 page-theme runs, from 13).
  What's left is in pages other work is changing: the match and ATS labels at 10 px with `opacity-80` (Matches and
  the public Jobs AI and Resume AI pages, light) and the public Resume AI sample's links inside an `aria-hidden` block.
- **Light theme follows the system** until someone picks one (`theme-init.js` and Settings' default were "dark";
  `index.html` no longer hard-codes `class="dark"`), and it follows the system live while open.
- Figures are tabular by default on the web (`tnum`); headings balance their lines; with data saver on, the night
  sky leaves out its stars.
- Size: the JS a page loads first is unchanged by this part (119.53 KB gzip, +2.00 KB over both parts); CSS +0.48 KB.

## Look and feel foundation: three motion levels, toasts, skeletons, empty states (2026-10-07)

The design layer the front door, onboarding and product work build on (`packages/ui`, shared with the desktop app).

- **Motion tokens** in `design/base.css`, exposed as Tailwind `duration-press|quick|panel|page|moment` and
  `ease-standard|enter|exit`. Page fades drop from 450 ms to 280 ms; lists stagger 35 ms apart for the first 6
  items only (the 6th used to wait 300 ms); `appear` fades in an item added later with `@starting-style`.
- **Animations: Full / Gentle / Off** in Settings → Appearance (web and desktop), replacing the on/off switch.
  Gentle keeps fades and stops everything that moves; Off stops everything. It's `html[data-motion]`, so it covers
  every component, old and new. The OS reduced-motion setting caps Full at Gentle (and Settings says so); a device
  that hasn't chosen starts at Gentle when the OS asks or data saver is on. The old stored switch carries over (on is
  Full, off is Off), still per device in `orbit.design`, and Settings no longer saves on open (D47).
  - New `motion-ok:` variant (Full only) next to Tailwind's `motion-safe:`, and `useMotion()` for JS animation. The
    loading orb (a canvas, which CSS can't stop) now holds still below Full; before, it kept moving with the in-app
    switch off. The illustrations use `motion-ok:`.
  - Checked in headless Chrome with `getAnimations()` on 10 signed-in pages and the primitives: with OS reduced
    motion, or Gentle or Off in Settings (including an old stored `true` or `false`), no transform animation runs and
    the orb doesn't move; at Full they do.
- **Hover and press:** card lift and the primary-button sheen only on devices that hover (no stuck lifted card on a
  phone); cards press in on touch; press feedback only at Full.
- **A focused field is never hidden** under the sticky header or the phone tab bar (`scroll-padding`, WCAG 2.4.11).
- **Toasts** (`toast()`, `ToastHost` in `main.tsx`): short confirmations with an optional Undo, in one polite live
  region so screen readers hear them; three at most, a fourth pushes the oldest out; 5 s (8 s with an action, 7 s for
  an error), paused while hovered, focused or the tab is hidden; Escape closes one. Bottom centre on phones above the
  tab bar, bottom right on desktop. The cards' code loads with the first toast, or when the page is idle.
- **Skeletons** (`Skeleton`: line, card, job card, resume card, session row) shaped like what's coming, with
  `useLoadPhase()`: nothing for a load under 150 ms, then at least 300 ms so it never blinks. A still tint below Full.
- **`Button loading`** keeps its label, shows a small orb and ignores presses without losing focus.
  **`buttonClass()`** gives links the Button look without copying class strings.
- **Empty states** in four kinds: first use (with `GhostPreview`, a faded outline of the filled screen: cards, rows,
  or the tracker's three columns), no results, all cleared (a small, still tick) and offline (Try again, announced).
- **`celebrate()`**: a milestone toast once per device (first mock, first ATS 80+, first Applied…), never in a live
  session, with a 700 ms orbit burst at Full motion only.
- **`Term`**: a dotted-underline word with a plain-words meaning on hover, tap or Enter, read with the word by screen
  readers; a glossary for ATS, JD, UTR, STAR, fit check and tailor.
- Size: the JS a page loads first grows 1.98 KB gzip (117.53 → 119.51 KB), CSS 1.21 KB (14.75 → 15.96 KB); the burst,
  skeletons, terms and toast cards are only in the pages that use them. Desktop builds; tests for the motion levels
  (including the old stored values), the toast queue, the skeleton timing and the milestones.

## Admin console: delete, suspend, take credits away, an account in full, the audit log and a dashboard (2026-10-07)

The owner asked for a more capable admin account: delete or remove accounts, take minutes and AI credits away, and
"more things whatever is best". Users & access becomes a console with three tabs (Users, Payments, Audit log).

- **Delete an account** from its panel, after typing its email (the API checks it too). It goes through the same
  function as "Delete my account" (`auth/accounts.py`, now shared): live sessions stop first, then everything in the
  account cascades away. **Approved payments stay on the books** without the account (they were already
  `ON DELETE SET NULL`), so revenue totals don't change and a UTR can't be reused; the credit ledger and audit trail
  stay too (no foreign keys, as before), with the admin's notes cleared. The audit entry keeps the id and the email.
- **Take credits away**: resume credits and/or interview minutes, with a required reason. A balance never goes below
  zero: asking for more takes what's there, and both the preview and the answer say so. "Set to zero" takes exactly
  the balance. Each removal is a ledger entry (`admin_remove`, with the reason as its note), so the history explains
  it; adding credits can carry a note too. Removals don't count as "used".
- **Suspend / unsuspend**: a suspended account can't sign in (told why, only after the right password), can't use the
  API (`current_user` answers 403 `account_suspended` with the reason), can't open the live socket or finish a
  password reset. Suspending signs it out everywhere and ends its live sessions, including one waiting to reconnect;
  the owner is emailed the reason. **Sign out everywhere** from the panel too (password unchanged).
- **The account panel** (`?user=` on the list): usage, access (grant / approve / revoke, as before), credits, name,
  email verified, a password-reset email (the usual link), **private notes** (left out of the owner's data export),
  and its history in tabs: the full credit ledger, sessions (kind, state, minutes; never titles), payments, admin
  actions taken on it, its own sign-ins and security events with IPs, and content counts (documents by kind, resumes,
  stories, setups, Jobs AI profile, tracker and fit checks). Nothing destructive appears for the admin account or
  yourself, and the API refuses it anyway.
- **A better list**: filters (Everyone, Waiting, On a grant, Paid, Active 7 days, Never used, Suspended), sortable
  columns (account, credits left, minutes used, paid, last active, joined), search, 50 at a time with "Load more"
  (`offset`, `total`, `has_more`), **CSV export** of the filtered list (formula-safe cells), and **bulk "give
  credits"** to up to 100 selected accounts. "Last active" now means the last use of Orbit: a session, interview
  time, resume AI or an edit, a Jobs AI fit check or tracker change.
- **Dashboard strip**: accounts, active in 7 days, revenue this month, payments to check, interview minutes, resume AI
  credits and Jobs AI fit checks this month, paying accounts, and two small bar charts (sign-ups and interview
  minutes per day for 30 days, in the admin's own time zone), with hover, arrow-key reading and a table view. Plain
  SVG, no chart library.
- **Audit log page** (`/admin/audit`): admin actions or every audited event, filtered by action, by account (as the
  one who acted or the one it was about) and by search, each linking back to the account. Changing the provider
  settings is now audited too (key names only, never values).
- **Site announcement**: a one-line banner (info or warning) set from the dashboard, kept in the runtime config (no
  new table), shown above every signed-in page by the public `GET /v1/announcement`, dismissed per text.
- API: `GET/PATCH/DELETE /v1/admin/users/{id}`, `POST /v1/admin/users/{id}/credits/remove`, `/suspend`,
  `/unsuspend`, `/sign-out`, `/password-reset`, `POST /v1/admin/users/bulk-credits`, `GET /v1/admin/users/export`,
  `GET /v1/admin/audit`, `GET /v1/admin/stats`, `GET /v1/announcement`; `GET /v1/admin/users` gains `only`
  filters, `sort`, `order` and `offset`. All admin-only, bounded, in the security route matrix, and audited when they
  change something.
- **Migration `f3a9c1e7b5d4`** (on `e9b4c6a2d8f1`): `users.suspended_at`, `users.suspended_reason`,
  `users.admin_note`, `credit_entries.note`, `audit_logs.target` widened to 400 on Postgres, and an index on
  `audit_logs.created_at`. Checked up and down on SQLite (test) and Postgres 16. Design note: D45.

**Verified:** API 1,596 tests pass, 17 skipped (+14 console tests, and 14 more routes in the security matrix); the 4
Windows-only failures from main remain (`test_deploy_image` reads a file as cp1252, three private-IP literals in
`test_job_link`); ruff, strict mypy (`orbit_api`). Frontend: typecheck and lint (all packages), UI 153 tests (+2), web 54 (+11), desktop 27, web
build. Migration up, down (a 390-character target truncated to 128) and up again on a local Postgres 16, and
`downgrade base` / `upgrade head`. The console driven end to end in headless Chrome
(`tools/orbit-drive/admin-console-drive.mjs`, 20 checks) against the API on SQLite and again on Postgres: no server
errors, no console errors.

## Out of AI credits: a clear popup, and no more "List should have at most 10 items" (2026-10-07)

A user with no resume credits saw "List should have at most 10 items after validation, not 11" instead of being told
they were out of credits. Out of credits, the fixes left are the free ones ("add these skills"), and the editor's
`addSkills` put skills that didn't fit an existing group into a new one past the server's limit of 10 skill groups. The
11th group made every save and every AI request a 422 that Pydantic worded, so the 402 "out of credits" never came.

- **No 11th group:** `addSkills` (web `resume/model.ts`) and `add_skills` (`resumes/apply.py`) put skills into the
  groups that have room once there are 10. `ResumeData` folds an 11th group sent by an older tab into the others
  instead of refusing the whole resume (`fold_skill_groups`), so nobody stays stuck.
- **"You're out of AI credits" popup** (`components/OutOfCreditsDialog.tsx`, `lib/outOfCredits.ts`): the web client
  watches every reply, and a resume AI `402 upgrade_required` (Resume AI, Jobs AI's Outreach, interview prep, …) or a
  session refused for interview minutes opens one dialog with what a credit is for, the cheapest pack and **Get
  credits** (→ Plan & billing with that pack). The editor opens it too when only the no-AI fixes came back.
- Tests: `test_resume_limits.py` (the fold, the fallback, and "out of credits" with an 11th group is a 402, not a
  422), `outOfCredits.test.ts`, `model.test.ts`. Driven in headless Chrome (`tools/orbit-drive/credits-popup-drive.mjs`,
  18/18 at 1280 and 390 px).

## Plain-spoken answers: sized to the question, at the candidate's real level (2026-10-07)

A user's feedback: simple questions got hard terminology, every answer was the same length, and someone with no
background in a topic got an expert's answer that read as AI-generated and didn't survive a follow-up. Measured on 28
questions (yes/no to system design) for a fresher with a thin resume and a senior engineer, real DeepSeek through the
real engine (`tools/orbit-drive/plain_probe.py`, two runs on each side): "Have you used Kubernetes?" got ~135 words,
nearly as much as a URL-shortener design (~215); none of the 48 simple answers was the right size; the fresher's
answers claimed hands-on work their resume didn't support in 23 of 56.

- **Auto length, the new default** (`routing.pick_size`, D44): each answer gets a size from the question's type and
  wording, with no model call: **brief** (1–3 sentences: yes/no, "Have you used X?", a notice period), **short**
  ("What is X?"), **medium** (an intro, why us, strengths, "how does X work"), **long** (a story, an approach),
  **detailed** (system design, deep or multi-part technical). "Briefly" / "in detail" and extra parts move it. The
  token budget and key-point cap follow the size. Short / Standard / Detailed stay as fixed choices.
- **The card says how much to say**: "Quick answer", "Short answer", "Medium answer", "Long answer", "Detailed
  answer". On an auto session **Shorter / Longer** re-ask that one answer a size down or up (the next question is
  sized on its own), and a new **Simpler** re-asks it in plainer words. "Make it shorter" in chat steps down too.
- **Plain words, answer first**: the prompt asks for the interviewer's own words and everyday ones, a technical term
  only when needed and never a textbook definition (with a bad/good pair), and a first sentence that is a complete
  answer on its own, so the candidate can stop there.
- **The candidate's real level** (`live/background.py`): fresher / junior / mid / senior, inferred once per session
  from the resume (years stated, dated roles, titles, "final-year student") and else the role, or set in setup
  ("Your experience level", Auto by default). A tool the question asks about that the verified facts never mention
  gets a believable depth and one honest line ("I haven't used it on a real project yet, but…") instead of faked
  expertise. A project question now gets the resume's projects (they shared no word with it, so one was invented).
- **TERMS**: up to 3 technical words the answer says, each with its plain meaning, shown dimmed under the answer
  (`LiveAnswer.terms`); never read out.
- "Failure modes" / "failed payments" no longer make a technical question behavioral.

| 112 answers per side (2 runs × 28 questions × 2 candidates) | before (standard) | after (auto) |
|---|---|---|
| in the intended size range (±25%) | 49 | 109 |
| simple questions (yes/no, "what is X") in range | 0 of 48 | 46 of 48 |
| mean words: brief / short / medium / long / detailed | 135 / 159 / 159 / 178 / 214 | 38 / 63 / 119 / 190 / 344 |
| jargon per 100 words, simple questions (the probe's list) | 1.91 | 0.88 |
| judge: jargon, 1–5 | 3.06 | 2.61 |
| judge: the first sentence answers on its own | 78 | 98 |
| fresher: claims hands-on work the resume doesn't support | 23 of 56 | 5 of 56 |
| fresher: depth believable for the background, 1–5 | 3.02 | 4.41 |
| AI tells (human_probe's checks) | 87 | 61 |
| judge: sounds human, 1–10 | 8.05 | 8.52 |

Coding answers didn't regress (`code_probe.py`: 14/14 coding questions got code in every session and source, and 3/3
chat code asks, as in `code_probe_after2.json`), and the first word comes as fast as before (median 893 ms vs 927 ms,
run side by side). The system prompt grew by ~500 tokens, a cached prefix. Shared UI changes reach the desktop app
with its next release; installed 0.1.37 and older send only the fixed lengths and work as before.

## Outreach moves from Resume AI to Jobs AI, and writes for a job (2026-10-07)

Resume AI's "Profiles & outreach" tab is now Jobs AI's **Outreach** page, `/jobs/outreach` (a new tab between
Tracker and Profile): the referral requests, emails to HR, follow-ups and thank-you notes, and the Naukri and LinkedIn
profiles, the same parts and grounding as before (`pages/resume/ProfileKit.tsx` moved to `pages/jobs/Outreach.tsx`).

- **Written from a resume you pick** ("Written from", at the top on phones, beside the page from 1024 px): `?resume=`,
  else the one edited last. No resume yet: "Make a resume first", with a link to Resume AI.
- **For a job** ("For a job", messages only): a job on your tracker, or the one opened from a job's page. A job's
  page has **Write outreach** (written from the resume tailored for it, else the matched one), and so does every
  tracker card; the message starts as a referral before you apply, a follow-up once applied and a thank-you once
  interviewing. Company and role are filled in, the post's skills shown; a post that has left the feed uses the
  tracker's role and company. Messages are kept in this browser per resume and per job (the 20 changed last).
- **`POST /v1/resumes/outreach` takes `listing_id`** (D46): the server reads that posting from the job cache (title,
  company, place, its skills and text, cut to 8,000 characters, fenced as data) in place of `job_text`, fills in a
  blank company and role, and gives the model the post's skills split by whether the resume shows them, with "never
  claim one it doesn't". Same cost, one resume credit; a listing that's gone is a 404 before anything is spent.
- **Resume AI's editor**: six tabs, and where Outreach was, a small "Outreach ↗" link to Jobs AI's page for that
  resume. Tabs were never in the address (the editor's own state), so there's no old URL to redirect: `/resume-ai/:id`
  still opens the editor. On Outreach, `?resume=` doesn't re-match the job feed to that resume (it does elsewhere in
  Jobs AI).
- **Copy**: Resume AI's feature lists lose profiles and outreach (its public page points to Jobs AI instead); Jobs
  AI's gain "Outreach that gets replies" (its public page's features now in threes, its free note and how-it-works
  mention it); the sign-in screens (web and desktop) list cover letters and interview prep under Resume and outreach
  under Jobs. The desktop copy reaches users with the next desktop release.
- Jobs AI's tabs are a size smaller on phones (and the tracker's count hides under 380 px), so five fit 360 px.
- Tests: `test_resume_kit.py` (the posting read on the server, fenced and cut to size, typed company and role win,
  404 spends nothing), `kit.test.ts` (messages per job), `paths.test.ts`, `model.test.ts`, `routes.test.ts`,
  `routeTitle.test.ts`. Driven in headless Chrome at 1280 and 390 px (`tools/orbit-drive/outreach-move-drive.mjs`).

## Orbit Jobs AI: Jobs becomes Orbit's third product, with its own nav item and pages (2026-10-07)

Jobs was a tab of Resume AI (`/resume-ai/jobs`). It's now **Orbit Jobs AI**, a product of its own next to the
interview copilot and Resume AI, with its own place in the nav, its own pages and a public page.

- **Its own nav item, "Jobs AI"** (`components/Layout.tsx`): a Briefcase icon and "Jobs" with the same gradient AI
  pill as Resume AI (the link reads "Jobs AI" to screen readers), on the top bar and the phone tab bar. To fit, the
  nav keeps the six daily destinations (Home, Practice, Sessions, Documents, Resume AI, Jobs AI) and **Settings
  moves beside the account menu**: a gear (highlighted on Settings) and a "Settings" item in the menu, next to Plan
  & billing. Checked at 1440, 1280, 1024, 900, 800 and 768 px and on 390 and 360 px phones: one row, nothing cut,
  no sideways scroll; the tab bar's labels drop to 10 px under 380 px so "Documents" and "Resume AI" don't touch.
- **Its own pages** (`pages/jobs/`, one chunk, `JobsAiPages.ts`), with tabs between them (`ProductTabs` in
  `components/products.tsx`, which Resume AI's tabs now use too; the tracker tab shows its count):
  - `/jobs`, **Overview**: "Find jobs that fit your resume", what it does, your four best matches (each opens its
    job), what the feed looks for, where your applications stand (a count per step and what's coming up next) and
    the "Search on other sites" links.
  - `/jobs/matches`, **Matches**: the ranked feed, search, sort, "Search on other sites", and two quick filters a tap
    away (how recent: 24h / 3 / 7 / 30 days; work mode), which save the profile; the rest is on Profile. `?q=` and
    `?sort=` are in the address and the pages already loaded are kept, so Back from a job finds the list as it was.
  - `/jobs/listing/:id`, **a job's own page** (card titles and tracker cards open it): the post's summary with
    "Read it all" on the original (a snippet and a link, as the sources' terms ask, D43), the key facts the post
    states, where it's from with its credit, how the resume matches (all the matched and missing skills), the fit
    check (opened if it was run before, free), its place on the tracker (move it, notes and dates, remove), and every
    action: Apply then "Did you apply?", Save, Tailor my resume, Prepare, View original post. Back returns where it
    was opened from; a job that has left the feed says so.
  - `/jobs/tracker`, **Tracker**: the board (a list with a status filter on phones), as before.
  - `/jobs/profile`, **Profile**: the search profile as a page instead of a dialog, in sections (your resume, what
    you're looking for, where, which jobs, where Orbit looks), a live one-line summary beside it, "Unsaved changes"
    with Save and Discard (a bar above the tab bar on phones), then "See your matches". The resume links to Resume AI.
  - The pages share one copy of the profile and the tracker (`JobsAi.tsx`); the feed's cache key carries the
    profile's fingerprint, so a page opened after the profile changed never shows the old feed first.
- **Signed out, `/jobs` is a public product page** (`pages/jobs/JobsAiPublic.tsx`): what Jobs AI does, an example
  match drawn with the real card's parts (labelled Example), where the jobs come from and why LinkedIn and Naukri
  get links instead, how it works, and what's free, with the server's own numbers. "Start free" signs up and comes
  back to `/jobs`. Its only call is the new public numbers route.
- **`GET /v1/jobs/stats`** (no session): fresh jobs and companies in the last 7 days, the feeds credited by name,
  when they were last updated, and the free daily allowances (`ORBIT_JOBS_FIT_DAILY`, `ORBIT_JOBS_PROFILE_DAILY`).
  Counts only, worked out at most every 10 minutes, never starts a refresh, 30 a burst per network. In the security
  matrices (public routes, rate limit per network) and tested (`test_jobs.py`).
- **Old links keep working**: `/resume-ai/jobs` goes to `/jobs/matches`, its `?view=tracker` to `/jobs/tracker`,
  anything under it to the same place under `/jobs`, keeping the rest of `?` and `#` (signed out, through sign-in
  for that page). A route of its own, so "jobs" is never opened as a resume (`/resume-ai/jobsearch` still is).
  `movedJobsPath` in `pages/jobs/paths.ts`; the nav's prefetch (`pageFor`) and tab titles ("Jobs AI · Orbit") know
  every address.
- **Resume AI without Jobs**: its tab bar is gone again (one page), the "Jobs matched to your resume" chip and the
  public page's Jobs feature are out. Cross-links instead: "Find jobs that match your resume" under your resumes, "No
  job in mind yet? Find jobs that match this resume" in the editor's Job post panel (opens the matches with that
  resume, read by the AI), and a line on Resume AI's public page. Tailor my resume still opens the copy in Resume AI.
- **Home shows the three products**: the interview copilot, larger, with what it does as chips, and Resume AI and
  Jobs AI beside it (side by side under it on tablets, one after another on phones), each with a line and a way in;
  Jobs AI's shows where your applications stand. Home asks the tracker only, never the job boards.
- **Sign-in and sign-up**: the three products lead the features column ("Interview prep" folded into them); sign-up's
  subtitle is "Interview copilot, Resume AI and Jobs AI, in one account". Still fits 1024 × 720 and 1280 × 720 with
  the welcome note (tighter spacing on screens under 800 px tall).
- **Desktop app**: Jobs AI in the sign-in features and tagline, and a "Jobs AI" button in Settings next to Resume AI,
  opening `/jobs` in the browser.
- Also: the API's "make a resume first" messages name Resume AI (not "Documents → Resume maker"), and Resume AI's
  list of resumes no longer widens a phone screen when a title is long.
- Tests: the new addresses and redirects (`pages/jobs/paths.test.ts`), the feed's fingerprint, the tracker state
  shown on a job, a job's key facts and what's coming up next (`model.test.ts`), the prefetch and tab titles for
  every Jobs AI page and old address (`routes.test.ts`, `routeTitle.test.ts`).

## Jobs: 106 more company boards hiring in India (2026-10-07)

Most matches for an Indian resume came from remote feeds; now most come from companies hiring in Indian cities (an
engineer's feed; a fresher analyst's goes from a tenth to over a third). `companies.py` goes from 41 to 147 public job boards: 47 more on Greenhouse, 23 on Lever, 13 on Ashby and 23 on
SmartRecruiters (PhonePe, Bosch, Capco, Brillio, Eurofins, Nagarro, Renesas, LinkedIn, Everpure/Pure Storage,
HighLevel, Atlys, Emergent, Sprinto, Tide…), each checked live for current posts in India with the feed's own parsers.
Left out: staffing agencies and gig marketplaces, boards with almost nothing in India, and big boards whose India
posts are mostly field sales or retail (Paytm Payments Services, H&M) or civil engineering (AECOM).

- Posts in India on the company boards: 1,714 → 5,380; listed now (the last 30 days): 670 → 2,180.
- A real first refresh of every keyless source (local, real network): 98 s → 289 s; the process's peak memory is
  unchanged (179 → 180 MB working set), since at most two boards are read at once.
- A Bengaluru backend engineer (3 years): 16 of 56 matches from company boards in India (29%) → 71 of 111 (64%) for
  the last 7 days; 30 days: 48 of 93 → 296 of 341. A fresher data analyst in Pune or Hyderabad: 2 of 21 → 11 of 30.

## Jobs in Resume AI: the latest jobs that match your resume (2026-10-07)

**Resume AI → Jobs** (`/resume-ai/jobs`; `/jobs` redirects there) shows the newest openings that fit the user's
resume, lets them shape the feed, apply on the original site, and use Orbit's AI on each job. Nothing is scraped
(docs/DECISIONS.md D43).

- **Where the jobs come from** (`orbit_api/job_portal/sources/`, one small module each, one interface):
  - Companies' own job boards through their public applicant-tracking-system feeds, no key, each post linking
    straight to the employer's application: Greenhouse, Lever, Ashby and SmartRecruiters, for 41 companies hiring
    in India (Razorpay, Groww, Paytm, Meesho, CRED, Swiggy, Sarvam AI, Okta, Databricks…, `companies.py`; add or
    remove boards without a deploy with `ORBIT_JOBS_BOARDS_JSON`). Each board is fetched at most every 6 hours.
  - Remote-job feeds, credited the way their terms ask: Himalayas (searched by the profile's titles, open to India),
    Remote OK and Jobicy, refreshed daily. Remote posts for somewhere else are left out.
  - Optional search APIs, off until their keys are set: Adzuna India (free tier; shared queries, stops at 90% of its
    per-minute, daily and monthly quota) and JSearch (paid; stops at 90% of `ORBIT_JSEARCH_MONTHLY_BUDGET`).
  - Outbound calls only to those providers' fixed hosts, https, no redirects, timeouts, a size cap and an
    identifiable User-Agent; a 429 backs off for as long as the provider asks. A failing source just keeps its
    cached posts.
- **The cache** (`refresh.py`): posts live in the database (migration `e9b4c6a2d8f1`), so a restart loses nothing. A
  feed request starts one background refresh per stale source (single-flight) and never waits for it; the page asks
  again while `refreshing`. An in-process loop keeps sources fresh only while someone has used the feed in the last
  two days. Posts older than 30 days are dropped; a board's taken-down posts go on its next fetch. A real first
  refresh: about 790 posts from the seven keyless sources in about two minutes.
- **Matching, without the AI** (`ranking.py`): title closeness (40), skills the post asks for that the resume or
  profile shows (35, the ATS score's keyword reading and synonyms), place and work mode (10), experience (10) and
  recency (5) give "Match NN%", with the matched skills and the ones the resume doesn't show. Filters: posted within
  24h / 3 / 7 / 30 days, cities or anywhere in India, remote / hybrid / in office, job types, sources, excluded words.
  Sort by best match or newest; paginated; the same job on a company board and a feed is shown once, from the board;
  one company's many openings are spread out. Tuned on the real refresh: skills read the same on every card ("CI/CD",
  "Go"), hiring and legal boilerplate ("Recruiting", "AEDT") and the company's own products aren't skills, and a post
  asking for four or more skills the resume has none of isn't a match.
- **The AI around it** (free, no credits, cost-logged like the resume maker's):
  - A search profile read from a resume: 4-5 titles including an honest adjacent role, the seniority, 10-15 skills
    the resume itself shows (others are dropped), cities. Cached per resume content; `ORBIT_JOBS_PROFILE_DAILY` a
    day (default 5); past that, or if the AI is down, it's worked out from the resume as written. Real DeepSeek:
    1.3-1.7 s.
  - A fit check per job: Strong / Good / Stretch, why you fit (only what the resume states: a point naming a tool or
    number it doesn't have is dropped, resumes/claims.py), gaps, and 2-3 honest resume tweaks. Cached per job and
    resume; `ORBIT_JOBS_FIT_DAILY` a day (default 15), the admin uncapped. Real DeepSeek: about 3 s.
- **The page** (`apps/web/src/pages/jobs/`): job cards (title, company, place, "posted 3h ago", match %, skills,
  where it's from with its credit) with Apply (opens the original post, then "Did you apply?"), Save, Check my fit,
  Tailor my resume (a copy with the job's text, opened in the editor; a snippet-only post is read in full from its
  page first, or the card says Orbit only has a summary) and Prepare (the job description and resume saved to Documents,
  Practice opened with that job picked: `/mock?jd=`). A search box ("remote React jobs in Bangalore, 2 years") is
  read into filters by rules, instantly and free. "Search on LinkedIn / Naukri / Indeed / Foundit / Instahyre /
  Cutshort / Hirist / Wellfound / Internshala / Google Jobs": their own searches, prefilled from the profile and the
  time range, the user picks which. A Customise panel edits everything the AI filled in. The tracker: saved →
  applied → interviewing → offer / not this time, with notes and dates, a board on wide screens and a list with a
  status menu on phones. Empty states for no resume, the first fetch, no matches and unreachable boards.
- API: `/v1/jobs/profile` (GET, PUT), `/profile/suggest`, `/feed`, `/listings/{id}` (+ `/fit`, `/tailor`,
  `/prepare`), `/tracker` (GET, POST) and `/tracker/{id}` (PATCH, DELETE). Every user object is checked for its owner
  (404 otherwise); the security matrices cover the new routes. The account export includes the job search.
- New env vars (docs/DEPLOY.md): `ORBIT_JOBS_REFRESH`, `ORBIT_JOBS_SOURCES_OFF`, `ORBIT_JOBS_BOARDS_JSON`,
  `ORBIT_JOBS_FIT_DAILY`, `ORBIT_JOBS_PROFILE_DAILY`, `ORBIT_ADZUNA_APP_ID`, `ORBIT_ADZUNA_APP_KEY`,
  `ORBIT_JSEARCH_KEY`, `ORBIT_JSEARCH_MONTHLY_BUDGET`.

## Orbit Resume AI: the resume maker becomes Orbit's second product (2026-10-07)

The resume maker was a tab under Documents. It's now **Orbit Resume AI**, a product of its own next to the
interview copilot, with its own place in the app and a public page.

- **Its own place in the main nav, "Resume AI"** (`components/Layout.tsx`): a Sparkles icon and a small gradient
  "AI" pill after "Resume" mark it as the AI product, on the top bar and the phone tab bar, in light and dark. The
  top bar drops its icons between 768 and 1023 px so six destinations fit; the phone bar has a column each and fits
  a 360 px screen.
- **New addresses** (`pages/resume/paths.ts`): `/resume-ai` is the product home, `/resume-ai/:resumeId` the editor.
  `/resume-ai/jobs` is kept for the Jobs portal: until its page is mounted the address opens the product home, so
  "jobs" is never read as a resume id (also in the nav's prefetch, `pageFor` in `routes.ts`).
- **Old links still work**: `/documents/resumes` and `/documents/resumes/:id` go to the same place in Resume AI
  (signed out, through sign-in first, as before), keeping `?` and `#`; `/resume-maker` goes to `/resume-ai`.
- **The product home** (`pages/resume/Resumes.tsx`): "Build a resume that gets interviews", with "Create a resume"
  (the usual ways to start) and "Import my resume" (straight to the PDF or Word import), what the AI does as chips
  (`RESUME_AI_FEATURES` in `pages/resume/product.tsx`, one line each, so Jobs is one more line), your resume
  credits with the buy link, and your resumes. A tab bar between Resume AI's pages (`RESUME_AI_SECTIONS`) shows
  once there's more than one.
- **Home shows the two products side by side**: the interview copilot (start a live session or a mock) and Resume
  AI (what it does, your best resume's ATS score, Open Resume AI).
- **Signed out, `/resume-ai` is a public product page** (`pages/resume/ResumeAiPublic.tsx`): what Resume AI does, a
  sample resume drawn by the real preview with its real ATS score (98, from `/v1/resumes/score`), an example
  rewrite, and what's free: the welcome credit as the server sets it (`ORBIT_WELCOME_RESUME_CREDITS`), what never
  uses a credit, and the cheapest pack. Nothing on it calls the AI. "Start free" signs up and comes back to Resume
  AI; "Sign in" does the same.
- **Sign-in and sign-up**: the interview copilot and Resume AI lead the features column as Orbit's two products;
  sign-up's subtitle is "Interview copilot and Resume AI, in one account". Sign-up now honours where the visitor
  was headed (as sign-in already did), and the links between the two pages and "Go to sign in" carry it along.
  The side panel's planet moved to the corner so it all fits a 1024 × 720 screen, and its small text is readable in
  the light theme too.
- **Documents** keeps uploaded resumes, job descriptions and the Story bank; its tab bar loses "Resume maker" and
  gains a "Build or improve your resume in Resume AI" link.
- **Everywhere else**: the editor's back button, Billing's Resume AI credits row (now a link), the approval banner,
  tab titles ("Resume AI · Orbit", from `lib/routeTitle.ts`, out of `App.tsx`) and "Resume AI credits" spelt the
  same way throughout.
- **Desktop app** (copy and links): "Resume maker" is "Resume AI" on the setup screen's note, the Settings button
  and the sign-in features list; both open `/resume-ai` in the browser.
- Tests: the old-address mapping, the Jobs address and the product home (`paths.test.ts`), tab titles
  (`routeTitle.test.ts`) and the nav's prefetch (`routes.test.ts`).

## Resume maker: Naukri and LinkedIn profiles, outreach messages, Shorten with AI (2026-10-07)

- **New "Profiles & outreach" tab** ("Outreach" in the tab bar), each generation one resume credit
  (`resumes/kit.py`, `pages/resume/ProfileKit.tsx`):
  - **Naukri profile** (`POST /v1/resumes/naukri-profile`): resume headline (≤250 characters, role, years and
    strongest skills first because search results show about 60), profile summary (≤1,000) and 10-15 key skills.
  - **LinkedIn profile** (`POST /v1/resumes/linkedin-profile`): headline (≤220), About (≤2,600, opening with what
    they do and a result because about 265 characters show before "see more") and the top 5 skills.
  - **Messages** (`POST /v1/resumes/outreach`), with optional name, company, role and "anything to mention": a
    referral request (LinkedIn connection note ≤200 characters, which fits free accounts, plus a LinkedIn or WhatsApp
    message), an email to HR or a recruiter (subject and ≤150 words), a follow-up after applying (≤100 words) and a
    thank-you after an interview (≤120 words).
  - **Grounded the same way as the rest**: only the visible resume, the job post and what the candidate typed. A
    figure or a tool none of those give goes with its sentence (or its part of a headline), skills are only ones the
    resume shows, years of experience come from the dates (internships left out), a headline never gets a rank the
    resume doesn't give ("Senior" from the job post), and a sentence opening with a made-up referrer is dropped. The
    greeting and sign-off are written by the server from the recipient's name and the resume's contact details.
    Dashes, "I hope this finds you well" and the like are taken out; every field is cut to its limit at a sentence
    or separator.
  - Output is edited in place with counters (what a site shows first, characters or words against the limit) and
    Copy buttons, and is kept in this browser per resume. Verified with real DeepSeek on an Indian data-analyst
    resume and a Swiggy job post.
- **Shorten with AI to fit one page**: when Fit to one page can't get there with spacing and text size, it offers
  "Shorten with AI" (`mode: "shorten"` on `/v1/resumes/suggest`, `resumes/shorten.py`). The lines that give a printed
  line back for the fewest words go first (weak ones a little earlier, the summary if long), sized to how many lines
  over it is; a second pass retries lines still too long. Each shorter line must keep every figure, tool and
  negation; one that only lost filler or its last clause is a safe fix ("Apply the safe fixes"), a reworded one is
  read first. One credit, given back when nothing survives the checks.
- **Cover letter tone and length**: professional, warm or confident; short (150-200 words) or standard (250-350).
- **Fixes from an audit**:
  - Hidden sections never reach the AI: `/suggest`, `/fix` and `/cover-letter` read `data.visible()`, like the
    score and the Word file (tested for every AI route).
  - The resume AI's cost log records the provider that actually answered (the backup after a failover), the
    latency, and failed calls (`ok=False`).
  - Import keeps up to 12 project bullets (it cut them at 8; the schema allows 12).
  - A missing keyword chip on the ATS tab asks "Add it only if you've really used it" before adding the skill.
  - "Use in Orbit" updates the document it made for this resume instead of adding a copy each time
    (`replace_id` on `POST /v1/documents/text`: updated in place when it's still yours, no quota check; otherwise a
    new one), and says why it couldn't save: the document limit (with a link to Documents), an account waiting for
    approval, no connection. The browser remembers which document goes with which resume.
- Security matrices: the new routes and `/fix` are in the per-user AI rate-limit matrix; `replace_id` naming someone
  else's document leaves it alone and makes the caller their own.

## Interview prep from your resume, practised in a mock interview (2026-10-07)

A new **Interview prep** tab in the resume editor turns the resume into interview practice, which other resume
builders can't do: they stop at the document.

- **Questions from my resume** (1 resume credit): what an interviewer is most likely to ask about this resume, 2 to 4
  for each role and project, plus 3 to 5 from the job post when there is one, grouped by role and project with copy
  buttons. They name the resume's own lines ("You cut failed UPI payments by 35% with idempotent retries. What was
  the failure rate before, and how did you measure the 35%?"), never "Tell me about yourself".
  - Each has an **answer outline built only from the resume** (Situation, Task, Action, Result for behavioural ones).
    A figure or tool the resume doesn't state is taken out (resumes/claims.py); a part the resume doesn't give, or a
    note that only names a topic, becomes a prompt for you instead ("Add the baseline failure rate").
  - **Be ready to defend**: where the interviewer will push. What they push on is found first, without the AI, and
    handed to the model: big numbers, team sizes and "led"/"owned", skills listed with nothing behind them, short
    stints (under a year, internships aside), gaps of more than four months, and no current role.
  - Real DeepSeek, a 3-role resume with a job post: 15-17 questions in about 12 s.
- **Skill gap for this job** (1 resume credit; needs a job post): every job keyword the resume lacks, the same list as
  the ATS score's, plus up to 4 other requirements the post states ("5+ years" is dropped when the resume shows them).
  Each gets "you have related experience: say it like…", "prepare: …" or "don't claim it". Related experience must
  quote a real resume line, or it's downgraded. Keywords that aren't skills (the company's name, a city) can be
  skipped. Nothing missing: no credit spent.
- **Practise these in a mock interview**: tick up to 8 (each role's first question is ticked first) and Orbit's AI
  interviewer asks them, in order, as a "prep" drill (`MockConfig.drill`, no migration), marked "From your prep".
  A question with a defend note gets a live follow-up that pushes there ("what was your specific role, versus the
  other engineers?"). The resume and the job post are saved to Documents for the round, reusing the document "Use in
  Orbit" made (same kind and title, brought up to date) instead of adding a copy. The session is created on the
  server, so the desktop app can start or rejoin it too.
- **Save to my stories**: a behavioural outline goes to the story bank as a STAR draft, the parts to fill in left as
  [prompts], so live interviews can use it.
- Hidden sections never reach the AI. Results stay while the editor is open; nothing is stored on the server.
- The editor's tabs show labels without icons from tablet width up (six don't fit with both), with "Letter" and "Prep"
  where the editor sits beside the preview in a narrow column.
- Fixed: a year before a comma ("Aug 2020,") counted as an invented figure, so grounding took it out of AI text.
- API: `POST /v1/resumes/prep/questions` and `POST /v1/resumes/prep/skill-gap` (`{data, job_text}`); the shared client
  has `resumeQuestions` and `resumeSkillGap`. Drill items accept `feedback` from the web types too.

## Resume maker for students and freshers: CGPA, Campus and Harvard templates, fair scores without a job (2026-10-07)

Most people using the Resume maker are Indian job seekers, many of them students applying through campus placements,
Naukri and LinkedIn. Their resumes lead with education and projects, carry a CGPA and Class 10/12 marks, and have no
full-time job yet, which the editor, the templates and the ATS score didn't allow for.

- **CGPA or percentage on every education entry** (`grade`, optional, up to 60 characters; older resumes load with it
  empty). The form labels it "CGPA or percentage" ("8.6 / 10 CGPA, or 92%"), and the degree and school fields now say
  how to enter Class 12 and Class 10 (board and school, year, percentage). It prints in every template (under the
  degree, before the details; flush right on the degree line in Campus and Harvard), and goes into the Word file, the
  plain-text copy and what the AI reads of the resume.
- **AI import reads it**: the prompt maps a CGPA, percentage or class into `grade`, school results into education and
  internships into experience. Grounding keeps a grade only when the source states it ("8.71/10" backs "8.71 / 10
  CGPA"; "91.60%" backs "91.6%"); one it never gives is blanked. Checked on real DeepSeek with an NIT fresher resume.
- **New extra sections**: Positions of Responsibility, Achievements, Relevant coursework, Extracurricular activities,
  Personal details (with a note: MNC, startup and tech recruiters usually prefer it left out; some government and
  traditional employers expect it) and Declaration (starts with the standard one line).
- **"Student / fresher" in New resume**: a one-page Campus resume ordered education, projects, skills, internships,
  positions of responsibility, achievements, the last two ready to fill in.
- **Two ATS-safe single-column templates**, with Quick looks of their own:
  - *Campus*, in the style of Jake's resume: centred small-caps name, a " | " contact line, small-caps headings over
    a hairline, tight spacing, school or company in bold with the dates flush right and the degree or role in italics
    below.
  - *Harvard*: a serif name and centred bold uppercase headings over a rule, with generous spacing.
  - Both print to A4 and Letter (page 2 keeps its margin), show where pages break and work with "Fit to one page".
    The Word file keeps their look: centred header, small-caps or centred serif headings, two-line entries.
  - Word headings in every template are now set in the resume's font: Word's Heading 1 theme font used to win over
    it, so they came out in the theme's font whatever was chosen.
- **Fair scores for freshers.** A resume with no job but with projects is judged on its projects: two with bullets
  count as experience, and project bullets are held to the same checks as a role's (complete, 2-6 bullets, numbers,
  action verbs, length). A B.Tech fresher with two good projects and no internship scored 53 and now scores 93.
  Resumes with any role score exactly as before.
- Web unit tests now run in `apps/web` (vitest).

## Coding questions get code, in every session, in chat and from screenshots (2026-10-05)

Reported: coding questions came back as English only, even in a Coding interview, and in chat. Measured with real
DeepSeek on 16 everyday coding asks (spoken and typed, coding and normal interviews): 45 of 56 got code before, 56 of 56
after, and chat follow-ups ("give me the code", "now in Java") 6 of 6.

- **Code was thrown away.** The model often writes the code straight after the talk track without a `CODE:` line;
  unless the question had been typed "coding", the parser read it as prose and the code was crushed into the spoken
  answer as one line. A fenced block now counts as code wherever it is, unfenced code under `CODE:` is kept, and the
  solution under `CODE:` wins over a snippet in the talk track.
- **Coding asks were typed "technical"** ("write a program…", palindrome, Fibonacci, "detect a cycle in a directed
  graph", "merge two sorted lists", "check whether a number is prime"). More of the ways people name problems and ask
  for code, as whole words where a prefix would misfire ("code for" isn't "code formatting", "a trie" isn't "a
  tried"), plus a small "verb + data" rule for plain tasks ("count the words in a sentence").
- **The prompt now asks for the code**: coding answers MUST have `CODE:` with the complete solution, then
  complexity, edge cases and tests. In a Coding interview or assessment every technical question is a coding one. In a
  normal interview a technical question may still turn out to need code ("so how would you get the top ten in
  Python?"): the model decides, with room in the token budget for it. A follow-up to an answer that had code stays a
  coding answer.
- **Chat:** "give me the code", "code it", "now in Java", "what about C++?" redo the question on screen as code
  instead of being a new question, and "make it shorter" on a code answer keeps the code. The chat panel now shows the
  reply's code block (it showed only the words).
- **Screenshots in any session:** the model works out what the image shows. A coding problem gets the talk track plus
  the full solution, an error gets the fix (debug format where the plan has it), a multiple-choice question a plain
  answer. Screenshot answers always have a code-sized budget (normal-interview screenshots had a prose-sized one).

## Dotted "thinking orbs" for loading and AI activity (2026-10-04)

- Loading spinners, the live "Thinking…" / "Answering" / "Hearing speech" status, the answer card's thinking state and
  the session-report banner now use the animated dotted orbs from
  [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) (MIT, © Jakub Antalik), in the shared UI package so
  the web app and the desktop app both get them.
- The animation says what is going on: `searching` while reading a resume or the job post, `composing` while writing
  (letter, rewrites, answers), `solving` while thinking an answer through, `listening` while hearing speech,
  `connecting` while joining a session, `weaving` for uploads and tailoring. Page-level loads use the large orb.
- Monochrome, follows light/dark, a still frame under "reduce motion", paused when offscreen or the tab is hidden.
- Fixed a doubled ellipsis ("Reading your resume......") in loading messages.

## The resume maker is free for everyone, no account (2026-10-02)

- **Open to anyone at `/resume-maker`, linked from the sign-in and sign-up screens** ("Free resume maker, no account
  needed"). Everything works signed out: start from scratch or import a PDF, Word file, LinkedIn profile or pasted
  text; the live ATS score; the AI fixes (skills, bullets, numbers, dates, rewrites); cover letter; PDF and Word
  download. Signed-in people are sent to their account's resume maker, which is unchanged.
- **The resume stays in the visitor's browser**, not on the server: one resume, saved as they type ("Saved on this
  device"), with a note that clearing browsing data deletes it. If they later sign in, Resumes offers "Save to my
  account" (and Discard) for the one they made before.
- **Cost is capped, since nobody is there to bill.** Signed-out AI: 6 calls at once, then 1 a minute per address, and
  300 a day across everyone (`ORBIT_GUEST_RESUME_AI_DAILY`, `0` turns it off); past that, "The free AI has reached
  today's limit. Try again tomorrow, or create a free account." Scoring and Word export aren't capped. Importing a
  document from an account and importing a job post from a link need an account, so the signed-out editor leaves
  them out; pasting a job post works.
- **API:** new `/v1/resume-maker/{score,docx,import,import-file,suggest,cover-letter,cover-letter/docx}`, the same tools
  as `/v1/resumes/*` (shared code), with no sign-in and nothing stored. The account endpoints still need one.
  The shared client exposes them as `api.guest.*`.

## Resume AI fixes every problem, not just wording (2026-10-02)

- **"Fix with AI" now appears on almost every ATS problem**, and it does what the problem needs: adds skills, adds
  bullets, adds numbers, writes dates one way, writes a missing headline or summary. Before, it could only reword
  text that already existed, so "list at least 8 skills" or "this role has no bullets" had no fix.
- **Skills** are worked out on the server with no AI call, so they're instant. Tools your own bullets name but your
  Skills section lacks are offered with no warning (adding them says nothing new). Skills the job post asks for, and
  skills common for your kind of role, come as separate suggestions with a "check it's true" warning. Tick off any
  you don't have before adding.
- **Missing bullets** are drafted for any role with fewer than 2, in a resume-bullet voice, with a placeholder for
  every number and no tool the resume doesn't name, and a warning that they come from the job title, not from you.
- **Numbers** are added as `[X%]` / `[N]` placeholders where a bullet needs one (never an invented figure).
- **Dates** that mix styles ("01/2021" next to "Jun 2018") are rewritten one way; "2021" is never turned into
  "Jan 2021", which would invent a month. **"Apply the N safe fixes at once"** applies the skills the resume proves
  and the date fixes in one click; anything that needs your confirmation or a number stays one at a time.
- `POST /v1/resumes/suggest` takes `check` (an ATS check id) and suggestions have a `kind`
  (`rewrite`, `add_skill`, `add_bullet`, `set`) and an optional `confirm` warning. If the AI is down, the skill and
  date fixes still come back.

## Resume writing on a phone: no more endless "uploading" / "scoring" (2026-10-02)

- **Every request now has a time limit.** A stalled phone connection (switching wifi and cellular, a tunnel, weak
  signal) used to leave the screen waiting for ever. Ordinary requests give up after 30 s with "That took too long.
  Check your connection and try again."; AI calls, uploads and exports get 150 s. The limit is picked from the
  endpoint, so a new AI endpoint isn't cut off by forgetting to opt in. Requests can also be cancelled.
- **Importing a resume** shows what's happening, and after 8 s says it's still working (scanned PDFs and long
  resumes can take a minute or two) with a **Cancel** button. A file over the server's 10 MB limit is refused
  before uploading it over cellular.
- **Scoring keeps up on a slow connection.** A new edit cancels the score request still running, so slow replies
  can't pile up or overwrite a newer score, and the wait before the next request grows while the connection is slow.
  (On a simulated slow connection: 3 score requests instead of 6.)
- **Autosave is safe on a slow connection.** Saves go one at a time, so an older save can no longer land after a
  newer one and overwrite recent edits. After a dropped connection it retries by itself every 5 s and as soon as
  the phone is back online.

## Resume import can't add what the source doesn't say (2026-10-02)

- **Imported resumes are checked against the text they came from** (`claims.ground_import`). The import prompt says
  "copy facts exactly", but a model can add a plausible skill, an email, a profile link or a metric. Now:
  - an email, phone number or link the source doesn't contain is blanked (a link matches with or without
    `https://` and `www.`; a phone number matches however it's spaced);
  - a skill the source never lists is dropped, a skill listed in two groups is kept once, and an empty group goes;
  - a figure the source never states in a summary, bullet or project becomes a placeholder.
  - What was removed is logged.

## Resume AI can't invent facts; cleaner job keywords (2026-10-02)

- **AI rewrites can't add facts** (`resumes/claims.py`). The prompts forbid invented numbers and tools, but nothing
  checked. Now every suggested rewrite is checked against the whole resume:
  - a figure the resume never states ("by 40%", "$2M", "3.5x", "12 teams") becomes a placeholder ("[X%]",
    "[$X]", "[N]x", "[N]") and the reason says to fill in the real number;
  - a tool or technology the resume never mentions (GraphQL, Terraform, S3…) drops that suggestion.
  - Years and digits inside names (S3, k8s, 24/7) are not figures; generic shorthand (KPI, ROI, SLA) is not a tool.
- **Cover letters get the figure check too**, against the resume and the job post (a letter may cite a figure the
  post states, such as "500 services").
- **Job keywords**: no more "RPC" split off "gRPC", "rails" (from "payment rails") as Ruby on Rails, or "Remote",
  "Hybrid", "PTO" and similar perks as skills to add.

## Follow-up chains keep their topic (2026-10-02)

- **A follow-up's retrieval inherits the thread, not just the last question.** In "Tell me about the payment service
  you built" → "What would you do differently?" → "How did you test it?", the third question used to search with only
  the second and found nothing. It now carries the last two questions, so it still finds the payment-service facts.
- **More back-references count as follow-ups**: "the team", "the project", "the outcome", "the result", "the same
  way", "do it again", "looking back".
- **"The X you built / led / designed / worked on…" is about the candidate's own work**, so it's typed personal and
  gets the grounding rules.

## Topic questions get the matching facts; more personal questions get personal rules (2026-10-02)

- **"Your experience with X" gets X.** Questions typed "resume" were always answered from the profile summary and
  latest roles (the "tell me about yourself" treatment), so "Describe your experience with fraud detection" never
  saw the fraud-detection fact. That treatment now applies only to broad background questions ("tell me about
  yourself", "walk me through your resume/career"); anything with a topic gets the facts that match the topic.
- **A summary line that's just a name** ("Jane Doe") is no longer sent as context.
- **Hyphenated words match their parts**: "fraud" finds "fraud-detection". The retrieval benchmark's dev set
  improved (R@1 0.77 → 0.82, MRR 0.85 → 0.89); the held-out set is unchanged.
- **More personal questions are typed as personal**, so they get the grounding rules:
  - education ("Where did you go to university?");
  - experience with a tool ("Have you worked with Kafka?", "familiar with");
  - prioritisation and work style.

## Story questions get story answers, grounded in the resume (2026-10-01)

- **"Tell me about a time…" is always behavioral.** "Tell me about a time you had to scale a service under pressure"
  was typed system design (the "scale" keyword won). That gave a story question the design format and a code-sized
  budget, without the story rules. Asking for a story (a time / situation / example, "have you ever") now decides
  the type first.
- **Retrieval matches word forms properly.** The stemmer split "service"/"services" ("service" vs "servic"),
  truncated "success" to "succes", and kept "migrating"/"migration" apart, despite its own docstring. It now
  handles "-es" only after s/x/z/ch/sh, leaves "-ss"/"-us"/"-is" alone, drops a final silent "e", and unifies
  "-ating"/"-ated"/"-ation".
  - The scaling question now finds "Built payment services handling 10k TPS"; before, it found nothing.
  - The retrieval benchmark is unchanged (no regressions).

## Mock interviewer replies without a model call's wait (2026-10-01)

- **The next question is written during the candidate's pause.** After 0.9 s of silence the next question starts
  in the background.
  - When the answer is judged complete (1.2–5 s, depending on how it ends), it is asked at once.
  - If the candidate keeps talking, it is discarded and written again for the full answer.
  - Applies to the free-flowing interview (not drills or negotiations), and only when another question will be asked.

## Transcription knows this interview's vocabulary (2026-10-01)

- **Real custom vocabulary for the speech-to-text.** Deepgram's keyterm prompting takes single terms, but Orbit sent
  whole resume skill lines ("Languages: Python, Go, TypeScript"), and lines of 40+ characters were dropped
  entirely. Tech terms from the job post and the company name were never sent.
- Now (`live/keyterms.py`) it sends up to 50 individual terms, most useful first:
  - the company;
  - each skill from the resume's skills lines;
  - tech-shaped names from the job post (gRPC, ClickHouse, Node.js, C++, AWS);
  - names written mid-sentence (Rust, Protobuf, Stripe);
  - then the same from the rest of the documents.
  - Generic job words ("Engineer", "Senior") and company suffixes are left out.

## Short commands get answered; ambiguous ones don't wait for the classifier (2026-10-01)

- **"Explain microservices." / "Define idempotency." are answered.**
  - A request verb followed by a bare noun ("Explain microservices.", "Define idempotency.", "Compare REST and
    gRPC.") scored as a possible statement, minus a penalty for being short. Such requests never auto-answered
    and didn't even reach the classifier.
  - They now count as requests unless the noun phrase has its own verb ("Design reviews happen weekly.", "Share
    price is up."), which still goes to the classifier.
- **The classifier no longer adds its round trip.** For an utterance that does go to the classifier, the answer
  is written in the background while it decides.
  - If it says "answer" (with the question unchanged or only lightly reworded), the words appear at once.
  - Otherwise they are discarded unseen.

## Phone mode tells voices apart; capped answers end cleanly (2026-10-01)

- **Phone / room mode knows who's talking.** The single microphone is diarized (Deepgram `diarize=true`).
  - The first voice to ask a real question is the interviewer; other voices are the candidate.
  - The candidate thinking aloud ("So how would I explain it?") no longer triggers an answer.
  - Swapping a transcript line teaches Orbit that voice for the rest of the session.
  - A result that straddles two speakers belongs to the one who said most of it.
- **Capped answers end on a full sentence.** The stream now reports `finish_reason`. An answer that hits its token
  budget is trimmed to its last complete sentence instead of stopping mid-word, and the server logs it.

## Live answers: the whole question, faster, with Stop and Pause in reach (2026-10-01)

- **The whole question gets answered.**
  - Question extraction no longer drops the main ask when a statement sits between the parts ("Tell me about your
    last project. I'm especially interested in the scaling. What would you do differently?" used to send only the
    last sentence).
  - Asks phrased as statements count ("I'd like to understand…", "I'm especially interested in…"), and topic
    framing ("So my next question is about testing.") stays with the question.
  - A short continuation after a pause ("…which database? <pause> And why?", "In Go?") re-answers the whole
    question. A short aside ("Yeah, that's right.") doesn't restart the answer.
  - Question types match whole words ("backpressure" is no longer "pressure" = behavioral) and come from the whole
    question, not only its last sentence.
- **Multi-part questions are spelled out for the model.** The prompt lists the parts ("This question has 3
  parts…") with a POINTS label for each, and the token budget grows with the number of parts so the answer isn't
  cut off before the last one.
- **The model knows the question is live speech.** It corrects misheard technical terms silently and checks the
  interviewer's latest turn for anything the extracted question missed, without re-answering earlier questions.
- **Faster answers.**
  - With "wait before answering" on Balanced or Patient, the answer is now written *during* the wait: if the
    question fires unchanged it appears at once, words included; if the interviewer keeps talking it's dropped
    unseen. This hides the model's start-up time (about 0.7–1 s) inside the wait.
  - The AI connection is warmed when the interviewer starts speaking (and at session start), so an answer after
    a quiet stretch doesn't pay for a new TLS handshake.
- **Stop and Pause.**
  - **Stop** on a streaming answer ends it but keeps what's written (`answer.stop`); Clear still removes it.
  - **Pause** is now in the compact overlay too (the desktop app's default), and a paused session shows a banner
    with Resume.
  - The compact overlay's answer toolbar and bottom bar are icon-only and wrap instead of overflowing the panel.

## Open sign-up without SMTP when approval is on; "waiting" count for the admin (2026-09-30)

- **Open sign-up without email.** Production used to refuse `ORBIT_ALLOWED_EMAILS=*` without SMTP, and refuse
  `ORBIT_EMAIL_VERIFICATION=off` with it. With sign-up approval on, nobody can spend anything until the admin
  looks at the account, so `*` with verification `off` is now allowed. `*` with verification on still needs SMTP.
- **"N waiting" in the web header** (admin only). It links to Users & access, is re-counted on every page change
  and every minute, and is how the admin hears about sign-ups on a server with no SMTP.

## New sign-ups wait for the admin; grant access for a while (2026-09-30)

- **New accounts wait for approval** (`ORBIT_SIGNUP_APPROVAL`, on by default in production).
  - A new account can sign in and look around. Sessions, AI features and uploads answer 403 `approval_pending`
    (`require_verified_user`).
  - A banner in the web and desktop apps says it's waiting, and the ready check says so too, instead of "out of
    minutes".
  - Accounts from before stay approved (`users.approved` defaults to true, migration `d2a6f8c4e9b1`).
- **The admin hears about every sign-up.** An email to `ORBIT_ADMIN_EMAIL` names the person and links to the
  admin page. Where email verification is required, it's sent once the new inbox is verified, so typo'd and
  throwaway addresses never reach you.
- **Users & access** (Settings → Users & access, `/admin/users`). Waiting and Everyone tabs, each account with its
  join date, email status and live minutes this month.
  - **Give access for a while:** Unlimited or Pro, for 1 hour, 2 hours, 1 day, 7 days or 30 days. Giving the same
    plan again adds the time on.
  - **Approve for good** (the Free plan), or **Revoke** (back to waiting).
  - The user gets an email for a grant or an approval. A grant runs out on its own and they wait again.
  - Plan & billing shows when a granted plan ends.
  - Endpoints: `GET /v1/admin/users`, `POST /v1/admin/users/{id}/access`.

## Resume maker: cover letters, more sections, undo, page count, sharper ATS checks (2026-09-30)

- **Cover letter** (new tab). One click writes a letter from the resume and the job post (`POST
  /v1/resumes/cover-letter`, `resumes/ai.py`).
  - It's grounded like the rewrites: it only restates what the resume and job post say, with [placeholders] for
    the rest.
  - It's saved with the resume in a new `resumes.cover_letter` column (migration `c9d4e7a2f1b8`). A save that
    leaves the field out keeps the letter.
  - It's editable, with a matching letter-page preview, Copy, Word (`/cover-letter/docx`) and PDF.
- **More sections:** Languages, Awards, Volunteering, Publications, Interests, or a custom one (up to 5).
  - Each shows as a list or on one line, and has a place in the section order (`extra:<id>`).
  - They appear in the preview, both PDFs and the Word file, count toward keywords, and are read by AI import.
  - In the Sidebar template, one-line sections go in the side column.
- **Undo and redo** for the whole resume (buttons, or Ctrl+Z / Ctrl+Shift+Z outside a text field). Typing in one
  field is one step. A removed role, an accepted AI change or a "fit to page" can all be taken back.
- **Page count:**
  - The preview shows how many pages the resume prints on, and where page 2 starts. The guide sits at the top of
    the role that moves to page 2, since printing keeps each role whole.
  - **Fit to one page** tries tighter spacing, then smaller text down to 9.5 pt, measured off-screen, and applies
    the first that fits (one undo step), or says it can't.
- **Unfilled placeholders are caught.** An AI rewrite can leave a cue like "[X%]".
  - A new ATS check and a banner point to it, and it's highlighted in the preview (not in print).
  - Downloading a PDF or Word file with one left asks first.
- **Make a copy** of a resume from the list, to tailor a version for another job.
- **Sharper ATS checks** (weights rebalanced so they still total 100):
  - the same opening verb on too many bullets, with other verbs to use;
  - clichés like "team player" or "results-driven";
  - roles not listed most recent first, or ending before they start.
- **Fixes:**
  - In the Links and Skills rows, the label box took the whole width and hid the URL (a `w-32` lost to the
    input's `w-full`).
  - The editor tabs no longer wrap.
  - On phones, the icon-only tabs had no accessible name.

## Better interview answers: consistency, common questions, company, sharper mock interviewer (2026-09-29)

- **Answers stay consistent and don't retell the same story.** Each answer used to see only the one before it, and
  only on a follow-up. Now every answer gets short notes on the last 6 answers (`SessionMemory.answers`): the
  question, the points made, and which of the user's facts each one drew on. Example stories are marked as such.
  The prompt says to keep the same facts, numbers and opinions, and to pick a different story for a new
  behavioral question unless the question is about that same story. A "make it shorter" rewrite replaces its
  answer's note rather than adding one. The notes survive a reconnect, since they live in the carried-over memory.
- **Guidance for the most common interview questions** (`prompts/live_system.md`):
  - tell me about yourself: a short arc, not a resume recital;
  - why this company, why this role, why you're leaving: specific, forward-looking, never criticising an
    employer, no invented company facts;
  - strengths with proof, and weaknesses that are real but not disqualifying (no humblebrags);
  - why should we hire you: the role's top needs matched to verified strengths;
  - "Do you have any questions for us?": the answer is now two or three tailored questions for the user to *ask*,
    not an answer;
  - clarifications.

  Closing and motivation questions ("any questions for us", "why this role", "what interests you about…") are
  now detected as that type.
- **Company awareness.**
  - A session started from a saved setup passes its company name to every answer and to the mock interviewer.
    A salary-negotiation practice uses the company from its offer setup.
  - "Why us?" answers always get the "about us" and role parts of the job post, even when a search wouldn't find
    them.
- **Mock interviewer.**
  - It now sees every topic it has already covered, so a long round no longer circles back to one; before, it saw
    only the last 6 exchanges.
  - Difficulty is spelled out: easy is encouraging; medium probes once on vague answers; hard asks for specifics,
    numbers and trade-offs and politely challenges weak reasoning.

## Resume maker: Word download, better Word import, named PDF (2026-09-29)

- **Download as Word (.docx).** Next to "Download PDF", **Word** downloads the resume as the editor shows it,
  saved or not, for portals and recruiters that ask for Word (`POST /v1/resumes/docx`, `resumes/docx_export.py`).
  - It is built from real Word parts: headings, bullet lists, and a right tab stop for dates. That makes it easy
    to edit, and ATS software reads it cleanly.
  - It keeps the font, size, accent colour, spacing, page size and section order. It is always one plain column
    with no photo.
- **Word resumes import whole.** Uploading a .docx used to read only top-level paragraphs, dropping anything in
  tables, text boxes, and page headers and footers. Many Word resume templates put the whole layout in tables
  and the contact line in the page header. All of it is now read, in order and only once (Word keeps two copies
  of each text box). This applies to Documents uploads too.
- **The PDF gets a real file name.** "Download PDF" now suggests "Sam Lee - Resume.pdf" instead of the app's name.

## Fix: resume import of scanned PDFs, and a clean "Download PDF" (2026-09-29)

- **Scanned and hard-to-read PDFs now import.** Uploads used to fail with "No readable text found (scanned PDFs
  need OCR, not yet supported)". PDFs are now read in three steps (`documents/parsing.py`):
  - pypdf first;
  - PDFium if pypdf finds nothing (fonts it can't map, some design-tool exports);
  - OCR for scans with no text layer: PDFium renders the first 3 pages and Tesseract reads them.

  OCR runs inside the same memory- and CPU-limited child process as the parsers, which now has 75 s for a PDF.
  It applies to Documents uploads too. The API image installs `tesseract-ocr`; a server without it tells the
  user to export a text PDF or paste the text.
- **The downloaded resume has no browser header or footer.** The print page now has no margin, so the browser
  has nowhere to print its date, title, URL and page numbers. The resume's own padding repeats on every page
  (`box-decoration-break: clone`), so page 2 still gets its top margin.
- **The name comes first in the PDF's text.** In the Classic template the header was positioned, so the browser
  wrote its text after the sections, and ATS parsers read the name and contacts last. The photo is now anchored
  to the page instead.

## Fix: whole-app check (2026-09-29)

A pass through every screen (sign-up, documents, story bank, a live session, the report, practice, settings,
billing, phone widths) found three problems:
- **Long questions were saved cut short.** When the interviewer kept talking and a question grew, the live
  answer used the whole question, but the report and exports kept only its first part. The recorder now updates
  the stored question text (`DbRecorder.question_text`).
- **The mic could hang on "Starting…".** If the browser's audio engine never loaded, nothing happened and there
  was no error. It now gives up after 8 seconds and shows "Microphone unavailable" with a Retry button.
- **Resume fields had no length limits.** Pasting a long text into a resume field made every autosave fail
  quietly ("Not saved"). Each field now stops at the limit the server accepts, and "Add role" stops at 20 roles.

## Fix: answers covered only the last part of a question (2026-09-29)

When the interviewer asked in one breath, e.g. "Tell me about your last project. What was the hardest part?" or
"We process 10k payments a second and latency spikes at peak. How would you fix it?", the answer covered only
the last sentence. The detector kept just the last question sentence of a turn, so a longer "wait before
answering" didn't help. `question_in_context` now keeps:
- earlier parts of the question;
- set-up said right before it ("Let's say…", "We have…", "Imagine…"), or that the question refers back to
  ("…fix it?");
- constraints added right after ("Assume a million users.").

What still stays out:
- other apps' audio merged into the turn;
- fillers and pleasantries;
- the interviewer's reaction to your last answer ("Great, thanks.").

Set-up is capped at 80 words. Whether something counts as a question is still judged on the question sentence
itself.

## Resume maker (2026-09-29)

Most resumes are read by software before a person sees them. The resume maker, under Documents → Resume maker,
scores yours the way that software reads it and helps you fix it until it passes.
- **Start anywhere:** from scratch, from a PDF or Word file, from LinkedIn ("Save to PDF", or pasted text), from
  pasted text, or from a resume already in Documents. AI reads it into editable sections, never adding facts.
  The file isn't kept.
- **ATS score out of 100, with a fix for every missed point** (`resumes/ats.py`):
  - The score is deterministic, so the same resume always gets the same number, and it re-scores as you type.
  - Contact details 10, standard sections 12, summary 5, experience bullets 28 (action verbs, numbers, length, no
    "I"), skills 8, length and dates 7, ATS-safe layout 5, job keywords 25.
  - Without a job post, the other 75 points are scaled to 100.
  - "Show me" jumps to the text a fix is about.
- **Tailor to a job post:** paste it or import it from a link. You see which keywords are matched and which are
  missing, and one click adds a missing one to your skills (only the ones you really have).
- **AI rewrite, one accepted change at a time:** "Improve my resume", "Tailor to the job", or "Fix with AI" on a
  single line.
  - Each suggestion names the exact text it replaces and is skipped if you've edited that text since.
  - Where a number would help, the AI leaves a [placeholder] for you to fill in, never an invented figure.
- **Design:**
  - Four templates: Classic, Modern, Compact, and Sidebar (flagged as less ATS-safe).
  - Accent colour, five fonts, text size, spacing, A4 or Letter, and an optional photo (shrunk to 256 px; flagged
    for ATS).
- **Download PDF** prints just the resume at real size, as real selectable text: one A4 page in the tested
  example, with the text in reading order.
- **Use in Orbit** saves the resume to Documents, so live sessions answer from it.
- **Desktop app:** the setup screen shows your best resume's ATS score, with a link to the Resume maker, and
  Settings has a Resume maker button. Both open it in your browser.
- Included in "Download my data". Every page scans clean with axe (WCAG 2.1 AA) in both themes, and there's no
  sideways scroll on phones.

## Reconnects continue the session (2026-09-27)

- **Conversation memory survives a dropped connection.** Before, a Wi-Fi blip mid-interview gave the new
  connection a fresh engine with no recent turns, summary or question history, so follow-up answers lost the
  thread. The next connection now picks up the previous engine's memory (`live/carryover.py`). It's kept in
  process memory for no longer than an idle session and dropped when the session ends. After a server restart,
  the saved rolling summary seeds it.
- **Mock interviews resume instead of restarting.** A drop used to start the round over at question 1 with a fresh
  timer. Now the same question comes back in the same place ("2 of 3"), it isn't recorded twice, and the round's
  clock keeps running.
- **Sign-up review fixes:** no stray "already registered" email to an owner mid-sign-up, and no 500 when two
  sign-ups for one address race.

## Dependency updates (2026-09-27)

Taken from Dependabot, after testing each one locally (typecheck, lint, tests, both builds, audit):
- **npm:** globals 17; eslint-plugin-react-hooks 7, with the classic rules kept as v5 had them (the new React
  Compiler rules are a refactor of their own); @types/node 22.x, matching the Node CI runs.
- **Actions:** setup-node 7, setup-uv 10, build-push-action 7, action-gh-release 3, pnpm/action-setup 6.1, all
  still SHA-pinned.

Not taken:
- **Tailwind 4:** the build breaks; it needs a real migration.
- **@types/node 26:** ahead of the runtime.
- **windows-core 0.100 on its own:** it must move with `windows`.

Dependabot now groups updates: one PR for all actions, minor and patch updates batched per ecosystem, and the
`windows` crates together. It also ignores major Tailwind and @types/node versions.

## Sign-up privacy, shorter web sessions, verified admin (2026-09-27)

- **Sign-up no longer reveals whether an email is registered** (when verification is required and mail works):
  - new and taken addresses get the same "Check your inbox" answer;
  - the owner of a taken address gets a "you already have an account" email;
  - the link verifies, then the person signs in.
- **Web sessions end after 3 days unused** (`ORBIT_SESSION_IDLE_HOURS`) and renew while in use, up to the same
  7-day cap. Desktop tokens are unchanged.
- **Admin rights need a verified email** when mail can be delivered, so registering the admin address first no
  longer makes someone admin.

## Security review (2026-09-27)

Full review (secrets, SCA, SAST, manual review, DAST): [SECURITY_REVIEW.md](SECURITY_REVIEW.md).
- **CI:**
  - Fixed script injection in the release workflow.
  - Every action is pinned to a commit SHA, and checkouts use `persist-credentials: false`.
  - New `security` job: pip-audit, bandit and pnpm audit.
  - Dependabot covers Docker.
- **Sign-in:**
  - The web app no longer receives the session token in JSON (httpOnly cookie only).
  - The cookie is `SameSite=Lax` in production.
  - Auth asserts are explicit 401s.
- **Client IPs:** can't be spoofed when `ORBIT_PROXY_SECRET` is set; the Worker states the real one.
- **Web app:** a CSP (built from the finished `index.html`), HSTS, `nosniff`, frame denial, COOP and a
  Permissions-Policy.
- **API:**
  - Request bodies are capped (413).
  - WebSockets refuse foreign origins.
  - Update links come from `ORBIT_API_PUBLIC_URL`.
  - Dropped-email logs mask the address.
  - No `server` banner.
- **Images and desktop:** base images are pinned by digest, and the desktop CSP adds `object-src`, `base-uri`,
  `form-action` and `frame-src 'none'`.

## Phones, accessibility and loose ends (2026-09-26)

- **Nothing scrolls sideways on phones.** Checked every page at 320 px and 390 px wide. Fixed:
  - Documents: 259 px too wide at 390. On phones, type and status move under the title instead of their own table
    columns.
  - New session: 64 px too wide. `Field` is `min-w-0`, because a select sizes to its longest option and stretched
    the grid column. This fixes every form.
  - Home at 320 px: the recent-sessions card in an auto-sized grid column.
  - Session detail at 320 px: the tabs use shorter labels on phones ("Q&A").
  - The live screen's "Mic off" and "Interviewer off" chips no longer wrap.
- **Accessibility (axe-core, both themes, every main page and the live screen)**: the score rings and pips are
  `role="img"` (their labels were ignored), the sign-in page has a `main` landmark, the review and summary headings
  no longer skip a level (web and desktop), the documents table's actions column has a header, the live screen has
  an `h1` (the session title) and a labelled nav, and the amber "Unfinished" / "Pinned" badges pass contrast in
  light mode (4.46 → above 4.5:1).
- **Worker hardening (from the superseded #83)**: a client-sent `X-Forwarded-For` is dropped when Cloudflare's
  `CF-Connecting-IP` is absent, so it can't spoof the IP the API rate-limits by. A bare `/api` also runs the Worker.
  PR #83 was closed as superseded by #84.

## Speed and feel pass (2026-09-26)

Measured on a production build with a phone profile (390 px, 4x CPU slowdown; "slow 4G" = 150 ms RTT, 1.6 Mbps):

| | Before | After |
|---|---|---|
| Idle CPU on Home, per 5 s of doing nothing | 5.35 s | 0.9 s once settled (2.1 s in the first seconds) |
| JavaScript to open the sign-in page | 559 kB (170 kB gzip), one file | ~290 kB (~92 kB gzip); pages load on demand |
| Sign-in form usable on slow 4G | 1.82 s | 1.48 s |
| Going back to a page you've seen | spinner, then data | instant (last data shown, refreshed in the background) |

- **Idle CPU (battery, scroll jank)**: the glass cards and bars no longer use `backdrop-filter` blur. Over the
  animated sky it re-blurred every panel on every frame, and it was half the idle cost. Surfaces are slightly more
  opaque, so they look the same. The sky still drifts and twinkles, in steps (a few repaints a second instead of 60).
  Decorative loops (planet orbit and glow, sparkles, float, empty-state orbits, the logo spark) play for a while and
  then rest. Status animations (listening pulse, "thinking" spinner, recording) are unchanged.
- **Code splitting** (`apps/web/src/routes.ts`): every page is its own chunk. After sign-in the daily pages are
  fetched when the browser is idle, and nav links prefetch on hover, focus and touch. The shared UI packages declare
  `sideEffects`, so each page only includes the components it uses.
- **Stale-while-revalidate data** (`useAsync(fn, deps, key)`): the session, document and story lists, progress, a
  session's detail, plans and entitlements show their last data instantly and refresh in the background. Pages that
  share a key share the data. The cache is cleared on sign-in, sign-out and session expiry.
- **Fonts**: Latin and Latin-ext only (English only), not seven subsets. CSS is down from 72 kB to 66 kB. Fonts are
  not preloaded: that was measured ~0.3 s slower on slow 4G, because it competes with the app's code.
- **Caching**: `apps/web/public/_headers` gives the hashed `/assets/*` files a one-year immutable cache, so repeat
  visits skip the revalidation round trips. `index.html` still revalidates, so deploys show up immediately.
- **API gzip** for JSON over 1 kB (the desktop app talks to the API directly). Never on `/v1/auth/*`, where tokens
  sit next to user input (BREACH). Test: `tests/test_compression.py`.
- **Feel**: buttons have a pressed state (no transform when motion is reduced), taps have no 300 ms delay and no
  grey flash, a new page opens at the top (Back keeps its position), and session lists no longer show "EN".

## English only (2026-09-26)

- The language pickers are gone from web setup ("Listen in", "Answer in"), the web mock form and desktop setup:
  every session listens and answers in English.
- The API pins it too: `language` is always stored as `en` and `answer_language` as none for new sessions and saved
  setups (older clients or saved setups that send another language get English), live sessions run in English even
  for older rows, and a live `settings.update` can't change the answer language. The fields stay in the API for
  compatibility. Test: `tests/test_english_only.py`.

## Salary negotiation practice (2026-09-26)

- **Practice → Mock interview → Salary negotiation** (web + desktop): enter the offer (and optionally the company
  and your target). The AI plays a recruiter who has just made the offer: it opens by presenting it, then reacts to
  what you say, asking for your number and its basis, pushing back with bands and internal equity, and offering
  non-salary levers (signing bonus, equity, start date, title, leave) when base is stuck. The recruiter setting
  (flexible / realistic / tough) sets how much room it has and how much pressure it applies. The call ends when a deal
  is closed, you ask for time, the turn budget (about one turn per two minutes, 4-12) or the time runs out.
- **Your target stays hidden** from the recruiter; only the review sees it.
- **Negotiation review**: the usual report and scorecard, graded on negotiation skill: anchoring with a justified
  number, tying the ask to value and market data, not conceding early, asking about the whole package, handling
  pushback and silence, staying collaborative, never inventing a competing offer, confirming in writing. The
  summary says where the offer ended up versus where it started and your target.
- API: `MockConfig.interview_type = "negotiation"` with `MockConfig.negotiation {offer, company?, target?}` (required
  for that type); `mock.question` carries `negotiation: true` and counts turns. Tests: `tests/test_negotiation.py`
  (setup validation, turn flow and closing, hidden target, turn budget and fallbacks, the review rubric end to end).

## Job posting from a link (2026-09-26)

- **Prep → From a link…**: paste a job posting URL and Orbit reads the posting into the job description field,
  to check and edit; **Save to Documents** keeps it as a job description (then usable in live sessions too). The
  role title goes along with the prep request. Sites that need a sign-in (LinkedIn) say so and suggest pasting.
- Reads the page's schema.org JobPosting data when present (Greenhouse, Lever, Workday and most ATSs publish it),
  else the page's main content without navigation, header and footer.
- SSRF-safe fetch (`prep/job_link.py`): http(s) on default ports only, no credentials in the URL; the host is
  resolved once and every address must be public (no loopback, private, link-local/metadata, CGNAT or reserved,
  including IPv4-mapped and shorthand forms); the connection goes to that checked IP with Host + TLS SNI (no DNS
  rebinding); redirects re-checked hop by hop (max 4); 8 s timeout, 2 MB cap, HTML/text only, no environment proxy;
  rate-limited per IP and per user. Nothing is stored.
- API: `POST /v1/prep/import-link`. Tests: `tests/test_job_link.py` (28: extraction paths, pinned request, private
  and literal/shorthand addresses, mixed DNS answers, unsupported links, redirect re-checks and loops, unreadable
  pages, the endpoint).

## Answer ratings (2026-09-26)

- **👍/👎 on every live answer** (web + desktop live panel) and in the session review (Questions & answers). A 👎
  asks what was off, in one optional tap: too long, too generic, not accurate, missed the question, too formal.
- **Orbit adapts**: a reason you give three times in your last 40 ratings becomes a fixed style hint in every later
  session's prompt ("keep every answer noticeably tighter", "be concrete, prefer your documents and stories", ...).
  Only these fixed hints reach the model, never free text.
- **Admin → Answer ratings** (desktop Settings): satisfaction, share of answers rated, 👎 reasons, and by question
  type and model. Counts only, no answer content.
- API: `PUT /v1/sessions/{id}/answers/{answer_id}/feedback` (`rating: null` clears), ratings on
  `GET /v1/sessions/{id}` answers, `GET /v1/admin/feedback`. Table `answer_feedback` (migration `a7c3e9f1b5d2`),
  keyed by the live answer id so a rating never races the answer row being written. In the account export.
- Tests: `tests/test_feedback.py` (rate/change/clear and ownership, rating before the answer row lands, learned
  hints reaching the next session and the prompt, admin report and gating).

## Story bank (2026-09-26)

Your real examples, written once in STAR form and reused in every interview (the most-asked-for gap in the
competitor review):

- **Story bank** (web: Documents → Story bank, `/documents/stories`): write stories (title, situation, task,
  action, result, and what they show), edit and delete them. A **Coverage** card shows which of 12 common
  competencies (leadership, conflict, failure, impact, ...) have a story yet; tapping a gap starts one for it.
- **Draft from my resume** (up to 4) or **From my notes** (rough notes → one story): drafts to review, with
  missing details as highlighted [fill in] prompts; only saved stories are used. `POST /v1/stories/draft`, not
  stored.
- **Live answers use them**: every session loads the user's stories into its retrieval index as verified
  candidate facts (embedded lazily and cached on the row), and behavioral, leadership and culture questions always
  get the best-matching story if any matches. The answer's sources show "Story: <title>".
- Setup (web + desktop) says how many stories come along, with a link to manage them; Home's getting-started
  checklist gains "Add a story". Stories are in the account export and deleted with the account.
- API: `GET/POST /v1/stories`, `PUT/DELETE /v1/stories/{id}` (up to 100), table `stories` (migration
  `f6b2d8e4a1c9`).
- Tests: `tests/test_stories.py` (CRUD and ownership, competency validation, export, drafting from resume and
  notes, draft parsing, story retrieval for behavioral prompts, a saved story reaching a live answer).

## Phone companion (2026-09-26)

A second screen on your phone, the way competitors pair a phone with the desktop app:

- **Phone** button in the live panel header (web + desktop): a QR code for `<web>/companion#<code>`, Copy link and
  Stop sharing. The phone needs no sign-in and captures nothing: it shows the current question and answer, lets you
  flip through earlier answers and pin one (on the phone only), keeps its screen awake, and says when the session
  has ended.
- API (`sessions/companion.py`): `POST /v1/sessions/{id}/companion` (owner; the same code while valid) and
  `DELETE` (revoke + disconnect phones); `POST /v1/companion/{code}` (public, rate-limited; the 256-bit code is the
  credential) → a single-use 60 s ticket; `WS /v1/sessions/{id}/view?ticket=` mirrors the live socket's events
  (minus interim transcript), replaying the last 400 so a phone joining late catches up. Up to 3 phones; each has
  its own bounded queue so a slow phone never delays the session. Codes expire after 4 h and are revoked when the
  session ends (live end, REST end, or the abandoned-session sweep).
- The code travels in the URL fragment (never sent to a server or logged) and the page removes it from the address
  bar once read.
- Tests: `tests/test_companion.py` (stable owner-only codes and revocation, single-use session-bound tickets,
  mirrored events with replay and read-only socket, disconnect on end, viewer limit); client `view` socket URL and
  QR size.

## Speaking feedback, progress, custom instructions, follow-ups (2026-09-25)

From a competitor review (Yoodli-style delivery coaching, progress tracking, Final Round-style debriefs and
custom instructions):

- **How you sounded** (session review, web + desktop): pace (words/min), filler words per minute and the most used,
  your share of the talking time, and average answer length, each with a status and a tip. Pure arithmetic on your
  side of the transcript (`sessions/delivery.py`), stored in the report as `delivery` — no model call. The mic
  channel is transcribed with Deepgram `filler_words=true` so "um"/"uh" are kept; the interviewer's channel isn't
  (question detection reads it).
- **Your progress** (top of the Practice page): sessions this week, streak, average score of the last five vs the
  five before, latest pace, a review-score-over-time chart (hover tooltip, table view) and the latest speaking tips.
  `GET /v1/progress`, no model call.
- **Custom instructions** ("Mention I'm relocating to Berlin", "British spelling"): a field on New session (web +
  desktop), saved with the setup (its notes), stored on the session (`sessions.instructions`, migration
  `e5a1c7d3b9f2`) and applied to every live answer as fenced candidate preferences that can't override the format,
  grounding or honesty rules.
- **Follow up** (ended real sessions, web + desktop): a debrief (went well / to improve / what you promised / next
  steps) and a thank-you email drafted from the transcript, with Copy and Open in email app. `POST
  /v1/sessions/{id}/follow-up`, generated once and cached with the report (`?refresh=true` rewrites it); not for
  mock interviews.
- Tests: `tests/test_insights.py` (filler counting, pace/tips, `filler_words` only on request, instruction fencing,
  instructions from a saved setup, follow-up caching and rules, progress and streaks).

## Interview prep from a job description (2026-09-25)

- **`POST /v1/prep`** (`orbit_api/prep`): from a saved job description or pasted text, plus the newest (or a chosen)
  resume, the model predicts the questions this interviewer is most likely to ask. Each comes with its category,
  *why* they'd ask it (the JD requirement behind it), talking points drawn only from the resume, and a first-person
  suggested answer; missing personal details become `[fill in]` prompts instead of invented facts. The document
  text is fenced as reference data; the model's JSON is validated item by item (malformed items dropped, unknown
  categories normalised); cost is recorded as a `prep` provider request. Gated on the plan's `mock` feature,
  verified users, per-IP and per-user rate limits. Stateless — nothing else is stored.
- **Practice page (web)** is now *Prep → Practise*: generate questions, read the talking points and suggested
  answers, **Copy all** as Markdown, and **Practise N out loud**, which starts a mock interview asking exactly the
  ticked questions (a `drill` with the new kind `prep`: "Let's practise the questions from your prep", then each
  question in order, labelled *From your prep*). The last result is kept on the device.
- Tests: `tests/test_prep.py` (pasted and saved documents, resume grounding, validation and ownership, parser
  robustness, practising the questions in a mock session).

## Web ↔ desktop parity: saved setups, ready check, audio verdicts, account options (2026-09-25)

- **Saved setups on the web.** The setup picker (pick one to fill in role, documents, language and answer
  preferences; save / update / delete) moved from the desktop app into `packages/ui` (`WorkspaceBar`) and is now on
  the web's New session page too. The last-used setup is restored, and sessions record which setup they came from.
- **Ready check on the web.** The desktop pre-session checklist is shared (`PreflightPanel`): the server's provider /
  allowance checks and a network round trip, plus each app's own checks. The web's are microphone permission / no
  microphone, tab-audio support (phones can't share tab audio), and whether a resume and job description are
  selected. Failing blockers disable **Start** unless you choose *Start without these checks*, as on desktop.
- **Test microphone / Test tab audio verdicts on the web** — *sounds good*, *silent*, *too loud*, *dropping out*,
  *no audio arriving* — using the shared audio diagnostics (measured in the browser; nothing is sent). Tests stop on
  their own after 30 s.
- **Desktop account options:** *Sign out everywhere* in Settings, and one-click links to Plan & billing and to change
  email / download data / delete account in the browser.

## Unfinished sessions, Practice in the menu, setup checklist (2026-09-25)

- **Sessions left open are ended automatically.** A dropped connection doesn't end a session (so it can be
  resumed), which meant a session closed without **End** stayed "live" forever: no report, and "Live · 0 min" in
  every list. A sweep (`sessions/cleanup.py`, every `ORBIT_SESSION_SWEEP_S`, default 5 min) now ends any session
  with no connection and no new transcript for `ORBIT_ABANDONED_SESSION_MIN` (default 60) exactly as End would:
  status, `ended_at` = its last activity, and the durable report job. Test: `test_abandoned_sessions_are_ended_and_reported`.
- **Sessions page:** open sessions are labelled *Unfinished* / *Not started*, listed first, with **Resume** and
  **End** right in the list. Home and the desktop app use the same labels.
- **Menu:** Home · **Practice** · Sessions · Documents · Settings. Practice (mock interviews) had no menu entry on the
  web. Plan & billing moved to the **account menu** (avatar) and a card at the top of Settings; Sign out is in the
  account menu too.
- **Plan & billing:** plans without a price say *Pricing coming soon* and *Upgrades coming soon* instead of a blank
  price and a greyed-out Upgrade button that looked broken.
- **Get set up** checklist on Home for new accounts: upload a resume, add a job description, try a practice
  interview, run a live session — ticked off from real data, hidden once done or dismissed.
- **Shorter / Longer** on an answer re-asks the same question one length step down / up (30s · 60s · Detailed).

## Live screen: hideable side panel, labelled answer settings (2026-09-25)

- **Transcript panel can be hidden.** A header button (and a ✕ in the panel) shows/hides the Transcript · Chat ·
  Reading panel; wide screens remember the choice per device. On phones the panel used to be unreachable — it now
  opens as a sheet over the answer (Esc or ✕ closes it), so phones get the transcript and the chat history too.
- **Chat lives in the panel.** The Chat button opens the panel on its Chat tab and focuses the input (the phone-only
  input with no replies above it is gone).
- **Bottom bar in two clear rows:** actions (Answer, Screenshot, Chat, Clear … Settings, Pause, End — icons with
  labels, icon-only on phones) and a labelled **Answer settings** row: *Length*, *Auto-answer*, *Wait*, *Style*,
  *Thinking*. **"What do these do?"** explains every option in place with the current one marked (the old
  explanations were hover tooltips, which touch screens never show). The settings row folds away with **Settings**;
  it starts folded on phones and remembers the choice.

## "Deep Space" redesign — web + desktop (2026-09-25)

- **New brand mark:** a planet core inside an orbit ring (accent violet → aurora cyan) with a four-point spark (the
  AI) riding the gap. One SVG component (`OrbitLogo`, `OrbitWordmark`) drives the header, spinners and status pill;
  the favicon, Windows app/tray icons (`apps/desktop/src-tauri/icons`), Apple touch icon and PWA icons are the same
  paths on a dark tile.
- **Design tokens:** `zinc-*` now resolves to *ink* (cool blue-violet neutrals) and `indigo-*` to the accent, both
  as CSS variables, so every existing screen picked up the new palette without touching its classes. New default
  accent **Nebula**; the old accents stay selectable. `aurora-*` is the fixed cyan used only in brand gradients.
- **Type:** Space Grotesk (headings), Inter (body), JetBrains Mono (code), self-hosted via Fontsource so the
  desktop app works offline. Previously Inter was named but never loaded, so every device fell back to its system font.
- **Surfaces & motion:** an animated sky (`SpaceBackdrop`: two drifting aurora clouds, three twinkling star layers;
  hidden in see-through desktop windows), frosted-glass panels, gradient hairline borders, a sheen on primary
  buttons, lift-on-hover cards, staggered entrances. Everything honours reduced motion and Settings → Animations.
- **Illustrations:** `PlanetHero` (ringed planet, orbiting moon and spark) and `SpotIllustration` (any icon in a
  glowing orb with an orbiting satellite) for heroes and empty states; a listening "radar" when no answer is showing.
- **Web:** new app shell (glass top bar with icons; on phones a bottom tab bar replaces the top nav, whose last
  three links used to be scrolled off-screen), split-screen sign-in, a new Home, icons on every page header.
  The web app's duplicate UI primitives now re-export the shared ones.
- **Live panel (shared):** logo in the header (spins while answering), pill status, pill tabs, chat bubbles,
  icon buttons for compact/expand (were Unicode glyphs); the control bar wraps instead of overflowing on phones.
- **Desktop:** icon buttons in the title bar (fits the 380 px window), redesigned sign-in and Home; see-through
  mode rules updated to the new palette.
- Checks: typecheck, lint, 81 UI tests; screenshots of web (desktop + 390 px phone, dark + light) and the desktop
  UI at 380 px and 900 px.

## Mock interview quality (§32) and re-drill (§33) (2026-09-25)

- **Re-drill:** the review has a **Drill N weak questions** button, and `POST /v1/sessions/{id}/drill` starts a new
  mock session from it.
  - It asks the weakest questions again (scored ≤ 3 or unanswered, up to 3). The first two each get a **live
    follow-up** built from the new answer and the old feedback.
  - Then a **short version** drill ("in about thirty seconds").
  - Same role, documents and interviewer settings; the mock machinery handles recording and grading.
  - Available in desktop History and the web session page.
- **Answer completion adapts** to how an answer ends: 5 s after trailing off mid-thought ("…and", "…because",
  "um"), 1.2 s after a wrap-up ("so yeah", "that's it"), 2.5 s after a long answer, and 3 s otherwise.
- **End-of-round summary:** answered / skipped, follow-ups and words per answer. It says to end the session for the
  graded review.
- The drill UI labels questions *Drill: try again* and *Short version · ~30 s*.
- **Real DeepSeek:** the follow-ups targeted the old feedback ("what actually happened with that trial, and how did
  you land on a final decision?", "what did you change afterwards so the leak couldn't happen again?") in 0.8–1.0 s.
- **Desktop test build:** History → Review showed "Drill 2 weak questions", which opened a 3-question drill with the
  badge and lead-in. A skipped question moved on without a follow-up. No errors.
- Tests: 6 API tests (completion timing, plan selection, drill flow + summary, skip, endpoint: no review, nothing
  to drill, other user's session, same documents). The UI reducer test covers `drill_kind` and the summary.

## Audio diagnostics (§23) (2026-09-25)

- **Setup → Test audio** now diagnoses each channel as well as showing its meter. The mic and the interviewer
  channel get a verdict with advice: *sounds good*, *silent* (muted mic / nothing playing), *too loud*,
  *dropping out* or *no audio arriving*.
- **Measured on the device, from the capture frames' levels**, with nothing sent to the server:
  - delivery (frames received vs expected at 50 ms each), dropouts (gaps ≥ 250 ms, or a stalled stream), longest gap;
  - silent / near-clipping share, average and peak dBFS;
  - device status events and errors.
- The test stops itself after 30 s, so the mic isn't left on.
- **Copy diagnostics:** a shareable JSON report with measurements and device settings only: no audio,
  transcripts, account details or keys. Personal names in device names ("Sam's AirPods") are redacted.
- Code: `packages/ui/src/live/audioDiagnostics.ts` (pure), with 9 tests covering each verdict, redaction and report contents.
- **Verified in the desktop test build on real devices:**
  - verdicts appear after 2 s;
  - the room mic read "silent" (avg -79 dBFS) and the output "nothing playing", with 97–98% delivery and 0 dropouts;
  - the 30 s auto-stop fired;
  - the copied report held only the fields above;
  - no console errors.

## Microsoft Store packaging: free, no "unknown publisher" (2026-09-25)

- **`scripts/package-msix.ps1`:** packages the release exe as an MSIX for the Microsoft Store.
  - The Store signs it, so Store installs show no SmartScreen warning, and individual developer accounts are free.
  - Clean build with the same sign-in storage guard as release-desktop.ps1.
  - Uses the Windows SDK's `makeappx`, and the manifest template is `windows/msix/AppxManifest.xml` (full trust + microphone).
- **The Store copy never self-updates.** `updater::is_packaged()` checks the process's package identity, so
  `check_update` reports none and `install_update` refuses, because the Store delivers updates. The direct
  download is unchanged.
- **Public privacy policy** at `/privacy.html` (web), which the Store listing requires.
- Waiting on the user: a Partner Center account and the three identity values (`store-identity.json`).
- **Tested:**
  - Rust: fmt, clippy `-D warnings`, 20 tests.
  - `makeappx` validates the manifest and packs a 2.5 MB package.
  - Not yet: an install on this PC. Windows refuses an unsigned package that contains a desktop exe
    (`0x80073D2B`), so a local install needs Developer Mode or a trusted test certificate (both need admin).
    The alternative is a private-audience Store listing.

## Dependency upgrades: all Dependabot PRs (2026-09-25)

- **Desktop (Rust):**
  - cpal 0.18, xcap 0.9, png 0.18, base64 0.23.
  - windows-core 0.62. **`windows` moved to 0.62 with it**: the `#[implement]` macro needs matching versions, and 0.62 alone didn't compile.
- **Frontend:**
  - React 19. `react`, `@types/react` and `react-dom` move together; the Dependabot PR bumped only `react-dom`.
  - React Router 7, TypeScript 6, vitest 5.
  - `@vitejs/plugin-react` 6, which needs **Vite 8**, so Vite went 5 to 8.
  - One React 19 type fix: `RefObject<T | null>`.
- **Node 22.12+:**
  - vitest 5 requires it, and Node 20 is end-of-life.
  - CI uses Node 22, `engines` is `>=22.12`, and `.node-version` pins Cloudflare's builder to 22.
- **CI actions:** checkout 7, upload-artifact 7, setup-uv 7, pnpm/action-setup 6, gitleaks 3. All tags exist, and none of their breaking changes touch inputs we use.
- **Verified locally** (GitHub Actions is blocked by billing):
  - Rust: fmt, clippy `-D warnings`, 19 tests;
  - UI: 72 tests; typecheck and lint in all workspaces; web and desktop production builds;
  - the full web journey in Chrome (register → documents → live → end → History);
  - a desktop release build: device list, and mic + loopback capture (60/60 frames);
  - a screenshot (2560×1440) through to an answer;
  - live screen, key points and Read aloud (0 audio frames while reading).

## Key points you can tick, and Read aloud (2026-09-25)

- **Key points (§25):** click a point to tick or untick it yourself. Your click wins over the automatic match, and
  NEXT moves with it. Show/Hide is remembered per device.
- **Read aloud (§31):** a *Read aloud* button on finished answers reads the spoken answer and its talking points
  on the on-device Windows voices (the text never leaves the machine). It has Pause/Resume, Stop, speed (0.75–1.5×) and a voice picker; speed and
  voice are remembered.
  - It only starts when you press it.
  - Code and diagrams aren't read; a `[fill in]` prompt becomes a pause.
  - **While it plays, Orbit sends no audio**, so its own voice is never transcribed as the interview. It uses the
    same mute as the mock interviewer. When paused, listening resumes.
- **Fix:** with the mock speech-to-text provider (dev), the status went from "mock" to "ok" after the scripted
  "connected" events, which hid the Dev · simulate controls. It now stays "mock". This was a regression from the
  truthful-STT change; real providers are unaffected.
- **Verified in the desktop test build:**
  - 80 audio frames per 2 s when idle, **0 while reading**, and 80 again when paused or stopped;
  - manual tick/untick works;
  - 8 voices listed;
  - speed persisted;
  - no console errors.
- Tests: UI 72 (override, speech text, chunking); API 356 (plus a test that mock STT stays "mock" while a reconnect or outage still shows).

## Admin cost dashboard (2026-09-25)

- **`GET /v1/admin/costs` (§40):**
  - totals for LLM, speech-to-text and vision;
  - **cost per live hour and per session**;
  - cache hit ratio and tokens per answer;
  - how many calls the backup served;
  - per model, per request type, per user and per plan.
- **Unpriced LLM calls are counted and flagged, never shown as $0.** Speech-to-text uses
  `ORBIT_STT_PRICE_PER_MINUTE` (the Deepgram Nova-3 list price by default; empty = unknown, not zero).
- **Desktop Settings → Costs** (admin only) shows the stats, the per-model table and the top users.
- **Real measurement:** one real DeepSeek answer cost $0.0002 (2,162 tokens in, 292 out, 89% cache hit). Speech
  to text is ~90% of the cost of a live hour.
- Tests: 2 tests with exact numbers from seeded rows, admin-only access, unpriced ≠ $0, unknown STT price.

## Data controls: export, email change, transcript deletion, report retry (2026-09-25)

- **Download my data (§42):** `GET /v1/auth/me/export` returns one JSON file with the profile, documents (full
  text), workspaces, sessions (transcript, questions, answers, report), usage and security log. Secrets and
  embeddings are excluded. It's in web Settings → Account.
- **Verified email change (§43):** it requires the password. A single-use 24 h link goes to the **new** address
  and a heads-up to the old one. Confirming swaps the email, marks it verified and signs out every other session
  (migration `d4f9b2c6e1a3`).
- **Delete just the transcript:** `DELETE /v1/sessions/{id}/transcript` keeps the answers and report. It's refused
  while the session is live.
- **Report retry (§41):** `POST /v1/sessions/{id}/report/retry` re-queues a failed report. The "couldn't generate"
  note used to point at *Generate review*, a different feature; it now has **Try again**.
- New `docs/PRIVACY.md`: what's never stored, what's stored and why, and every control.
- Tests: 6 API tests. Real browser (Edge): the data download produced a real JSON file with no password hash, and
  the email change worked end to end through the emailed link.

## System design and debug modes (2026-09-25)

- **System design mode (§30):** system-design questions get the spoken talk track first, then a `DESIGN` block
  with 12 sections (Requirements … Trade-offs). The answer card shows them as a labelled grid. Gated by the plan
  feature `system_design`.
- **Debug mode (§29):** bug reports get the talk track (how to explain it), then root cause, minimal fix, why it
  failed, a unified diff (red/green), and the corrected code. It triggers on coding questions with bug cues, and on
  technical questions with code context. Coding screenshots use it only if the image shows an error. Gated by
  `advanced_coding`.
- **Found in the real app:** the question classifier labels bug reports ("my code throws a KeyError", "this test
  is failing") as `technical`, so a coding-only trigger never fired from Chat. Code context now identifies them.
- **Copy** includes design sections and debug details.
- **Measured with real DeepSeek:** first token in 0.59 s (design) and 0.68 s (debug), unchanged from normal
  answers. All 12 design sections came back filled, and the debug answer had a correct root cause, fix, diff and
  code. Both render in the real desktop app.
- Tests: 6 API tests (parsing, streaming, plan gating, mode choice incl. technical bug reports, prompt wiring) and
  1 UI test.

## Candidate fact provenance (2026-09-25)

- **Numbered facts and cited sources (§19).** Prompt facts are numbered F1…Fn. The model ends each answer with
  `SOURCES:` (after the spoken text, so no first-token cost), and each answer carries `sources` (document, chunk,
  excerpt, verified).
- **Four grounding levels:** `verified` / `inferred` (new) / `example` (= unsupported) / `general`.
  `finalize_grounding` never lets "verified" stand without a cited verified fact, and an "inferred" answer with
  no source becomes "example".
- **Answer card:**
  - shows the cited facts, with ✓ for the user's own documents, instead of every retrieved label;
  - adds a new *Based on your documents — check details* badge for `inferred`.
- **Found with the real model:** the old rule "elaborating a real project IS example" labelled a true, cited
  story as *Suggested details*. It's now `inferred`, with the source shown.
- Tests: 4 provenance tests (resolution, unknown refs, every downgrade path, engine end to end). Real DeepSeek
  produced all four labels correctly on the fixture resume.

## Hybrid retrieval + benchmark (2026-09-25)

- **Benchmark first (§18):** `tests/retrieval_eval.py` has 22 dev and 16 **held-out** paraphrased interview
  questions, scored on Recall@1/@3 and MRR through the real chunker. The old retriever scored R@3 0.50 (dev) and
  0.38 (held-out). The brief's own example, "stakeholder conflict" → "resolved release disagreements", wasn't
  found at all.
- **Hybrid retrieval (§17):** reciprocal-rank fusion of dense + BM25 (light stemming), on the bullet itself (not
  its shared job heading), with interview-theme query expansion.
  - Category boosts were removed; they hurt on both sets.
  - A relevance gate keeps unrelated facts out of prompts.
  - Held-out: R@3 0.38 → **0.50** (hash) → **0.81** (bge-small).
- **Local neural embedder, opt-in:** `ORBIT_EMBEDDER=bge-small` (ONNX via fastembed, CPU, no embedding bill,
  about +200 MB RAM). It loads in the background with a BM25-only fallback until ready, and degrades to hashing if
  it can't load.
- **Migration path:** `document_chunks.embedding_model`; chunks from another embedder are re-embedded lazily when
  a session loads them (migration `c3e8a1d5f7b2`).
- **Fixed:** the chunker dropped 1–2 character skills (**Go**, R, C#).
- Tests: 11 retrieval tests, with benchmark floors. New `docs/RETRIEVAL.md`.

## Preflight blockers vs warnings, honest Deepgram check (2026-09-25)

- **Severity on every check (§15):**
  - Blockers: server, network, AI, transcription, microphone, minutes, email verification.
  - Warnings: resume, JD, vision, screenshots, app version, interviewer audio off.
  - `GET /v1/preflight` returns `severity` per check, plus `blockers`; `ok` now means "no failing blocker".
- **Setup gates Start on blockers:** "Fix N problems to start" instead of "Start anyway". A confirmed **Start
  without these checks** stays as an escape hatch, and the dialog lists each failing check and its detail.
  Warnings never block.
- **Deepgram check (§16):** after the account call (`/v1/projects`), preflight opens a real streaming socket with
  the live settings and closes it without sending audio. "Streaming transcription verified" is shown only when
  that succeeds; otherwise "Deepgram account reachable, but live streaming failed (…)". Verified against real
  Deepgram (1,094 ms), and a bad key fails with HTTP 401.
- Tests: 6 new API tests. Real desktop test build: a blocked case (unverified email) had Start disabled and the
  confirmation cancellable; a warnings-only case could start.

## Phase 2 — LLM failover and provider health (2026-09-25)

- **Backup LLM (§12):** `OpenAICompatibleProvider` (OpenAI, Gemini, OpenRouter, Groq…) behind
  `FallbackProvider`.
  - It takes over only when DeepSeek fails **before its first token**: 429, 5xx, timeout, network, a bad key or
    no credit, or no first token within the budget (10 s, +12 s with thinking).
  - It never switches mid-answer, and a circuit breaker opens after 3 straight failures.
  - It's gated by the plan feature `provider_fallback`.
  - The provider and model that actually served are recorded, so cost is attributed correctly; unpriced means
    unknown, never zero.
  - DeepSeek and the backup share one SSE reader.
- **Provider health (§13):** healthy / degraded / down / unknown, with last success and failure, p95 and failure
  rate, for the LLMs, Deepgram, the database and email. Admins see it at `GET /v1/admin/providers`.
- **Fallback UX (§24):** a failover shows the user nothing technical ("AI connection recovered").
- **Preflight** pings DeepSeek directly (not through the failover, which would hide an outage) and reports "the
  backup AI is answering" as a warning.
- **Bugs found while building:**
  - 5xx errors (the most common outage) weren't in the failover list; it now keys on retryability.
  - A thinking-by-default backup spent its whole budget on hidden reasoning, which led to
    `ORBIT_FALLBACK_LLM_EXTRA_JSON` for provider options.
- **Verified live:** the primary pointed at a dead address, and the backup client streamed a real answer from an
  OpenAI-compatible API in 3.0 s.
- Tests: 23 new (failover rules, breaker, budget, vision and plan gating, OpenAI-compatible parsing and errors,
  engine attribution, subtle UX, preflight, config). New `docs/AI_PROVIDER.md`.

## Launch hardening 1d — Authenticode pipeline, release config split, single-instance guard (2026-09-25)

- **Authenticode signing pipeline (§8):**
  - `scripts/sign-windows.ps1` (signtool, SHA-256, RFC 3161 timestamp) supports three credential sources: a
    certificate in the Windows store (Certum SimplySign or a hardware token), Azure Trusted Signing, or a PFX.
  - `release-desktop.ps1 -Sign` makes Tauri sign every binary before the updater signature is written.
  - `verify-authenticode.ps1` then checks the installer and the exe + uninstaller inside it: valid chain,
    intact hash, timestamp present.
  - `ORBIT_REQUIRE_SIGNING=1` refuses unsigned builds; CI's `release.yml` got the same verification and an
    `ORBIT_REQUIRE_SIGNING` repo variable.
  - Tested end-to-end with a throwaway self-signed certificate: every binary was signed and timestamped, and
    verification passed only in test-certificate mode. It correctly failed on the untrusted root, on unsigned
    files and on the published 0.1.16. The test certificate was deleted afterwards.
- **Release config split (§9):** `tauri.conf.json` no longer sets `dangerousInsecureTransportProtocol`.
  `tauri.dev.conf.json` enables it for localhost development (`pnpm dev:desktop`). The release script and CI fail
  if the release config ever allows it.
- **Single instance, explicit (§10):**
  - `render.yaml` pins `numInstances: 1`;
  - `ORBIT_API_REPLICAS` (default 1) stops a production boot if it's set above 1, because live-session state is
    in-process until it moves to Redis.

## Launch hardening 1b — configurable plans, entitlements, session ceiling (2026-09-25)

- **One plan table in server config** (`entitlements.py`), overridable with `ORBIT_PLANS_JSON` and
  `*_MAX_SESSION_MINUTES`. Invalid config stops the API at boot.
- **Plan fields:** live minutes, mock minutes, screenshots, documents, max session length, features, display
  price, Stripe price id.
- **Entitlement service** `for_user()` behind `GET /v1/entitlements`, plus a public `GET /v1/plans`. The web
  Billing page and desktop Settings render from them instead of hard-coded copy.
- **Mock interviews have their own monthly allowance** (`mock_seconds`); before, they spent live minutes.
- **Feature flags are enforced** (before, they were defined but never checked):
  - screenshots need `vision` and mock sessions need `mock`, otherwise `403 feature_unavailable`;
  - the old defaults contradicted themselves: Free had screenshot credits but no `vision`.
- **Per-session ceiling (§7), even on Unlimited:**
  - Free 60 min, Pro 180, Unlimited 240, counted across reconnects;
  - a 5-minute warning (`usage.status {reason: "session"}`), then a graceful end (transcript, usage and report
    are all kept);
  - a capped session can't reopen (`409 session_time_limit`);
  - the live banner says which limit it hit.
- New `docs/BILLING.md`.
- Tests: 14 entitlement tests (config, fail-fast, endpoints, mock allowance, feature gates, ceiling) and 1
  reducer test. The Billing page was checked in Edge against a local API with price overrides.

## Launch hardening 1a, part 2 — one live session, truthful STT status, upload hardening (2026-09-25)

- **One live session per account.** A second one is refused at the ticket (`409 live_session_active`, naming the
  running session) before any audio or AI spend. The live screen offers **End it and use this one**.
  - Ticket errors (401/402/403/404/409) are no longer retried, and they keep the server's message, which used to
    be replaced by a generic "Not authorized".
- **Fixed:** `POST /sessions/{id}/end` didn't stop that session's live socket, so a session ended from another
  window or the web kept streaming audio to Deepgram until its client left. It now ends the engine
  (`session.ended`, usage recorded) and closes the socket with 4009.
- **Truthful STT status (§14).** Deepgram `connect()` suppressed its timeout, and the engine then reported
  transcription as `ok` regardless, so a slow or rejected handshake showed "ok" first.
  - Sessions now expose their real state.
  - The engine reports `connecting`, then `ok` only once both sockets are open, plus `reconnecting` / `down`.
  - The status pill says "Connecting audio…" / "Transcription unavailable".
- **Upload hardening (§20).** DOCX archives are inspected before parsing (ZIP bomb, size, entry count,
  traversal). PDF/DOCX extraction runs in an isolated child process with a timeout (and memory/CPU limits on
  Linux).
- **Per-app capture wording (§21).** Choosing a browser now says other tabs may be heard too, instead of "only
  this app".
- Tests:
  - 4 STT-status tests, 12 upload tests, a rewritten live-session test and 2 live-client tests.
  - Real desktop test build: a second session hit the conflict, "End it and use this one" ended the other (it
    received `session.ended`, then 4009) and connected. Chrome in "Listen to" shows the browser wording.

## Launch hardening 1a — verification, CSRF, abuse limits (2026-09-25)

- **Email verification is enforced.** `require_verified_user` gates session creation (live and mock), live
  tickets, screenshots, AI review and document uploads with `403 email_unverified`.
  - The admin is exempt.
  - Unverified users keep account access.
  - Both apps show a shared banner (Resend link / I've verified), and preflight reports it without spending
    provider calls.
- **CSRF defence** for cookie-authenticated browser requests: a strict Origin/Referer check plus an
  `X-CSRF-Token` HMAC of the session, which the shared client sends automatically. Bearer (desktop) requests are
  unaffected.
- **Abuse limits:**
  - sign-up 5/hour per IP;
  - login also limited per target email;
  - password reset per email;
  - per-user limits on session create, live tickets, screenshots and review, so rotating IPs doesn't multiply
    provider spend.
- **CAPTCHA abstraction:** Turnstile on sign-up and password reset when configured; the widget is chosen via
  `GET /v1/auth/config`.
- **Production fail-fast:** the API refuses to boot with public sign-up but verification off, verification
  required without SMTP, or Turnstile without keys.
- **Fixed (production):** CORS didn't allow `PUT`, so from the desktop app **editing a saved workspace and saving
  admin config were blocked** by the browser preflight.
- **Fixed (production):** uvicorn trusted `X-Forwarded-For` only from 127.0.0.1, so behind Render every request
  shared the proxy's IP: **per-IP rate limits were one global bucket** and audit IPs were wrong. The Dockerfile now
  passes `--forwarded-allow-ips='*'`.
- **Fixed (dev):** log redaction masked the dev outbox's links, so local verification and reset links couldn't be
  clicked. The dev outbox (never used in production) now also writes mail to `%TEMP%/orbit-dev-outbox.txt`.
- New `docs/SECURITY.md`.
- Tests:
  - 13 API regression tests (`test_launch_security.py`) and 5 client tests.
  - A real-browser drive of the web app (Edge) confirmed the verify flow, CSRF enforcement and the cross-origin
    PUT.
  - A real desktop test build confirmed the banner, the checklist entry and refused starts.

## Phase 6e — docs pass (2026-09-25)

Every doc was checked against the code, and stale statements were fixed:
- **README:** a "What Orbit does" overview and a download link.
- **ARCHITECTURE:** the status table, the "not built" list, the diagram, the data model (19 tables) and the phases
  are all current. The finalizer section had wrong timings: with Deepgram, questions fire on its endpoint, with a
  2.5 s fallback. The response-timing grace is a hold before firing.
- **PROTOCOL:** documents `mock.next`, `mock.question`, `mock.completed`, `coding_language`, and the answer fields
  `grounding`, `key_points`, `problem`, `edge_cases` and `tests`.
- **Desktop README:** rewritten.
  - Covers the WASAPI and per-app capture commands, updater, close dialog and all 9 global shortcuts.
  - Explains the test-build isolation.
  - Removed the macOS permission sections (deferred) and the "auto-update not wired" note.
- **Web README:** screenshots and mock interviews described as they work now.
- **DEPLOY:** `wrangler.jsonc` is at the repo root, and Workers Builds deploys `main`.
- **DECISIONS:** D28 (verified release script), D29 (contrast fixed in shared CSS), D30 (one curated icon set) and
  D31 ("delete app data" includes the sign-in).

## Phase 6d — installer lifecycle (2026-09-25)

- Tested install → upgrade → uninstall → reinstall on a real machine with the published installer (0.1.6 → 0.1.15).
  - Upgrade: sign-in and every setting kept.
  - Reinstall: signed in, settings byte-identical.
  - Uninstall removes the program, the Start-menu shortcut and the Add/Remove Programs entry.
- **Fixed:** "Delete the application data" in the uninstaller removed the settings and window state but left the
  **sign-in token** in Windows Credential Manager. A Tauri NSIS hook (`apps/desktop/src-tauri/windows/hooks.nsh`)
  now removes it under the same conditions: box ticked, and a real uninstall rather than an update. Covered by
  `scripts/test-uninstall-hook.ps1` (4 cases, throwaway credential).
- Documented where each piece of user state lives and what upgrade and uninstall do to it (WINDOWS_RELEASE.md). Also
  documented a WebView2 gotcha: an *empty* `WEBVIEW2_USER_DATA_FOLDER` silently swaps in a blank profile.

## Phase 6c — icon library (2026-09-25)

- Replaced every emoji / Unicode-glyph icon (📌 ◐ × ✕ ↻ ← ↓ ✓ → ○ ✎ ▾ ‹ ›) and the four hand-drawn SVGs with
  **lucide** icons, via one curated module (`packages/ui/src/icons.ts`) shared by desktop and web. Icons now share
  one stroke weight and render the same regardless of Windows emoji font; decorative icons are `aria-hidden`, and
  every icon-only button has an accessible name.
- Checklist status icons carry a spoken label ("OK" / "Warning" / "Problem") instead of the raw status id.
- **Fixed:** at the default 380 px Setup window, the title bar's text links pushed the transparency, minimize and
  **close** buttons off-screen. Documents / History / Settings / Sign out are now icon buttons with tooltips.
- axe (WCAG 2.1 AA): still 0 violations on all 8 screens in both themes. Web bundle +2 kB gzipped.

## Phase 6b — accessibility (2026-09-25)

- Audited every desktop screen with **axe-core (WCAG 2.1 A/AA)** in the real app, in both themes: Sign in, Home,
  Setup, Live (coding answer), End dialog, History, Settings, Documents.
- **Before:** 46 colour-contrast failures (grey secondary text at 2.6–4.4:1 against the 4.5:1 minimum) and 2 invalid
  ARIA attributes (level meters labelled without a role).
- **Fixed:** secondary text uses zinc-400 in dark mode (5.8–7.8:1) and a slightly darker grey in light mode (4.7–5.9:1
  on every light surface) — shared CSS, so web gets it too; level meters are `role="meter"` with values; the answer
  "Thinking…" placeholder is a `status`.
- **After: 0 violations on all 8 screens, light and dark.**

## Phase 6a — readable text, in-app dialogs, performance baseline (2026-09-25)

- **Text size setting now works everywhere:** 49 fixed-pixel text sizes (43 labels at 10–11 px, the question, the
  answer body, code) were converted to rem, so Settings → Text size scales them (they ignored it before). Sizes follow
  the brief: labels 12 px, answer 16 px, question 17 px, compact overlay 15 px (at the default size).
- **No more browser dialogs:** all 10 `window.confirm` / `window.prompt` uses (end session, delete document/session,
  remove key, sign out everywhere, delete account) use one accessible in-app `confirmDialog` (alertdialog, Esc to
  cancel, focus restored, danger styling, "type DELETE" for account deletion). Delete-session copy no longer claims
  to delete screenshots (they are never stored).
- **Performance baseline** (desktop app + WebView2, 8-core PC): startup to window 0.57 s; idle 212 MB / 1.7 % CPU;
  live simulated interview 274 MB / 1.7 % CPU.
- Verified in the real app: labels 12 → 13.5 px when the root size goes to Large; End shows the in-app dialog, Esc
  keeps the session, "End session" ends it; zero native dialogs; no console errors.

## Release incident — 0.1.11 forgot sign-ins (2026-09-25)

- **What happened:** 0.1.11 was built while `ORBIT_KEYRING_SERVICE` (a compile-time switch for test builds) was set
  to an empty string instead of unset; the app looked for the saved sign-in under an empty service name, so anyone
  who updated to it was signed out.
- **Found** before the next release: rustc's dep-info showed `ORBIT_KEYRING_SERVICE=`; a read-only `load_token` probe
  of every published installer confirmed only 0.1.11 was affected (0.1.7–0.1.10 and 0.1.12 find the saved sign-in).
  The owner's installed app (0.1.6) never took it.
- **Fixed:** 0.1.12 published (verified the same way), so the updater no longer offers 0.1.11; `secrets.rs` treats an
  empty value as unset (proved by building under the exact 0.1.11 condition); `scripts/release-desktop.ps1` refuses
  to release unless the variable is unset in the build.

## Phase 5d — AI mock interviewer (2026-09-25)

- New session type **Mock interview** (desktop Setup + web): pick interviewer (recruiter, hiring manager, senior/staff
  engineer, executive), focus (mixed, behavioral, technical, system design, coding), difficulty and length. The AI
  asks out loud, listens, follows up on what you actually said, moves on, and ends the session when the plan or time
  is used up; the normal report/review then grades the answers (D27). Migration `b7d2e4f6a8c1` (`sessions.mock_config`).
- Real DeepSeek run: a natural opener, a follow-up on a specific claim ("You mentioned leading the move to an
  event-sourced ledger…"), a push for specifics on a vague answer ("You said it went fine, but I'd like specifics"),
  a topic change after two follow-ups, and it caught an off-topic answer.
- Real desktop app: mock options shown, interviewer audio off, first question displayed and spoken
  (`speechSynthesis.speaking`), status moves from "Interviewer speaking…" to "Your turn", "I'm done" produced the next
  question, session recorded with its questions; no console errors.
- Not exercised end-to-end here: a full spoken answer through the real mic (the silence-after-answer path is covered by
  engine tests with the injected clock).

## Phase 5c — coding workspace (2026-09-25)

- Coding answers render as **Problem → Say (talk track) → Code → Edge cases → Tests**, plus complexity and key
  points. New `LiveAnswer.problem / edge_cases / tests` from `PROBLEM:` / `EDGE:` / `TESTS:` lines (D26).
- Code view: line numbers, syntax highlighting (Python, Java, JavaScript, TypeScript, C++, C#, Go, Rust, SQL),
  copy, remembered wrap toggle, and a language picker that regenerates the answer in the chosen language.
- Fixed while testing with real DeepSeek: "Find the second highest salary from an Employee table" was classified as
  a salary negotiation (no code). Pay words next to data cues (table, query, SQL, column…) are now coding.
- Real DeepSeek: two sum (auto → Python), reverse a linked list (Java), NPE debug (Java) produced every section in the
  requested language; first spoken words 0.51–0.86 s. In the real desktop app, the coding fixture showed all sections
  and switching Python → Java regenerated the code in Java; no console errors.

## Phase 5b — adaptive "NEXT" guidance (2026-09-25)

- Answers carry 3–6 key points (`LiveAnswer.key_points`, from a `POINTS:` line); the answer card shows them as a
  checklist that ticks off what the candidate has said and marks the next point (→). Local, instant, sticky, hideable
  (D25).
- Measured on real DeepSeek answers + DeepSeek-written "nervous candidate" paraphrases of the first half of each
  answer: all four cases ticked exactly the points in the spoken part, and an off-topic ramble ticked none. One false
  tick found during the evaluation (generic topic words against a long sentence) was fixed by requiring a label word
  for loose sentence matches. POINTS presence: 12/12 after marking the line required (a design answer had omitted it).
- Verified in the real desktop app with a real DeepSeek answer: five points, NEXT on the first, no false ticks from
  the candidate's unrelated line, Hide/Show works, no console errors.

## Phase 5a — pre-session checklist + saved setups (2026-09-25)

- **Checklist** (desktop Setup, above Start): microphone, interviewer audio source, resume/JD selected, network round
  trip, plus server checks (`GET /v1/preflight`: database, DeepSeek responding, Deepgram key valid, vision, live
  minutes / screenshot credits, app version) — each with a precise fix. Collapsed when all is well; failures expand
  and the button reads "Start anyway". Provider checks are cached (D23).
- **Saved setups** (`/v1/workspaces`, migration `a1f3c7e9d2b5`): save the current session setup under a name, pick it
  next time (documents + preferences restored, last one remembered), update or delete it. Sessions record the
  workspace they came from; a workspace's documents are used when a session doesn't pass its own.

**Verified in the real desktop app** (test build + local server with real keys): checklist showed real statuses
(DeepSeek 715 ms, Deepgram key valid, resume/JD missing flagged with fixes); a setup saved, restored after leaving
and reopening Setup, and the session started from it was linked (`session_count` 1). API 239 tests (+6).

## Phase 4 — answer quality (2026-09-24)

- **Question detection** (measured on the brief's phrases plus a monologue/filler corpus):
  - Before: missed "A little more on the security side.", "Go on.", "Say more about the rollout.", "Two sum, given an
    array of integers.", "So the next thing I wanted to ask is how you handle secrets"; "Expand on that.", "Talk me
    through your thinking.", "Hmm, and the database layer?" sat in the never-used LLM band. It also auto-answered 12
    statements such as "Design is a big part of our culture here." and "Tell me is what my manager always says."
  - After: all 22 required phrases trigger, 0 of 23 statements/fillers/logistics do (with and without a recent
    question). Bare continuers ("Go on.", "Why?") count only right after a question.
- **Ambiguous-band classifier** (`live/classifier.py`, D21). Real DeepSeek: 9/10 correct on hard cases, resisted an
  injected instruction, median 0.67 s (only for ambiguous utterances), and resolves references ("Hmm, the caching
  layer." → "How did you design the caching layer of the payments service?").
- **Fact safety** (D22): `GROUNDED` label + "Suggested details" badge; sharper rule that a verified fact anchors only
  what it says. Audit before: a fully invented failure story (7 unsupported claims) and invented rollout steps, both
  presented as fact. After: invented detail still appears for questions the resume can't support, but every such
  answer was labelled `example` (12/12 over two runs). Technical/design/coding answers are labelled `general`, first
  words unchanged (0.52–0.73 s).
- **Duplicate suppression**: the brief's "Tell me… / Tell me about… / Tell me about yourself" case is pinned by a test
  (one question, one answer).
- Real-audio regression run (Deepgram + DeepSeek): filler ignored, three questions answered, latency unchanged.

**Verified:** API 233 tests (+56) + 15 smoke (new: real classifier); ruff, strict mypy; UI 42 tests, typecheck, lint.
**Not done in this phase:** neural/hybrid retrieval (current lexical retrieval kept), token-level context budget
(a character budget exists), prepared/cached answers.

## Phase 3 — Windows audio reliability (2026-09-24)

- **Stable device identity:** microphones and outputs are listed and opened by MMDevice endpoint id (legacy saved
  names still resolve). The Setup screen remembers the mic and output choice.
- **Recovery:** unplug/replug, Bluetooth drop, device invalidation and default-device switches reopen capture by
  itself; a missing chosen device falls back to the default and switches back when it returns. Live shows
  "Microphone disconnected — reconnecting…" / "reconnected" / "switched to …".
- **Call audio:** new "Call audio — communications device" choice, plus any specific output. On the dev PC the
  default output (Realtek Digital Output) and the communications device (Speakers) differ, so a Teams call routed to
  the communications device was previously inaudible to Orbit.
- **Resampling:** Windows converts to 16 kHz mono (AUTOCONVERTPCM + SRC_DEFAULT_QUALITY) on the capture path.
- **Silence fill:** output loopback emits silence frames while nothing plays, keeping end-of-speech detection and
  the latency timeline working.

**Verified on real hardware** (test build driven over CDP): endpoint ids listed with default/communications flags;
TTS through the default output captured (RMS 0.097); 20 frames/s of silence with nothing playing; communications
choice opens Speakers; bogus saved ids fall back with a `fallback` status; switching the Windows default output
mid-capture (Digital → Speakers → Digital, restored afterwards) produced `switched` → `switched` with no frame gap.
Rust 18 tests, clippy -D warnings, fmt; desktop typecheck + lint.

**Needs manual hardware:** USB/Bluetooth unplug-replug, HDMI outputs and sleep/wake weren't physically exercised
(the same reopen path handles them: device invalidation → reopen); Teams/Zoom routing to the communications device.

## Phase 2 — platform (2026-09-24)

Decisions for a private deployment: one API instance (D12), no Stripe or backup provider yet (D17), Sentry built in
but off (D18).

- **Real-provider smoke suite** (`tests/smoke`, opt-in with `RUN_PROVIDER_SMOKE=true`; manual GitHub workflow).
  DeepSeek: text + priced usage, streaming, JSON mode, vision, timeout mapping. Deepgram: interim → final + endpoint,
  reconnect, every language in the app. **It found two real bugs**, both fixed:
  - `language: "auto"` sent `detect_language=true`, which Deepgram streaming rejects (HTTP 400) → now `language=multi`.
  - HTTP 400 handshakes were retried forever → now fatal ("unsupported transcription settings").
- **Deepgram reconnects keep one timeline:** timestamps restart at 0 on each socket; events are now shifted by the
  audio sent to earlier sockets (unit-tested). The unused "last packet → transcript" metric was removed.
- **Real latency metrics** (`live/metrics.py`): speech start → first partial, speech end → final / question /
  first AI word, question → first AI word; stored per session (`sessions.metrics`, migration `9d5e2f8a1b47`),
  p50/p95/p99 via `GET /v1/admin/latency` and desktop **Settings → Latency**. First real run: speech end → final
  326 ms, → question 1.88 s (mostly the Balanced 1.5 s wait), question → first word 679 ms, speech end → first word
  2.58 s.
- **Observability:** JSON logs in production with `request_id` / `user_id` / `session_id`, `X-Request-ID`
  propagation, secret redaction (keys, bearer tokens, JWTs, WS tickets, Deepgram tokens), optional Sentry with
  scrubbing.
- **CI:** `cargo fmt --check` + `cargo clippy -D warnings` added (the tree was formatted in a separate commit).

**Verified:** API 177 tests (+9) + 14 smoke (all green against the real providers), ruff, strict mypy; UI 42 tests,
typecheck, lint; Rust 17 tests, fmt, clippy -D warnings; migration round trip + `alembic check` on SQLite.

## Phase 1 — critical correctness & security (2026-09-24)

Audit of the upgrade brief's P0 list against `main` @ cab0d95; every item below was confirmed in code first.

| # | Issue | Fix |
|---|---|---|
| P0-3 | Per-app loopback built a Rust slice from a possibly-null WASAPI buffer before the silent check (UB) | Slice only built for a non-silent, non-null, non-empty packet; down-mix moved to a safe `packet_to_mono` helper (any channel count, short buffers padded) with unit tests |
| P0-4 | Production with `ORBIT_ADMIN_EMAIL` unset: open sign-up and first user = unlimited admin | Production refuses to boot without `ORBIT_ADMIN_EMAIL`; admin never inferred from registration order in production; allowlist never falls open |
| P0-5 | Pricing table knew only `deepseek-chat/reasoner`; production model `deepseek-flash` costed $0; cache hits ignored | `providers/llm/pricing.py`: DeepSeek list prices (cache hit/miss/output, peak/off-peak), `ORBIT_LLM_PRICING_JSON` overrides, unknown model → cost `NULL` + warning; `cached_input_tokens` parsed and stored |
| P0-6 | Live minutes written only at socket close (crash = unbilled) and checked only at connect | 15 s heartbeat commits one idempotent row per connection and enforces the limit mid-session across all the user's sessions; `usage.status` warning (< 5 min) and graceful end at 0 (`4003`) |
| P0-7 | In-process live state ambiguous for multiple instances | Documented decision: production is single-instance until live state moves to Redis (DECISIONS D12) |
| P0-10 | "Store screenshots" toggle did nothing (server always discards) | Toggle removed; truthful copy; API ignores the flag and always reports `false` |
| P0-11 | Screenshot credit charged before analysis | Credit spent only when the answer completes (keyed per question); `screenshot_attempts` / `screenshot_failures` internal metrics |
| P0-12 | Desktop accepted plain `http://` remote servers (password/token in cleartext) | `checkServerUrl`: https required except loopback / dev builds; insecure saved override ignored; inline reason shown |
| P0-14 | Recorder logged and dropped failed writes (usage, cost, transcript) | Bounded retries with backoff → `failed_writes` dead letter → local spool → replay on boot; fixed PKs + usage upserts make retries idempotent; live teardown shielded from handler cancellation and drained on shutdown |
| P0-15 | `session.ended` waited up to 30 s for the report; `/end` used a non-durable BackgroundTask | Reports are DB-backed jobs (claim via conditional UPDATE, retry with backoff, stale-job recovery, dedupe per session); `report_status` on sessions; History shows "Generating the report…" and polls |

Migration `8c4d1e7f2a30`: `usage.idempotency_key` (unique), `provider_requests.cached_input_tokens`,
nullable `estimated_cost_usd`, `failed_writes`, `jobs`.

**Verified:** API 168 tests (+16), ruff, strict mypy; UI 42 tests (+4), typecheck, lint; Rust 17 tests (+4),
clippy clean; migration upgrade/downgrade/`alembic check` on SQLite; a real DeepSeek-V4.1-Flash run recorded
cost with cache hits (1,408 of 1,602 input tokens) and charged each screenshot once.

**Not verified here:** the migration against Postgres (no local Postgres; runs on the next Render deploy, where a
failure rolls back and the old deploy keeps serving). The loopback fix changes code that only runs on real
per-app capture: it needs a desktop release to reach users.

## Personal Orbit V6 continuity — 20 October 2026 (review branch)

- Today is the signed-in operational home, with one saved priority and an optional grounded AI plan.
- Five career tasks plus contextual Prepare/My Career collect existing tools and preserve old routes.
- Guided Application opens this job's exact owned kit and explains uncertain/manual/submission state without changing it.
- Preview REST/live/proxy and employer rendering cannot use the canonical production API; independent staging remains operator setup.
- Correct current release documentation; repair existing motion-contract and incomplete migration-fixture baseline failures.
- No migration, new transport, automatic submission, provider call on mount or third-party runtime dependency.
