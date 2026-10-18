import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import preset from "../../tailwind.preset";

/**
 * The interaction rules (DESIGN.md "Interaction", DECISIONS D74), held: one timing scale, presses gated by the motion
 * level, Gentle turning every new entrance and exit into a fade, and no stray durations in the apps' code.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(join(here, "base.css"), "utf8");
const repo = join(here, "../../../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // LinkedIn AI is being rebuilt on its own branch; it joins the check when it lands.
    if (name === "node_modules" || name === "dist" || name === "linkedin") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("interaction rules", () => {
  it("has the press timings on the one scale: 80 ms in, 140 ms out", () => {
    expect(css).toMatch(/--dur-press-in:\s*80ms/);
    expect(css).toMatch(/--dur-press-out:\s*140ms/);
    const durations = preset.theme.extend.transitionDuration as Record<string, string>;
    expect(durations["press-in"]).toBe("var(--dur-press-in)");
    expect(durations["press-out"]).toBe("var(--dur-press-out)");
  });

  it("hovers only where there is a real hover (no sticky hover after a tap)", () => {
    expect((preset as { future?: Record<string, boolean> }).future?.hoverOnlyWhenSupported).toBe(true);
  });

  it("presses (the 97% sink) only at Full motion, and never a busy, disabled or selection control", () => {
    const rule = css.slice(css.indexOf(":root:not([data-motion=\"reduced\"]):not([data-motion=\"off\"])\n  :is(button, .btn)"));
    const head = rule.slice(0, rule.indexOf("{"));
    for (const not of [":disabled", '[aria-disabled="true"]', '[role="switch"]', '[role="tab"]', '[role="radio"]', '[role="menuitem"]', ".lift"])
      expect(head).toContain(not);
    expect(rule.slice(0, rule.indexOf("}"))).toContain("scale(0.97)");
  });

  it("turns every new entrance into a fade at Gentle, and every exit into a fade-out", () => {
    const fades = css.slice(css.indexOf(':root[data-motion="reduced"] :is(.animate-fade-in'), css.indexOf("animation-name: orbit-fade !important"));
    for (const c of [".animate-page-in", ".animate-toast-in", ".tooltip-bubble", ".animate-dialog-in", ".animate-sheet-up"]) expect(fades).toContain(c);
    const exits = css.slice(css.indexOf(':root[data-motion="reduced"] :is(.animate-dialog-out'));
    for (const c of [".animate-dialog-out", ".animate-sheet-down", ".animate-panel-out", ".animate-toast-out"]) expect(exits.slice(0, 200)).toContain(c);
    expect(css).toMatch(/@keyframes orbit-fade-out/);
  });

  it("opens a details only when someone opens it, and only at Full (a fade at Gentle)", () => {
    expect(css).toContain(':root[data-motion="full"] details[data-opening][open]::details-content');
    expect(css).toContain(':root[data-motion="reduced"] details[data-opening][open]::details-content');
    expect(css).not.toMatch(/details\[open\]::details-content\s*\{[^}]*animation/);
  });

  it("draws its own checkboxes, but gives high-contrast mode the system's", () => {
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*input:is\(\[type="checkbox"\], \[type="radio"\]\)\s*\{\s*appearance: auto;/);
  });

  it("never transitions everything, and keeps durations on the scale", () => {
    expect(css).not.toMatch(/transition:\s*all\b/);
    // Live meters and clocks tick at their own rate: those are the only off-scale durations.
    const allowed = [/VideoInterview\.tsx$/, /components[\\/]ui\.tsx$/, /MockPanel\.tsx$/];
    const stray: string[] = [];
    for (const app of ["packages/ui/src", "apps/web/src", "apps/desktop/src"])
      for (const file of sources(join(repo, app))) {
        const text = readFileSync(file, "utf8");
        if (/\btransition-all\b/.test(text)) stray.push(`${file}: transition-all`);
        const off = text.match(/\bduration-(?:75|100|150|200|300|500|700|1000)\b/g);
        if (off && !allowed.some((a) => a.test(file))) stray.push(`${file}: ${off.join(", ")}`);
      }
    expect(stray).toEqual([]);
  });
});
