import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({ api: {} })); // the client reads the browser's location when it loads

const { allowanceSpan } = await import("./PricingTiers");

describe("allowanceSpan", () => {
  it("says a week's allowance is for the week, not a month", () => {
    expect(`50 hours of live interview help${allowanceSpan(7)}`).toBe("50 hours of live interview help, to use in the week");
    expect(allowanceSpan(14)).toBe(", to use in the 14 days");
    expect(allowanceSpan(30)).toBe(" a month");
    expect(allowanceSpan(365)).toBe(" a month");
  });
});
