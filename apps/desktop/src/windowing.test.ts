import { describe, expect, it } from "vitest";
import { fitWindow } from "./windowing";

// A 1366×768 laptop at 125 %: the work area above the taskbar, in physical pixels.
const laptop = { x: 0, y: 0, width: 1366, height: 728 };
const expanded = { width: 1150, height: 850 }; // 920×680 at 125 %

describe("fitting the window to the screen when it changes size", () => {
  it("is never bigger than the work area", () => {
    const fit = fitWindow({ x: 100, y: 100, width: 475, height: 650 }, expanded, laptop);
    expect(fit.width).toBe(1150);
    expect(fit.height).toBe(728);
  });

  it("moves up and left so a window that grows near the corner keeps its buttons on screen", () => {
    // the compact overlay parked bottom-right, then the session opens expanded
    const fit = fitWindow({ x: 880, y: 70, width: 475, height: 650 }, { width: 1150, height: 700 }, laptop);
    expect(fit).toEqual({ x: 216, y: 28, width: 1150, height: 700 });
    expect(fit.x + fit.width).toBeLessThanOrEqual(laptop.width);
    expect(fit.y + fit.height).toBeLessThanOrEqual(laptop.height);
  });

  it("stays put when the new size fits where it is, and never moves to shrink", () => {
    expect(fitWindow({ x: 40, y: 20, width: 1150, height: 700 }, { width: 475, height: 650 }, laptop)).toEqual({
      x: 40,
      y: 20,
      width: 475,
      height: 650,
    });
  });

  it("leaves a window the user put partly off-screen where it is", () => {
    const fit = fitWindow({ x: -200, y: 300, width: 475, height: 650 }, expanded, laptop);
    expect(fit.x).toBe(-200);
    expect(fit.y).toBe(300);
  });

  it("works on a second monitor left of the main one (negative coordinates)", () => {
    const left = { x: -2560, y: 0, width: 2560, height: 1392 };
    const fit = fitWindow({ x: -600, y: 900, width: 380, height: 480 }, { width: 920, height: 680 }, left);
    expect(fit).toEqual({ x: -920, y: 712, width: 920, height: 680 });
  });
});
