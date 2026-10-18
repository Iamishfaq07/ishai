import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The phone fixes that live in CSS: easy to delete in a tidy-up without noticing what they were for.
const INDEX = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const BASE = readFileSync(new URL("../../../../packages/ui/src/design/base.css", import.meta.url), "utf8");

function coarseBlocks(css: string): string[] {
  return [...css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? "");
}

describe("touch-screen CSS", () => {
  it("types at 16 px in every text field on a touch screen, so iOS never zooms the page into one", () => {
    const rule = coarseBlocks(INDEX).find((b) => b.includes("font-size: 16px"));
    expect(rule, "the (pointer: coarse) 16px rule in index.css").toBeDefined();
    for (const control of ["input:not(", "textarea", "select"]) expect(rule).toContain(control);
    // and wins over a field's own !text-xs, but a field set to text-base or larger keeps its size
    expect(rule).toContain("font-size: 16px !important");
    expect(rule).toContain('[class~="!text-lg"]');
    // "text-sm text-lg" (the shared field look plus a size) renders at 14 px: it must not be let off
    expect(rule).toMatch(/:is\(\[class~="text-base"\], \[class~="text-lg"\][^)]*\):not\(\[class~="text-sm"\]/);
    // and only on a touch screen: never a bare rule a mouse would see
    expect(INDEX.replace(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/g, "")).not.toMatch(/font-size:\s*16px/);
  });

  it("has the invisible 44 px tap areas, on touch screens only", () => {
    const block = coarseBlocks(BASE).join("\n");
    expect(block).toMatch(/\.tap::before/);
    expect(block).toMatch(/\.tap-y::before/);
    expect(block).toMatch(/height: max\(100%, 44px\)/);
    expect(BASE.replace(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/g, "")).not.toMatch(/\.tap(-y)?::before/);
  });
});
