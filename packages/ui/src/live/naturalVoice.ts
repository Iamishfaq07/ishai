import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";

/**
 * The mock interviewer's natural voice: neural text-to-speech streamed from the API (Deepgram Aura behind it), played
 * as it arrives. When it can't be used (not set up, today's allowance used, the provider down, autoplay refused), the
 * device's own voice reads the question instead: the mock never goes silent, and the question is always on screen.
 */
export interface NaturalVoiceSource {
  /** Voice ids, the chosen one first; a panel gives each interviewer the next one. */
  voices: string[];
  speak: (text: string, voice: string, signal: AbortSignal) => Promise<Response>;
}

export interface VoiceOption {
  id: string;
  label: string;
}

/** What Settings stores: "device" (the platform's voices), or a natural voice id. */
export const VOICE_CHOICE_KEY = "orbit.interviewerVoice";
export const DEVICE_VOICE = "device";

/** The panelist's voice: the n-th, round the list. */
export function voiceForSpeaker(voices: string[], n: number): string | undefined {
  return voices.length ? voices[n % voices.length] : undefined;
}

/** After this failure, stop asking for the natural voice for the rest of the session (it won't come back soon). */
export function naturalVoiceGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || err.status === 503 || err.status === 401 || err.status === 403);
}

/** The chosen voice first, then the others; null when it's off or not offered. */
export function orderVoices(options: VoiceOption[], choice: string | null, fallback: string): string[] | null {
  if (choice === DEVICE_VOICE || !options.length) return null;
  const ids = options.map((o) => o.id);
  const first = choice && ids.includes(choice) ? choice : ids.includes(fallback) ? fallback : ids[0]!;
  return [first, ...ids.filter((id) => id !== first)];
}

function untilEnded(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Playback failed"));
    };
    const cleanup = () => {
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", fail);
      signal.removeEventListener("abort", done);
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", fail);
    signal.addEventListener("abort", done);
  });
}

/**
 * Plays an MP3 response in `audio`, starting with the first chunk where MediaSource takes MP3 (Chrome, Edge,
 * Firefox, Safari on macOS), or once it's all in elsewhere. Resolves when it ends or `signal` stops it; rejects when it
 * can't play (the caller then uses the device's voice).
 */
export async function playResponse(res: Response, audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  const streaming = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && res.body;
  let url = "";
  try {
    if (streaming && res.body) {
      const source = new MediaSource();
      url = URL.createObjectURL(source);
      audio.src = url;
      await new Promise<void>((resolve) => source.addEventListener("sourceopen", () => resolve(), { once: true }));
      const buffer = source.addSourceBuffer("audio/mpeg");
      const reader = res.body.getReader();
      const append = (chunk: Uint8Array) =>
        new Promise<void>((resolve, reject) => {
          buffer.addEventListener("updateend", () => resolve(), { once: true });
          buffer.addEventListener("error", () => reject(new Error("Couldn't decode the voice")), { once: true });
          buffer.appendBuffer(chunk as BufferSource);
        });
      let started = false;
      for (;;) {
        if (signal.aborted) {
          void reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        await append(value);
        if (!started) {
          started = true;
          await audio.play(); // throws when autoplay is refused: the caller falls back
        }
      }
      if (source.readyState === "open") source.endOfStream();
      if (!started) return;
    } else {
      const blob = await res.blob();
      if (signal.aborted) return;
      url = URL.createObjectURL(blob);
      audio.src = url;
      await audio.play();
    }
    await untilEnded(audio, signal);
  } finally {
    audio.pause();
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * The natural voice for a live panel: asks the server what's offered once, applies the saved choice, and returns the
 * source to hand to LivePanel (null = the device's voice).
 */
export function useNaturalVoiceSource(api: {
  voiceStatus: () => Promise<{ available: boolean; voices: VoiceOption[]; default_voice: string }>;
  speak: (text: string, voice: string, signal: AbortSignal) => Promise<Response>;
} | null, choice: string | null, enabled = true): NaturalVoiceSource | null {
  const [voices, setVoices] = useState<string[] | null>(null);
  useEffect(() => {
    if (!api || !enabled || choice === DEVICE_VOICE) {
      setVoices(null);
      return;
    }
    let live = true;
    api.voiceStatus().then(
      (s) => live && setVoices(s.available ? orderVoices(s.voices, choice, s.default_voice) : null),
      () => live && setVoices(null),
    );
    return () => {
      live = false;
    };
  }, [api, choice, enabled]);
  return useMemo(() => (api && voices ? { voices, speak: api.speak } : null), [api, voices]);
}
