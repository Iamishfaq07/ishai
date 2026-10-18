import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { safeLocal } from "../storage";
import { speakable, speechChunks } from "./speechText";

/**
 * The mock interviewer's natural voice: neural text-to-speech from the API (Deepgram Aura behind it, a small choice of
 * voices). When it can't be used (not set up, today's allowance used, the provider down), the device's own voice reads
 * the question instead; when the browser won't play sound until a tap, the room asks for one (D76). The mock never
 * goes silent without saying why, and the question is always readable.
 */
export interface NaturalVoiceSource {
  /** Voice ids, the chosen one first; a panel gives each interviewer the next one. */
  voices: string[];
  speak: SpeakFn;
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

/** The browser won't play sound until the person taps or presses a key (autoplay policy): not a broken voice. */
export function isAutoplayBlocked(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "NotAllowedError" : (err as { name?: string } | null)?.name === "NotAllowedError";
}

/** A clip that should be playing but hasn't moved for this long is stuck: it's started again from where it was. */
export const STALL_MS = 1500;

/** One line's audio and the pace it was made at (1 when the provider didn't apply the pace asked for). */
export interface VoiceClip {
  blob: Blob;
  speed: number;
}

export interface PlayHooks {
  /** The clip is about to play in `audio`; returns how to follow a replacement element, and the detach. */
  onClip?: (audio: HTMLAudioElement, clip: VoiceClip) => { retarget?: (next: HTMLAudioElement) => void; detach?: () => void } | undefined;
  /** Its first sound is out. */
  onPlaying?: () => void;
  /**
   * The browser refused to play it until a tap (autoplay policy). `resume` plays it, and must be called from that tap
   * (a click or key handler). The clip waits for it (or for `signal`).
   */
  onBlocked?: (resume: () => void) => void;
  /** It stalled and was started again (or couldn't be): for the API's log. */
  onIssue?: (kind: "stalled", detail: string) => void;
  /** Playback rate, for a pace the provider didn't apply itself. */
  rate?: number;
}

/**
 * Plays one clip in its own new <audio> element, straight to the speakers (D76: nothing in its way that could silence
 * it). A fresh element every time: reusing one and loading a new source while it was still starting is what made
 * browsers throw "The play() request was interrupted by a new load request". Resolves when it ends or `signal` stops
 * it. A watchdog restarts it from where it was if it stalls (no progress for STALL_MS while it should be playing), and
 * gives up after a second stall. Autoplay refusals wait for a tap (onBlocked) instead of failing; anything else
 * rejects, and the caller falls back to the device's voice.
 */
export async function playClip(clip: VoiceClip, signal: AbortSignal, hooks: PlayHooks = {}): Promise<void> {
  if (signal.aborted) return;
  const url = URL.createObjectURL(clip.blob);
  const make = () => {
    const el = new Audio(url);
    el.preload = "auto";
    if (hooks.rate && hooks.rate !== 1) el.playbackRate = hooks.rate;
    return el;
  };
  let audio = make();
  const follow = hooks.onClip?.(audio, clip);
  let watch = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let started = false;
      let lastTime = -1;
      let lastMove = performance.now();
      let stalls = 0;
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearInterval(watch);
        if (err) reject(err);
        else resolve();
      };
      const onEnded = () => done();
      const onError = () => done(new Error("The voice couldn't play."));
      const onPlaying = () => {
        if (!started) hooks.onPlaying?.();
        started = true;
        lastMove = performance.now();
      };
      const listen = (el: HTMLAudioElement) => {
        el.addEventListener("ended", onEnded);
        el.addEventListener("error", onError);
        el.addEventListener("playing", onPlaying);
      };
      const unlisten = (el: HTMLAudioElement) => {
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
        el.removeEventListener("playing", onPlaying);
      };
      const play = () => {
        audio.play().then(
          () => onPlaying(),
          (err: unknown) => {
            if (signal.aborted || isAbort(err)) return done();
            if (isAutoplayBlocked(err) && hooks.onBlocked) {
              // Waits for a tap: resume() is called from it, where play() is allowed.
              hooks.onBlocked(() => {
                lastMove = performance.now();
                play();
              });
              return;
            }
            done(err);
          },
        );
      };
      signal.addEventListener("abort", () => {
        audio.pause();
        done();
      }, { once: true });
      listen(audio);
      play();
      watch = window.setInterval(() => {
        if (settled) return;
        const now = performance.now();
        if (!started || audio.paused || audio.ended || audio.currentTime !== lastTime) {
          lastTime = audio.currentTime;
          lastMove = now;
          return;
        }
        if (now - lastMove < STALL_MS) return;
        stalls += 1;
        hooks.onIssue?.("stalled", `at ${audio.currentTime.toFixed(1)}s of ${Number.isFinite(audio.duration) ? audio.duration.toFixed(1) : "?"}s`);
        if (stalls > 1) return done(new Error("The voice stalled."));
        // Start it again, from where it got to, in a new element (the old one is stuck).
        const at = audio.currentTime;
        unlisten(audio);
        audio.pause();
        audio = make();
        follow?.retarget?.(audio);
        listen(audio);
        const seek = () => {
          try {
            audio.currentTime = at;
          } catch {
            // not seekable yet: from the start, which is still better than silence
          }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener("loadedmetadata", seek, { once: true });
        lastMove = now;
        lastTime = -1;
        play();
      }, 250);
    });
  } finally {
    window.clearInterval(watch);
    audio.pause();
    follow?.detach?.();
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/**
 * Plays an MP3 response once it has all arrived (the voice settings' sample, older callers): playClip without the
 * extras.
 */
export async function playResponse(res: Response, signal: AbortSignal): Promise<void> {
  const blob = await res.blob();
  await playClip({ blob, speed: 1 }, signal);
}

/** Splits a line for speaking (speechChunks: the first sentence alone, then a sentence each). Kept for older callers. */
export function voiceChunks(text: string): string[] {
  return speechChunks(text);
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

export type SpeakFn = (text: string, voice: string, signal: AbortSignal, opts?: { speed?: number }) => Promise<Response>;

/** The speaking pace: slower, normal, brisk (Settings and the video interview's setup). */
export type VoicePace = "slower" | "normal" | "brisk";
export const PACE_KEY = "orbit.interviewerPace";
export const PACE_SPEED: Record<VoicePace, number> = { slower: 0.88, normal: 1, brisk: 1.12 };

/** The pace kept on this device (Settings, the video interview's setup). */
export function savedPace(): VoicePace {
  const p = safeLocal.getItem(PACE_KEY);
  return p === "slower" || p === "brisk" ? p : "normal";
}

/** Fetches a clip (from the cache for the lines worth keeping), as the speech shaped for the voice. */
async function fetchClip(speak: SpeakFn, text: string, voice: string, signal: AbortSignal, speed: number, keep: boolean): Promise<VoiceClip> {
  const said = speakable(text);
  const key = clipKey(voice, speed, said);
  const hit = keep ? await cachedClip(key) : null;
  if (hit) return hit;
  const res = await speak(said, voice, signal, speed !== 1 ? { speed } : undefined);
  const made = Number(res.headers?.get?.("X-Orbit-Speed") ?? "1");
  const clip = { blob: await res.blob(), speed: Number.isFinite(made) && made > 0 ? made : 1 };
  if (keep) void keepClip(key, clip);
  return clip;
}

export interface SpeakHooks {
  /** Each part of the line about to play: its element and clip, and where its text is in the line. */
  onClip?: (audio: HTMLAudioElement, clip: VoiceClip, part: { text: string; offset: number; index: number }) => ReturnType<NonNullable<PlayHooks["onClip"]>>;
  onPlaying?: () => void;
  onBlocked?: PlayHooks["onBlocked"];
  onIssue?: PlayHooks["onIssue"];
  /** The speaking pace asked for. */
  speed?: number;
  /** Keep this line's audio for next time (an acknowledgement, the same opening every time). */
  keep?: boolean;
  /** Awaited before the first piece plays (an acknowledgement still being said finishes first). */
  before?: () => Promise<void>;
}

/**
 * Says `text` in the natural voice, in growing pieces (D76): the first two are requested at once, the first plays as
 * soon as it arrives (it's short, so it starts sooner), and each later one is requested when the one before it starts
 * playing, so it's ready when that ends and isn't made at all for a line she's cut off on. Rejects with a
 * NaturalVoiceError naming what wasn't heard.
 */
export async function speakNatural(text: string, speak: SpeakFn, voice: string, signal: AbortSignal, hooks: SpeakHooks = {}): Promise<void> {
  const chunks = speechChunks(text);
  const speed = hooks.speed ?? 1;
  const requests: Array<Promise<VoiceClip> | undefined> = [];
  const request = (i: number) => {
    if (i >= chunks.length || requests[i] || signal.aborted) return;
    const r = fetchClip(speak, chunks[i]!, voice, signal, speed, Boolean(hooks.keep));
    r.catch(() => undefined); // awaited in order below; don't report a later one twice
    requests[i] = r;
  };
  request(0);
  request(1);
  let offset = 0;
  let first = true;
  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) return;
    const part = chunks[i]!;
    const at = text.indexOf(part, offset);
    const partOffset = at >= 0 ? at : offset;
    offset = partOffset + part.length;
    try {
      request(i);
      const clip = await requests[i]!;
      if (i === 0 && hooks.before) await hooks.before();
      if (signal.aborted) return;
      await playClip(clip, signal, {
        // A pace the provider didn't apply: the playback is paced instead (the pitch is kept).
        rate: clip.speed === speed ? 1 : speed / clip.speed,
        onClip: (audio, c) => hooks.onClip?.(audio, c, { text: part, offset: partOffset, index: i }),
        onPlaying: () => {
          request(i + 1);
          if (first) hooks.onPlaying?.();
          first = false;
        },
        ...(hooks.onBlocked ? { onBlocked: hooks.onBlocked } : {}),
        ...(hooks.onIssue ? { onIssue: hooks.onIssue } : {}),
      });
    } catch (err) {
      if (signal.aborted || isAbort(err)) return;
      throw new NaturalVoiceError(err, chunks.slice(i).join(" "));
    }
  }
}

// ---- clips worth keeping (D76): acknowledgements, an opening said the same way every time -------------------------

const CACHE_NAME = "orbit-voice-v1";
const MEMORY_MAX = 40;
const memory = new Map<string, VoiceClip>();

function clipKey(voice: string, speed: number, said: string): string {
  return `https://orbit.local/voice/${encodeURIComponent(voice)}/${speed}/${encodeURIComponent(said.slice(0, 300))}`;
}

async function cachedClip(key: string): Promise<VoiceClip | null> {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const store = typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
    const res = await store?.match(key);
    if (!res) return null;
    const clip = { blob: await res.blob(), speed: Number(res.headers.get("X-Orbit-Speed") ?? "1") || 1 };
    memory.set(key, clip);
    return clip;
  } catch {
    return null;
  }
}

async function keepClip(key: string, clip: VoiceClip): Promise<void> {
  memory.set(key, clip);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
  try {
    const store = typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
    await store?.put(key, new Response(clip.blob, { headers: { "Content-Type": "audio/mpeg", "X-Orbit-Speed": String(clip.speed) } }));
  } catch {
    // no cache storage here (private mode): memory only
  }
}

/** Short acknowledgements she can say while she thinks of her next line (one at a time, never the same twice). */
export const ACKS = ["Mm-hmm.", "Okay.", "Right.", "Got it.", "I see."] as const;

/**
 * Makes sure the acknowledgements are cached for `voice` (in the background, one at a time). True when they all
 * are; a miss is skipped (a real run's first one failed and none were ever said), and two give up until next time.
 */
export async function warmAcks(speak: SpeakFn, voice: string, speed: number): Promise<boolean> {
  const controller = new AbortController();
  let misses = 0;
  for (const ack of ACKS) {
    const said = speakable(ack);
    if (await cachedClip(clipKey(voice, speed, said))) continue;
    try {
      await fetchClip(speak, ack, voice, controller.signal, speed, true);
    } catch {
      misses += 1; // not now (the allowance, the network): they're optional
      if (misses >= 2) return false;
    }
  }
  return misses === 0;
}

/**
 * An acknowledgement to say at once: one already cached for `voice`, not `avoid` (the last one said). Never fetched
 * now: made on demand it came a second and a half later, on top of her reply.
 */
export async function cachedAck(voice: string, speed: number, avoid: string | null): Promise<{ text: string; clip: VoiceClip } | null> {
  const options = ACKS.filter((a) => a !== avoid);
  const start = Math.floor(Math.random() * options.length);
  for (let k = 0; k < options.length; k++) {
    const text = options[(start + k) % options.length]!;
    const clip = await cachedClip(clipKey(voice, speed, speakable(text)));
    if (clip) return { text, clip };
  }
  return null;
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
  speak: SpeakFn;
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
