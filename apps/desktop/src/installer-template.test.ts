import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs helper shared with the command line
import { tauriNsisTemplate, withoutOrbitBlocks } from "../scripts/tauri-nsis-template.mjs";

/**
 * The installer (DECISIONS D77, docs/WINDOWS_RELEASE.md "The installer"): Orbit's NSIS template is Tauri's with
 * blocks added, its pages never show in the updater's passive or a silent install, and the Finish page's link is an
 * opt-in that starts unticked.
 */
const tauri = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri");
const ours: string = readFileSync(join(tauri, "windows/installer.nsi"), "utf8");
const conf = JSON.parse(readFileSync(join(tauri, "tauri.conf.json"), "utf8"));
const blocks = [...ours.matchAll(/; ORBIT:BEGIN ([^\n]*)\n([\s\S]*?); ORBIT:END\n/g)].map((m) => ({ name: m[1]!, body: m[2]! }));
const block = (name: string) => blocks.find((b) => b.name === name)?.body ?? "";

describe("the installer template", () => {
  const upstream = tauriNsisTemplate() as string | null;

  it.skipIf(upstream === null)("is the installed Tauri CLI's own, plus Orbit's blocks (update them together)", () => {
    expect(withoutOrbitBlocks(ours)).toBe(upstream);
  });

  it("is the one tauri.conf.json builds with, with the brand's bitmaps and icon", () => {
    const nsis = conf.bundle.windows.nsis;
    expect(nsis.template).toBe("./windows/installer.nsi");
    expect(nsis.installerHooks).toBe("./windows/hooks.nsh"); // "Delete app data" still removes the sign-in
    expect(nsis.installerIcon).toBe("./icons/icon.ico");
    expect(nsis.uninstallerIcon).toBe("./icons/icon.ico");
    const bmp = (file: string) => {
      const b = readFileSync(join(tauri, file));
      return { magic: b.subarray(0, 2).toString("ascii"), w: b.readInt32LE(18), h: b.readInt32LE(22), bits: b.readUInt16LE(28), compression: b.readUInt32LE(30), bytes: b.length };
    };
    // NSIS's sizes: 150 x 57 for the header, 164 x 314 for the Welcome and Finish pages. Uncompressed 8-bit palettes.
    expect(bmp(nsis.headerImage)).toMatchObject({ magic: "BM", w: 150, h: 57, bits: 8, compression: 0 });
    expect(bmp(nsis.sidebarImage)).toMatchObject({ magic: "BM", w: 164, h: 314, bits: 8, compression: 0 });
    expect(bmp(nsis.sidebarImage).bytes).toBeLessThan(60_000);
  });

  it("keeps the updater's install passive: the panel returns at once, and the pages it adds to are skipped", () => {
    expect(conf.plugins.updater.windows.installMode).toBe("passive");
    const show = /Function OrbitInstFilesShow\n([\s\S]*?)FunctionEnd/.exec(block("pages"))?.[1] ?? "";
    expect(show.trimStart().startsWith("${If} $PassiveMode = 1\n  ${OrIf} $UpdateMode = 1\n    Return")).toBe(true);
    // The Welcome and Finish pages Orbit words are Tauri's, skipped in passive mode (and no page shows with /S).
    for (const page of ["MUI_PAGE_WELCOME", "MUI_PAGE_FINISH"]) {
      const at = ours.indexOf(`!insertmacro ${page}\n`);
      expect(ours.slice(Math.max(0, at - 1200), at)).toContain("!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive");
    }
    // Nothing Orbit adds is a page of its own (a page would need its own skip).
    expect(blocks.some((b) => /^\s*Page custom/m.test(b.body))).toBe(false);
  });

  it("asks before opening the web, unticked, and only for Orbit's own site", () => {
    const pages = block("pages");
    expect(pages).toContain('${NSD_CreateCheckbox} 120u 130u 195u 10u "Explore Orbit\'s free tools on the web"');
    expect(pages).toContain("${NSD_Uncheck} $OrbitExplore");
    expect(pages).not.toMatch(/NSD_Check\b|BST_CHECKED} 0/);
    expect(block("strings")).toContain('"https://orbitanswer.com/?utm_source=orbit-desktop&utm_campaign=installer-finish"');
    expect(pages).toMatch(/\$\{If\} \$OrbitExploreState == \$\{BST_CHECKED\}\n\s+ExecShell "open" "\$\{ORBIT_EXPLORE_URL\}"/);
  });

  it("speaks in Orbit's words and names only Orbit's tools", () => {
    expect(block("welcome")).toContain('!define MUI_WELCOMEPAGE_TITLE "Welcome to Orbit"');
    expect(block("finish")).toContain('!define MUI_FINISHPAGE_RUN_TEXT "Open Orbit"');
    for (const tool of ["Interview copilot", "Practice with Saba", "Resume AI", "Jobs AI", "LinkedIn AI", "Learning AI", "KashSec Academy"])
      expect(block("pages")).toContain(`"${tool}"`);
    expect(ours.toLowerCase()).not.toContain("deepseek");
  });
});
