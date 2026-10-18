import { describe, expect, it } from "vitest";
import { sampleOffer } from "@orbit/ui";
import { HR_QUESTIONS, PRESETS, isPresetId, presetSession, presetTitle, roleForPractice } from "./mockPresets";

describe("roleForPractice", () => {
  it("uses the link, then the saved job title, then the welcome role", () => {
    expect(roleForPractice("  SDE  ", "Analyst", "Support")).toBe("SDE");
    expect(roleForPractice("", "Analyst", "Support")).toBe("Analyst");
    expect(roleForPractice(null, "  ", "Support")).toBe("Support");
    expect(roleForPractice(null, null, "   ")).toBe("");
  });
});

describe("one-tap mock presets", () => {
  it("start a 5-minute HR round on the campus questions, as a recruiter", () => {
    const s = presetSession("hr5", "", ["resume-doc"]);
    expect(s).toMatchObject({ type: "mock", title: "Mock — 5-min HR round", document_ids: ["resume-doc"], auto_answer: false });
    expect(s.mock).toMatchObject({ duration_minutes: 5, persona: "recruiter", interview_type: "behavioral", difficulty: "easy" });
    expect(s.mock?.drill?.map((d) => d.question)).toEqual(HR_QUESTIONS);
    // The round's own questions, not "the questions from your prep": nothing was prepared (kind "prep" says it was).
    expect(s.mock?.drill?.every((d) => d.kind === "set")).toBe(true);
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

  it("negotiate a ₹ offer in India, never dollars", () => {
    const s = presetSession("salary", "", []);
    expect(s.mock).toMatchObject({ interview_type: "negotiation", persona: "recruiter", negotiation: { offer: sampleOffer("IN").offer } });
    expect(JSON.stringify(PRESETS.map((p) => p.blurb("")))).not.toContain("$");
    expect(s.mock?.negotiation?.offer).toContain("LPA");
    expect(presetTitle(PRESETS.find((p) => p.id === "salary")!)).toBe("Salary talk (₹)");
  });

  it("use the terms of the country the user applies in", () => {
    const us = presetSession("salary", "", [], "US");
    expect(us.mock?.negotiation?.offer).toBe(sampleOffer("US").offer);
    expect(us.mock?.negotiation?.offer).toContain("$");
    const blurbs = JSON.stringify(PRESETS.map((p) => p.blurb("", "GB")));
    expect(blurbs).not.toContain("₹");
    expect(blurbs).not.toContain("campus");
    expect(presetTitle(PRESETS.find((p) => p.id === "salary")!, "US")).toBe("Salary talk");
    expect(PRESETS.find((p) => p.id === "hr5")!.blurb("", "IN")).toContain("campus HR round");
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

describe("the first screen outside India", () => {
  it("is a recruiter screen, without India's shift-work question; India's stays the HR round", async () => {
    const { hrQuestions } = await import("./mockPresets");
    const hr5 = PRESETS.find((p) => p.id === "hr5")!;
    expect(presetTitle(hr5)).toBe("5-min HR round");
    expect(presetTitle(hr5, "US")).toBe("5-min recruiter screen");
    expect(presetSession("hr5", "", [], "IN").title).toBe("Mock — 5-min HR round");
    expect(presetSession("hr5", "", [], "GB").title).toBe("Mock — 5-min recruiter screen");
    expect(hrQuestions("IN")).toBe(HR_QUESTIONS);
    const gb = presetSession("hr5", "", [], "GB").mock?.drill?.map((d) => d.question) ?? [];
    expect(gb).toHaveLength(HR_QUESTIONS.length);
    expect(gb.join(" ")).not.toMatch(/shift/);
    expect(gb).toContain("Are you open to relocating if the role needs it?");
  });
});

describe("a one-tap round in a practice language (Hindi, Hinglish)", () => {
  it("asks its fixed questions in that language, and says which language the session is in", () => {
    const hi = presetSession("hr5", "", [], "IN", "hi");
    expect(hi.language).toBe("hi");
    const hiQuestions = hi.mock?.drill?.map((d) => d.question) ?? [];
    expect(hiQuestions).toHaveLength(HR_QUESTIONS.length);
    expect(hiQuestions.every((q) => /[ऀ-ॿ]/.test(q))).toBe(true); // Devanagari
    expect(hiQuestions[1]).toContain("हमारी कंपनी"); // the server names the company here, as in "our company"
    const hinglish = presetSession("tmay10", "", [], "IN", "hinglish").mock?.drill ?? [];
    expect(hinglish.map((d) => d.question)).toEqual([
      "Apne baare mein bataiye.",
      expect.stringMatching(/^Apne resume se/),
      "Apne baare mein bataiye.",
    ]);
    expect(hinglish.map((d) => d.kind)).toEqual(["set", "set", "concise"]);
    expect(hinglish.every((d) => !/[ऀ-ॿ]/.test(d.question))).toBe(true); // Latin script
  });

  it("leaves English rounds and the free rounds as they were", () => {
    expect(presetSession("hr5", "", []).language).toBe("en");
    expect(presetSession("hr5", "", [], "IN", "en").mock?.drill?.map((d) => d.question)).toEqual(HR_QUESTIONS);
    expect(presetSession("tech15", "", [], "IN", "hi").mock).toEqual(presetSession("tech15", "", [], "IN").mock);
  });
});
