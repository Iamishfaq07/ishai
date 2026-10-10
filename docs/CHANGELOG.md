# Implementation log

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
