# Implementation log

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
