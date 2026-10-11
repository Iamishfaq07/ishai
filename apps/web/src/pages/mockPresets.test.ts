import { describe, expect, it } from "vitest";
import { HR_QUESTIONS, PRESETS, SAMPLE_OFFER, isPresetId, presetSession } from "./mockPresets";

describe("one-tap mock presets", () => {
  it("start a 5-minute HR round on the campus questions, as a recruiter", () => {
    const s = presetSession("hr5", "", ["resume-doc"]);
    expect(s).toMatchObject({ type: "mock", title: "Mock — 5-min HR round", document_ids: ["resume-doc"], auto_answer: false });
    expect(s.mock).toMatchObject({ duration_minutes: 5, persona: "recruiter", interview_type: "behavioral", difficulty: "easy" });
    expect(s.mock?.drill?.map((d) => d.question)).toEqual(HR_QUESTIONS);
    expect(s.role).toBeUndefined();
  });

  it("practise 'Tell me about yourself' long, with a follow-up, then short", () => {
    const drill = presetSession("tmay10", "Data Analyst", []).mock?.drill ?? [];
    expect(drill[0]).toMatchObject({ question: "Tell me about yourself.", follow_up: true });
    expect(drill.at(-1)).toEqual({ question: "Tell me about yourself.", kind: "concise" });
    expect(drill.length).toBeLessThanOrEqual(8); // the server's drill limit
  });

  it("make the technical round for the role when it's known", () => {
    expect(presetSession("tech15", " Data Analyst ", [])).toMatchObject({
      title: "Mock — Data Analyst (technical)",
      role: "Data Analyst",
      mock: { interview_type: "technical", duration_minutes: 15, persona: "engineer" },
    });
    expect(presetSession("tech15", "", []).title).toBe("Mock — 15-min technical");
    expect(PRESETS.find((p) => p.id === "tech15")!.blurb("SDE")).toContain("For SDE");
  });

  it("seat a panel of three different interviewers", () => {
    const s = presetSession("panel15", "SDE", []);
    expect(s.title).toBe("Panel — SDE");
    expect(s.mock).toMatchObject({ duration_minutes: 15, panel: ["hiring_manager", "engineer", "recruiter"] });
    expect(new Set(s.mock?.panel).size).toBe(3);
    expect(s.mock?.drill).toBeUndefined(); // a panel isn't a drill (the server ignores one there)
    expect(presetSession("panel15", "", []).title).toBe("Mock — Panel round");
  });

  it("time a one-way video interview like the recorded platforms", () => {
    const s = presetSession("oneway10", "", []);
    expect(s.title).toBe("Mock — Video interview");
    expect(s.mock).toMatchObject({ duration_minutes: 10, one_way: { think_seconds: 30, answer_seconds: 90 } });
  });

  it("negotiate a ₹ offer, never dollars", () => {
    const s = presetSession("salary", "", []);
    expect(s.mock).toMatchObject({ interview_type: "negotiation", persona: "recruiter", negotiation: { offer: SAMPLE_OFFER } });
    expect(JSON.stringify(PRESETS.map((p) => p.blurb("")))).not.toContain("$");
    expect(SAMPLE_OFFER).toContain("LPA");
  });

  it("stay within the server's limits and know their own ids", () => {
    for (const p of PRESETS) {
      const m = presetSession(p.id, "", []).mock!;
      expect(m.duration_minutes).toBeGreaterThanOrEqual(5);
      expect(m.duration_minutes).toBeLessThanOrEqual(60);
      expect(m.duration_minutes).toBe(p.minutes);
      for (const d of m.drill ?? []) expect(d.question.length).toBeLessThanOrEqual(400);
    }
    expect(isPresetId("hr5")).toBe(true);
    expect(isPresetId("nope")).toBe(false);
    expect(isPresetId(null)).toBe(false);
  });
});
