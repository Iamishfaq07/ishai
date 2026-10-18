import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboardInset";

describe("keyboardInset", () => {
  it("is what the keyboard covers below the visual viewport", () => {
    // iPhone 14 portrait, keyboard open: the visual viewport shrinks to 492 px of 844 and isn't panned.
    expect(keyboardInset({ innerHeight: 844, height: 492, offsetTop: 0 })).toBe(352);
  });

  it("allows for a visual viewport the browser has panned down to the focused field", () => {
    expect(keyboardInset({ innerHeight: 844, height: 492, offsetTop: 120 })).toBe(232);
  });

  it("is 0 with the keyboard closed, on a desktop, and for the browser's own bars moving", () => {
    expect(keyboardInset({ innerHeight: 844, height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 900, height: 900, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, height: 790, offsetTop: 0 })).toBe(0); // Safari's address bar
    expect(keyboardInset({ innerHeight: 844, height: 700, offsetTop: 200 })).toBe(0); // panned past the bottom
    expect(keyboardInset({ innerHeight: 844, height: 422, offsetTop: 0, scale: 2 })).toBe(0); // pinch-zoomed in
  });
});
