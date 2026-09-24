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

/** An app with an audio session (Windows). `pid` is the root of its process tree. */
export interface AudioApp {
  pid: number;
  exe: string;
  name: string;
  active: boolean;
}

/** Apps currently able to play sound — the candidates for per-app interviewer capture. */
export function listAudioApps(): Promise<AudioApp[]> {
  return invoke<AudioApp[]>("list_audio_apps").catch(() => []);
}

export function startCapture(
  options: { micDeviceId?: string; systemAudio: boolean; systemProcessId?: number; systemDevice?: string },
  onEvent: (event: CaptureEvent) => void,
): Promise<CaptureInfo> {
  const channel = new Channel<CaptureEvent>();
  channel.onmessage = onEvent;
  return invoke<CaptureInfo>("start_capture", {
    micDeviceId: options.micDeviceId ?? null,
    systemAudio: options.systemAudio,
    systemProcessId: options.systemProcessId ?? null,
    systemDevice: options.systemDevice ?? null,
    onEvent: channel,
  });
}

export function stopCapture(): Promise<void> {
  return invoke<void>("stop_capture");
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
export type UpdateProgress = { kind: "downloading"; downloaded: number; total: number | null } | { kind: "installing" };

export function checkUpdate(apiUrl: string): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update", { apiUrl });
}

/** Downloads, verifies the signature, and hands off to the installer (which relaunches Orbit). */
export function installUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  return invoke<void>("install_update", { onEvent: channel });
}
