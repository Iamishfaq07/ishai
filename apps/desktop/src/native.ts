/**
 * Typed wrappers around the Rust commands in src-tauri/src. Keep names and payloads in sync with
 * audio.rs / screen.rs / secrets.rs.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { AudioChannel } from "@orbit/types";

export interface NativeAudioDevice {
  /** Windows: stable endpoint id (survives renames; tells identical devices apart). */
  id: string;
  name: string;
  isDefault: boolean;
  /** The default *communications* device (Teams/Zoom calls often play here). */
  isCommunications: boolean;
}

/** Device lifecycle while capturing (Windows): Orbit reopens lost devices by itself. */
export type DeviceState = "active" | "fallback" | "lost" | "restored" | "switched";

export interface CaptureInfo {
  mic: boolean;
  system: boolean;
  /** Why the mic isn't running (e.g. in use by another app), if requested. */
  micError: string | null;
  /** Why system audio isn't running (e.g. macOS not yet supported), if requested. */
  systemError: string | null;
}

export type CaptureEvent =
  /** pcm = base64 PCM16LE mono 16 kHz; rms = 0..1 for meters. */
  | { kind: "frame"; channel: AudioChannel; pcm: string; rms: number }
  | { kind: "error"; channel: AudioChannel; message: string }
  | { kind: "status"; channel: AudioChannel; state: DeviceState; device: string };

export interface NativeCapture {
  pngBase64: string;
  width: number;
  height: number;
}

export function listAudioDevices(): Promise<NativeAudioDevice[]> {
  return invoke<NativeAudioDevice[]>("list_audio_devices");
}

/** Output devices whose sound can be captured (Windows). */
export function listOutputDevices(): Promise<NativeAudioDevice[]> {
  return invoke<NativeAudioDevice[]>("list_output_devices").catch(() => []);
}

/** A short, human line for a device status event (null = nothing worth showing). */
export function deviceStatusText(ev: { channel: AudioChannel; state: DeviceState; device: string }): string | null {
  const what = ev.channel === 0 ? "Microphone" : "Interviewer audio";
  switch (ev.state) {
    case "lost":
      return `${what} disconnected${ev.device ? ` (${ev.device})` : ""} — reconnecting…`;
    case "restored":
      return `${what} reconnected.`;
    case "switched":
      return `${what} switched to ${ev.device}.`;
    case "fallback":
      return `Your chosen ${ev.channel === 0 ? "microphone" : "output"} isn't connected — using ${ev.device}.`;
    default:
      return null;
  }
}

/**
 * An audio error as a person reads it: what's wrong and what to do, without Windows error codes ("Access is denied.
 * (0x80070005)"). The raw text goes to the console, and the audio test's "Copy diagnostics" keeps it.
 */
export function friendlyAudioError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.warn("Audio:", raw);
  if (/restarting to finish an update/i.test(raw)) return "Orbit is restarting to finish an update. It's back in a moment.";
  const what = /^(system audio|app audio|interviewer)/i.test(raw) ? "the meeting audio" : "the microphone";
  if (/0x80070005|access is denied/i.test(raw)) {
    return what === "the microphone"
      ? "Windows is blocking the microphone. Turn on Windows Settings → Privacy & security → Microphone → “Let desktop apps access your microphone”, then click Retry."
      : "Windows refused access to the meeting audio. Click Retry, or pick “Default output” under Listen to.";
  }
  if (/no device|0x80070490|0x88890004|not found/i.test(raw)) {
    return `Couldn't find ${what === "the microphone" ? "that microphone" : "that audio device"}. Check it's plugged in or pick another one, then click Retry.`;
  }
  if (/0x8889000a|in use|exclusive/i.test(raw)) {
    return `Another app is holding ${what} for itself. Close that app (or turn off its exclusive mode), then click Retry.`;
  }
  if (/list audio (devices|apps)/i.test(raw)) return "Couldn't read your audio devices. Click Retry, or restart Orbit.";
  if (/app audio.*isn't running/i.test(raw)) {
    return "That app isn't running. Open it, then click Retry, or pick “Default output” under Listen to.";
  }
  if (/app audio/i.test(raw)) return "Couldn't listen to that app. Pick “Default output” under Listen to, or restart the meeting app.";
  return `Couldn't start ${what}. Check it's connected, then click Retry.`;
}

/** An app with an audio session (Windows). `pid` is the root of its process tree. */
export interface AudioApp {
  pid: number;
  exe: string;
  name: string;
  active: boolean;
}

/** Apps holding an audio session on any output device — the candidates for per-app interviewer capture. */
export function listAudioApps(): Promise<AudioApp[]> {
  return invoke<AudioApp[]>("list_audio_apps").catch(() => []);
}

export interface CaptureOptions {
  /** From `newCaptureId()`: `stopCapture(id)` then stops this capture and never one started after it. */
  captureId: number;
  micDeviceId?: string;
  systemAudio: boolean;
  /** Capture only this app's process tree. */
  systemProcessId?: number;
  /** That app's exe: finds it again if it restarted (a new PID). */
  systemProcessExe?: string;
  /** Output to capture when no app is chosen: "default" | "communications" | endpoint id. */
  systemDevice?: string;
}

// Random per page load, so ids from before a reload (whose capture may still be running) never repeat.
let captureSeq = Math.floor(Math.random() * 1e9) * 1000;
export function newCaptureId(): number {
  captureSeq += 1;
  return captureSeq;
}

export function startCapture(options: CaptureOptions, onEvent: (event: CaptureEvent) => void): Promise<CaptureInfo> {
  const channel = new Channel<CaptureEvent>();
  channel.onmessage = onEvent;
  return invoke<CaptureInfo>("start_capture", {
    captureId: options.captureId,
    micDeviceId: options.micDeviceId ?? null,
    systemAudio: options.systemAudio,
    systemProcessId: options.systemProcessId ?? null,
    systemProcessExe: options.systemProcessExe ?? null,
    systemDevice: options.systemDevice ?? null,
    onEvent: channel,
  });
}

export function stopCapture(captureId: number): Promise<void> {
  return invoke<void>("stop_capture", { captureId });
}

export function openRegionSelector(): Promise<void> {
  return invoke<void>("open_region_selector");
}

/** Captures the monitor the main window is on. */
export function captureScreen(): Promise<NativeCapture> {
  return invoke<NativeCapture>("capture_screen");
}

/** Rect in logical (CSS) pixels relative to the overlay window's monitor. */
export function captureRegion(rect: { x: number; y: number; width: number; height: number }): Promise<NativeCapture> {
  return invoke<NativeCapture>("capture_region", rect);
}

export interface ScrollCapture extends NativeCapture {
  /** Screens joined; 1 = the area didn't scroll. */
  screens: number;
  /** end = the bottom · limit = the length/size limit · mouse = the mouse moved · lost = the screens stopped lining up */
  stop: "end" | "limit" | "mouse" | "lost";
}

/** Same rect as captureRegion: captures it while scrolling it to the bottom (the mouse wheel over it), joined into
 *  one tall image, then scrolls it back. The overlay must be hidden first, or the wheel scrolls the overlay. */
export function captureScrolling(rect: { x: number; y: number; width: number; height: number }): Promise<ScrollCapture> {
  return invoke<ScrollCapture>("capture_scrolling", rect);
}

// Access token lives in the OS credential store (Keychain / Windows Credential Manager).
export function saveToken(token: string): Promise<void> {
  return invoke<void>("save_token", { token });
}
export function loadToken(): Promise<string | null> {
  return invoke<string | null>("load_token");
}
export function clearToken(): Promise<void> {
  return invoke<void>("clear_token");
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const REGION_CAPTURED_EVENT = "region-captured";
export interface RegionCapturedPayload {
  pngBase64: string;
}

// ── Auto-update (src-tauri/src/updater.rs) ──────────────────────────────────
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}
export type UpdateProgress = { kind: "downloading"; downloaded: number; total: number | null } | { kind: "verifying" };

export function checkUpdate(apiUrl: string): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update", { apiUrl });
}

/** Downloads the update and verifies its signature. Nothing is installed yet. */
export function downloadUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  return invoke<void>("download_update", { onEvent: channel });
}

/** Hands the downloaded update to the installer, which closes Orbit and relaunches it. Refused while capturing. */
export function installUpdate(): Promise<void> {
  return invoke<void>("install_update");
}
