import { describe, expect, it } from "vitest";
import { ats80Step } from "./atsMilestone";

describe("the first-80 toast", () => {
  it("follows the score while fixes land in a row, so it never shows an older one than the header", () => {
    // The launch film's run: 74, then 82 (the toast), then 97 and 99 a few seconds later.
    expect(ats80Step(74, 82)).toEqual({ do: "celebrate", message: "Your resume scores 82. Ready to apply?" });
    expect(ats80Step(82, 97)).toEqual({ do: "update", message: "Your resume scores 97. Ready to apply?" });
    expect(ats80Step(97, 99)).toEqual({ do: "update", message: "Your resume scores 99. Ready to apply?" });
  });

  it("closes when the score drops back under 80, and leaves an unchanged score alone", () => {
    expect(ats80Step(84, 76)).toEqual({ do: "close" });
    expect(ats80Step(90, 90)).toBeNull();
  });

  it("doesn't count opening a resume, or the gap between two, as a rise", () => {
    expect(ats80Step(null, 91)).toBeNull();
    expect(ats80Step(91, null)).toBeNull();
    expect(ats80Step(60, 79)).toBeNull(); // still under 80
  });
});
