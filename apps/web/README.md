# @orbit/web

Browser app for Orbit: account, documents (resume / JD / notes), session setup, the live copilot,
mock interviews, history + reports, billing, and settings. The live screen is the shared
`LivePanel` from `@orbit/ui`, the same component the desktop app uses.

## Run

```bash
# from the repo root
pnpm install
cp apps/web/.env.example apps/web/.env      # VITE_API_URL=http://localhost:8000
pnpm dev:web                                 # http://localhost:5173
```

The API (`apps/api`) must be running and must allow `http://localhost:5173` in `ORBIT_CORS_ORIGINS`
**with credentials**. The web client authenticates only with the API's httpOnly session cookie, so
JavaScript never sees a token. Only `VITE_*` variables reach the bundle, so never put provider keys there.

```bash
pnpm --filter @orbit/web typecheck
pnpm --filter @orbit/web build
```

## Audio in the browser

| Source | How | Channel |
|---|---|---|
| Your microphone | `getUserMedia` (echo cancellation / noise suppression on) | `0` (candidate) |
| Interviewer | `getDisplayMedia` tab/screen share with **“Share tab audio”** ticked. The video track is stopped immediately and only audio is used | `1` (interviewer) |

Both streams pass through `public/pcm16-worklet.js`, which mixes down to mono, low-passes, resamples
to 16 kHz, and converts to PCM16. Frames are sent every 50 ms as `[channel byte][PCM16LE…]` (see
`docs/PROTOCOL.md`).

- Tab audio works in Chromium browsers (Chrome, Edge, Arc). Firefox and Safari can't share tab audio, so
  the setup screen disables the toggle and points users to the desktop app.
- Browsers require a user click before `getDisplayMedia`, so the live screen shows a
  **Share tab audio** banner instead of prompting automatically. If the user stops sharing, the
  banner comes back.
- Audio is dropped, not queued, while the socket reconnects or the session is paused.

## Permission onboarding

- **Microphone:** the setup screen shows the Permissions API state. *Test microphone* triggers the
  prompt and shows a live meter. If permission is denied, it explains how to re-allow from the address bar.
- **Tab audio:** *Test tab audio* opens the share picker and shows a meter, so users can confirm they
  ticked “Share tab audio” before the interview starts.

## Screenshots

The **Screenshot** button asks the browser for a one-frame screen/window/tab capture, previews it,
and uploads only on **Analyze** (`POST /v1/sessions/{id}/screenshots`). The answer streams back
over the live socket. If the server doesn't implement the endpoint yet, the preview says so
plainly. It never pretends the image was analyzed.

## Dev: simulate an interview

When the API runs the mock STT provider (`provider.status` → `stt: mock`), the live screen shows
a **Dev · simulate** row. It replays `behavioral_interview`, `technical_interview`,
`coding_interview`, or `meeting` at 1–10× through `dev.simulate`, so the whole pipeline can be
demoed without a microphone or API keys.
