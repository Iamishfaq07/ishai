import { describe, expect, it } from "vitest";
import { internationalCardFailure } from "./razorpay";

describe("international checkout fallback", () => {
  it("recognizes gateway international card restrictions without swallowing other failures", () => {
    expect(internationalCardFailure("International cards not enabled for merchant")).toBe(true);
    expect(internationalCardFailure("foreign card is not supported")).toBe(true);
    expect(internationalCardFailure("Insufficient funds")).toBe(false);
  });
});
