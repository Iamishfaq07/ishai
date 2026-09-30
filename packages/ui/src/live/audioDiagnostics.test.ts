import { describe, expect, it } from "vitest";
import { addFrame, diagnosticsReport, newChannelStats, redactDeviceName, summarize } from "./audioDiagnostics";

/** Frames every 50 ms from t=0 for `ms`, at a fixed level (optionally skipping a window). */
function run(ms: number, rms: number, skip?: [number, number]) {
  const s = newChannelStats();
  for (let t = 0; t < ms; t += 50) if (!skip || t < skip[0] || t >= skip[1]) addFrame(s, rms, t);
  return s;
}

describe("audio diagnostics", () => {
  it("healthy speech-level mic is ok, with full delivery", () => {
    const r = summarize(run(5000, 0.05), 0, 5000, "mic");
    expect(r.verdict).toBe("ok");
    expect(r.delivery).toBe(1);
    expect(r.dropouts).toBe(0);
    expect(r.averageDbfs).toBe(-26);
  });

  it("waits before judging", () => {
    expect(summarize(newChannelStats(), 0, 1000, "mic").verdict).toBe("waiting");
  });

  it("no frames at all is no_audio", () => {
    expect(summarize(newChannelStats(), 0, 3000, "system").verdict).toBe("no_audio");
  });

  it("a muted mic is silent, and a quiet system channel says to play something", () => {
    expect(summarize(run(4000, 0.0005), 0, 4000, "mic").advice).toMatch(/muted/);
    expect(summarize(run(4000, 0), 0, 4000, "system").advice).toMatch(/Play something/);
  });

  it("repeated gaps between frames are dropouts; one short hiccup isn't", () => {
    const gappy = newChannelStats();
    const holes = [[1000, 1400], [2000, 2400], [3000, 3400]];
    for (let t = 0; t < 6000; t += 50) if (!holes.some(([a, b]) => t >= a! && t < b!)) addFrame(gappy, 0.05, t);
    const r = summarize(gappy, 0, 6000, "mic");
    expect(r.verdict).toBe("dropouts");
    expect(r.dropouts).toBe(3);
    expect(r.longestGapMs).toBe(450);
    expect(summarize(run(6000, 0.05, [1000, 1400]), 0, 6000, "mic").verdict).toBe("ok");
  });

  it("a stream that stopped is a dropout even without a later frame", () => {
    const r = summarize(run(2000, 0.05), 0, 5000, "mic");
    expect(r.verdict).toBe("dropouts");
    expect(r.delivery).toBeLessThan(0.8);
  });

  it("near-clipping input is too_loud", () => {
    expect(summarize(run(4000, 0.7), 0, 4000, "mic").verdict).toBe("too_loud");
  });

  it("redacts personal names in device names, keeps the model", () => {
    expect(redactDeviceName("Sam's AirPods Pro")).toBe("[name]'s AirPods Pro");
    expect(redactDeviceName("Headset (Priya’s Jabra)")).toBe("Headset ([name]'s Jabra)");
    expect(redactDeviceName("Microphone (Realtek(R) Audio)")).toBe("Microphone (Realtek(R) Audio)");
    expect(redactDeviceName("Sam'sung")).toBe("Sam'sung");
    const long = "-".repeat(100_000); // no "'s" anywhere: linear, not a quadratic backtrack
    expect(redactDeviceName(long)).toBe(long);
  });

  it("the report holds measurements only, with names redacted", () => {
    const summary = summarize(run(3000, 0.05), 0, 3000, "mic");
    const json = diagnosticsReport(
      {
        appVersion: "0.1.22",
        userAgent: "Windows NT 10.0",
        selection: { mic: "Sam's AirPods", listenTo: "app: zoom.exe" },
        devices: { mics: [{ name: "Sam's AirPods", isDefault: true }], outputs: [] },
        channels: { mic: summary, system: null },
        events: [{ t: 1.2, channel: "mic", kind: "status", detail: "switched to Sam's AirPods" }],
      },
      new Date("2026-09-25T00:00:00Z"),
    );
    expect(json).not.toContain("Sam");
    const parsed = JSON.parse(json);
    expect(parsed.channels.mic.verdict).toBe("ok");
    expect(parsed.selection.listen_to).toBe("app: zoom.exe");
    expect(Object.keys(parsed)).not.toContain("transcript");
  });
});
