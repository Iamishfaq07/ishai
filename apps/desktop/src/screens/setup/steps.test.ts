import { describe, expect, it } from "vitest";
import { levelFromPeak } from "./levels";
import { setupSteps, shortDevice, type StepInput } from "./steps";

const base: StepInput = {
  typeLabel: "Interview",
  role: "Senior Backend Engineer",
  needsOffer: false,
  micName: "Headset Microphone (Jabra Evolve2 65)",
  interviewerUsed: true,
  interviewerOn: true,
  interviewerName: "Zoom",
  interviewerWarning: null,
  callType: true,
  documents: 2,
  hasResume: true,
  isMock: false,
  answerSummary: "English · Auto length · Automatic",
};
const byId = (s: StepInput) => Object.fromEntries(setupSteps(s).map((v) => [v.id, v]));

describe("New session's steps", () => {
  it("say what's chosen, and are done when nothing wants a look", () => {
    const steps = byId(base);
    expect(steps.session!.summary).toBe("Interview · Senior Backend Engineer");
    expect(steps.listen!.summary).toBe("Jabra Evolve2 65 + Zoom");
    expect(steps.context!.summary).toBe("2 picked");
    expect(Object.values(steps).every((s) => s.done && !s.attention)).toBe(true);
  });

  it("flag a call that won't hear the interviewer, a missing microphone, and a silent chosen app", () => {
    expect(byId({ ...base, interviewerOn: false }).listen!.attention).toBe(true);
    expect(byId({ ...base, interviewerOn: false }).listen!.summary).toContain("Interviewer off");
    expect(byId({ ...base, micName: null }).listen!.summary).toContain("No microphone");
    expect(byId({ ...base, interviewerWarning: "Zoom isn't playing any sound" }).listen!.attention).toBe(true);
    // Phone and mock sessions only use the mic: the interviewer being off is how they work.
    expect(byId({ ...base, interviewerUsed: false, interviewerOn: false }).listen!.attention).toBe(false);
  });

  it("want a resume for the copilot, not for a mock round, and the offer for salary practice", () => {
    expect(byId({ ...base, hasResume: false }).context!.attention).toBe(true);
    expect(byId({ ...base, hasResume: false, isMock: true }).context!.attention).toBe(false);
    expect(byId({ ...base, documents: 0, hasResume: false }).context!.summary).toBe("None picked");
    expect(byId({ ...base, needsOffer: true }).session!.attention).toBe(true);
  });

  it("shorten device names to the part people recognise", () => {
    expect(shortDevice("Speakers (Realtek Audio)")).toBe("Realtek Audio");
    expect(shortDevice("Microphone Array (Realtek(R) Audio)")).toBe("Microphone Array (Realtek(R) Audio)");
    expect(shortDevice("USB Mic")).toBe("USB Mic");
  });
});

describe("tile meters", () => {
  it("read a peak on a decibel scale: quiet sounds still move them, silence doesn't", () => {
    expect(levelFromPeak(0)).toBe(0);
    expect(levelFromPeak(1)).toBe(1);
    expect(levelFromPeak(0.01)).toBeCloseTo(0.2, 5); // -40 dBFS
    expect(levelFromPeak(0.001)).toBe(0); // -60 dBFS
  });
});
