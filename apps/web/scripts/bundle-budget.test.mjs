import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measure } from "./bundle-budget.mjs";

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A tiny dist: the entry imports shared.js; Home's chunk imports shared.js (already loaded) and its own icons.js. */
function dist() {
  const d = mkdtempSync(join(tmpdir(), "orbit-budget-"));
  dirs.push(d);
  mkdirSync(join(d, "assets"));
  writeFileSync(join(d, "index.html"), `<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">`);
  const big = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${Math.random()};`).join("\n");
  writeFileSync(join(d, "assets", "index-AAAAAAAA.js"), `import { a } from "./shared-BBBBBBBB.js";\n${big(400)}`);
  writeFileSync(join(d, "assets", "shared-BBBBBBBB.js"), big(200));
  writeFileSync(join(d, "assets", "Home-DDDDDDDD.js"), `import { a } from "./shared-BBBBBBBB.js";\nimport { b } from "./icons-EEEEEEEE.js";\n${big(100)}`);
  writeFileSync(join(d, "assets", "icons-EEEEEEEE.js"), big(100));
  writeFileSync(join(d, "assets", "Live-FFFFFFFF.js"), big(3000)); // lazy, never imported: not in Home's first load
  writeFileSync(join(d, "assets", "index-CCCCCCCC.css"), "body{color:red}");
  writeFileSync(join(d, "assets", "Live-GGGGGGGG.css"), "a{color:blue}".repeat(2000)); // a lazy page's own CSS
  return d;
}

describe("bundle budget", () => {
  it("counts the entry with what it imports, and a page with what it adds, not the lazy pages", () => {
    const rows = Object.fromEntries(measure(dist(), { entry: 1, css: 1, pages: { Home: 1 } }).map(([w, kb]) => [w, kb]));
    expect(rows["entry (every page)"]).toBeGreaterThan(0);
    // Home = the entry (shared counted once) + Home's chunk + icons
    expect(rows.Home).toBeGreaterThan(rows["entry (every page)"]);
    expect(rows.Home - rows["entry (every page)"]).toBeLessThan(rows["entry (every page)"]);
    expect(rows.css).toBeLessThan(0.1); // only the stylesheet index.html links
  });

  it("says when a budgeted page's chunk is missing (renamed), instead of passing", () => {
    expect(() => measure(dist(), { entry: 1, css: 1, pages: { Gone: 1 } })).toThrow(/no chunk for Gone/);
  });
});
