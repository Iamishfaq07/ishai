# Product screens

Real screenshots of Orbit's own screens with made-up demo data, for the website, the ad creatives (`../ads/`) and the
Microsoft Store listing (`../store/`). Everything in them is fictional: the person (Aditi Rao, a data analyst), her
resume, the employers (Juniper Logistics, Fernway Travel, Kestrel Pay, Lumen Analytics, Northwind Labs, Brightline
Health, Cobalt Commerce, Tessellate, Quillbook, Parallel Grid, Harbourline) and the job posts.

The raw captures in `src/` aren't in git (`../.gitignore`): run the capture first; the ads, the Store screenshots
and the link previews (`apps/web/og/render.mjs`) are made from them.

| File (`src/`, 2560 x 1600: a 1280 x 800 window at 2x) | What it shows |
| --- | --- |
| `copilot-{light,dark}.png` | A live session (`/live/:id`): the transcript, the detected question, a finished answer built from the resume with its key points ticking off as the candidate speaks, the likely follow-up and the resume line it used. |
| `copilot-streaming-{light,dark}.png` | The same moment while the answer is still being written. |
| `practice-{light,dark}.png` | A finished mock interview's review: the score, what went well, what to improve, what to practise next. |
| `resume-{light,dark}.png` | The Resume AI editor with the resume, its live preview and its ATS score (98, from the real scorer). |
| `jobs-{light,dark}.png` | Jobs AI matches, each with its fit score and the skills it matched. |
| `mission-{light,dark}.png` | The Mission room of an application with an interview in two days: the steps and the prep plan. |
| `tracker-{light,dark}.png` | The application tracker's board, from saved to offer. |

The website uses WebP copies, 1600 x 1000, in `apps/web/src/marketing/shots/<name>-<theme>.webp` (`capture.mjs
--webp`).

These show the signed-in workbench as it is on this branch. Re-capture them after a change to those screens (the
design-round-3 branch, for one), then re-export the ads and the store screenshots.

## Seed a local stack, then capture

Never against production: both scripts refuse orbitanswer.com, and the seed script runs only on a SQLite database in
a temp folder.

1. Start a local stack with mock providers and a fresh database (for example `C:\Users\Ishfaq\tools\orbit-drive\brand\stack.sh`:
   API on 8023, web on 5186, `ORBIT_LLM_PROVIDER=mock ORBIT_STT_PROVIDER=mock ORBIT_JOBS_REFRESH=false`).
2. Seed it, from `apps/api`, with the API's database URL:

   ```sh
   ORBIT_DATABASE_URL="sqlite+aiosqlite:///C:/Users/<you>/AppData/Local/Temp/<stack>/db.sqlite" \
     uv run python ../../marketing/screens/seed.py --api http://localhost:8023 --web http://localhost:5186 all
   ```

   Through the API: the account (`aditi.demo@example.com`), the resume, the resume as a document, the Jobs AI search
   profile, seven tracker entries (saved, applied, interviewing with an interview in two days, an offer, a "not this
   time") and a mock interview. Straight into the local database, where no API writes it: nine job posts from the
   fictional employers, believable dates on the tracker, and the mock interview's transcript, questions and
   scorecard (built with the server's own report code; the mock AI's report would say "[mock]"). The steps run one at
   a time too: `account`, `listings`, `tracker`, `mock`. The ids go to `.seed-state.json` (not committed).
   If the local server has no `ORBIT_ADMIN_EMAIL`, the first account is its admin: the capture hides the admin link.
3. Restart the local API: the job feed reads its posts at startup.
4. Capture, from the repository root:

   ```sh
   node marketing/screens/capture.mjs --web http://localhost:5186 --api http://localhost:8023   # src/*.png
   node marketing/screens/capture.mjs --webp                                                   # the website copies
   node marketing/screens/capture.mjs --store                                                  # ../store/
   # --only copilot,jobs   --themes light   --playwright <path to playwright-core/index.mjs>   --chrome-path <exe>
   ```

## How the live session is captured

The local API runs the mock AI, so the live session's words come from `capture.mjs`. It opens the real page, signed
in, and proxies its live WebSocket to the real local server with Playwright's `page.routeWebSocket()`: everything
passes through, and the script adds its own server-to-client events (`transcript.final`, `question.detected`,
`state.changed`, `answer.started`, `answer.chunk`, `answer.completed`, then a `transcript.partial` of the candidate
answering), exactly as `docs/PROTOCOL.md` describes them. The page draws them with its own components. Three things
are made to look like a real call rather than a dev setup:

- the speech and AI providers report `ok` instead of `mock` (the mock one adds a developer-only "simulate" row);
- headless Chrome has no meeting tab to share, so `getDisplayMedia` returns a quiet tone (the page then says
  "Interviewer hearing"), and the microphone is Chrome's fake device;
- the clock reads 12 minutes into the call, and the system-design "Critique architecture" panel is hidden (this is an
  analyst's interview).

The pages are captured in UTC, as the server counts days, so the Mission room and the server agree on when the
interview is. The floating support button and the admin link are hidden in every screen.
