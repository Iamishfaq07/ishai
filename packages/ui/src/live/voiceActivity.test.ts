import { describe, expect, it } from "vitest";
import { SpeechEnvelope, VoiceTap, envelopeBands, seeded, syllables } from "./voiceActivity";

describe("a speech-like envelope", () => {
  it("counts syllables well enough for a voice's rhythm", () => {
    expect(syllables("the")).toBe(1);
    expect(syllables("make")).toBe(1);
    expect(syllables("interview")).toBe(3);
    expect(syllables("decision,")).toBe(3);
    expect(syllables("बताइए")).toBeGreaterThanOrEqual(1);
    expect(syllables("internationalisation")).toBe(6); // capped
  });

  it("bumps for each syllable of a word, then goes quiet", () => {
    const env = new SpeechEnvelope(1);
    env.word(0, "decision");
    const samples = Array.from({ length: 70 }, (_, i) => env.level(i * 10));
    expect(Math.max(...samples)).toBeGreaterThan(0.5);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    // Dips between syllables: a voice, not a block.
    const peaks = samples.filter((v, i) => i > 0 && i < samples.length - 1 && v > samples[i - 1]! && v >= samples[i + 1]!);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(env.level(2000)).toBe(0);
  });

  it("speaks on its own without word events, with pauses, the same way every run", () => {
    const a = new SpeechEnvelope(3);
    const b = new SpeechEnvelope(3);
    const levels: number[] = [];
    for (let t = 1; t < 4000; t += 16) {
      a.auto(t);
      b.auto(t);
      levels.push(a.level(t));
      expect(b.level(t)).toBe(a.level(t));
    }
    expect(Math.max(...levels)).toBeGreaterThan(0.6);
    expect(levels.filter((v) => v < 0.05).length).toBeGreaterThan(levels.length * 0.1);
  });

  it("draws a voice's spectrum from the envelope: most energy low, nothing in silence", () => {
    const bands = new Float32Array(20);
    envelopeBands(0.8, 1234, bands);
    const low = bands.slice(0, 5).reduce((s, v) => s + v, 0);
    const high = bands.slice(15).reduce((s, v) => s + v, 0);
    expect(low).toBeGreaterThan(high * 1.5);
    envelopeBands(0, 1234, bands);
    expect(Math.max(...bands)).toBe(0);
  });

  it("seeds its jitter", () => {
    expect(seeded(5)()).toBe(seeded(5)());
    expect(seeded(5)()).not.toBe(seeded(6)());
  });
});

describe("Saba's voice from the device's word timing", () => {
  const text = "Tell me about a time you disagreed.";

  it("follows the word being said, in the question's offsets, and talks while words arrive", () => {
    const tap = new VoiceTap();
    const u = {};
    let changes = 0;
    tap.subscribe(() => changes++);
    tap.deviceStart(u, text, 10);
    expect(tap.source()).toBe("estimate");
    expect(tap.word()).toBeNull();
    tap.boundary(u, 5, 2, 1000);
    expect(tap.source()).toBe("words");
    expect(tap.word()).toEqual({ start: 15, end: 17 });
    expect(changes).toBe(1);
    const bands = new Float32Array(10);
    expect(tap.sample(bands, 1080)).toBeGreaterThan(0.3);
    expect(Math.max(...bands)).toBeGreaterThan(0.2);
    expect(tap.sample(bands, 4000)).toBe(0); // no more words: quiet
    // An engine that sends no length: up to the next space.
    tap.boundary(u, 8, 0, 1200);
    expect(tap.word()).toEqual({ start: 18, end: 23 });
    // A stale utterance (cancelled) doesn't move it.
    tap.boundary({}, 0, 4, 1300);
    expect(tap.word()).toEqual({ start: 18, end: 23 });
    tap.deviceEnd(u);
    expect(tap.source()).toBeNull();
    expect(tap.word()).toBeNull();
    expect(tap.sample(bands, 1400)).toBe(0);
  });

  it("marks no word when the spoken text isn't in the question, and goes quiet on stop", () => {
    const tap = new VoiceTap();
    const u = {};
    tap.deviceStart(u, text, -1);
    tap.boundary(u, 0, 4, 100);
    expect(tap.word()).toBeNull();
    expect(tap.source()).toBe("words");
    tap.stop();
    expect(tap.source()).toBeNull();
    expect(tap.sample(new Float32Array(4), 150)).toBe(0);
  });
});
