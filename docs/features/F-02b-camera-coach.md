# Video mock: the camera coach (on-device)

Status: built 16 Oct 2026, **off by default** (`ORBIT_VIDEO_MOCK=false`). Web app only.

## What it does (with the flag on)
- In every mock round, under the question: **Show my camera** (the mirrored self-view that one-way rounds already
  had), and a **Camera coach** checkbox.
- With the coach on, MediaPipe Face Landmarker runs in the browser (WebAssembly, served from Orbit's own site, never
  a CDN) about ten times a second, and keeps three numbers:
  - **Face in frame**: % of samples with a face found.
  - **Facing the camera**: % of those where the head was turned within 20° of the camera, left/right and up/down.
    This is head direction, not eye gaze.
  - **Head movement**: average head turning speed, degrees per second.
- The numbers are sent with the session every 20 s while measuring, and when it stops. The session page shows
  an **On camera** card with a trend of "facing the camera" over the last 6 sessions, plus a table view.
- **Never sent or stored:** video, frames, images, face landmarks or blendshapes. The API keeps only the five
  numeric fields and drops anything else posted alongside.
- **Never inferred:** confidence, emotion, engagement, honesty or employability. The copy says so.

## Fixes that came with it
- `Permissions-Policy` was `camera=()`, which blocked the camera on the live site. That broke the existing one-way
  self-view too. It's now `camera=(self)`.
- CSP `script-src` gains `'wasm-unsafe-eval'`, needed for WebAssembly. `'unsafe-eval'` is still not allowed.

## Files
- Web: `apps/web/src/lib/cameraCoach.ts` (pose maths, tally, loader) and `useCameraCoach.ts` (saving).
  `public/mediapipe/face_landmarker.task` is MediaPipe's float16 face model, Apache-2.0, 3.7 MB, SHA-256
  `64184e22…bc9ff`.
- `vite.config.ts` serves and copies the WASM from `@mediapipe/tasks-vision@1.0.1`, pinned.
- Shared UI: `SelfView` (in `MockPanel.tsx`) and `CameraCard` (in `Insights.tsx`).
- API: `sessions/camera.py`, the `sessions.camera_metrics` column (migration `a3c5e7f9b1d3`), and `camera` in the
  session detail.

## Tests
- `apps/api/tests/test_camera_coach.py`:
  - off by default;
  - stores the numbers and builds the trend;
  - range validation, and extra fields are dropped;
  - other users get a 404, and live sessions are refused.
- `apps/web/src/lib/cameraCoach.test.ts`: head pose from the matrix, and the tally's percentages, movement and pauses.
- `apps/web/src/lib/csp.test.ts`: `'wasm-unsafe-eval'` is present, `'unsafe-eval'` isn't, and there's no CDN.
- Playwright with a fake camera fed a public-domain test portrait:
  - The model loaded from Orbit's own server with no CDN requests.
  - Face in frame and facing the camera were both 100%.
  - The numbers were saved, and the card and trend showed on the session page.
  - With no face in the picture, the card says so instead of showing 0% facing.

## Not done / OWNER ACTION REQUIRED
- Speed: headless software rendering here managed about 3 samples a second. The brief's 20 fps target (the coach
  samples at 10 a second) needs checking on a real mid-range laptop and phone.
- Safari 17+ is untested here.
- Not in the desktop app: its CSP and WebView2 camera permission need their own pass.
- Try it on your own devices and lighting, then set `ORBIT_VIDEO_MOCK=true`.
