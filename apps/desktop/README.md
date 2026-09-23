# @orbit/desktop

Tauri 2 desktop app for Orbit: a compact floating copilot window (≈380×520) with native
microphone + system-audio capture, a native region-screenshot overlay, a system tray, and
global shortcuts. The UI is `LivePanel` from `@orbit/ui`, shared with the web app.

## Prerequisites

- Node ≥ 20.11 + pnpm 9
- Rust stable (≥ 1.77.2) — <https://rustup.rs>
- Platform deps: <https://v2.tauri.app/start/prerequisites/>
  - Windows: WebView2 (preinstalled on Windows 11) and the MSVC build tools
  - macOS: Xcode command-line tools

## Run

```bash
pnpm install
cp apps/desktop/.env.example apps/desktop/.env   # VITE_API_URL, VITE_WEB_URL
pnpm dev:desktop                                  # = pnpm --filter @orbit/desktop tauri dev
```

```bash
cd apps/desktop/src-tauri && cargo test           # resampler / PCM / crop unit tests
pnpm --filter @orbit/desktop tauri build          # installers in src-tauri/target/release/bundle
```

The icons in `src-tauri/icons/` are generated placeholders. Replace them with the real logo using
`pnpm --filter @orbit/desktop tauri icon path/to/logo.png`.

## What's native (Rust, `src-tauri/src`)

| Command | What it does |
|---|---|
| `list_audio_devices` | Input devices via cpal (the device name is the id) |
| `start_capture(micDeviceId?, systemAudio, onEvent)` | Opens the mic (channel 0) and, if requested, system audio (channel 1). Each is mixed down to mono, resampled to 16 kHz, and streamed as base64 PCM16LE frames every 50 ms over a Tauri `Channel`. The webview forwards the bytes to the API socket |
| `stop_capture` | Stops and drops both streams |
| `open_region_selector` | Opens a transparent, always-on-top window over the current monitor |
| `capture_region(x,y,w,h)` / `capture_screen` | One-shot capture with xcap, cropped and PNG-encoded |
| `save_token` / `load_token` / `clear_token` | Orbit session token in the OS credential store (keyring) |

**System audio**

- **Windows:** WASAPI loopback. cpal opens an input stream on the default output device, so Orbit
  hears whatever your speakers or headset play, kept separate from your mic.
- **macOS:** not implemented yet. It needs ScreenCaptureKit (macOS 12.3+). `start_capture` returns
  `systemError: "macOS system audio requires ScreenCaptureKit — not implemented yet."` and the
  session continues with the mic only. The UI says this; it's never faked.
- **Linux:** not supported yet (a PulseAudio/PipeWire monitor source would be the route).

No audio is written to disk. Provider API keys (DeepSeek, Deepgram) never reach the desktop app.
Audio goes to the Orbit API, which relays it to STT server-side.

## Window behaviour

- Compact (380×520) ⇄ expanded (920×680) from the ⤢ button. Position and size persist via
  `tauri-plugin-window-state`, and multi-monitor positions are restored.
- 📌 toggles always-on-top (on by default).
- The window is frameless. Drag it by the header. × hides to the tray, and **Quit** lives in the tray menu.
- There's intentionally **no** content-protection, capture-exclusion, or "undetectable" mode.

## Shortcuts

In-window (a configurable `HotkeyMap` from `@orbit/ui`, stored in `localStorage["orbit.hotkeys"]`. The web app has a Settings editor; the desktop settings UI isn't built yet, so desktop uses the defaults):

| Action | Default |
|---|---|
| Answer | Ctrl/⌘ + Enter |
| Screenshot region | Ctrl/⌘ + Shift + S |
| Pause / resume listening | Ctrl/⌘ + L |
| Focus chat | Ctrl/⌘ + K |
| Clear | Ctrl/⌘ + Shift + C |

System-wide (work while another app is focused). These are deliberately different so Orbit never
steals Ctrl+Enter or Ctrl+Shift+S (Save As) from other apps:

| Action | Default |
|---|---|
| Answer | Ctrl/⌘ + Shift + Enter |
| Screenshot region | Ctrl/⌘ + Shift + 2 |
| Show / hide Orbit | Ctrl/⌘ + Shift + O |

## Permission onboarding

- **macOS microphone:** the first capture triggers the system prompt using
  `NSMicrophoneUsageDescription` (`src-tauri/Info.plist`). If it's denied, the live screen shows
  *Audio capture failed* with **Retry**. The user must re-enable Orbit in System Settings → Privacy &
  Security → Microphone.
- **macOS screenshots:** the first capture triggers **Screen Recording** permission. macOS requires
  an app restart after granting it.
- **Windows microphone:** Settings → Privacy & security → Microphone → “Let desktop apps access your
  microphone” must be on. WASAPI loopback needs no extra permission.
- Setup has a **Test audio** button with live mic/system meters, so problems show up before the call.

## Auto-update (architecture)

Not wired yet. The intended path is `tauri-plugin-updater` with signed update manifests served by
the API/CDN, a check on launch plus every few hours, and install on the next restart. Updates never
install mid-session.
