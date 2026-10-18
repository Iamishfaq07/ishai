// Records sanitized fixtures of real, public ATS application pages (Greenhouse, Lever, Ashby) for the extension's
// auto-apply tests. Run by hand, once, from the repository root: `node tools/e2e/ats-fixtures/record.mjs`.
// Headless, throwaway profile, GET only: every request that could submit anything is aborted (Ashby's page loads its
// form through read-only GraphQL queries over POST; those are let through, mutations are not). The saved HTML has its
// scripts, iframes, inline handlers and tokens removed; external stylesheets are inlined so visibility is realistic.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = {
  "greenhouse-gitlab": "https://job-boards.greenhouse.io/gitlab/jobs/8860302002",
  "greenhouse-discord": "https://job-boards.greenhouse.io/discord/jobs/8806482002",
  "lever-palantir": "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply",
  "lever-spotify": "https://jobs.lever.co/spotify/223f9722-3579-4ff2-b123-e4cc7b0c1a64/apply",
  "ashby-linear": "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff/application",
  "ashby-notion": "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application",
};
const only = process.argv.slice(2);

const browser = await chromium.launch({ headless: true, ...(process.env.ORBIT_E2E_CHROMIUM ? { executablePath: process.env.ORBIT_E2E_CHROMIUM } : {}) });
for (const [name, url] of Object.entries(PAGES)) {
  if (only.length && !only.includes(name)) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.continue();
    const body = req.postData() ?? "";
    if (req.method() === "POST" && /graphql/i.test(req.url()) && !/mutation/i.test(body)) return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
  await page.waitForSelector("form input, input[type=file]", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const html = await page.evaluate(async () => {
    const inlined = [];
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      try {
        inlined.push(await (await fetch(link.href)).text());
      } catch {
        /* cross-origin stylesheet that won't fetch: dropped */
      }
      link.remove();
    }
    for (const sheet of document.styleSheets) {
      // CSS-in-JS rules inserted with insertRule never appear in the <style> text: write them out.
      try {
        const owner = sheet.ownerNode;
        if (owner instanceof HTMLStyleElement && !owner.textContent.trim()) owner.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      } catch {
        /* cross-origin */
      }
    }
    for (const css of inlined) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.querySelectorAll("script, noscript, iframe, link[rel=preload], link[rel=modulepreload], link[rel=prefetch], meta[http-equiv]").forEach((el) => el.remove());
    for (const el of document.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
    document.querySelectorAll('input[type=hidden][name*="token" i], input[name="authenticity_token"], input[name*="csrf" i]').forEach((el) => el.setAttribute("value", "fixture"));
    // Lever embeds each question card's whole template (thousands of options) in a hidden input: not needed.
    document.querySelectorAll('input[type=hidden][name$="[baseTemplate]"]').forEach((el) => el.setAttribute("value", "{}"));
    document.querySelectorAll('input[name="timezone"]').forEach((el) => el.setAttribute("value", "UTC"));
    for (const style of document.querySelectorAll("style")) style.textContent = style.textContent.replace(/@font-face\s*{[^}]*}/g, "").replace(/url\(["']?data:[^)]*\)/g, "none");
    document.querySelectorAll("form[action]").forEach((f) => f.setAttribute("action", "/submit"));
    return "<!doctype html>\n" + document.documentElement.outerHTML;
  });
  writeFileSync(join(here, `${name}.html`), `<!-- Recorded ${new Date().toISOString().slice(0, 10)} from ${url} (public page, sanitized) -->\n${html}`);
  console.log(name, html.length);
  await context.close();
}
await browser.close();
