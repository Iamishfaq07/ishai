import { describe, expect, it } from "vitest";
import { SILENT_AFTER_MS, feed, meterLevel, newTrack, sourceState, sourceText } from "./sourceActivity";

const state = (t: ReturnType<typeof newTrack>, now: number, channel: "mic" | "system" = "mic", on = true, paused = false) =>
  sourceState(t, { on, paused, channel, now });

describe("sourceActivity", () => {
  it("is off, paused or waiting before it hears anything", () => {
    const t = newTrack();
    expect(state(t, 0, "mic", false)).toBe("off");
    expect(state(t, 0, "mic", true, true)).toBe("paused");
    expect(state(t, 0)).toBe("waiting");
    feed(t, 0.001, 0);
    expect(state(t, 1_000)).toBe("quiet");
    expect(state(t, 5_000)).toBe("waiting"); // frames stopped coming
  });

  it("hears speech, then counts silence from the last sound", () => {
    const t = newTrack();
    feed(t, 0.05, 0);
    expect(state(t, 1_000)).toBe("hearing");
    for (let at = 50; at <= SILENT_AFTER_MS.mic + 1_000; at += 50) feed(t, 0.0005, at);
    const end = SILENT_AFTER_MS.mic + 1_000;
    expect(state(t, end)).toBe("silent");
    expect(state(t, end, "system")).toBe("quiet"); // the interviewer may be quiet longer
    expect(sourceText("system", "silent").advice).toMatch(/shared/);
    expect(sourceText("mic", "hearing").advice).toBeNull();
  });

  it("counts silence from switching on when nothing was ever heard", () => {
    const t = newTrack();
    for (let at = 0; at <= SILENT_AFTER_MS.system; at += 50) feed(t, 0, at);
    expect(state(t, SILENT_AFTER_MS.system, "system")).toBe("silent");
  });

  it("meters on a dB scale, rising at once and falling gently", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(0.001)).toBe(0);
    const t = newTrack();
    feed(t, 0.1, 0);
    const peak = t.level;
    feed(t, 0, 50);
    expect(t.level).toBeLessThan(peak);
    expect(t.level).toBeGreaterThan(peak * 0.8);
  });
});
