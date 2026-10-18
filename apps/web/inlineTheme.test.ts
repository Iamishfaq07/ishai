import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INLINE_SCRIPTS, THEME_TAG, inlineScript, inlineThemeScript, scriptTag } from "./inlineTheme";

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

  it("puts the app's start inline too, after the theme (the CSP hashes both)", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    const out = INLINE_SCRIPTS.reduce((page, file) => inlineScript(page, file, `/* ${file} */`), html);
    for (const file of INLINE_SCRIPTS) expect(out).not.toContain(scriptTag(file));
    expect(out.indexOf("/* theme-init.js */")).toBeLessThan(out.indexOf("/* app-start.js */"));
    expect(out.indexOf("/* app-start.js */")).toBeLessThan(out.indexOf('<script type="module"'));
    expect(out.match(/<script>/g)?.length).toBe(2);
    // The files' whole-line comments stay in the files.
    expect(inlineScript(scriptTag("app-start.js"), "app-start.js", '// why\nrun("https://x");\n  // more\nend();\n')).toBe('<script>run("https://x");\nend();</script>');
  });
});
