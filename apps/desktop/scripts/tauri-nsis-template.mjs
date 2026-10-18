// Tauri's own NSIS template, as embedded in the installed CLI (the one `tauri build` uses without
// `bundle.windows.nsis.template`). Orbit's template (src-tauri/windows/installer.nsi) is this file plus its
// `; ORBIT:BEGIN … ; ORBIT:END` blocks; src/installer-template.test.ts holds them together.
//   node apps/desktop/scripts/tauri-nsis-template.mjs > upstream.nsi     (then diff it with installer.nsi)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The template, or null where the Windows CLI isn't installed (another OS). */
export function tauriNsisTemplate() {
  try {
    const cli = createRequire(join(desktop, "package.json")).resolve("@tauri-apps/cli/package.json");
    const native = createRequire(cli).resolve("@tauri-apps/cli-win32-x64-msvc/package.json");
    const binary = readFileSync(join(dirname(native), "cli.win32-x64-msvc.node"));
    // Stored with Windows line ends; the repo keeps LF (.gitattributes), and NSIS reads either.
    const start = binary.indexOf("Unicode true\r\nManifestDPIAware true");
    if (start < 0) return null;
    const end = binary.indexOf(0, start);
    return binary.subarray(start, end).toString("utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

/** Orbit's template without its own blocks: what's left must be Tauri's, unchanged. */
export function withoutOrbitBlocks(text) {
  return text.replace(/; ORBIT:BEGIN [^\n]*\n[\s\S]*?; ORBIT:END\n/g, "");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = tauriNsisTemplate();
  if (!t) {
    console.error("The Windows Tauri CLI isn't installed here.");
    process.exit(1);
  }
  process.stdout.write(t);
}
