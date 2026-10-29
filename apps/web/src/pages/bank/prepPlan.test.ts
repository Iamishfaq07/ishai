import { describe, expect, it } from "vitest";
import { buildPlan, daysBetween, planIcs, planText } from "./prepPlan";
import type { BankCompany } from "./types";

const netflix = {
  slug: "netflix", name: "Netflix", aliases: [], group: "global-tech", summary: "s", reviewed: "2026-10-01",
  rounds: ["Recruiter call", "Team interviews", "Final"], looks_for: ["Judgment", "Candor: giving and taking direct feedback", "Courage", "Selflessness"],
  questions: [], tips: ["t"],
} as unknown as BankCompany;

describe("prep plan", () => {
  it("needs a date after today", () => {
    expect(buildPlan("company", netflix, "2026-11-01", "2026-11-01")).toBeNull();
    expect(buildPlan("company", netflix, "2026-10-30", "2026-11-01")).toBeNull();
  });

  it("packs everything into one day when the interview is tomorrow, second mock left out", () => {
    const plan = buildPlan("company", netflix, "2026-11-02", "2026-11-01")!;
    expect(plan.days).toHaveLength(1);
    const ids = plan.days[0]!.steps.map((s) => s.id);
    expect(ids).toContain("mock");
    expect(ids).not.toContain("mock2");
    expect(ids.at(-1)).toBe("review");
  });

  it("spreads a week, keeps the day before light and ends on the interview", () => {
    const plan = buildPlan("company", netflix, "2026-11-08", "2026-11-01")!;
    expect(plan.starts).toBe("2026-11-01");
    expect(plan.days.at(-1)).toEqual({ date: "2026-11-07", steps: [expect.objectContaining({ id: "review" })] });
    const ids = plan.days.flatMap((d) => d.steps.map((s) => s.id));
    expect(ids).toEqual(["process", "resume", "warmup", "mine", "stories", "mock", "fix", "tips", "mock2", "review"]);
    expect(plan.days.find((d) => d.steps.some((s) => s.id === "stories"))!.steps.find((s) => s.id === "stories")!.detail).toContain("Judgment; Candor; Courage");
  });

  it("starts at most two weeks out", () => {
    const plan = buildPlan("company", netflix, "2026-12-31", "2026-11-01")!;
    expect(daysBetween(plan.starts, plan.interview)).toBe(14);
  });

  it("writes all-day calendar events and a text copy", () => {
    const plan = buildPlan("company", netflix, "2026-11-04", "2026-11-01")!;
    const ics = planIcs(plan, "Netflix", "https://orbitanswer.com/companies/netflix", new Date("2026-11-01T10:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261104");
    expect(ics).toContain("SUMMARY:Netflix interview\r\n");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(planText(plan, "Netflix", (d) => d)).toMatch(/^Netflix interview prep plan\n\n2026-11-01\n- Read how Netflix interviews/);
  });
});
