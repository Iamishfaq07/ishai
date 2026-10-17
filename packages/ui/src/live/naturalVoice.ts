import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";

/**
 * The mock interviewer's natural voice: neural text-to-speech from the API (Deepgram Aura behind it, one voice). When it can't be used (not set up, today's allowance used, the provider down, autoplay refused), the
 * device's own voice reads the question instead: the mock never goes silent, and the question is always on screen.
 */
export interface NaturalVoiceSource {
  /** Voice ids, the chosen one first; a panel gives each interviewer the next one. */
  voices: string[];
  speak: (text: string, voice: string, signal: AbortSignal) => Promise<Response>;
  /** Still finding out whether the server has it: hold the first question for a moment rather than use the device's. */
  pending?: boolean;
}

const STATUS_WAIT_MS = 2500;

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

/** Stopped on purpose (the next question, Stop, barge-in): not a failure, so no fallback voice. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Plays an MP3 response once it has all arrived (an interviewer's question is a second or two of audio), in its own
 * new <audio> element. A fresh element every time: reusing one and loading a new source while it was still starting
 * is what made browsers throw "The play() request was interrupted by a new load request". Resolves when it ends or
 * `signal` stops it; rejects only when it can't play (the caller then uses the device's voice). `onAudio` sees the
 * element (and its audio) before it plays, so the video room can follow the voice; it returns what to undo after.
 */
export type OnVoiceAudio = (audio: HTMLAudioElement, blob: Blob) => (() => void) | undefined;

export async function playResponse(res: Response, signal: AbortSignal, onAudio?: OnVoiceAudio): Promise<void> {
  const blob = await res.blob();
  if (signal.aborted) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const detach = onAudio?.(audio, blob);
  const stop = () => audio.pause();
  signal.addEventListener("abort", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("The voice couldn't play.")), { once: true });
      signal.addEventListener("abort", () => resolve(), { once: true });
      audio.play().catch((err: unknown) => (signal.aborted || isAbort(err) ? resolve() : reject(err)));
    });
  } finally {
    signal.removeEventListener("abort", stop);
    audio.pause();
    detach?.();
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/**
 * Splits what the interviewer says so the first sentence can start playing while the rest is still being made: the
 * opening sentence on its own (with the next one if it's very short), then everything after it in one piece.
 */
export function voiceChunks(text: string): string[] {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return sentences.length ? sentences : [];
  let head = sentences.shift()!;
  while (head.length < 12 && sentences.length > 1) head += ` ${sentences.shift()!}`;
  return [head, sentences.join(" ")];
}

/** A natural voice that failed part-way: `rest` is what hadn't been heard yet (the device's voice says it). */
export class NaturalVoiceError extends Error {
  constructor(
    readonly reason: unknown,
    readonly rest: string,
  ) {
    super("The natural voice stopped.");
  }
}

/**
 * Says `text` in the natural voice, sentence-pipelined: every piece is requested at once, the first plays as soon as
 * it arrives, the next is usually ready when it ends. Rejects with a NaturalVoiceError naming what wasn't heard.
 */
export async function speakNatural(
  text: string,
  speak: (text: string, voice: string, signal: AbortSignal) => Promise<Response>,
  voice: string,
  signal: AbortSignal,
  onAudio?: OnVoiceAudio,
): Promise<void> {
  const chunks = voiceChunks(text);
  const requests = chunks.map((c) => speak(c, voice, signal));
  requests.forEach((r) => r.catch(() => undefined)); // awaited in order below; don't report a later one twice
  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) return;
    try {
      await playResponse(await requests[i]!, signal, onAudio);
    } catch (err) {
      if (signal.aborted || isAbort(err)) return;
      throw new NaturalVoiceError(err, chunks.slice(i).join(" "));
    }
  }
}

type VoiceStatus = { available: boolean; voices: VoiceOption[]; default_voice: string };
const STATUS_TTL_MS = 10 * 60_000;
let statusMemo: { api: object; at: number; status: Promise<VoiceStatus>; resolved?: VoiceStatus } | null = null;

/**
 * What the server offers, asked once per ten minutes and shared: the setup page asks ahead (warmVoiceStatus) so the
 * interviewer's first words don't wait on it.
 */
export function warmVoiceStatus(api: { voiceStatus: () => Promise<VoiceStatus> }): Promise<VoiceStatus> {
  const now = Date.now();
  if (statusMemo && statusMemo.api === api && now - statusMemo.at < STATUS_TTL_MS) return statusMemo.status;
  const status = api.voiceStatus();
  const memo: NonNullable<typeof statusMemo> = { api, at: now, status };
  statusMemo = memo;
  status.then(
    (s) => (memo.resolved = s),
    () => {
      if (statusMemo === memo) statusMemo = null;
    },
  );
  return status;
}

/** The answer already in hand (from warmVoiceStatus), if it is: then there's nothing to wait for. */
function knownStatus(api: object): VoiceStatus | undefined {
  if (!statusMemo || statusMemo.api !== api || Date.now() - statusMemo.at >= STATUS_TTL_MS) return undefined;
  return statusMemo.resolved;
}

/**
 * The natural voice for a live panel: asks the server what's offered once, applies the saved choice, and returns the
 * source to hand to LivePanel (null = the device's voice).
 */
export function useNaturalVoiceSource(api: {
  voiceStatus: () => Promise<{ available: boolean; voices: VoiceOption[]; default_voice: string }>;
  speak: (text: string, voice: string, signal: AbortSignal) => Promise<Response>;
} | null, choice: string | null, enabled = true): NaturalVoiceSource | null {
  // undefined: still asking the server (the first question waits for the answer, up to STATUS_WAIT_MS).
  const fromStatus = (s: VoiceStatus) => (s.available ? orderVoices(s.voices, choice, s.default_voice) : null);
  const [voices, setVoices] = useState<string[] | null | undefined>(() => {
    const known = api && enabled && choice !== DEVICE_VOICE ? knownStatus(api) : undefined;
    return known ? fromStatus(known) : undefined;
  });
  useEffect(() => {
    if (!api || !enabled || choice === DEVICE_VOICE) {
      setVoices(null);
      return;
    }
    const known = knownStatus(api);
    if (known) {
      setVoices(fromStatus(known));
      return;
    }
    let live = true;
    setVoices(undefined);
    const giveUp = window.setTimeout(() => live && setVoices((v) => (v === undefined ? null : v)), STATUS_WAIT_MS);
    warmVoiceStatus(api).then(
      (s) => live && setVoices(fromStatus(s)),
      () => live && setVoices(null),
    );
    return () => {
      live = false;
      window.clearTimeout(giveUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromStatus only reads `choice`
  }, [api, choice, enabled]);
  return useMemo(() => {
    if (!api || voices === null) return null;
    if (voices === undefined) return { voices: [], speak: api.speak, pending: true };
    return { voices, speak: api.speak };
  }, [api, voices]);
}
