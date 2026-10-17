import { AnalyserReader, bandsFromSamples, voiceLevel } from "./audioLevel";

/**
 * Saba's voice as the screen follows it, outside React: how loud it is now, where its energy sits (bands, low to high),
 * and which word she's saying when the speech engine reports word timing. The video room's visualizer reads it every
 * frame; its captions subscribe to the word.
 *
 * Where the level comes from:
 * - **The natural voice** is real audio (an MP3 in an <audio> element). Where Web Audio is running it plays through
 *   one shared AudioContext with an analyser in the way ("audio"). Where it isn't (no tap yet, or an iPhone, where
 *   Web Audio follows the ringer switch), the clip plays as before and its decoded samples are read at the element's
 *   current time ("decoded"), so the bars still follow the real voice.
 * - **The device's voice** (speechSynthesis) can't be captured. Its word-boundary events drive a speech-like envelope,
 *   each word a burst of syllables at a speaking pace with a little jitter, so it visibly talks in time with the
 *   words ("words"). An engine that sends no boundaries gets the same envelope on its own ("estimate").
 */
export type VoiceSource = "audio" | "decoded" | "words" | "estimate";

export interface WordSpan {
  /** Offsets into the question's text: the word being said is text.slice(start, end). */
  start: number;
  end: number;
}

export interface VoiceActivity {
  /** What drives the level now; null while she's silent. */
  source(): VoiceSource | null;
  /** Fills `bands` (0..1 each, low to high) for `now` (performance.now()) and returns the overall level, 0..1. */
  sample(bands: Float32Array, now: number): number;
  /** The word being said, when the engine reports word timing; null otherwise. */
  word(): WordSpan | null;
  /** Called when word() changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Gets the audio ready ahead of the first clip, so the first tap anywhere can unlock it (mobile Safari). */
  prepare?(): void;
}

/** A small seeded random generator (mulberry32): the envelope's jitter is the same every run (and in tests). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly how many syllables a word has: its vowel groups (English-ish; enough for a voice's rhythm). */
export function syllables(word: string): number {
  const latin = word.toLowerCase().replace(/[^a-z]/g, "");
  // Another script (Hindi in Devanagari): about one syllable per two or three letters.
  if (!latin) return Math.max(1, Math.min(6, Math.round([...word.replace(/[\s\p{P}]/gu, "")].length / 2.5)));
  const n = latin.match(/[aeiouy]+/g)?.length ?? 0;
  const silentE = n > 1 && /[^aeiouy]e$/.test(latin) ? 1 : 0;
  return Math.max(1, Math.min(6, n - silentE || 1));
}

/** A syllable at a conversational pace (~5 a second), and the gap a sentence's end leaves. */
export const SYLLABLE_MS = 190;
const SENTENCE_GAP_MS = 320;

/**
 * A speech-like loudness envelope: each syllable a soft bump (raised cosine), louder on a word's first syllable, with
 * seeded jitter in size and length. Words come from boundary events (`word`), or, with `auto`, it makes its own at a
 * speaking pace with pauses where sentences would end.
 */
export class SpeechEnvelope {
  private bumps: Array<{ at: number; dur: number; amp: number }> = [];
  private nextAuto = 0;
  private autoWords = 0;
  private readonly random: () => number;

  constructor(seed = 7) {
    this.random = seeded(seed);
  }

  /** A word starts at `now`: schedules its syllables. */
  word(now: number, text: string): void {
    const n = syllables(text);
    let at = now;
    // Drop what's left of the previous word: the next boundary is when it really ended.
    this.bumps = this.bumps.filter((b) => b.at + b.dur > now && b.at < now);
    for (let i = 0; i < n; i++) {
      const dur = SYLLABLE_MS * (0.75 + this.random() * 0.5);
      const amp = (i === 0 ? 0.92 : 0.7) * (0.75 + this.random() * 0.25);
      this.bumps.push({ at, dur, amp });
      at += dur * 0.92;
    }
    if (this.bumps.length > 48) this.bumps.splice(0, this.bumps.length - 48);
  }

  /** Makes words on its own from `now` (no boundary events). */
  auto(now: number): void {
    if (now < this.nextAuto) return;
    if (this.nextAuto === 0 || now - this.nextAuto > 1000) this.nextAuto = now;
    const n = 1 + Math.floor(this.random() * 3);
    this.word(this.nextAuto, "a".repeat(n * 3).replace(/a{3}/g, "ba"));
    this.autoWords += 1;
    const pause = this.autoWords % (6 + Math.floor(this.random() * 5)) === 0 ? SENTENCE_GAP_MS : 40 + this.random() * 90;
    this.nextAuto += n * SYLLABLE_MS * 0.92 + pause;
  }

  /** The envelope at `now`, 0..1. */
  level(now: number): number {
    let v = 0;
    for (const b of this.bumps) {
      const t = (now - b.at) / b.dur;
      if (t <= 0 || t >= 1) continue;
      v = Math.max(v, b.amp * 0.5 * (1 - Math.cos(2 * Math.PI * t)));
    }
    return v;
  }

  clear(): void {
    this.bumps = [];
    this.nextAuto = 0;
    this.autoWords = 0;
  }
}

/**
 * A voice's spectrum drawn from its envelope alone (no audio to read): most energy low, falling off towards the
 * highs, each band wavering on its own a little, so the bars look like a voice rather than a block.
 */
export function envelopeBands(level: number, now: number, bands: Float32Array): void {
  const n = bands.length;
  for (let k = 0; k < n; k++) {
    const shape = Math.exp((-1.6 * k) / Math.max(1, n - 1)) * (k < n * 0.2 ? 0.92 + (k / (n * 0.2)) * 0.08 : 1);
    const waver = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.013 + k * 1.9) * Math.sin(now * 0.0071 + k * 0.7));
    bands[k] = Math.min(1, level * shape * waver * 1.05);
  }
}

// One AudioContext for every voice clip, made on first use and closed when the last voice lets go. Mobile Safari (and
// a page nobody has touched yet) starts it suspended: the first tap or key press anywhere resumes it.
let shared: { ctx: AudioContext; users: number; unlock: () => void } | null = null;
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

function audioContextClass(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function acquireVoiceContext(): AudioContext | null {
  const Ctx = audioContextClass();
  if (!Ctx) return null;
  if (!shared || shared.ctx.state === "closed") {
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    const unlock = () => {
      if (ctx.state === "running" || ctx.state === "closed") {
        UNLOCK_EVENTS.forEach((e) => document.removeEventListener(e, unlock, true));
        return;
      }
      void ctx.resume().catch(() => undefined);
    };
    UNLOCK_EVENTS.forEach((e) => document.addEventListener(e, unlock, true));
    shared = { ctx, users: 0, unlock };
  }
  shared.users += 1;
  return shared.ctx;
}

export function releaseVoiceContext(ctx: AudioContext | null): void {
  if (!ctx || !shared || shared.ctx !== ctx) return;
  shared.users -= 1;
  if (shared.users > 0) return;
  const { unlock } = shared;
  UNLOCK_EVENTS.forEach((e) => document.removeEventListener(e, unlock, true));
  shared = null;
  if (ctx.state !== "closed") void ctx.close().catch(() => undefined);
}

/** iPhone and iPad (iPadOS says it's a Mac with touch). */
function appleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * May an <audio> element play through Web Audio here without any risk of going silent? Only while the context runs (a
 * suspended one would mute it), and not on iPhone or iPad, where Web Audio follows the ringer switch and the mic's
 * audio session: there the clip plays as before and its decoded samples are read instead.
 */
function canRoute(ctx: AudioContext): boolean {
  return ctx.state === "running" && !appleTouch();
}

const BANDS_FFT = 1024;

/**
 * Saba's voice activity, fed by useInterviewerVoice: attach() for each natural-voice clip, deviceStart/boundary/
 * deviceEnd for the device's voice, stop() when she stops. One per interviewer voice; dispose() on unmount.
 */
export class VoiceTap implements VoiceActivity {
  private mode: VoiceSource | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly reader = new AnalyserReader();
  private clip: { audio: HTMLAudioElement; samples: Float32Array | null; rate: number } | null = null;
  private readonly envelope = new SpeechEnvelope();
  private span: WordSpan | null = null;
  private text = "";
  private offset = 0;
  private utterance: object | null = null;
  private readonly listeners = new Set<() => void>();

  source(): VoiceSource | null {
    return this.mode;
  }

  word(): WordSpan | null {
    return this.span;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setWord(span: WordSpan | null): void {
    if (span?.start === this.span?.start && span?.end === this.span?.end) return;
    this.span = span;
    this.listeners.forEach((l) => l());
  }

  /** Ask for the shared context: from the video room as it opens, so the first tap anywhere can unlock it. */
  prepare(): void {
    this.ctx ??= acquireVoiceContext();
  }

  /**
   * A natural-voice clip is about to play: analyse it. `blob` is its audio, for decoding when it can't go through
   * the analyser. Returns the detach to call when it ends.
   */
  attach(audio: HTMLAudioElement, blob?: Blob): () => void {
    this.setWord(null);
    this.utterance = null;
    this.envelope.clear();
    // Only once a screen that follows the voice asked for it (prepare: the video room). Elsewhere the clip plays
    // exactly as before, with no audio graph.
    const ctx = this.ctx;
    let source: MediaElementAudioSourceNode | null = null;
    if (ctx && canRoute(ctx)) {
      try {
        if (!this.analyser) {
          this.analyser = ctx.createAnalyser();
          this.analyser.fftSize = BANDS_FFT;
          this.analyser.smoothingTimeConstant = 0.5;
          this.analyser.minDecibels = -95;
          this.analyser.maxDecibels = -20;
          this.analyser.connect(ctx.destination);
        }
        source = ctx.createMediaElementSource(audio);
        source.connect(this.analyser);
      } catch {
        source = null;
      }
    } else if (ctx?.state === "suspended") {
      void ctx.resume().catch(() => undefined); // for the next clip
    }
    const clip = { audio, samples: null as Float32Array | null, rate: 48000 };
    this.clip = clip;
    this.mode = source ? "audio" : "estimate";
    if (!source && blob && ctx) {
      // Read the clip's own samples instead: decoding needs no gesture and plays nothing.
      void blob
        .arrayBuffer()
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          if (this.clip !== clip) return;
          clip.samples = decoded.getChannelData(0);
          clip.rate = decoded.sampleRate;
          this.mode = "decoded";
        })
        .catch(() => undefined);
    }
    return () => {
      if (source) {
        try {
          source.disconnect();
        } catch {
          // already gone
        }
      }
      if (this.clip === clip) {
        this.clip = null;
        this.mode = null;
      }
    };
  }

  /** The device's voice started saying `text`, which begins at `offset` in the question. */
  deviceStart(utterance: object, text: string, offset: number): void {
    this.clip = null;
    this.utterance = utterance;
    this.text = text;
    this.offset = offset;
    this.envelope.clear();
    if (this.mode !== "words") this.mode = "estimate";
  }

  /** A word boundary from the device's voice (charIndex/charLength into its text). */
  boundary(utterance: object, charIndex: number, charLength: number, now = performance.now()): void {
    if (utterance !== this.utterance) return;
    let end = charIndex + charLength;
    if (!charLength) {
      const rest = this.text.slice(charIndex).search(/\s/);
      end = rest < 0 ? this.text.length : charIndex + rest;
    }
    const word = this.text.slice(charIndex, end);
    if (!word.trim()) return;
    this.mode = "words";
    this.envelope.word(now, word);
    this.setWord(this.offset >= 0 ? { start: this.offset + charIndex, end: this.offset + end } : null);
  }

  deviceEnd(utterance: object): void {
    if (utterance !== this.utterance) return;
    this.utterance = null;
    this.mode = null;
    this.setWord(null);
  }

  /** She stopped (Skip, the next question, mute, unmount). */
  stop(): void {
    this.utterance = null;
    this.clip = null;
    this.mode = null;
    this.envelope.clear();
    this.setWord(null);
  }

  sample(bands: Float32Array, now: number): number {
    const mode = this.mode;
    if (!mode) {
      bands.fill(0);
      return 0;
    }
    if (mode === "audio" && this.analyser) return this.reader.read(this.analyser, bands);
    if (mode === "decoded" && this.clip?.samples) {
      const { audio, samples, rate } = this.clip;
      if (audio.paused || audio.ended) {
        bands.fill(0);
        return 0;
      }
      return voiceLevel(bandsFromSamples(samples, rate, audio.currentTime, bands));
    }
    // The envelope: from word events, or on its own while the clip plays / the voice speaks without them.
    if (mode === "estimate") {
      if (this.clip && (this.clip.audio.paused || this.clip.audio.ended)) {
        bands.fill(0);
        return 0;
      }
      this.envelope.auto(now);
    }
    const level = this.envelope.level(now);
    envelopeBands(level, now, bands);
    return level;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    try {
      this.analyser?.disconnect();
    } catch {
      // already gone
    }
    this.analyser = null;
    releaseVoiceContext(this.ctx);
    this.ctx = null;
  }
}

/** Any analyser as a voice (the component gallery's fake voice, tests): always "audio", no word timing. */
export function analyserActivity(analyser: AnalyserNode): VoiceActivity {
  const reader = new AnalyserReader();
  return {
    source: () => "audio",
    sample: (bands) => reader.read(analyser, bands),
    word: () => null,
    subscribe: () => () => undefined,
  };
}
