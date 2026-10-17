// The theme script (public/theme-init.js: dark or light before the first paint) inline in the built index.html, so
// a page's first paint waits on one request fewer (Lighthouse counted it as render-blocking, ~150–300 ms on a phone;
// DECISIONS D67). The Content-Security-Policy still forbids inline scripts in general: vite.config.ts hashes every
// inline script in the finished index.html, and the built public pages, the Worker's 404 and the app all reuse that
// file byte for byte. The dev server keeps loading the file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

export const THEME_TAG = '<script src="/theme-init.js"></script>';

/** The page with the theme script's tag replaced by the script itself. Throws if the tag isn't there. */
export function inlineThemeScript(html: string, script: string): string {
  if (!html.includes(THEME_TAG)) throw new Error(`inlineTheme: index.html has no ${THEME_TAG}`);
  return html.replace(THEME_TAG, () => `<script>${script.trim()}</script>`);
}

export function inlineTheme(): Plugin {
  let publicDir = "public";
  return {
    name: "orbit-inline-theme",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => inlineThemeScript(html, readFileSync(join(publicDir, "theme-init.js"), "utf8")),
    },
  };
}
