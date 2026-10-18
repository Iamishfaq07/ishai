import { AnalyserReader, bandsFromSamples, rms, voiceLevel } from "./audioLevel";
import { speakable, syllableCount, wordTimeline, type TimedWord } from "./speechText";

/**
 * Saba's voice as the screen follows it, outside React: how loud it is now, where its energy sits (bands, low to high),
 * which word she's saying, and how much of her line has been said (DECISIONS D69, D76). The video room's visualizer
 * reads it every frame; its captions and transcript reveal her line as she says it.
 *
 * Where it comes from:
 * - **The natural voice** is real audio, an MP3 in an <audio> element that plays straight to the speakers: nothing in
 *   between that could silence it (Web Audio routing went silent whenever its context was suspended, D76). Its own
 *   decoded samples, read at the element's current time, give the level ("decoded"); until they're decoded, a
 *   speech-like envelope ("estimate"). The words are timed across the clip by their syllables (Aura gives no word
 *   timestamps), so the caption keeps pace with her.
 * - **The device's voice** (speechSynthesis) can't be captured. Its word-boundary events drive the envelope and the
 *   caption ("words"); an engine that sends none gets an estimated pace ("estimate").
 */
export type VoiceSource = "audio" | "decoded" | "words" | "estimate";

export interface WordSpan {
  /** Offsets into the line's text: the word being said is text.slice(start, end). */
  start: number;
  end: number;
}

/** How much of the line `id` has been said: text.slice(0, upTo). `done` once all of it was (or it was stopped). */
export interface LineReveal {
  id: string;
  upTo: number;
  done: boolean;
}

export interface VoiceActivity {
  /** What drives the level now; null while she's silent. */
  source(): VoiceSource | null;
  /** Fills `bands` (0..1 each, low to high) for `now` (performance.now()) and returns the overall level, 0..1. */
  sample(bands: Float32Array, now: number): number;
  /** The word being said, when its timing is known; null otherwise. */
  word(): WordSpan | null;
  /** How much of the current line has been said (captions reveal it as she speaks); null with no line. */
  reveal(): LineReveal | null;
  /** Called when word() or reveal() changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Gets the decoder ready ahead of the first clip. */
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
  return Math.min(6, syllableCount(word));
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

// One decoder for every clip: an OfflineAudioContext decodes without opening an audio device, without a tap, and
// plays nothing (so it can never be the reason she's silent).
let decoder: BaseAudioContext | null = null;
function voiceDecoder(): BaseAudioContext | null {
  if (decoder) return decoder;
  if (typeof window === "undefined") return null;
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  try {
    decoder = Offline ? new Offline(1, 1, 24000) : null;
  } catch {
    decoder = null;
  }
  return decoder;
}

/** Where speech starts and ends in decoded samples (seconds): the first and last 10 ms over a quiet threshold. */
export function speechBounds(samples: Float32Array, rate: number): { from: number; to: number } {
  const step = Math.max(1, Math.round(rate / 100));
  let first = -1;
  let last = -1;
  for (let i = 0; i + step <= samples.length; i += step) {
    if (rms(samples, i, i + step) > 0.015) {
      if (first < 0) first = i;
      last = i + step;
    }
  }
  return first < 0 ? { from: 0, to: samples.length / rate } : { from: first / rate, to: last / rate };
}

/** The clip's level for volume matching: clips that come out louder are brought down to the others (never up). */
const TARGET_RMS = 0.11;
export function clipVolume(samples: Float32Array, from: number, to: number, rate: number): number {
  const level = rms(samples, Math.round(from * rate), Math.round(to * rate));
  return level > 0 ? Math.max(0.55, Math.min(1, TARGET_RMS / level)) : 1;
}

/** The word containing (or just after) `pos` in `text`: [start, end). */
function wordAt(text: string, pos: number): WordSpan | null {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let last: WordSpan | null = null;
  while ((m = re.exec(text))) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (span.end > pos) return span;
    last = span;
  }
  return last;
}

/** A natural-voice clip of the line: its element, where its text starts in the line, and its words' timing. */
interface Clip {
  audio: HTMLAudioElement;
  offset: number;
  text: string;
  samples: Float32Array | null;
  rate: number;
  timeline: TimedWord[];
  volume: number;
}

/**
 * Saba's voice activity, fed by useInterviewerVoice: beginLine() when she's about to say a line, attach() for each of
 * its natural-voice clips, deviceStart/boundary/deviceEnd for the device's voice, endLine() when it's all been said,
 * stop() when she stops. One per interviewer voice; dispose() on unmount.
 */
export class VoiceTap implements VoiceActivity {
  private mode: VoiceSource | null = null;
  private clip: Clip | null = null;
  private readonly envelope = new SpeechEnvelope();
  private span: WordSpan | null = null;
  private line: { id: string; text: string; upTo: number; done: boolean } | null = null;
  private spoken = ""; // what the device's voice is saying (the line, shaped for speech)
  private utterance: object | null = null;
  private deviceAt = 0;
  private deviceOffset = 0;
  private estimate: { timeline: TimedWord[]; start: number } | null = null;
  private timer = 0;
  private readonly listeners = new Set<() => void>();
  private readonly scratch = new Float32Array(16);

  source(): VoiceSource | null {
    return this.mode;
  }

  word(): WordSpan | null {
    return this.span;
  }

  reveal(): LineReveal | null {
    return this.line ? { id: this.line.id, upTo: this.line.upTo, done: this.line.done } : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  private setWord(span: WordSpan | null): void {
    let changed = false;
    if (span?.start !== this.span?.start || span?.end !== this.span?.end) {
      this.span = span;
      changed = true;
    }
    if (span && this.line && span.end > this.line.upTo) {
      this.line.upTo = span.end;
      changed = true;
    }
    if (changed) this.notify();
  }

  prepare(): void {
    voiceDecoder();
  }

  /** She's about to say a line (the text appears only as she says it). */
  beginLine(id: string, text: string): void {
    this.stopTimer();
    this.line = { id, text, upTo: 0, done: false };
    this.span = null;
    this.mode = null;
    this.clip = null;
    this.estimate = null;
    this.envelope.clear();
    this.notify();
  }

  /** All of the line is said, or there's no voice to say it with: all of it is shown. */
  endLine(): void {
    this.stopTimer();
    if (this.line && !this.line.done) {
      this.line.upTo = this.line.text.length;
      this.line.done = true;
    }
    this.span = null;
    this.mode = null;
    this.clip = null;
    this.estimate = null;
    this.notify();
  }

  private startTimer(): void {
    if (this.timer || typeof window === "undefined") return;
    this.timer = window.setInterval(() => this.follow(), 40);
  }

  private stopTimer(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** Keeps the word and the reveal in step with the clip (or the estimate) while she speaks. */
  private follow(): void {
    const clip = this.clip;
    if (clip) {
      if (clip.audio.paused || clip.audio.ended || !clip.timeline.length) return;
      const t = clip.audio.currentTime;
      let i = 0;
      while (i + 1 < clip.timeline.length && clip.timeline[i + 1]!.at <= t) i++;
      const w = clip.timeline[i]!;
      if (t >= w.at - 0.02) this.setWord({ start: clip.offset + w.start, end: clip.offset + w.end });
      return;
    }
    if (this.estimate && this.line) {
      const elapsed = (performance.now() - this.estimate.start) / 1000;
      let i = -1;
      while (i + 1 < this.estimate.timeline.length && this.estimate.timeline[i + 1]!.at <= elapsed) i++;
      if (i >= 0) {
        const w = this.estimate.timeline[i]!;
        this.setWord({ start: w.start, end: w.end });
      }
    }
  }

  /**
   * A natural-voice clip of the line starts: `text` is its part of the line, from `offset`. Reads its samples (for
   * the level, the words' timing and its volume) without being in its way. Returns how to follow a replacement
   * element (the stall recovery) and the detach.
   */
  attach(audio: HTMLAudioElement, blob: Blob | null, part?: { text: string; offset: number }): {
    retarget: (next: HTMLAudioElement) => void;
    detach: () => void;
  } {
    this.utterance = null;
    this.estimate = null;
    this.envelope.clear();
    const text = part?.text ?? this.line?.text ?? "";
    const clip: Clip = { audio, offset: part?.offset ?? 0, text, samples: null, rate: 24000, timeline: [], volume: 1 };
    this.clip = clip;
    this.mode = "estimate";
    const time = (from: number, to: number) => {
      clip.timeline = wordTimeline(text, from, to);
    };
    const onMeta = () => {
      if (!clip.samples && Number.isFinite(clip.audio.duration)) time(0.04, Math.max(0.2, clip.audio.duration - 0.12));
    };
    audio.addEventListener("loadedmetadata", onMeta);
    onMeta();
    const ctx = voiceDecoder();
    if (blob && ctx) {
      void blob
        .arrayBuffer()
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          if (this.clip !== clip) return;
          clip.samples = decoded.getChannelData(0);
          clip.rate = decoded.sampleRate;
          const { from, to } = speechBounds(clip.samples, clip.rate);
          time(from, to);
          clip.volume = clipVolume(clip.samples, from, to, clip.rate);
          clip.audio.volume = clip.volume;
          this.mode = "decoded";
        })
        .catch(() => undefined);
    }
    this.startTimer();
    return {
      retarget: (next) => {
        clip.audio.removeEventListener("loadedmetadata", onMeta);
        clip.audio = next;
        next.volume = clip.volume;
      },
      detach: () => {
        clip.audio.removeEventListener("loadedmetadata", onMeta);
        if (this.clip === clip) {
          this.clip = null;
          this.mode = null;
          this.stopTimer();
          // This part of the line is said.
          if (this.line) this.setWord({ start: clip.offset, end: Math.min(this.line.text.length, clip.offset + text.length) });
        }
      },
    };
  }

  /**
   * The device's voice started saying the line from `offset` (all of it, or the part the natural voice didn't get
   * to): `spoken` is that part shaped for speech, which is what its boundaries index. `rate` is its speaking rate, for
   * the estimate when the engine sends no word boundaries.
   */
  deviceStart(utterance: object, spoken: string, rate = 1, offset = 0): void {
    this.clip = null;
    this.utterance = utterance;
    this.spoken = spoken;
    this.deviceOffset = Math.max(0, offset);
    this.deviceAt = performance.now();
    this.envelope.clear();
    if (this.mode !== "words") this.mode = "estimate";
    // No boundary in the first moments: an estimated pace for the caption (replaced as soon as one arrives).
    const line = this.line;
    if (line) {
      const rest = line.text.slice(this.deviceOffset);
      const syll = (rest.match(/\S+/g) ?? []).reduce((n, w) => n + syllableCount(speakable(w)), 0);
      const seconds = (syll * SYLLABLE_MS) / 1000 / Math.max(0.5, rate) + 0.4;
      const timeline = wordTimeline(rest, 0.15, seconds).map((w) => ({ ...w, start: w.start + this.deviceOffset, end: w.end + this.deviceOffset }));
      this.estimate = { timeline, start: this.deviceAt };
    }
    this.startTimer();
  }

  /** A word boundary from the device's voice (charIndex/charLength into what it's saying). */
  boundary(utterance: object, charIndex: number, charLength: number, now = performance.now()): void {
    if (utterance !== this.utterance) return;
    let end = charIndex + charLength;
    if (!charLength) {
      const rest = this.spoken.slice(charIndex).search(/\s/);
      end = rest < 0 ? this.spoken.length : charIndex + rest;
    }
    const word = this.spoken.slice(charIndex, end);
    if (!word.trim()) return;
    this.mode = "words";
    this.estimate = null; // real timing now
    this.envelope.word(now, word);
    const line = this.line;
    if (!line) return;
    // The spoken text is (the rest of) the line shaped for speech: the same place, proportionally, snapped to the
    // line's word.
    const span = line.text.length - this.deviceOffset;
    const pos = this.deviceOffset + (this.spoken.length ? Math.round((charIndex / this.spoken.length) * span) : 0);
    this.setWord(wordAt(line.text, pos));
  }

  deviceEnd(utterance: object): void {
    if (utterance !== this.utterance) return;
    this.utterance = null;
    this.mode = null;
    this.estimate = null;
    this.stopTimer();
    this.span = null;
    this.notify();
  }

  /** She stopped (Skip, the next question, mute, talked over, unmount): what's left of the line is shown. */
  stop(): void {
    this.utterance = null;
    this.endLine();
  }

  /** Her output level now (for telling her own echo from the candidate's voice). */
  level(now = performance.now()): number {
    return this.sample(this.scratch, now);
  }

  sample(bands: Float32Array, now: number): number {
    const mode = this.mode;
    if (!mode) {
      bands.fill(0);
      return 0;
    }
    const clip = this.clip;
    if (clip && (clip.audio.paused || clip.audio.ended)) {
      bands.fill(0);
      return 0;
    }
    if (mode === "decoded" && clip?.samples) {
      return voiceLevel(bandsFromSamples(clip.samples, clip.rate, clip.audio.currentTime, bands));
    }
    // The envelope: from word events, or on its own while the clip decodes / the voice speaks without them.
    if (mode === "estimate") this.envelope.auto(now);
    const level = this.envelope.level(now);
    envelopeBands(level, now, bands);
    return level;
  }

  dispose(): void {
    this.stop();
    this.line = null;
    this.listeners.clear();
  }
}

/** Any analyser as a voice (the component gallery's fake voice, tests): always "audio", no word timing. */
export function analyserActivity(analyser: AnalyserNode): VoiceActivity {
  const reader = new AnalyserReader();
  return {
    source: () => "audio",
    sample: (bands) => reader.read(analyser, bands),
    word: () => null,
    reveal: () => null,
    subscribe: () => () => undefined,
  };
}
