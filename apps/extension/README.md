# Orbit browser extension (Chrome and Edge, Manifest V3)

Clip a job from the page you're on to your Orbit tracker, see which of its keywords your resume covers, and fill an
application's basic fields for you to review. Filling never submits. **Auto-apply** (off by default, opt-in) is the
one part that submits: it applies for you to the jobs Orbit has prepared, on Greenhouse, Lever and Ashby career pages.

## What it can touch
- `activeTab` + `scripting`: a page is read only when you click the extension's button on it. Without auto-apply it
  can't see any other site, ever.
- `storage`: its own sign-in token, auto-apply's on/off and pause setting, its last 20 results, and (for "Needs you"
  items only, kept a week) the application packet so you can finish it in one click.
- `alarms`: auto-apply's schedule. `tabGroups`: labels auto-apply's tab "Orbit Apply". Neither shows a warning.
- Host access: Orbit's site (for the Connect page) and Orbit's API. No job sites are listed at install.
- Optional host access, asked for only when you turn auto-apply on (`optional_host_permissions`; the browser shows
  its own prompt) and given back when you turn it off: `https://boards.greenhouse.io/*`,
  `https://job-boards.greenhouse.io/*`, `https://jobs.lever.co/*`, `https://jobs.ashbyhq.com/*`. Removing them in
  the browser's extension settings turns auto-apply off.

## Auto-apply (`src/lib/autoApply`)
Single purpose, as the store asks: still "help you apply to jobs", now also finishing the application for you when
you've said so. What it does, and what it never does:
- **Runs only while on and the browser is open.** The service worker asks Orbit for the next application on a
  `chrome.alarms` schedule (`GET /v1/apply/next`; 204 means nothing due). It waits for `not_before`, respects
  Orbit's pause, quiet hours and daily limit from `/v1/apply/status`, and backs off on errors. One application at a
  time, a few minutes apart. The popup has Pause/Resume and Check now.
- **Visible.** Each application opens in its own unfocused window, in a tab group titled "Orbit Apply"; the toolbar
  badge shows ▶ while it works and the count of "Needs you" items after. The window closes when it's done.
- **Only the four ATS hosts.** The packet's `apply_url` must be https on the ATS it names (`adapters/index.ts`
  `onAtsHost`); a redirect anywhere else (a sign-in page) stops it.
- **Truthful, pre-approved answers only.** Standard fields come from the packet's `fields` (with the existing field
  detection, `lib/fields.ts`). Every other question is matched to a packet answer by the ATS's question id, then the
  exact label, then the normalized label (`match.ts`). Nothing is guessed: no match, or an answer that isn't one of
  the question's options, makes a required question "unknown". Voluntary EEO questions get the "decline to
  self-identify" option when there is one. Consent, privacy and attestation questions are only answered from an
  explicit packet answer. The resume (`download_url`, fetched with the extension token when it's on Orbit's API) and
  the cover letter (as a .txt file, or typed into a cover-letter box) are attached through DataTransfer with the usual
  input/change events.
- **A person's pace, no tricks.** A character at a time (long text a few words at a time), pauses between fields,
  values set through the native setters so React sees them. No captcha solving, no stealth or fingerprint changes, no
  automation-detection evasion of any kind.
- **Stops and hands over ("Needs you")** on: a captcha or human check on show (before or after submit; the invisible
  reCAPTCHA badge alone isn't one), a sign-in wall, an email code, a block page, a required question with no approved
  answer (reported with its options), a file the page didn't take, a form it doesn't recognise, or fields that didn't
  take a value. Nothing is submitted then. In the popup, **Finish it** opens the job in your own tab, fills what it can
  (outlined in purple, as Fill does) and lists what's left; you press Submit.
- **Submits only when ready**: every required field shows a value and the page itself shows no errors. Then it presses
  the form's own submit button and waits up to a minute for the ATS's success state (Greenhouse's confirmation page,
  Lever's "Application submitted", Ashby's success box). Only that counts as submitted. Anything else is reported as
  failed (`form_changed`, or `error` when the form went away without a confirmation, which Ashby's spam filter can
  do).
- **Proof**: the result (`POST /v1/apply/{id}/result`) carries what was entered, the confirmation text and final URL,
  and a PNG of the confirmation when the browser allows it (see Known limits). Results that can't be sent are kept and
  sent next time.

The contract with the API is `src/lib/autoApply/contract.ts` (it mirrors the server's apply routes).

### Known limits
- `chrome.tabs.captureVisibleTab` needs `<all_urls>` or `activeTab`; the four ATS hosts aren't enough, so the
  screenshot is usually `null` and the confirmation text and URL are the proof. Asking for `<all_urls>` would be far
  broader than auto-apply needs.
- The adapters follow the ATS pages as recorded on 2026-10-19 (`tools/e2e/ats-fixtures`). Greenhouse's react-select
  dropdowns and location lookup, Lever's resume parsing and Ashby's autocomplete are driven through their own events; a
  redesign shows up as "Needs you" (`form_changed`), not as a wrong submission. Greenhouse forms embedded on company
  sites (`?gh_jid=`), the EU hosts (`job-boards.eu.greenhouse.io`, `jobs.eu.lever.co`) and other ATSes aren't
  covered.
- Ashby can reject a submission silently and still show success; Orbit reports what the page shows.

## Signing in
The popup's **Connect to Orbit** opens `/extension/connect` on Orbit's site. If you're signed in there, **Connect the
extension** makes a token that works only for the extension's routes (`auth/security.py` `SCOPED_PATHS`). It shows in
Settings → Devices as "Browser extension", where it can be signed out. The token lasts as long as any sign-in
(`ORBIT_JWT_TTL`, 7 days by default). After that, the popup asks you to connect again.

## Build
```sh
pnpm --filter @orbit/extension build                                                       # localhost:5173, API at its /api
ORBIT_WEB_URL=http://localhost:5173 ORBIT_API_URL=http://localhost:8000 node apps/extension/build.mjs   # local dev
ORBIT_WEB_URL=https://<your site> node apps/extension/build.mjs                            # production (API at /api)
```
Load `apps/extension/dist` in `chrome://extensions` (Developer mode → Load unpacked), or zip it for the stores.

## Tests
- `pnpm --filter @orbit/extension test`: reading JobPosting data and page titles, which form field asks for what, and
  auto-apply: question matching, the three adapters against saved copies of real public Greenhouse, Lever and Ashby
  application pages (`tools/e2e/ats-fixtures`; re-record with `node tools/e2e/ats-fixtures/record.mjs`), the stop
  conditions, and that nothing counts as submitted without the ATS's success state.
- `tools/e2e/extension-autoapply.spec.ts`: the built extension in headless Chromium against a fake Orbit API and a
  local fake ATS serving those pages on their real hostnames (the browser's resolver maps the four hosts to it and
  nothing else resolves). Packet, fill, upload, submit, confirmation, result posted; a captcha before and after
  submit; an unanswerable question and its "Finish it" hand-off; the opt-in/opt-out permission requests.
- `tools/e2e/extension.spec.ts`: loads the built extension into Chromium. It connects, clips a fixture job page,
  checks fit, saves to the tracker and fills a Greenhouse-style form. It checks that typed answers and the person's
  own questions are left alone, and that nothing is submitted.

## OWNER ACTION REQUIRED to publish
0. Before publishing auto-apply: the site's `privacy.html` still says the extension "never submits anything". Update
   it (and the store's privacy practices) to describe auto-apply, its opt-in host access and what it sends back.
1. Build with the production `ORBIT_WEB_URL` and zip `dist/`.
2. Chrome Web Store: register a developer account (one-time fee). Upload the zip and fill in the privacy practices:
   it handles the email and name shown in the popup, job details you choose to save, and resume basics for autofill;
   with auto-apply on, it also fills and submits applications on the four ATS sites from your approved answers and
   reports each result to Orbit. Nothing is sold or used for ads. Link to `privacy.html`.
3. Edge Add-ons (Partner Center, free): the same zip.
4. Store listings need screenshots and a 128 px icon (`icons/icon-128.png`).
5. Set `VITE_EXTENSION_URL` to the store listing in the web build's environment (Cloudflare build variables): the
   Connect page then offers "Get the extension" to anyone who opens it without the extension (until then it says the
   extension isn't in the stores yet).
