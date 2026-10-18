# Orbit browser extension (Chrome and Edge, Manifest V3)

Clip a job from the page you're on to your Orbit tracker, see which of its keywords your resume covers, and fill an
application's basic fields for you to review. **It never submits anything.**

## What it can touch
- `activeTab` + `scripting`: a page is read only when you click the extension's button on it. It can't see any other
  site, ever.
- `storage`: its own sign-in token.
- Host access: only Orbit's site (for the Connect page) and Orbit's API. No job sites are listed.

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
- `pnpm --filter @orbit/extension test`: reading JobPosting data and page titles, and which form field asks for what.
- `tools/e2e/extension.spec.ts`: loads the built extension into Chromium. It connects, clips a fixture job page,
  checks fit, saves to the tracker and fills a Greenhouse-style form. It checks that typed answers and the person's
  own questions are left alone, and that nothing is submitted.

## OWNER ACTION REQUIRED to publish
1. Build with the production `ORBIT_WEB_URL` and zip `dist/`.
2. Chrome Web Store: register a developer account (one-time fee). Upload the zip and fill in the privacy practices:
   it handles the email and name shown in the popup, job details you choose to save, and resume basics for autofill;
   nothing is sold or used for ads. Link to `privacy.html`.
3. Edge Add-ons (Partner Center, free): the same zip.
4. Store listings need screenshots and a 128 px icon (`icons/icon-128.png`).
5. Set `VITE_EXTENSION_URL` to the store listing in the web build's environment (Cloudflare build variables): the
   Connect page then offers "Get the extension" to anyone who opens it without the extension (until then it says the
   extension isn't in the stores yet).
