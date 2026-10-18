/**
 * Reading a voice off audio, for the video room's visualizer and meters: how loud it is (0..1) and where its energy
 * sits across the speech range (bands, low to high). Pure functions over buffers, so the same mapping serves the mic's
 * analyser, Saba's analysed voice and decoded audio, and the tests.
 */

/** The speech range the bands cover: a voice's fundamental up to its brightest consonants. */
export const VOICE_LOW_HZ = 140;
export const VOICE_HIGH_HZ = 4800;
/** The decibel window a band's energy is read in: quieter is nothing, louder is full. */
const MIN_DB = -82;
const MAX_DB = -22;

/** Root mean square of a time-domain buffer (-1..1). */
export function rms(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  const end = Math.min(to, samples.length);
  for (let i = from; i < end; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return end > from ? Math.sqrt(sum / (end - from)) : 0;
}

/**
 * A level for the screen from a voice's RMS: speech close to a mic, or a TTS clip, sits around 0.05-0.25 RMS. A soft
 * knee (a 0.7 power above the gate) so quiet syllables still show and loud ones don't all pin at the top.
 */
export function voiceLevel(value: number, gate = 0.006, full = 0.2): number {
  if (value <= gate) return 0;
  return Math.min(1, Math.pow((value - gate) / (full - gate), 0.7));
}

/** `n` band edges (n + 1 frequencies), log-spaced over the speech range. */
export function bandEdges(n: number, low = VOICE_LOW_HZ, high = VOICE_HIGH_HZ): number[] {
  const edges: number[] = [];
  for (let i = 0; i <= n; i++) edges.push(low * Math.pow(high / low, i / n));
  return edges;
}

/**
 * Which FFT bins make each band, for an analyser's frequency data (`binCount` bins up to Nyquist). Every band gets at
 * least one bin, so a coarse FFT (the mic's is 256 points) repeats bins at the low end rather than leaving gaps.
 */
export function bandBins(n: number, sampleRate: number, binCount: number): Array<[number, number]> {
  const hzPerBin = sampleRate / 2 / binCount;
  return bandEdges(n).slice(0, n).map((lowHz, i) => {
    const highHz = bandEdges(n)[i + 1]!;
    const from = Math.max(1, Math.min(binCount - 1, Math.floor(lowHz / hzPerBin)));
    const to = Math.max(from + 1, Math.min(binCount, Math.round(highHz / hzPerBin)));
    return [from, to];
  });
}

/** A band's energy in decibels (from an analyser's byte data, 0..255 over its decibel range) to 0..1. */
export function dbToUnit(db: number): number {
  return Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

/**
 * Fills `bands` from an analyser's byte frequency data (getByteFrequencyData) read over its own decibel range, re-read
 * in the bands' window. A band is mostly its loudest bin (a voice's harmonics are sparse: averaging a wide high band
 * would bury them) with some of its average. Returns the loudest band.
 */
export function bandsFromBytes(
  bytes: ArrayLike<number>,
  bins: Array<[number, number]>,
  bands: Float32Array,
  range: { minDecibels: number; maxDecibels: number },
): number {
  let peak = 0;
  const span = range.maxDecibels - range.minDecibels;
  for (let b = 0; b < bands.length; b++) {
    const [from, to] = bins[b] ?? [0, 0];
    let sum = 0;
    let top = 0;
    for (let i = from; i < to; i++) {
      const v = bytes[i] ?? 0;
      sum += v;
      if (v > top) top = v;
    }
    const byte = to > from ? 0.65 * top + 0.35 * (sum / (to - from)) : 0;
    const db = byte <= 0 ? -Infinity : range.minDecibels + (byte / 255) * span;
    const v = dbToUnit(db);
    bands[b] = v;
    if (v > peak) peak = v;
  }
  return peak;
}

/** Reads an analyser into bands and a level each frame, reusing its buffers. */
export class AnalyserReader {
  private bytes = new Uint8Array(0);
  private wave = new Float32Array(0);
  private bins: Array<[number, number]> = [];
  private key = "";

  read(a: AnalyserNode, bands: Float32Array): number {
    const key = `${a.frequencyBinCount}:${bands.length}:${a.context.sampleRate}`;
    if (key !== this.key) {
      this.key = key;
      this.bytes = new Uint8Array(a.frequencyBinCount);
      this.bins = bandBins(bands.length, a.context.sampleRate, a.frequencyBinCount);
    }
    if (this.wave.length !== a.fftSize) this.wave = new Float32Array(a.fftSize);
    a.getByteFrequencyData(this.bytes);
    a.getFloatTimeDomainData(this.wave);
    bandsFromBytes(this.bytes, this.bins, bands, a);
    return voiceLevel(rms(this.wave));
  }
}

const FFT_SIZE = 1024;
const fft = { re: new Float32Array(FFT_SIZE), im: new Float32Array(FFT_SIZE), bytes: new Uint8Array(FFT_SIZE / 2) };
const HANN = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

/** In-place radix-2 FFT of fft.re/fft.im (FFT_SIZE points). */
function transform(): void {
  const { re, im } = fft;
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

const SAMPLE_RANGE = { minDecibels: -100, maxDecibels: -20 };

/**
 * Fills `bands` from raw samples (decoded audio) around `at` (seconds): the same Hann-windowed FFT an analyser takes,
 * read into the bands the same way, for audio that plays without one. Returns the slice's RMS.
 */
export function bandsFromSamples(samples: Float32Array, sampleRate: number, at: number, bands: Float32Array): number {
  const centre = Math.round(at * sampleRate);
  const from = Math.max(0, centre - FFT_SIZE / 2);
  const to = Math.min(samples.length, from + FFT_SIZE);
  if (to - from < 64) {
    bands.fill(0);
    return 0;
  }
  for (let i = 0; i < FFT_SIZE; i++) {
    fft.re[i] = from + i < to ? samples[from + i]! * HANN[i]! : 0;
    fft.im[i] = 0;
  }
  transform();
  // Each bin as the analyser's byte would read it (|X| / N in decibels over its range), then the bands from those.
  const span = SAMPLE_RANGE.maxDecibels - SAMPLE_RANGE.minDecibels;
  for (let k = 0; k < FFT_SIZE / 2; k++) {
    const magnitude = Math.hypot(fft.re[k]!, fft.im[k]!) / FFT_SIZE;
    const db = 20 * Math.log10(magnitude + 1e-12);
    fft.bytes[k] = Math.max(0, Math.min(255, Math.round(((db - SAMPLE_RANGE.minDecibels) / span) * 255)));
  }
  bandsFromBytes(fft.bytes, bandBins(bands.length, sampleRate, FFT_SIZE / 2), bands, SAMPLE_RANGE);
  return rms(samples, from, to);
}

/**
 * One step of a voice-like follower: rises fast (attack) and falls slower (release), so the bars read as speech, not
 * noise. Time constants in ms; `dt` is the frame's length in ms.
 */
export function follow(current: number, target: number, dt: number, attackMs: number, releaseMs: number): number {
  const tau = target > current ? attackMs : releaseMs;
  const k = 1 - Math.exp(-dt / Math.max(1, tau));
  return current + (target - current) * k;
}

/**
 * Is someone talking into the mic? An adaptive floor (it follows quiet down at once and noise up slowly), a margin
 * over it, and hysteresis: on after a short stretch of voice, off only after a pause, so the state doesn't flicker
 * between words.
 */
export interface TalkState {
  floor: number;
  /** Since when (ms) the level has disagreed with `talking`: loud while not talking, quiet while talking. */
  since: number | null;
  talking: boolean;
}

export const TALK_ON_MS = 180;
export const TALK_OFF_MS = 900;
const TALK_MARGIN = 0.03; // RMS over the floor that counts as a voice
const TALK_MIN = 0.02; // never "talking" below this, however quiet the room

export function talkStep(state: TalkState, level: number, now: number, dt: number): TalkState {
  // The floor: down to a quieter level at once, up towards louder ones over ~2 s in a quiet room and ~8 s while
  // someone talks (the pauses between their words keep it low), so a fan or a hum stops counting as a voice.
  const tau = state.talking ? 8000 : 2000;
  const floor = level < state.floor ? level : state.floor + (level - state.floor) * (1 - Math.exp(-dt / tau));
  const loud = level > Math.max(TALK_MIN, floor + TALK_MARGIN);
  if (loud === state.talking) return { floor, since: null, talking: state.talking };
  const since = state.since ?? now;
  if (now - since >= (state.talking ? TALK_OFF_MS : TALK_ON_MS)) return { floor, since: null, talking: !state.talking };
  return { floor, since, talking: state.talking };
}

export const TALK_START: TalkState = { floor: 0.01, since: null, talking: false };
