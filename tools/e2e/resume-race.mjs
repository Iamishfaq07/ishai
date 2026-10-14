// Browser check for the resume save race and two-tab conflicts (V3-06). Not part of CI yet.
// Run against a local API (port 8000, ORBIT_ENV=development, open sign-up) and the web dev server (port 5173):
//   npm i playwright@1.56.0 && node tools/e2e/resume-race.mjs <screenshot dir>
// CHROMIUM=/path/to/chrome picks the browser binary (default: Playwright's own).
// Expected: "server kept for A: \"A edited v2\"" (the old editor kept v1), and a conflict in tab two.
import { chromium } from "playwright";
const API = "http://localhost:8000", WEB = "http://localhost:5173";
const out = process.argv[2] || ".";
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const email = `race-${Date.now()}@example.com`;
const reg = await ctx.request.post(`${API}/v1/auth/register`, { data: { email, password: "correct horse battery", name: "Ana" }, headers: { Origin: WEB } });
if (reg.status() !== 201) throw new Error("register " + reg.status() + " " + (await reg.text()));
const page = await ctx.newPage();
await page.goto(`${WEB}/`);
await page.getByRole("button", { name: "OK" }).click().catch(() => undefined); // the cookie notice
const mk = async () => {
  await page.goto(`${WEB}/resume-ai`);
  await page.getByText("Create a resume").first().click();
  await page.getByText("Start from scratch").click();
  await page.waitForURL(/\/resume-ai\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByLabel("Resume name").waitFor({ timeout: 30000 });
  return page.url().split("/").pop();
};
const A = await mk(), B = await mk();
const server = async (id) => page.evaluate(async ([api, rid]) => (await fetch(`${api}/v1/resumes/${rid}`, { credentials: "include" })).json(), [API, id]);
// Hold the FIRST save of A for 3 s, as a slow connection would.
let held = 0;
await page.route(`${API}/v1/resumes/${A}`, async (route) => {
  if (route.request().method() === "PUT" && held++ === 0) await new Promise((r) => setTimeout(r, 3000));
  await route.continue();
});
await page.goto(`${WEB}/resume-ai/${A}`);
const title = page.getByLabel("Resume name");
await title.waitFor();
await title.fill("A edited v1");
await page.waitForTimeout(1300); // the autosave of v1 starts and is held
await title.fill("A edited v2");
// Move to B right away (client-side), as clicking another resume would: the editor flushes A's v2.
await page.evaluate((b) => { window.history.pushState({}, "", `/resume-ai/${b}`); window.dispatchEvent(new PopStateEvent("popstate")); }, B);
await page.getByLabel("Resume name").waitFor();
await page.waitForTimeout(4500); // both saves of A have finished by now
const saved = await server(A);
console.log("server kept for A:", JSON.stringify(saved.title), "revision", saved.revision);
// Back to A: the editor shows what the server kept.
await page.evaluate((a) => { window.history.pushState({}, "", `/resume-ai/${a}`); window.dispatchEvent(new PopStateEvent("popstate")); }, A);
await page.waitForFunction(() => document.querySelector('input[aria-label="Resume name"]')?.value?.startsWith("A edited"));
console.log("editor shows for A:", JSON.stringify(await page.getByLabel("Resume name").inputValue()));

// Two tabs on B: tab 2 opened before tab 1 saved, so tab 2's save is a conflict, not an overwrite.
const tab1 = page, tab2 = await ctx.newPage();
await tab1.evaluate((b) => { window.history.pushState({}, "", `/resume-ai/${b}`); window.dispatchEvent(new PopStateEvent("popstate")); }, B);
await tab2.goto(`${WEB}/resume-ai/${B}`);
await tab1.getByLabel("Resume name").waitFor();
await tab2.getByLabel("Resume name").waitFor();
await tab1.getByLabel("Resume name").fill("B from tab one");
await tab1.getByText("Saved", { exact: false }).first().waitFor();
await tab1.waitForTimeout(1500);
await tab2.getByLabel("Resume name").fill("B from tab two");
await tab2.getByText("Saved in another tab or device").waitFor({ timeout: 8000 });
await tab2.screenshot({ path: `${out}/conflict.png`, clip: { x: 0, y: 0, width: 1280, height: 220 } });
const b = await server(B);
console.log("tab two saw a conflict; server kept for B:", JSON.stringify(b.title));
await tab2.getByRole("button", { name: "Load the latest" }).click();
await tab2.getByText("weren't saved").waitFor({ timeout: 8000 });
await tab2.screenshot({ path: `${out}/draft.png`, clip: { x: 0, y: 0, width: 1280, height: 320 } });
console.log("tab two after Load the latest:", JSON.stringify(await tab2.getByLabel("Resume name").inputValue()), "(draft offered)");
await browser.close();
