/**
 * Typed wrappers around the Rust commands in src-tauri/src. Keep names and payloads in sync with
 * audio.rs / screen.rs / secrets.rs.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { AudioChannel } from "@orbit/types";

export interface NativeAudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface CaptureInfo {
  mic: boolean;
  system: boolean;
  /** Why system audio isn't running (e.g. macOS not yet supported), if requested. */
  systemError: string | null;
}

export type CaptureEvent =
  /** pcm = base64 PCM16LE mono 16 kHz; rms = 0..1 for meters. */
  | { kind: "frame"; channel: AudioChannel; pcm: string; rms: number }
  | { kind: "error"; channel: AudioChannel; message: string };

export interface NativeCapture {
  pngBase64: string;
  width: number;
  height: number;
}

export function listAudioDevices(): Promise<NativeAudioDevice[]> {
  return invoke<NativeAudioDevice[]>("list_audio_devices");
}

export function startCapture(
  options: { micDeviceId?: string; systemAudio: boolean },
  onEvent: (event: CaptureEvent) => void,
): Promise<CaptureInfo> {
  const channel = new Channel<CaptureEvent>();
  channel.onmessage = onEvent;
  return invoke<CaptureInfo>("start_capture", {
    micDeviceId: options.micDeviceId ?? null,
    systemAudio: options.systemAudio,
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
