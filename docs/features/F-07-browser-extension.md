# F-07 · Browser extension (Chrome and Edge)

Status: built 16 Oct 2026, **not published**: publishing to the stores is an owner action (see
`apps/extension/README.md`).

## What it does
- **Clip a job.** On any job page, the popup reads the job from what's on screen. It uses schema.org `JobPosting`
  data first (Greenhouse, Lever, Workday, LinkedIn, Naukri and most career sites publish it), then the page's title
  and text. You check the title, company, location and link, then save it to the tracker through the existing
  `POST /v1/jobs/tracker/manual`. Orbit's server never fetches or scrapes the page.
- **Check fit.** "Check my resume against it" runs Resume AI's ATS keyword match (`POST /v1/extension/fit`) on the
  job text: matched and missing keywords and coverage %. No AI call, no credits. The copy says it's coverage, not a
  prediction.
- **Fill an application.** Fills empty first/last/full name, email, phone, location, LinkedIn, GitHub and website
  fields from the resume Jobs AI uses (`GET /v1/extension/profile`), outlines each one, and shows a banner asking you
  to review. It never:
  - overwrites typed text;
  - touches salary, visa, why-us, gender, notice period and similar answers;
  - uploads a file;
  - clicks submit.

## Security
- A token scoped to the extension: `create_access_token(scope="extension")`. `current_user` refuses a scoped token
  anywhere outside `SCOPED_PATHS`, and a scoped token can't mint another one.
- Each connection is a `UserSession(kind="extension")`, listed in Devices, and signing it out ends the token.
- The site hands the token over by `window.postMessage` on `/extension/connect`. Only the extension's content
  script, which runs on that page alone, listens. The token is never displayed.
- Manifest permissions: `activeTab`, `scripting`, `storage`, and host access to Orbit's own origins only.

## Tests
- API: `apps/api/tests/test_extension.py`.
  - The token works on its own routes and gets a 403 elsewhere: account, export, devices, delete, connect.
  - Signing it out from Devices ends it.
  - Autofill basics, and the keyword fit.
- Extension unit tests: JSON-LD (including raw line breaks), page-title fallback, field classification.
- End to end: `tools/e2e/extension.spec.ts`, which loads the built extension in Chromium.

## Not built
- Workday's multi-step forms, and filling fields inside cross-origin iframes. Some ATSs embed their form that way;
  the popup then fills nothing, and says so.
- Firefox (MV3 differences) and Safari.
- A fit check on the full AI fit (`/listings/{id}/fit`) works only for jobs in Orbit's own feed, so it isn't used here.
