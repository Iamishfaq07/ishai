// Builds the extension into dist/ (load it unpacked from there, or zip it for the Chrome Web Store / Edge Add-ons).
// ORBIT_WEB_URL: the site (default http://localhost:5173). ORBIT_API_URL: the API (default: the site's /api, as in
// production; set http://localhost:8000 for local development).
// For the end-to-end tests only: ORBIT_APPLY_PACE (default 1, a person's pace) speeds auto-apply's typing and pauses,
// and ORBIT_E2E_GRANT_HOSTS=1 lists the ATS sites as granted up front (a headless browser can't click the permission
// prompt). Store builds use neither.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
// ORBIT_EXTENSION_OUT: another output folder (the end-to-end tests build their own copies).
const out = process.env.ORBIT_EXTENSION_OUT ? resolve(process.env.ORBIT_EXTENSION_OUT) : join(root, "dist");
const web = (process.env.ORBIT_WEB_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const api = (process.env.ORBIT_API_URL ?? `${web}/api`).replace(/\/+$/, "");
const origin = (url) => new URL(url).origin;
const pace = Number(process.env.ORBIT_APPLY_PACE ?? "1");
const grantHosts = process.env.ORBIT_E2E_GRANT_HOSTS === "1";
// Auto-apply's sites (src/lib/autoApply/adapters: keep in step). Asked for only when the candidate turns it on.
const ATS_SITES = ["https://boards.greenhouse.io/*", "https://job-boards.greenhouse.io/*", "https://jobs.lever.co/*", "https://jobs.ashbyhq.com/*"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Each script stands alone (content scripts and injected files can't import), so each is its own IIFE bundle.
const entries = { "popup/popup": "src/popup/popup.ts", page: "src/page/inject.ts", apply: "src/page/apply.ts", connect: "src/connect.ts", background: "src/background.ts" };
for (const [name, entry] of Object.entries(entries)) {
  await build({
    configFile: false,
    logLevel: "warn",
    define: { __ORBIT_WEB_URL__: JSON.stringify(web), __ORBIT_API_URL__: JSON.stringify(api), __ORBIT_APPLY_PACE__: JSON.stringify(pace) },
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
  description: "Clip jobs to Orbit, check your resume's keywords, fill applications to review, and, only if you turn it on, auto-apply for you.",
  icons,
  background: { service_worker: "background.js" },
  action: { default_popup: "popup/popup.html", default_title: "Orbit", default_icon: icons },
  // activeTab: a page is read only when the person clicks the extension on it. No access to any site otherwise.
  // alarms: auto-apply's schedule. tabGroups: labels its tab "Orbit Apply".
  permissions: ["activeTab", "scripting", "storage", "alarms", "tabGroups"],
  // Only Orbit itself: its API, and its "Connect the extension" page.
  host_permissions: [...new Set([`${origin(api)}/*`, `${origin(web)}/*`, ...(grantHosts ? ATS_SITES : [])])],
  // The four ATS sites, asked for only when the candidate turns auto-apply on (and given back when it's turned off).
  optional_host_permissions: grantHosts ? [] : ATS_SITES,
  content_scripts: [{ matches: [`${origin(web)}/extension/connect*`], js: ["connect.js"], run_at: "document_idle" }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Built the extension for ${web} (API ${api}) in ${out}${pace !== 1 ? ` (auto-apply pace ${pace})` : ""}${grantHosts ? " (ATS sites granted, tests only)" : ""}`);
