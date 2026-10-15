import { describe, expect, it } from "vitest";
import { evidenceFor, sourceLabel, suggestNote } from "./evidence";

describe("evidence vault copy", () => {
  it("names where a claim comes from, and says when the source is gone", () => {
    expect(sourceLabel({ source_kind: "manual", source_title: "", source_id: null })).toBe("In your own words");
    expect(sourceLabel({ source_kind: "story", source_title: "Launch conflict", source_id: "s1" })).toBe("Story: Launch conflict");
    expect(sourceLabel({ source_kind: "story", source_title: "Launch conflict", source_id: null })).toBe("Story: Launch conflict (since deleted)");
    expect(sourceLabel({ source_kind: "resume", source_title: "", source_id: "d1" })).toBe("Resume: your resume");
  });

  it("says how many to check and why some were left out", () => {
    expect(suggestNote(3, 0)).toBe("3 new claims to check below.");
    expect(suggestNote(1, 1)).toMatch(/^1 new claim to check below\. 1 left out because the source doesn't say it word for word/);
    expect(suggestNote(0, 2)).toMatch(/^No new claims/);
  });
});

describe("evidenceFor", () => {
  const item = (claim: string, quote = "", status: "confirmed" | "suggested" = "confirmed") => ({ claim, quote, status });
  const latency = item("Cut checkout latency by 40% with a pricing cache", "we cut checkout latency by 40%");

  it("finds the claim a bullet rests on, worded differently", () => {
    expect(evidenceFor("Cut p95 checkout latency 40% by caching pricing in memory", [latency])).toBe(latency);
    expect(evidenceFor("Mentored 3 junior engineers through their first on-call", [
      latency, item("Mentored three junior engineers on-call", "I mentored 3 juniors"),
    ])?.claim).toBe("Mentored three junior engineers on-call");
  });

  it("reads small numbers written as words", () => {
    const mentoring = item("Mentored three junior engineers through on-call");
    expect(evidenceFor("Mentored 3 junior engineers through their first on-call", [mentoring])).toBe(mentoring);
    expect(evidenceFor("Mentored 5 junior engineers through their first on-call", [mentoring])).toBeNull();
  });

  it("never marks a bullet whose number the evidence doesn't give", () => {
    expect(evidenceFor("Cut checkout latency by 60% with a pricing cache", [latency])).toBeNull();
    expect(evidenceFor("Cut checkout latency by 40% for 2M users with a pricing cache", [latency])).toBeNull();
  });

  it("ignores suggestions, unrelated bullets and empty ones", () => {
    expect(evidenceFor("Cut checkout latency by 40% with a pricing cache", [{ ...latency, status: "suggested" as const }])).toBeNull();
    expect(evidenceFor("Built the Android app's onboarding flow", [latency])).toBeNull();
    expect(evidenceFor("", [latency])).toBeNull();
    expect(evidenceFor("Checkout latency", [latency])).toBeNull();
  });
});
