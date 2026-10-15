import { describe, expect, it } from "vitest";
import { flagAllows } from "./flags";

describe("flagAllows", () => {
  it("waits for the account, then follows the flag (missing means off)", () => {
    expect(flagAllows(null, "evidence_vault")).toBeNull();
    expect(flagAllows({ evidence_vault: true }, "evidence_vault")).toBe(true);
    expect(flagAllows({ evidence_vault: false }, "evidence_vault")).toBe(false);
    expect(flagAllows({}, "evidence_vault")).toBe(false);
  });
});
