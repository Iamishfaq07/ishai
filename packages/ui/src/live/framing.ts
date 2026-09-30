import {
  PROTOCOL_VERSION,
  isServerEvent,
  type AudioChannel,
  type ClientEvent,
  type ClientEventMap,
  type ClientEventType,
  type ServerEvent,
} from "@orbit/types";
import { trimTrailingSlashes } from "../serverUrl";

/**
 * Binary audio frame: [1 byte channel][PCM16LE mono 16 kHz samples...].
 * Uses DataView so the byte order is little-endian regardless of platform.
 */
export function encodeAudioFrame(channel: AudioChannel, pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(1 + pcm.length * 2);
  const view = new DataView(buffer);
  view.setUint8(0, channel);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(1 + i * 2, pcm[i] ?? 0, true);
  }
  return buffer;
}

/** Wraps PCM16LE bytes that are already little-endian (e.g. from the desktop capture). */
export function encodeAudioBytes(channel: AudioChannel, pcmLE: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(1 + pcmLE.byteLength);
  out[0] = channel;
  out.set(pcmLE, 1);
  return out.buffer;
}

export function makeClientEvent<K extends ClientEventType>(
  type: K,
  data: ClientEventMap[K],
  now: number = Date.now(),
): ClientEvent {
  return { v: PROTOCOL_VERSION, type, ts: now, data } as ClientEvent;
}

/** Parses a JSON text frame. Returns null for malformed or unknown events (forward compatible). */
export function parseServerFrame(raw: string): ServerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return isServerEvent(value) ? value : null;
}

/** `live` is the owner's two-way socket; `view` is the phone companion's read-only mirror of it. */
export function toWebSocketUrl(
  apiBaseUrl: string,
  sessionId: string,
  ticket: string,
  path: "live" | "view" = "live",
): string {
  const base = trimTrailingSlashes(apiBaseUrl).replace(/^http/i, "ws");
  return `${base}/v1/sessions/${encodeURIComponent(sessionId)}/${path}?ticket=${encodeURIComponent(ticket)}`;
}
