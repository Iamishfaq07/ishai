// Builds the extension into dist/ (load it unpacked from there, or zip it for the Chrome Web Store / Edge Add-ons).
// ORBIT_WEB_URL: the site (default http://localhost:5173). ORBIT_API_URL: the API (default: the site's /api, as in
// production; set http://localhost:8000 for local development).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
const web = (process.env.ORBIT_WEB_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const api = (process.env.ORBIT_API_URL ?? `${web}/api`).replace(/\/+$/, "");
const origin = (url) => new URL(url).origin;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Each script stands alone (content scripts and injected files can't import), so each is its own IIFE bundle.
const entries = { "popup/popup": "src/popup/popup.ts", page: "src/page/inject.ts", connect: "src/connect.ts", background: "src/background.ts" };
for (const [name, entry] of Object.entries(entries)) {
  await build({
    configFile: false,
    logLevel: "warn",
    define: { __ORBIT_WEB_URL__: JSON.stringify(web), __ORBIT_API_URL__: JSON.stringify(api) },
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: false,
      lib: { entry: join(root, entry), formats: ["iife"], name: "orbit", fileName: () => `${name}.js` },
    },
  });
}

cpSync(join(root, "src/popup/popup.html"), join(out, "popup/popup.html"));
cpSync(join(root, "src/popup/popup.css"), join(out, "popup/popup.css"));
cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });

const icons = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
const manifest = {
  manifest_version: 3,
  name: "Orbit: clip jobs and fill applications",
  short_name: "Orbit",
  version: "0.1.0",
  description: "Clip a job to your Orbit tracker, check your resume's keywords against it, and fill an application's basics for you to review. Never submits.",
  icons,
  background: { service_worker: "background.js" },
  action: { default_popup: "popup/popup.html", default_title: "Orbit", default_icon: icons },
  // activeTab: a page is read only when the person clicks the extension on it. No access to any site otherwise.
  permissions: ["activeTab", "scripting", "storage"],
  // Only Orbit itself: its API, and its "Connect the extension" page.
  host_permissions: [...new Set([`${origin(api)}/*`, `${origin(web)}/*`])],
  content_scripts: [{ matches: [`${origin(web)}/extension/connect*`], js: ["connect.js"], run_at: "document_idle" }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Built the extension for ${web} (API ${api}) in ${out}`);
