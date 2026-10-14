import { describe, expect, it } from "vitest";
import { CALIBRATE_MS, HOLD_MS, bargeInStep, type BargeInState } from "./bargeIn";

function run(levels: Array<[number, number]>): boolean {
  let state: BargeInState = { started: 0, floor: 0, above: null };
  for (const [t, level] of levels) {
    const step = bargeInStep(state, level, t);
    state = step.state;
    if (step.fired) return true;
  }
  return false;
}

describe("barge-in", () => {
  it("fires when the candidate talks clearly over the interviewer for a moment", () => {
    const t = CALIBRATE_MS + 10;
    expect(run([[0, 0.02], [100, 0.03], [t, 0.2], [t + HOLD_MS / 2, 0.2], [t + HOLD_MS, 0.21]])).toBe(true);
  });

  it("doesn't fire on the interviewer's own voice leaking into the mic", () => {
    const echo = 0.08;
    const steps: Array<[number, number]> = [];
    for (let t = 0; t < 2000; t += 30) steps.push([t, echo * (0.8 + (t % 90) / 300)]);
    expect(run(steps)).toBe(false);
  });

  it("doesn't fire on a short noise (a cough, a click)", () => {
    const t = CALIBRATE_MS + 10;
    expect(run([[t, 0.3], [t + 30, 0.01], [t + 60, 0.3], [t + 90, 0.01]])).toBe(false);
  });

  it("ignores everything during the first calibration window", () => {
    expect(run([[0, 0.5], [60, 0.5], [120, 0.5], [180, 0.5], [240, 0.5]])).toBe(false);
  });
});
