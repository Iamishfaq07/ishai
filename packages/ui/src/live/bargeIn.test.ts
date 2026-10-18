import { describe, expect, it } from "vitest";
import { CALIBRATE_MS, HOLD_MS, bargeInStart, bargeInStep } from "./bargeIn";

/** [time ms, mic RMS, her output level 0..1] → when it fired, or null. */
function run(steps: Array<[number, number, number]>): number | null {
  let state = bargeInStart(0);
  for (const [t, mic, out] of steps) {
    const step = bargeInStep(state, mic, out, t);
    state = step.state;
    if (step.fired) return t;
  }
  return null;
}

/** Her voice: syllables (0.6) and the gaps between them (0.05), every 30 ms. */
const saba = (t: number) => (Math.floor(t / 150) % 3 === 2 ? 0.05 : 0.6);

describe("barge-in", () => {
  it("never takes her own voice coming back through the speakers for the candidate", () => {
    // The natural voice: a second of nothing while the clip arrives (the old calibration measured only this), then her
    // voice, with a fifth of it leaking into the mic, louder at times.
    const steps: Array<[number, number, number]> = [];
    for (let t = 0; t < 1000; t += 30) steps.push([t, 0.004, 0]);
    for (let t = 1000; t < 6000; t += 30) {
      const out = saba(t);
      steps.push([t, 0.004 + out * 0.2 * (t > 4000 ? 1.25 : 1), out]);
    }
    expect(run(steps)).toBeNull();
  });

  it("stops her when the candidate talks over her, within HOLD_MS of them starting", () => {
    const steps: Array<[number, number, number]> = [];
    for (let t = 0; t < 2000; t += 30) {
      const out = saba(t);
      steps.push([t, 0.004 + out * 0.2, out]);
    }
    for (let t = 2010; t < 3000; t += 30) {
      const out = saba(t);
      steps.push([t, 0.004 + out * 0.2 + 0.16, out]); // the candidate's voice on top of her echo
    }
    const fired = run(steps);
    expect(fired).not.toBeNull();
    expect(fired! - 2010).toBeLessThanOrEqual(HOLD_MS + 60);
  });

  it("hears the candidate before she's started (the clip still on its way)", () => {
    const steps: Array<[number, number, number]> = [];
    for (let t = 0; t < 900; t += 30) steps.push([t, t < 300 ? 0.004 : 0.15, 0]);
    expect(run(steps)).not.toBeNull();
  });

  it("doesn't fire on a short noise (a cough, a click), or while learning her echo", () => {
    expect(run([[0, 0.004, 0], [30, 0.3, 0], [60, 0.004, 0], [90, 0.3, 0], [120, 0.004, 0]])).toBeNull();
    const learning: Array<[number, number, number]> = [];
    for (let t = 0; t < CALIBRATE_MS - 30; t += 30) learning.push([t, 0.4, 0.6]);
    expect(run(learning)).toBeNull();
  });
});
