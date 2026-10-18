import { describe, expect, it } from "vitest";
import { createMicGate } from "./micGate";

const frame = (n: number, v = 1) => new Int16Array(n).fill(v);

describe("the mic while Saba can be heard (D76)", () => {
  it("holds her echo back and drops it when she just finishes", () => {
    const sent: Int16Array[] = [];
    const gate = createMicGate((f) => sent.push(f), 16_000, 900);
    for (let i = 0; i < 10; i++) gate.frame(frame(1600, 7), true); // a second of her voice from the speakers
    expect(sent).toHaveLength(0);
    gate.frame(frame(1600, 1), false);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe(1);
  });

  it("sends the start of their words first when they talk over her", () => {
    const sent: Int16Array[] = [];
    const gate = createMicGate((f) => sent.push(f), 16_000, 900);
    for (let i = 0; i < 20; i++) gate.frame(frame(1600, i), true); // 2 s held: only the last 0.9 s is kept
    gate.bargeIn();
    gate.frame(frame(1600, 99), false);
    const values = sent.map((f) => f[0]);
    expect(values.at(-1)).toBe(99);
    expect(values.slice(0, -1)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]); // the last 900 ms, in order
    gate.frame(frame(1600, 100), true);
    gate.frame(frame(1600, 101), false);
    expect(sent.map((f) => f[0]).at(-1)).toBe(101); // a later plain finish flushes nothing
    expect(sent.map((f) => f[0])).not.toContain(100);
  });
});
