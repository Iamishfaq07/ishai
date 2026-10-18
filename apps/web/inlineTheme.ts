// The head's two small scripts inline in the built index.html, so a page's first paint waits on no request for them:
// the theme (public/theme-init.js: dark or light before the first paint; Lighthouse counted it as render-blocking,
// ~150–300 ms on a phone; DECISIONS D67) and the app's start on the pages built as HTML (public/app-start.js, after
// their first paint; D79). The Content-Security-Policy still forbids inline scripts in general: vite.config.ts hashes
// every inline script in the finished index.html, and the built public pages, the Worker's 404 and the app all reuse
// that file byte for byte. The dev server keeps loading the files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** The scripts index.html loads from public/ that the build puts inline, in order. */
export const INLINE_SCRIPTS = ["theme-init.js", "app-start.js"] as const;

export const scriptTag = (file: string): string => `<script src="/${file}"></script>`;
export const THEME_TAG = scriptTag("theme-init.js");

/** The page with a script's tag replaced by the script itself, its whole-line comments left in the file (every page
 *  carries the script). Throws if the tag isn't there. */
export function inlineScript(html: string, file: string, script: string): string {
  const tag = scriptTag(file);
  if (!html.includes(tag)) throw new Error(`inlineTheme: index.html has no ${tag}`);
  const code = script.replace(/^[ \t]*\/\/.*(?:\r?\n|$)/gm, "").trim();
  return html.replace(tag, () => `<script>${code}</script>`);
}

export const inlineThemeScript = (html: string, script: string): string => inlineScript(html, "theme-init.js", script);

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
      handler: (html) => INLINE_SCRIPTS.reduce((out, file) => inlineScript(out, file, readFileSync(join(publicDir, file), "utf8")), html),
    },
  };
}
