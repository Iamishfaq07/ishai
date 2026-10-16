import { describe, expect, it } from "vitest";
import { barPath, columnHeight, columnLayout, growDelay, niceCeiling, peakIndex } from "./chart";

describe("the column chart", () => {
  it("tops the axis at a round number", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(1)).toBe(1);
    expect(niceCeiling(3)).toBe(5);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(12)).toBe(20);
    expect(niceCeiling(140)).toBe(200);
    expect(niceCeiling(0.4)).toBe(0.5);
  });

  it("caps a column at 24 px and leaves air between neighbours", () => {
    const wide = columnLayout(400, 8);
    expect(wide.slot).toBe(50);
    expect(wide.bar).toBe(24);
    expect(wide.x(0)).toBe(13);
    const tight = columnLayout(300, 30);
    expect(tight.bar).toBe(8);
    expect(tight.x(1) - (tight.x(0) + tight.bar)).toBe(2);
    expect(columnLayout(0, 0).bar).toBe(1);
  });

  it("draws nothing for zero and at least 2 px for a small value", () => {
    expect(columnHeight(0, 10, 96)).toBe(0);
    expect(columnHeight(0.01, 10, 96)).toBe(2);
    expect(columnHeight(5, 10, 96)).toBe(48);
  });

  it("rounds a column's top, not its foot", () => {
    expect(barPath(10, 20, 50, 96)).toBe("M10,96V50Q10,46 14,46H26Q30,46 30,50V96Z");
    // A column shorter than the rounding keeps its height.
    expect(barPath(0, 20, 2, 96)).toBe("M0,96V96Q0,94 2,94H18Q20,94 20,96V96Z");
  });

  it("labels the busiest column, the latest on a tie, and none when all are zero", () => {
    expect(peakIndex([1, 4, 2])).toBe(1);
    expect(peakIndex([4, 1, 4])).toBe(2);
    expect(peakIndex([0, 0])).toBe(-1);
    expect(peakIndex([])).toBe(-1);
  });

  it("grows the row in within about a third of a second", () => {
    expect(growDelay(0, 8)).toBe(0);
    expect(growDelay(7, 8)).toBe(280);
    expect(growDelay(29, 30)).toBe(348);
  });
});
