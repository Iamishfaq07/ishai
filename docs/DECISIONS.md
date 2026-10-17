# Decision log

**D1 — Line-tagged streaming format instead of JSON.** JSON can't be rendered until its keys close, so answers would
appear late and in bursts. The model emits `ANSWER:` / `- bullet` / `CODE:` / `TIME:` lines, and
`AnswerStreamParser` turns the buffer into a full `LiveAnswer` after each chunk. The UI renders the snapshot
as-is (it's idempotent), so a bullet appears the moment it's written and text that has already streamed never shifts.

**D2 — Audio is relayed through the API.** The desktop app never holds a Deepgram key (spec §15/§66). This costs one
extra hop (~tens of ms) but lets us meter usage and enforce auth on the server.

**D3 — Two audio channels instead of diarization.** Mic = candidate, system = interviewer. This is far more reliable than
diarizing a mixed stream. `speaker.correct` handles the edge cases.

**D4 — Per-session in-memory retrieval.** The chunks of the selected documents are loaded once when the WS connects, then
each question is scored locally in under 1 ms. pgvector (HNSW) stays the store and will back library-wide search.

**D5 — Local hashing embedder.** DeepSeek has no embeddings API. A deterministic feature-hashing embedder
(384-d) needs no key, runs offline, and handles lexical matching of resume facts well. Swap in a neural
embedder behind `Embedder` when recall needs it (a re-embed migration will be required).

**D6 — Cheap heuristic detection first.** It runs on every partial. The LLM classifier is reserved for the
ambiguous band (`needs_llm`) and isn't wired into the hot path yet.

**D7 — Single-use WS tickets.** Browsers can't set headers on a WebSocket, and a long-lived JWT must not appear in a URL.
The tickets are held in process memory (see D12).

**D8 — No "undetectable" features.** Orbit doesn't hide itself from screen sharing and doesn't try to defeat
proctoring (spec §64). Screenshots are only taken on explicit user action. Audio is never stored.

**D9 — Mock providers are labelled, never disguised.** `/health` and `provider.status` report `mock`, and mock
answers are prefixed `[mock]`. Production config refuses to start with mock providers or the dev JWT secret.

**D10 — Token versioning for revocation.** JWTs carry the user's `token_version`, and `current_user`
rejects any mismatch. A password reset or "sign out of all devices" bumps the version, which revokes every
web cookie and desktop keychain token immediately, with no token denylist to maintain.

**D11 — Email tokens.** Tokens are random, single-use and expiring (48 h to verify, 1 h to reset), and only their
SHA-256 is stored. Issuing a new token voids the older unused ones. Reset requests always return the same 202
body, and the email is sent *after* the response, so neither the content nor the timing reveals whether an
account exists. The web pages strip `?token=` from the URL on load and send `no-referrer`.

**D12 — Production runs exactly one API instance (for now).** WS tickets, live-socket ownership (one socket per
session, 2 per user), the engine registry that screenshot uploads feed, and rate-limit buckets live in process
memory. That is correct only with a single instance, which is what the Render deploy runs. Scaling out requires
moving those to Redis first (`ORBIT_REDIS_URL` is reserved for it). Usage, cost, jobs and dead letters are in
Postgres and are already multi-instance safe (job claims are conditional UPDATEs).

**D13 — The admin is explicit in production.** `ORBIT_ADMIN_EMAIL` is required (the server refuses to start
without it); registration order never confers admin in production. Unset, sign-up would be open and the first
account would get unlimited use of the shared provider keys. Dev/test keep a first-user fallback for convenience.

**D14 — Metering is server-authoritative and idempotent.** Live minutes are committed on a heartbeat as one upserted
row per connection (`usage.idempotency_key = live:<connection>`); the limit is enforced mid-session. Screenshot
credits are spent only on a delivered answer (`shot:<question>`); attempts and failures are separate internal
metrics. LLM cost is estimated from config-driven prices with cache-hit/miss and DeepSeek peak/off-peak rates; an
unpriced model records cost `NULL` (unknown) with a warning — never `$0`.

**D15 — Live-session writes are durable.** The recorder retries each write with backoff; what still fails goes to
`failed_writes` (or a local spool file if the DB is unreachable, failing that memory) and is replayed at startup,
every minute while the API runs, before a session's report and at shutdown: the host's disk doesn't outlive the
process, so the spool can't wait for a restart. Live teardown runs in a shielded task so a cancelled handler (server
shutdown) can't abort usage/transcript writes. Reports are DB-backed jobs (`jobs` table) run by a worker in each API
process, so ending a session is instant and a restart can't lose a report: a job cut off by shutdown goes straight
back in the queue.

**D16 — Remote servers must be HTTPS.** The desktop "Server" override accepts plain `http://` only for this
machine (`localhost`, `127.0.0.1`, `[::1]`) or in a development build; an insecure saved override is ignored.

**D17 — No billing or backup AI provider yet.** Orbit is a private, single-user deployment, so there is nobody to
charge: plans and limits are enforced server-side, but nothing is purchasable (no Stripe). A second LLM provider
would need another paid key; DeepSeek errors are retried once before the first token. Revisit both before opening
Orbit to other users.

**D18 — Crash reporting is built in but off.** Sentry starts only when `ORBIT_SENTRY_DSN` is set, with PII,
request bodies/headers/query strings and breadcrumbs stripped. Without it, structured JSON logs with correlation IDs
(and secret redaction) are the record.

**D19 — Latency is measured on the audio timeline.** Each STT channel keeps a map from "audio position sent to the
provider" to "server time it was sent", so speech-start/speech-end timestamps from Deepgram become server times even
across pauses. Deepgram timestamps restart at 0 on every socket, so each reconnect's events are shifted by the audio
sent to earlier sockets, giving one continuous session timeline.

**D20 — Native WASAPI capture on Windows (cpal only elsewhere).** Mic and output loopback open MMDevice endpoints by
stable id and ask the audio engine for 16 kHz mono directly (AUTOCONVERTPCM + SRC_DEFAULT_QUALITY), so Windows'
resampler replaces the hand-rolled one on this path. Each source runs a supervised loop: an invalidated/unplugged
device is reopened with backoff (same device if it returns, else the default), a stream following the default (or
the default *communications* device) re-targets within ~1 s when Windows switches it, and an explicitly chosen device
that was missing is switched back to as soon as it reappears. Output loopback delivers no packets while nothing
plays, so silence is synthesized after 100 ms — the transcriber needs to hear the pause to end the utterance.

**D21 — A classifier only for the ambiguous band.** The heuristic detector decides almost every utterance instantly.
One-word verbs double as nouns ("Design is a big part of our culture"), so they count as a request only when followed
by what they act on; the rest land in the 0.35–0.6 band. Utterances in that band go to one small JSON call (thinking
off, 2.5 s timeout, fenced transcript) only once the interviewer has finished (endpoint or long silence), never on
partials, and never in click-to-answer mode. It also rewrites references ("Expand on that.") into a standalone
question. If it's unavailable, the band is not auto-answered (the user can still press Answer).

**D22 — Answers declare where their personal claims come from.** The model starts every answer with
`GROUNDED: verified | example | general` (a few tokens, no extra call). "example" (a story, or details of a real
project that the documents don't contain) shows a "Suggested details" badge. A fabrication audit (real DeepSeek +
an LLM judge labelling each claim VERIFIED / INFERRED / GENERAL / UNSUPPORTED) showed invented personal detail can't be
fully prevented for questions the documents don't cover, but with the label every answer containing it was flagged
(12/12 across two runs). A personal question with no verified facts and no label defaults to "example".

**D23 — Preflight checks are real but cheap.** `GET /v1/preflight` pings DeepSeek with a 3-token request (cached 60 s)
and validates the Deepgram key with its free project-listing endpoint (cached 5 min), so the checklist reflects the
providers actually working — not just keys being present — at negligible cost. Warnings never block a session; a
failure turns the button into "Start anyway". Local checks (microphone, interviewer audio, documents, network round
trip) run in the desktop.

**D24 — Workspaces are saved setups, not a job tracker.** A workspace stores documents + answer preferences (role,
type, language, length, style, auto-answer). Audio devices stay per-machine (localStorage), since a setup may be used
on another PC. Deleting a workspace keeps its sessions (link set to NULL) and never touches documents.

**D25 — "NEXT" guidance is local and deterministic.** The model ends each answer with `POINTS:` (3–6 short labels, in
order) — after the answer, so the first word isn't delayed (+80 tokens of headroom so long answers still reach it;
a paragraph-opening fallback covers the rare answer without it). Coverage runs in the client on every transcript
update, with no model call: the candidate's words since the answer appeared are matched against each label (plus
common abbreviations, e.g. PR ↔ pull request) and against the answer sentence it summarises, by 5-letter stems. A
loose sentence match must also include one of the point's own words, so shared topic vocabulary alone ("build",
"scan") never ticks a point. Ticks are sticky per answer (no flicker); NEXT is the first unticked point after the
last ticked one. Chat and screenshot answers get no checklist. The user can hide it.

**D26 — Coding answers separate what to say from what to code.** For coding the spoken ANSWER is the talk track
(approach and why, never code read aloud), followed by PROBLEM (the task in one line), CODE, TIME/SPACE, EDGE and
TESTS. PROBLEM comes after the talk track in the stream so it never delays the first spoken word. A preferred code
language (`LiveSettings.coding_language`, remembered per device) goes into the prompt; changing it on an answer's
code re-asks the same question in that language (not for screenshots, whose image isn't kept). Highlighting is a small
built-in tokenizer rendered as React nodes (no dependency, no HTML injection).

**D27 — The mock interviewer lives in the live engine and speaks with the platform voice.** Mock sessions reuse the
whole live pipeline: mic → STT → transcript. A `MockInterviewer` asks one question at a time (one JSON call, thinking
off; persona, focus, difficulty, role, resume/JD as reference), decides follow-up vs new topic (at most two follow-ups
per topic), and moves on after 3 s of candidate silence following 3+ words, or on "I'm done". Questions are recorded as
interviewer turns + questions (source "mock"), so the existing report and review scorecard grade the practice. Speech
uses the built-in `speechSynthesis` (Windows voices; WebView2 exposes no voice list but speaks with the default
voice) — free and local. The mic is muted while the interviewer speaks so its voice isn't transcribed as the answer.
Practice mode never answers for the candidate: the answer controls are hidden and `answer.request` means "I'm done".
If the model fails, a fallback question list keeps the interview going.

**D28 — Releases are built by a script that proves they use the real sign-in store.** 0.1.11 was compiled with
`ORBIT_KEYRING_SERVICE=""` (left over from a test build), so it looked for the sign-in under an empty service name,
and every user appeared signed out. Now `secrets.rs` treats an empty value as unset, and
`scripts/release-desktop.ps1` clears the variable before building. After the build, the script reads rustc's
dep-info and refuses to publish if the variable was seen with a value. Each published installer is also
spot-checked by downloading it from GitHub and confirming it finds the installed app's sign-in (read-only).

**D29 — Accessibility contrast is fixed once in shared CSS, not class by class.** Secondary grey text (`zinc-400/500`)
failed WCAG AA (2.6–4.4:1) across both apps. Rather than editing dozens of call sites, `base.css` maps those
utilities to the lightest greys that pass on every surface in each theme: zinc-400 in dark mode, `#63636b` in light.
The result is verified by an axe audit of every real desktop screen in both themes.

**D30 — One icon library, curated.** Emoji and Unicode glyphs rendered differently per Windows font and couldn't be
styled. Icons come from lucide (tree-shaken, MIT), but only through `packages/ui/src/icons.ts`, so both apps share
one set. Lucide hides icons from screen readers by default, and every icon-only button carries an `aria-label` and a
tooltip.

**D31 — "Delete the application data" means all of it, including the sign-in.** The token is in Windows Credential
Manager, outside the folders Tauri's uninstaller deletes. An NSIS post-uninstall hook removes it under exactly
Tauri's conditions: the box is ticked, and this is not an update. Silent uninstalls and updates keep everything, so
a reinstall comes back signed in.
**D32 — Paid features require a verified email; the admin is exempt.** The server pays for every live minute, so
an account must prove it controls its inbox before it can spend provider money. The check is one dependency
(`require_verified_user`) on the paid routes, not scattered `if`s. The admin is configured by env, not by sign-up,
so it's trusted. Production refuses to boot if non-admins can sign in but no SMTP exists to verify them: a silent
lock-out is worse than a loud config error.

**D33 — CSRF via Origin check + session-bound token header, not a double-submit cookie.** The API and web app are
on different sites, so the web app can't read an API cookie, and a double-submit cookie doesn't work. The token is
an HMAC of (user id, token version), so it needs no storage and rotates on sign-out-everywhere. It's handed out
only in CORS-protected auth responses. Sending a custom header also forces a CORS preflight, which unknown origins
fail.

**D34 — Rate limits key on the account as well as the IP.** IPs are cheap to rotate, and accounts are gated by
email verification, so provider-cost endpoints are limited per user. Login is also limited per target email, which
throttles password guessing spread over many IPs.
**D35 — Limits are server configuration, checked by name.** Plans live in one table, with defaults in code and
overrides in env (`ORBIT_PLANS_JSON`), validated at boot, so prices and limits change without a release. Call
sites ask `plan.has("vision")`, never "is this the pro plan". The billing page renders `/v1/plans`, so the page
can't drift from what's enforced.

**D36 — Every session has a hard ceiling, even on Unlimited.** A session left running (a forgotten tab, a laptop
that never slept) would stream paid audio indefinitely. The ceiling counts time across reconnects, warns 5
minutes ahead, and ends through the normal end path, so nothing is lost.
**D37 — Signing is a script with verification, not a CI-only toggle.** Releases are built locally (Actions may be
unavailable), so `sign-windows.ps1` and `verify-authenticode.ps1` run the same way on a workstation and in CI. The
release is refused unless the shipped installer, exe and uninstaller all verify with a timestamp. Store-based
certificates (Certum SimplySign, hardware tokens) are the default path for an individual developer outside the
US/Canada, where Azure Trusted Signing isn't available to individuals.
**D38 — Fail over only before the first token.** Switching models mid-answer would splice two voices and two
sets of facts into one spoken answer. Failing over before any text costs at most the first-token budget. After
text has streamed, a failure is shown as a failed answer, which the user can re-ask. The backup is any
OpenAI-compatible API, so no vendor-specific client code is needed. Provider quirks (reasoning effort, thinking)
are configuration, not code.

**D39 — Hybrid retrieval, judged on a held-out set.** Retrieval changes are scored on paraphrased interview
questions, including a held-out resume that is never tuned against. Theme expansion looked spectacular on the dev
set (R@3 0.95) partly because the cues were written after seeing its failures; the held-out set showed the real
gain. Reciprocal-rank fusion avoids hand-tuned score weights. The neural embedder is opt-in because it costs
~200 MB on a 512 MB host. Each chunk records its embedder, so switching is a config change plus lazy
re-embedding.

**D40 — Provenance is cited by the model and enforced by the server.** The model knows which facts it used, so
it names them (`SOURCES: F1 F3`, after the spoken text so there's no latency cost). The server resolves only refs
it actually put in the prompt. It never trusts a "verified" label without a verified source: an honest model loses
nothing, and a mistaken one can't present invented history as real. "Embellishing a real fact" (inferred) is
split from "inventing an event" (example), because they need different warnings.

**D41 — Read aloud mutes capture instead of filtering its own voice.** Orbit's voice comes out of the speakers,
so the mic and the system loopback both hear it. Echo cancellation or a "don't transcribe my own voice" filter
would be guesswork. Not sending audio while it plays is exact, reuses the mock interviewer's mute, and can't leak
the answer into the transcript. The cost is that anything said during playback is missed, so it's user-started
only, pausing resumes listening, and the controls say "Orbit isn't listening". It uses the platform's voices, so
there's no provider and no cost. Only on-device voices are used, so no text leaves the machine.

**D42 — The drill plan is picked from the review, not generated.** Which questions to practise is already known:
the review scored them against what was actually said. Picking the weakest deterministically costs no model call
and can't invent questions the candidate never struggled with. The AI is used only where it adds something: a live
follow-up on the new answer, steered by the old feedback (fenced as data). The drill runs on the normal mock
machinery, so it's recorded and can be reviewed and drilled again like any session.


**D43 — Jobs come from feeds that allow it; the big portals get links, not scraping.** No provider legally offers
LinkedIn or Naukri listings as data, and scraping LinkedIn, Indeed or Naukri breaks their terms, so Orbit reads none
of them. It reads companies' own public applicant-tracking-system feeds (Greenhouse, Lever, Ashby, SmartRecruiters:
no key, every apply link goes straight to the employer, and they're the freshest source for the companies that use
them), remote-job feeds whose terms allow showing them (Himalayas, Remote OK, Jobicy; not Remotive, whose terms rule
out a sign-in-only display), and optional search APIs only once their keys are set (Adzuna, JSearch). The rest of the
market is reached with "Search on LinkedIn / Naukri / …" links prefilled from the profile: no data is fetched, the
user lands on the portal's own search. Each feed's terms are kept in its module and on the card: credit by name with
a followed link (Himalayas, Remote OK, Jobicy), Adzuna's logo-sized credit and its own redirect link, a snippet plus
a link to the original rather than the full text, refreshes no more often than allowed (company boards every 6 h,
feeds daily) and a back-off on 429. Listings are cached in the database and refreshed in the background by the
single API instance (D12), so a feed request never waits on a provider. Matching is deterministic (the ATS score's
keyword reading), so ranking a thousand cached posts costs nothing and explains itself. The AI is used only where it
adds something: reading a resume into a search profile, and a fit check per job. Both are free so that browsing jobs
never spends the user's resume credits, and capped per day (with results cached per resume content and per job) so
the shared key's cost stays bounded: a fit check is one short call, about 3 s, and the cap is configuration.

**D44 — Answer size is picked per question by rules, and stored as a fourth `length` value.** A yes/no question and
a system design question need answers ten times apart, and a candidate reads the answer as a script, so its length is
how long they talk. One length per session gave ~150 words to everything (plain_probe.py), a model left to judge the
size would decide it differently on every answer, and a separate classification call would add latency to each. The
question detector already knows the type and the parts; with the wording ("have you used", "what is", "walk me
through", "briefly", "in detail") that picks the size deterministically, testably and for free, and the user can
always override one answer (Shorter / Longer) or the session (a fixed length). `"auto"` is a fourth value of the
existing `length` setting rather than a new flag, because the session and saved-setup columns are plain strings (no
migration) and every place that reads a length already handles it in one spot. Older desktop clients never send
`"auto"`; `answer.started` keeps a fixed `length` beside the new `size` so they always get a value they know. (One
mixed case remains until the next desktop release: a setup saved as Auto on the web and opened in desktop 0.1.37
starts an auto session whose length picker shows no choice, and whose Longer button steps to Short.) The candidate's
level is inferred the same way, from the resume once per session, because a fresher talking like a staff engineer
is what an interviewer catches; topics the verified facts never mention get an honest line instead of a faked
expert's answer. The jargon glossary (`TERMS`) comes after the spoken answer, so it costs no time to the first word.

**D45 — The admin console deletes through the owner's own delete, keeps the books, and never goes below zero.**
Deleting an account from the console calls the same function as "Delete my account" (`auth/accounts.py`): live work
stops first, then `ON DELETE CASCADE` takes every document, session, resume, story, job-search row, usage row and link.
What stays is what has to: **approved payments are kept** (`payments.user_id` is `ON DELETE SET NULL`, since migration
c4f6a8b0d2e1), so revenue totals and each UTR's unique row survive and a transfer can't be claimed again
from a new account; the row holds no personal data beyond the UTR and the pack, and shows as "(deleted account)".
The credit ledger stays too (no foreign key: the welcome grant's network and inbox hashes stop delete-and-re-sign-up
abuse), with the admin's notes on it cleared, and so does the audit trail (no foreign key), whose delete entry keeps
the account's id and email so it still says who it was. Taking credits away is a negative ledger entry with the
admin's reason (`reason=admin_remove`, `note`), never a rewrite of history; the server clamps it to what's left and
says so, and "set to zero" takes exactly the balance. Suspension is a flag (`users.suspended_at`) checked on every
request by `current_user`, at sign-in (only after the right password, so it can't be used to probe accounts), at
password-reset confirm and on the live socket; suspending also signs the account out everywhere and ends its live
sessions, so nothing already open keeps running. None of the destructive actions work on the admin account or on the
acting admin. The console shows counts and metadata, never an account's content (documents, transcripts, session
titles); the admin's private notes are left out of the owner's data export, so they shouldn't hold anything the
owner would need to see.

**D46 — Job-aware outreach reads the posting on the server, by listing id.** Outreach lives in Jobs AI now, where a
message should be about a real job. The browser could send the job's text as `job_text`, but Jobs AI only ever shows a
summary of a post (D43), so it doesn't have the full text, and text from the browser could be anything. So the
browser sends the listing's id and the server reads the posting from its own cache: one source of truth, the same
size cap and fence as a pasted job post, and nothing new for the browser to hold. The post's skills go to the model
split by whether the resume shows them (the job portal's own matcher), because a referral request that claims a
skill the resume lacks does the candidate harm; the existing grounding checks still drop any tool or number that's
in neither the resume nor the post. It stays one resume credit, like any other message, and a listing that has left
the cache fails before the credit is claimed. The API route stays under `/v1/resumes`: the kit is still written from
a resume, and a new URL would only churn the clients.

**D47 — Three motion levels, and the OS setting is a ceiling, not a switch.** On/off made people choose between
everything moving and nothing at all, but "reduce motion" is about movement, not change: fades help people see what
happened. So Settings offers Full, Gentle (fades only, nothing slides, spins or bounces) and Off, applied as
`html[data-motion]` so one set of CSS rules covers every component, including ones written before this. The OS
reduced-motion setting caps Full at Gentle rather than being one more input: a user who asked their phone for less
motion never gets more because of a setting in Orbit, and a user who chose Off keeps Off. A device that hasn't chosen
starts at Gentle when the OS asks or data saver is on. The choice stays per device in `orbit.design` (no migration):
the old switch's `true` reads as Full and `false` as Off, so nobody's choice changes, and Settings saves only after
a change, so visiting it doesn't pin a device default. Tailwind's `motion-safe:` sees only the OS, so new code
uses `motion-ok:` and JS animation reads `useMotion()`.

**D48 — First-run answers live in the browser; the job search profile is their only server copy.** The welcome
questions decide what Home shows first, which is low-stakes and easy to answer again, so they are kept in
localStorage per account (`orbit.welcome.<user id>`, several people can share a browser) instead of a new column and
a migration in a round that allows none. The two answers the server can use, the target role and the city (and the
experience level), go into the Jobs AI search profile, whose `prefs` is JSON already, so the first job matches are
about the right jobs. The cost: another device doesn't know the goal, and Home falls back to its general order
there; and a profile saved this way no longer fills itself from the first resume (the Profile page's "Fill from my
resume" still does). "Your next step" is picked deterministically from the answers and the account's own data
(`lib/onboarding.ts`, unit-tested), not by the AI: it costs nothing, explains itself, and never suggests something
already done.

**D49 — Jobs found elsewhere are tracked as "ext:" entries, and freshness badges claim only what the cache knows.**
A job a fresher applied to on Naukri, LinkedIn or a campus portal goes on the same tracker as a feed job, as a
`JobApplication` whose `listing_id` is `"ext:" + uuid4().hex` (36 characters, the column's size; never a feed id, which
is "j" + hex) and `source = "manual"`: the column is a plain string, not a foreign key, so no migration. The link is
read from its address only (Naukri, LinkedIn, Internshala and the ATS boards write the title and company into it) and
never fetched, since those sites block bots and Orbit doesn't read them (D43); the user checks the guesses before
saving. The badges follow the same rule. "Still open" is only for a company's own board, because a successful board
fetch replaces that board's listings, so a post still in the cache was on the employer's page at `fetched_at`; feeds
and searches are never re-checked, so they don't get it. "Early applicant" uses the earlier of the post's date and
Orbit's first sighting, because a post without a date is dated at every fetch. No match % is shown until there's a
resume or skills to match against: without them every job scored about the same middling number.

**D50 — Contact messages go to an Inbox in the admin console, not to email.** The owner asked for a contact form
whose messages land "in my inbox of admin account", and then chose the console's Inbox only: no email for each new
message. A message is a row (`contact_messages`) the admin reads, notes, replies to and closes at `/admin/inbox`, with
an unread count on the console's Inbox tab and a badge in the admin's top bar, which together are the notification.
Email was the easy alternative, but Orbit's SMTP isn't guaranteed (an admin-only deploy may run without it), a
mailbox can't show which account or reported job a message is about, and nothing in it is audited. Replying keeps the
admin's own mailbox in the loop: "Send reply" emails the sender from Orbit's address with Reply-To set to the admin,
so the conversation carries on in their mail app, and "Reply in your mail app" (a `mailto:` with "Re: <topic>" and
the message quoted) works on a server without SMTP. Nothing typed ever reaches an email header: the reply goes to the
address pydantic validated, under a subject built from the fixed topic list and the reference. The form is public and
works signed out, so the abuse controls are the cheap, invisible ones first: a honeypot (a bot that fills it is told
"received" and nothing is kept), tight bounds, 5 an hour and 20 a day per network plus a daily cap for everyone
counted in the table (it survives a restart), and Turnstile for signed-out senders when it's configured (an account
passed it at sign-up). The network is kept only as a keyed hash, like the welcome grant, so the Inbox can flag a
flood without storing addresses. The route needs no CSRF token (a signed-out visitor has none), so a browser session
links a message to its account only when the request carries that session's token; a page elsewhere that makes the
browser post can't put words in a user's mouth. Deleting an account keeps its messages without the link (SET NULL):
they were written to Orbit, and an unanswered question shouldn't vanish with the account. Handled messages are
deleted after 12 months by the existing session sweeper (no new job runner). The Contact page goes live on its own;
Terms and Refund stay drafts behind `LEGAL_PAGES_PUBLISHED`, and the draft static `contact.html` is superseded.

**D51 — PayPal takes the dollar prices, by redirect, and only its capture credits.** The owner has a PayPal Business
account and asked for PayPal for buyers outside India. A PayPal India account can only take payments from abroad,
which matches the split the prices already make (rupees in India, dollars elsewhere: billing/pricing.py), so PayPal
is offered for every dollar price and never for rupees; Razorpay's USD orders stay as the fallback when PayPal isn't
set up. The buyer goes to PayPal's approval page and back (Orders v2 with `return_url`), rather than PayPal's JS
buttons in the page: no third-party script in the app, no Content-Security-Policy change, the same flow on phones, and
nothing for the page to trust. The server captures on the return and credits only a COMPLETED capture of exactly the
order's amount and currency, through the same `credit()` as Razorpay (one conditional update, unique capture ids), so
a reloaded return page, the webhook and the reconciler can all arrive and the order is credited once. An approved
order whose buyer never came back is captured by the `CHECKOUT.ORDER.APPROVED` webhook or the reconciler, so approving
is enough. Webhooks are verified by PayPal's own verify-webhook-signature endpoint with the event bytes as received
(re-encoding the JSON can change what was signed); without a webhook id they're refused and the return plus the
reconciler still settle every order. No migration: `payments` already had a method, currency, cents and gateway ids.
A half-configured PayPal logs a warning and stays off instead of refusing to start (refusing took production down
twice before).

**D52 — The job refresh is paced to a share of one CPU, and big backlogs are spread over runs.** The job refresh
should be a small background load wherever the API runs. The first refresh of the worldwide boards (#355) showed what
happens when it isn't: on the then-host's free instance, a tenth of one CPU, reading skills from thousands of new
posts took all of it, so health checks waited seconds, the host restarted the server, and the restart started the
refresh again (reverted in #357). Memory was never the problem (a local run under the same 0.1-CPU, 512 MB cap
peaked at 163 MB). A tenth of a CPU stays the worst case it's measured against; where CPU is billed by use (the API
is moving to Railway), pacing also caps what the refresh costs. So the refresh now keeps its own CPU work to
`ORBIT_JOBS_CPU_SHARE` of one CPU (0.04 by default):
a worker thread sleeps whenever its own CPU time runs ahead of that share of the wall clock, and the event loop rests
after each 100-row write in proportion to what the write took (`job_portal/pace.py`). Its own CPU time, not a fixed
sleep, so it adapts to the machine. It also does less at once: one board at a time across sources (was two), at most
12 of a source's due boards a run, never-fetched ones first in their listed order (India's first) and then the
longest waiting, with 10 minutes' rest between a source's runs; ranked feeds re-rank at most every 5 minutes while a
refresh writes, instead of after every board. 12 boards every 15 minutes covers SmartRecruiters' 183 board-and-
country lists in about 4 hours, inside their 6-hour TTL, so a first pass is slower but steady state is the same
freshness. Rejected: a separate worker process (one more service to run and pay for, for work that's light once
paced) and
fewer boards (the posts abroad are the point). Unpaced in tests, so the suite doesn't wait.

**D53 — The API runs on Railway behind its own name, api.orbitanswer.com.** The owner moved the API from Render to
Railway (Singapore, next to Neon). Clients now reach it as `https://api.orbitanswer.com`, a `CNAME` to the Railway
service, instead of a hosting provider's own name: the desktop app bakes its API address into each release, so the
last move (Ohio → Singapore) stranded installs of 0.1.31 and older, and this one would strand 0.1.40 and older the
day Render is deleted. With our own name, a future move is a DNS change that installed apps, update checks included,
follow with no release. The record is DNS only, not proxied by Cloudflare: the API keys callers without the web
Worker's proxy secret (the desktop app) on the right-most `X-Forwarded-For` hop, which behind Cloudflare's proxy is
a Cloudflare edge shared by everyone near it; the admin Overview warns (`api_cloudflare_proxied`) when direct callers
arrive with Cloudflare's `CF-Ray`. Render keeps running
until desktop installs have updated past 0.1.40 (Render serves them the update from GitHub Releases, as Railway
does); the Worker's cron keeps it warm meanwhile (`LEGACY_API_URL`). A saved sign-in-screen override that names a
retired Render address is ignored, so nobody stays behind on it. Still one instance (D12): Railway runs one replica,
and while both hosts run, each holds only its own clients' live sessions. No `railway.json`: the service is set up
in Railway's dashboard, which a config file in the repo would override on the next deploy.

**D54 — A long problem is captured by scrolling it, on the desktop, with the user's say-so.** Coding problems are
often longer than the screen, and a screenshot of the first screen answered half a question. Desktop screenshots now
have "Scroll to the end" (a switch on the selection screen, remembered, plus a button on the preview): Orbit turns the
mouse wheel over the selected area, waits for each scroll to settle, captures it, and joins the screens where their
rows match (scroll_capture.rs), then scrolls the area back and puts the mouse where it was. It's the user's own
action on their own screen, like the screenshot itself (spec §27): nothing scrolls unless they started it, and moving
the mouse stops it. Joining compares row fingerprints in vertical strips rather than whole rows, so a scrollbar, a
ticking timer or a hover highlight doesn't break it, and it learns from the first scroll which strips scroll (the
result keeps only those: a sliver of the editor beside the problem is cut off) and which rows stay put (a pane's tab
bar and a Run/Submit bar, kept once). The alternative, asking the user to take several screenshots, leaves the
joining to the model and spends several screenshot credits for one question. On the server a tall image is cut into
overlapping parts about a screen high (live/shots.py), sent in order with a note on how to read them: a vision model
shrinks one very tall image until its text blurs. Still one screenshot, one answer, one credit; nothing is stored.
Windows only, like the rest of the desktop's capture; the web app keeps single screenshots.

**D55 — Render is retired the day after the move, not two weeks later.** D53 planned to keep the old Render service
running until desktop installs had updated past 0.1.40. The owner suspended it on 2026-10-17, once desktop 0.1.41
(which talks to `api.orbitanswer.com`) was published and verified, and Railway (Hobby plan, Singapore) had taken all
web traffic. The cost is accepted: a desktop app still on 0.1.40 or older calls Render directly, for sign-in and for
its update check, so it stops working and can't update itself; its user reinstalls from orbitanswer.com. Installs
that already updated are unaffected, and so is the website. Suspended rather than deleted at first, so it can be
resumed if that turns out to matter. The code no longer reads Render's variables (`RENDER_GIT_COMMIT`,
`RENDER_EXTERNAL_URL`), the Worker no longer keeps it warm, and `render.yaml` is gone. Payment webhooks name a host's
own address, so they move to `https://api.orbitanswer.com/...` in Razorpay's and PayPal's dashboards; until they do,
payments still settle through the checkout return and the reconciler.

**D56 — Readiness fails on a database that refuses writes.** On 2026-10-18 the production database was left with
`default_transaction_read_only = on`: every read worked, every write (sign-in, Google sign-in, payments, sessions)
failed, and `/ready` still said `"database": "ok"` because it only ran `SELECT 1`. `/ready` now also asks Postgres
whether the transaction is read-only or the server is a standby (`current_setting('transaction_read_only')`,
`pg_is_in_recovery()`; skipped on SQLite) and answers 503 with `"database": "read_only"`. The admin Overview shows a
`database_read_only` warning with the fix. Railway runs the healthcheck only while a deploy goes live, so this
doesn't restart a running service when the database turns read-only later; it does block a new deploy until the
database takes writes again, and that is accepted: a deploy can't serve then anyway, and the previous one keeps
running. While a database refuses writes, the device "last used" touch on each signed-in request is skipped instead
of failing the request, so reading what's already there keeps working, and Google's callback sends the browser back
to `/login?error=server` instead of a bare 500 on the API's address.

**D57 — Plans for a while run on their own clock, and nothing given or paid is cut short.** A paid month and the
admin's grant are the same thing on the account: a plan until a time. Their allowances used to be 30-day periods
counted back from the end, so a week of Premium reached 23 days into the past (usage from before the purchase counted
against it) and two weeks back to back shared one 30-day allowance; and a new plan replaced a different one running,
so a paid week ended an admin's 60 days of Unlimited. Now:
- **Windows from the start.** Each grant keeps when it began (`users.grant_started_at`); its allowance runs in 30-day
  windows from there, the last one ending with the grant. Use from before never counts against it.
- **Every window has the plan's whole allowance**, a week's single 7-day window and a year's last few days included
  (Premium: 3,000 live and 1,500 mock minutes). The allowance is a fair-use cap, not a metered product, and the pricing
  promises it to every Premium plan ("50 hours of live interview help"); a week cut to its share (700) would break
  what weekly buyers were sold, and be worse than the "unlimited" weeks elsewhere. The Weekly card says the hours
  are "to use in the week". `users.grant_paid` records whether a grant was bought or given; it changes no limit.
- **Nothing is cut short.** The same plan bought again follows on where the running one ends (from now, if it already
  ended) as a grant of its own, with its own windows: a week renewed early has its whole allowance instead of sharing
  the first week's. The plan doesn't stop in between, and "until" shows the end of the run. The admin's "2 more hours"
  of the same plan just extends the running grant. A higher
  plan (basic < pro < premium < unlimited) starts now, and what's left of the running one waits behind it with all its
  time, its windows still counted from where they began. A lower plan waits until the running one ends. Grants waiting
  their turn are `users.grant_queue`, best first; nothing is converted by price (an admin grant has none), so there's
  no rate to argue about. Readers work the timeline out at any moment; writers (a payment landing, the admin's grant)
  move it on under the account lock, and the sweep stores the next grant as running once one ends, for the admin's
  lists. The receipt and the admin's email say when a waiting plan starts.
- **Existing grants** got their start from what made them (the latest approved paid month, or the admin's latest
  grant in the audit log). One with neither keeps counting its windows back from its end, as before.

**D58 — The workbench's dark mode is one blue-grey family, so the ink's darkest steps are remapped there.** Round 2
gave the workbench a blue-grey dark canvas, surface and line (#0D121C, #141B27, #232C3B), but the components paint
their dark panels with the ink scale's `dark:bg-zinc-950` / `-900` and `dark:border-zinc-800`, and ink is the front
door's violet night (#080918, #14162D). Worse, the body's own `dark:bg-zinc-950` utility outranked the canvas rule,
so the dark workbench sat on violet black with blue-grey cards on it: two families of near-black on one screen. The
options were to edit hundreds of `dark:` classes to name the canvas tokens, or to remap the ink's darkest steps inside
`html.app-shell.dark`: `zinc-950` (which `dark:` pairs with `bg-white` throughout: bars, fields, dialogs, the live
panel) becomes the surface, `zinc-900` a raised step above it, `zinc-800` the line and `zinc-700` the blue-grey
between. The remap won: one place, every component follows, light mode and the front door (and the desktop app,
which isn't `app-shell`) are untouched, and it makes dark mode the light theme's twin (chrome and fields on the
surface, the canvas recessed). The cost is that inside the dark workbench `zinc-950` no longer means "darkest": a
page that wants the canvas names `--canvas`. The live session page joins the workbench in the same change: it's
where the copilot is used, so it gets the still canvas and opaque panels, not the sky.
The same round made the workbench one component system (the owner asked for "a pure enterprise big product"). Each
primitive is built once in `packages/ui` and adopted where the hand-rolled versions were: one Button with six
variants and fields at its height, one Dialog/confirm/menu/tooltip/toast family on four elevation tokens (menu <
popover < dialog < toast) and a z-index scale, Callout and Badge for every banner and status pill, a Table with a
sortable header and a phone card view, SegmentedControl and Tabs with a sliding indicator, and an Orbit scene for each
product's empty screen. Two choices were deliberate: a loading button shows a spinner in its label's place at the same
width (nothing beside it shifts; the name stays for screen readers), and the gallery of all of it lives at
`/dev/components` in development builds only, behind `import.meta.env.DEV`, rather than a Storybook (no new
dependency, and it renders inside the real Layout, tokens and themes). Primitives are presentational: none changed
what a page does.

**D63 — The question bank is reviewed JSON in the API, and the public pages are built as HTML from it.** The 25
company guides were Python constants with four sample questions each, and every public page was an empty React root
to a crawler that doesn't run JavaScript (most AI assistants' crawlers: a title and nothing else), with 10 URLs in
the sitemap. Now:
- **Content is data**, one file per entry: `apps/api/orbit_api/question_bank/companies/<slug>.json` (about 100) and
  `roles/<slug>.json` (about 30). `schema.py` is the format and the honesty rules, enforced when the API starts, by
  `uv run python -m orbit_api.question_bank` and by the tests: every guide has a hedged summary and rounds (never
  "always"), what interviewers listen for (a company's published values where it has them), at least 10 questions
  (behavioral, role and fit) each with what a good answer covers, tips, optional sources (the company's own pages,
  each fetched when written) and the date it was reviewed. It refuses the claims we never make: "real", "actual",
  "leaked" or "asked at" questions, question sites by name, pay figures and head counts, promises, the model
  provider. The questions are Orbit's own wording; nothing is copied from question sites (their terms and copyright).
  It lives in the API because the API's image only has `apps/api`; the web build reads the same files. The API keeps
  its `CompanyStyle` records (`live/company_styles.py` reads the bank), so the mock interviewer, the copilot, Practice's
  "What to expect" and the Mission Room's Company tab got the new guides without changes; role packs reach the mock
  and the copilot through `live/role_packs.py` (a typed role, with its level words dropped). Not in the database:
  the content changes by review and deploy, not by users, and a file diff is the review.
- **Public pages are rendered at build time, not by the Worker.** `pnpm --filter @orbit/web build` builds the app,
  then builds `src/prerender/entry.tsx` for Node (`vite build --ssr`) and `scripts/prerender.mjs` writes each public
  page's HTML into `dist/`, drawn by the app's own components, signed out. **One registry**
  (`src/prerender/routes.tsx`) lists every public page: its address, its file, its head (title, description,
  canonical, optional preview image, optional JSON-LD) and its lastmod; the sitemap is generated from the same list.
  Adding a public page is a registry entry. The question bank's pages are files the assets serve directly
  (`/companies/amazon` → `companies/amazon.html`); the pages in the Worker's `PAGE_META` (/, /resume-ai, /jobs,
  /warmup, /contact, /technical) go to `dist/_prerender/` and the Worker serves them (`worker/prerendered.js`), except
  a signed-in visitor's own home at /, /resume-ai and /jobs (the session cookie is there), which stays the app.
- **No hydration: a hand-over.** The built page sits in `<div id="prerender">` in front of the app's hidden `#root`;
  when the app's copy of that page has rendered (its code loaded), it removes the built one in the same frame
  (`lib/prerender.tsx`). Hydrating would have needed the server and the first client render to match exactly, which
  this app's auth-loading and stored-preference rendering never do (React would throw the page away and redraw it).
  The cost: a form typed into before the app loads starts again. A product page that fails to render at build time
  is left to the app with a warning (its code changes often); a guide that fails stops the build; the tests require
  all of them to render.
- **Structured data says only what the page shows**: Organization, WebSite, WebPage, BreadcrumbList, and
  CollectionPage/ItemList for the lists. No ratings, reviews, offers or FAQ markup. robots.txt keeps its allow-list
  (search engines and AI crawlers alike, under `*`) and adds /companies and /roles.
Rejected: rendering in the Worker (it would need the content and React in the Worker, and per-request CPU for pages
that change only on deploy); a JSON API for the pages (crawlers would still see an empty root); hydration (above).

**D60 — Rupee prices are cut to about 30% under Parakeet AI's rupee prices; dollar prices stay where they were.** The
owner checked Parakeet AI's own rupee prices on 2026-10-18: 1 credit ₹2,360, 3 credits ₹3,690, 8 credits ₹7,380, 15
credits ₹11,070 (1 credit = 60 interview minutes), Weekly ₹4,980, Monthly ₹9,470, Yearly ₹37,900. Orbit's rupee prices
had been set about 30% under Parakeet's dollar prices converted at ≈ ₹88, which left them only a few percent under
Parakeet's own rupee prices (₹2,299 against ₹2,360 for 1 credit). They are now about 30% under those: 1 credit ₹1,649, 3 credits ₹2,599, 8 credits
₹5,199, 15 credits ₹7,749, Weekly ₹3,499, Monthly ₹6,599, Yearly ₹26,499 (AI credits stays ₹499). What each pack
includes is unchanged. The cut is for India only: a dollar price used to be the rupee price converted, so cutting
rupees would have cut dollars by 26-29% too, and the owner didn't choose that. Each default pack and plan now
carries its own `price_usd_cents`, pinned at its dollar price from before the cut ($7.99, $33.99, $53.99, $106.99,
$161.99; $70.99, $135.99, $531.99), and a test pins every one; the conversion is kept only for packs and plans set
through `ORBIT_CREDIT_PACKS_JSON` / `ORBIT_MONTHLY_PLANS_JSON` without a `price_usd_cents`. Orders already made keep
their stored amount: the checkout, the webhooks and the reconciler settle an order by what it was made for, so one
opened at an old price and paid at that price is credited as before, and a payment of the new price against it is
not a capture of it. No page claims "30% less than Parakeet" (re-check their prices before one does). The cost
note in BILLING.md matters more now: the Monthly plan (₹6,599) barely covers a subscriber who uses all 75 hours.
