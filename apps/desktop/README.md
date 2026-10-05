# @orbit/desktop

Tauri 2 desktop app for Orbit (Windows). It's a compact floating copilot window (380×520, expandable to 920×680).
Features:
- native microphone and interviewer-audio capture;
- a native region-screenshot overlay;
- a system tray;
- rebindable global shortcuts;
- signed auto-updates.

The live UI is `LivePanel` from `@orbit/ui`, shared with the web app.

## Prerequisites

- Node ≥ 20.11 + pnpm 9
- Rust stable (≥ 1.77.2): <https://rustup.rs>. On this machine cargo is in `%USERPROFILE%\.cargo\bin`.
- Windows: WebView2 (preinstalled on Windows 11) and the MSVC build tools. See
  <https://v2.tauri.app/start/prerequisites/>.

## Run

```bash
pnpm install
cp apps/desktop/.env.example apps/desktop/.env   # VITE_API_URL, VITE_WEB_URL
pnpm dev:desktop                                  # = pnpm --filter @orbit/desktop tauri dev
```

```bash
cd apps/desktop/src-tauri && cargo test && cargo clippy -- -D warnings
```

Releases go through `scripts/release-desktop.ps1`; see [docs/WINDOWS_RELEASE.md](../../docs/WINDOWS_RELEASE.md). Don't
run a bare `tauri build` for a release.

**Test builds** that must not touch your real sign-in: compile with `ORBIT_KEYRING_SERVICE=ai.orbit.desktop.test` and
run with `WEBVIEW2_USER_DATA_FOLDER` pointing at a temp folder. Clear both afterwards with
`Remove-Item Env:NAME`, because an empty-but-set value still takes effect.

## What's native (Rust, `src-tauri/src`)

| Command | What it does |
|---|---|
| `list_audio_devices` / `list_output_devices` | Microphones and output devices (WASAPI endpoint ids, with default / communications flags) |
| `list_audio_apps` | Apps with an audio session on any output device (the call often plays on the communications device), grouped by process tree, playing ones first (for "listen to one app") |
| `start_capture(captureId, micDeviceId?, systemAudio, systemProcessId?, systemProcessExe?, systemDevice?, onEvent)` | Mic → channel 0. Interviewer → channel 1, from one app (process loopback; the exe finds it again if it restarts) or an output device (`"default"`, `"communications"`, or an endpoint id). WASAPI mixes to mono and resamples to 16 kHz; sent as base64 PCM16LE frames every 50 ms over a Tauri `Channel`, which the webview forwards to the API socket. Async: opening devices never blocks the window |
| `stop_capture(captureId)` | Stops that capture's streams, and only that capture's (a late stop from the audio test can't end the live session's) |
| `open_region_selector` / `capture_region(x,y,w,h)` / `capture_screen` | Transparent always-on-top selector over the current monitor; one-shot capture with xcap, cropped and PNG-encoded |
| `save_token` / `load_token` / `clear_token` | Orbit session token in Windows Credential Manager (`access_token.ai.orbit.desktop`) |
| `check_update` / `install_update` | Signed update check against the API's manifest; install refuses while a live session is running |
| `quit_app` | Real quit (the close button can hide to the tray instead) |

**Audio capture** is native WASAPI (`wasapi_capture.rs`, `process_loopback.rs`) and supervised:
- **Unplugged device or changed default:** capture reopens and follows the new device, and fills the gap with
  silence so the transcript timeline stays continuous.
- **One app:** a failing stream (e.g. the audio service restarted) is re-activated, and if the app quits, capture
  follows it when it starts again (same exe, new process). Windows doesn't report a dead target itself (process
  loopback on a dead PID just delivers silence), so Orbit watches the app's process.
- **Status:** the UI gets `status` events for each change.

No audio is written to disk. Provider API keys (DeepSeek, Deepgram) never reach the desktop app: audio goes to the
Orbit API, which relays it to STT server-side.

macOS and Linux builds are deferred (Windows-first). The Rust code keeps cpal fallbacks, but they aren't shipped or
tested.

## Window behaviour

- Compact ⇄ expanded from the title bar. Position and size persist (`tauri-plugin-window-state`), including
  multi-monitor.
- The pin button toggles always-on-top (on by default), and the transparency button adjusts window opacity and blur.
  Text always stays fully visible.
- The window is frameless; drag it by the title bar. Close (×, or Alt+F4) asks whether to hide to the tray or quit,
  and can remember the choice. A remembered "quit" still asks during a live session.
- There's intentionally **no** content protection, capture exclusion, or "undetectable" mode.

## Shortcuts

In-window shortcuts (`@orbit/ui` `HotkeyMap`, desktop uses the defaults):

| Action | Default |
|---|---|
| Answer (in mock interviews: next question) | Ctrl + Enter |
| Screenshot region | Ctrl + Shift + S |
| Pause / resume listening | Ctrl + L |
| Focus chat | Ctrl + K |
| Clear | Ctrl + Shift + C |

System-wide shortcuts work while another app is focused. They're rebindable in **Settings → Global shortcuts**, and
deliberately avoid combos other apps rely on (Ctrl+Enter, Ctrl+Shift+S, Teams' Ctrl+Shift+M…):

| Action | Default |
|---|---|
| Show / hide Orbit | Ctrl + Shift + O |
| Answer | Ctrl + Shift + Enter |
| Screenshot region | Ctrl + Shift + 2 |
| Previous / next answer | Ctrl + Alt + ← / → |
| Copy answer | Ctrl + Shift + Y |
| Pause / resume | Ctrl + Alt + P |
| More / less transparent | Ctrl + Alt + ↓ / ↑ |

## Before a session

Setup shows a **Checklist** (preflight). Local checks cover the microphone, interviewer audio, resume, job
description and network. The server checks (`GET /v1/preflight`) cover the Orbit server, AI, transcription, vision,
minutes left, screenshot credits and the app version.

Problems come with a one-line fix.

- **Blockers disable Start ("Fix N problems to start"):** Orbit server, network, AI, transcription, microphone,
  minutes left and email verification. These are the checks without which a live interview can't work.
  **Start without these checks** remains as a confirmed escape hatch, in case a check itself is wrong.
- **Warnings never block:** resume, JD, vision, screenshot credits, app version, interviewer audio switched off.
- **Transcription** is checked twice: the Deepgram account, and then a real streaming handshake (no audio sent).
  The result says "Streaming transcription verified", not just that the account answered. **Test audio** shows live meters for both channels. Windows microphone access
must be on: Settings → Privacy & security → Microphone → "Let desktop apps access your microphone". Loopback capture
needs no extra permission.

## Auto-update

`tauri-plugin-updater` with minisign-signed manifests served by the API (`/v1/desktop/update/...`, from GitHub
Releases). Setup shows **Update & restart** when a new version is available; updates never install mid-session. See
[docs/WINDOWS_RELEASE.md](../../docs/WINDOWS_RELEASE.md) for signing keys, publishing, and what install, upgrade
and uninstall do to user data.
