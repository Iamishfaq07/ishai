import { describe, expect, it } from "vitest";
import { isScrolled, scrollNote } from "./scrollNote";

const shot = { pngBase64: "", width: 800, height: 3200 };

describe("scrolling capture notes", () => {
  it("say nothing about a whole page, and tell why a capture stopped early", () => {
    expect(scrollNote({ ...shot, screens: 4, stop: "end" })).toBeNull();
    expect(scrollNote({ ...shot, screens: 2, stop: "mouse" })).toMatch(/mouse moved/);
    expect(scrollNote({ ...shot, screens: 3, stop: "lost" })).toMatch(/end may be missing/);
    expect(scrollNote({ ...shot, screens: 9, stop: "limit" })).toMatch(/length limit/);
  });

  it("explain an area that didn't scroll", () => {
    expect(scrollNote({ ...shot, height: 600, screens: 1, stop: "end" })).toMatch(/didn't scroll/);
  });

  it("tell a scrolling capture from a plain one", () => {
    expect(isScrolled(shot)).toBe(false);
    expect(isScrolled({ ...shot, screens: 1, stop: "end" })).toBe(true);
  });
});
