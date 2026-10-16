import { describe, expect, it } from "vitest";
import type { JobOfferRecord } from "@orbit/types";
import { compareRows, emptyOffer, money, offerLine, placeOnRange, practiceRequest } from "./model";

function rec(over: Partial<JobOfferRecord>): JobOfferRecord {
  return {
    ...emptyOffer("INR"), id: "o", company: "Acme", role: "Backend Engineer", fixed: 2_400_000, first_year: 2_400_000,
    yearly: 2_400_000, take_home: null, market: null, position: null, plan: null, plan_stale: false,
    created_at: "", updated_at: "", ...over,
  };
}

describe("Offer AI model", () => {
  it("writes money the way offers do", () => {
    expect(money("INR", 2_400_000)).toBe("₹24L");
    expect(money("INR", 2_450_000)).toBe("₹24.5L");
    expect(money("INR", 12_500_000)).toBe("₹1.3Cr");
    expect(money("INR", 145_000, true)).toBe("₹1,45,000");
    expect(money("USD", 165_000)).toBe("$165k");
    expect(money("SGD", 900)).toBe("SGD 900");
  });

  it("says the offer in one line for the practice call", () => {
    expect(offerLine({ ...emptyOffer("INR"), fixed: 2_400_000, variable: 240_000, joining_bonus: 200_000 }))
      .toBe("₹24L fixed + ₹2.4L variable + ₹2L joining bonus");
    expect(offerLine({ ...emptyOffer("USD"), fixed: 150_000 })).toBe("$150k fixed a year");
  });

  it("sets up the negotiation practice with the plan's ask as the hidden target", () => {
    const req = practiceRequest(rec({ plan: { ask: 2_800_000, ask_why: "", reasons: [], call_script: [], email: { subject: "", body: "" }, questions: [], watch_outs: [] } }));
    expect(req.mock?.interview_type).toBe("negotiation");
    expect(req.mock?.negotiation).toEqual({ offer: "₹24L fixed a year", company: "Acme", target: "₹28L fixed" });
    expect(practiceRequest(rec({})).mock?.negotiation?.target).toBeUndefined();
  });

  it("places the offer on the market bar", () => {
    expect(placeOnRange(30, 20, 40)).toBe(50);
    expect(placeOnRange(10, 20, 40)).toBe(0);
    expect(placeOnRange(50, 20, 40)).toBe(100);
  });

  it("compares offers row by row and marks a clear best", () => {
    const rows = compareRows([rec({ id: "a", fixed: 2_400_000, first_year: 2_600_000, yearly: 2_400_000 }),
      rec({ id: "b", fixed: 2_200_000, joining_bonus: 500_000, first_year: 2_700_000, yearly: 2_200_000 })]);
    const fixed = rows.find((r) => r.label === "Fixed pay")!;
    expect(fixed.best).toBe(0);
    expect(rows.find((r) => r.label === "First year, all in")!.best).toBe(1);
    expect(rows.find((r) => r.label === "Variable (target)")).toBeUndefined(); // nobody has one
  });
});

describe("offers outside India", () => {
  it("use base salary, target bonus and signing bonus; India keeps fixed, variable and joining bonus", async () => {
    const { offerTerms } = await import("./model");
    expect(offerTerms("IN")).toMatchObject({ fixed: "Fixed pay", joining: "Joining bonus", variableRow: "Variable (target)" });
    expect(offerTerms("US")).toMatchObject({ fixed: "Base salary", joining: "Signing bonus", variableRow: "Target bonus" });
    expect(offerLine({ ...emptyOffer("USD"), fixed: 150_000, variable: 15_000, joining_bonus: 10_000 }, "US"))
      .toBe("$150k base + $15k target bonus + $10k signing bonus");
    expect(offerLine({ ...emptyOffer("GBP"), fixed: 60_000 }, "GB")).toBe("£60k base a year");
    const plan = { ask: 165_000, ask_why: "", reasons: [], call_script: [], email: { subject: "", body: "" }, questions: [], watch_outs: [] };
    expect(practiceRequest(rec({ currency: "USD", fixed: 150_000, plan }), "US").mock?.negotiation?.target).toBe("$165k base");
    const rows = compareRows([rec({ id: "a", fixed: 150_000, joining_bonus: 10_000 }), rec({ id: "b", fixed: 140_000 })], "US");
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Base salary", "Signing bonus"]));
    expect(rows.map((r) => r.label)).not.toContain("Fixed pay");
  });
});
