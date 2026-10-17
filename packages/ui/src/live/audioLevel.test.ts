import { describe, expect, it } from "vitest";
import { TALK_OFF_MS, TALK_ON_MS, TALK_START, bandBins, bandEdges, bandsFromSamples, follow, rms, talkStep, voiceLevel, type TalkState } from "./audioLevel";

const RATE = 24000;
function tone(hz: number, seconds: number, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

describe("levels", () => {
  it("measures RMS, and maps a voice's RMS to a level that gates silence and doesn't pin speech at the top", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(tone(200, 0.1, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(voiceLevel(0.003)).toBe(0); // room noise
    const quiet = voiceLevel(0.03);
    const normal = voiceLevel(0.1);
    expect(quiet).toBeGreaterThan(0.2); // a quiet syllable still shows
    expect(normal).toBeGreaterThan(quiet);
    expect(normal).toBeLessThan(1);
    expect(voiceLevel(0.9)).toBe(1);
  });

  it("rises fast and falls slower, like a voice", () => {
    const up = follow(0, 1, 16, 34, 150);
    const down = 1 - follow(1, 0, 16, 34, 150);
    expect(up).toBeGreaterThan(down * 2);
    expect(follow(0.5, 0.5, 16, 34, 150)).toBe(0.5);
  });
});

describe("bands", () => {
  it("spaces the bands over the speech range on a log scale", () => {
    const edges = bandEdges(4);
    expect(edges).toHaveLength(5);
    expect(edges[0]).toBeCloseTo(140);
    expect(edges[4]).toBeCloseTo(4800);
    expect(edges[2]! / edges[1]!).toBeCloseTo(edges[1]! / edges[0]!);
  });

  it("gives every band at least one FFT bin, in order, even for the mic's coarse 256-point FFT", () => {
    for (const binCount of [128, 512]) {
      const bins = bandBins(20, 48000, binCount);
      expect(bins).toHaveLength(20);
      for (const [from, to] of bins) {
        expect(from).toBeGreaterThanOrEqual(1);
        expect(to).toBeGreaterThan(from);
        expect(to).toBeLessThanOrEqual(binCount);
      }
      for (let i = 1; i < bins.length; i++) expect(bins[i]![0]).toBeGreaterThanOrEqual(bins[i - 1]![0]);
    }
  });

  it("reads decoded audio like an analyser: a low voice fills the low bands, a high sound the high ones", () => {
    const bands = new Float32Array(12);
    const lowRms = bandsFromSamples(tone(150, 0.5), RATE, 0.25, bands);
    const low = [...bands];
    expect(lowRms).toBeGreaterThan(0.15);
    expect(low[0]!).toBeGreaterThan(low[11]! + 0.3);
    bandsFromSamples(tone(4000, 0.5), RATE, 0.25, bands);
    expect(bands[11]!).toBeGreaterThan(bands[0]! + 0.3);
    expect(bandsFromSamples(new Float32Array(RATE), RATE, 0.5, bands)).toBe(0);
    expect(Math.max(...bands)).toBe(0);
    // Past the end of the clip: nothing.
    expect(bandsFromSamples(tone(150, 0.5), RATE, 3, bands)).toBe(0);
  });
});

describe("is the candidate talking?", () => {
  const run = (state: TalkState, level: number, from: number, ms: number) => {
    let s = state;
    for (let t = from; t < from + ms; t += 33) s = talkStep(s, level, t, 33);
    return s;
  };

  it("turns on after a short stretch of voice, stays on through the pauses between words, and off after a real pause", () => {
    let s = run(TALK_START, 0.004, 0, 1000);
    expect(s.talking).toBe(false);
    s = run(s, 0.1, 1000, TALK_ON_MS / 2);
    expect(s.talking).toBe(false); // a click or a cough isn't talking
    s = run(s, 0.1, 1100, TALK_ON_MS + 40);
    expect(s.talking).toBe(true);
    s = run(s, 0.004, 1400, 400); // between two words
    expect(s.talking).toBe(true);
    s = run(s, 0.1, 1800, 300);
    s = run(s, 0.004, 2100, TALK_OFF_MS + 100);
    expect(s.talking).toBe(false);
  });

  it("stops counting a steady hum as a voice within a few seconds", () => {
    const s = run(TALK_START, 0.05, 0, 4000);
    expect(s.talking).toBe(false);
    expect(s.floor).toBeGreaterThan(0.02);
    // ...and a voice over the hum still counts.
    expect(run(s, 0.15, 4000, 400).talking).toBe(true);
  });
});
