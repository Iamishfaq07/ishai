import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_TAG, inlineThemeScript } from "./inlineTheme";

describe("inlineThemeScript (the theme script inline in the built page)", () => {
  it("puts the script where index.html loads it, once", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    expect(html).toContain(THEME_TAG);
    const out = inlineThemeScript(html, "  (function () {})();\n");
    expect(out).not.toContain(THEME_TAG);
    expect(out).toContain("<script>(function () {})();</script>");
    expect(out.match(/<script>/g)?.length).toBe(1);
  });

  it("stops the build when the tag has moved, rather than shipping a page without its theme", () => {
    expect(() => inlineThemeScript("<html></html>", "x")).toThrow(/theme-init/);
  });
});
