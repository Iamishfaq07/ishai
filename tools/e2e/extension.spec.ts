import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";

// The browser extension (apps/extension), loaded unpacked into Chromium: connect it from Orbit's site, clip a job
// from a page's JobPosting data, check keyword coverage, save to the tracker, and fill a Greenhouse-style form,
// leaving the person's own answers alone and never submitting.
const API = "http://127.0.0.1:8000";
type PageHelpers = { __orbitExtension: { extractJob: () => { title: string; company: string; location: string; url: string; description: string }; fillForm: (p: unknown) => { filled: string[] } } };
const WEB = "http://127.0.0.1:5173";
const EXT = resolve("apps/extension/dist");

const JOB_PAGE = `<!doctype html><html><head><title>Backend Engineer - Acme</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Backend Engineer",
"hiringOrganization":{"@type":"Organization","name":"Acme Robotics"},"jobLocation":{"@type":"Place","address":
{"addressLocality":"Bengaluru","addressCountry":"IN"}},"description":"<p>We need <b>Python</b>, PostgreSQL, Kubernetes
and Kafka. Build REST APIs on AWS.</p>"}</script></head><body><h1>Backend Engineer</h1></body></html>`;
const FORM_PAGE = `<!doctype html><html><body><form action="/submit" method="post">
<label for="first_name">First Name</label><input id="first_name" name="job_application[first_name]">
<label for="last_name">Last Name</label><input id="last_name" name="job_application[last_name]">
<label for="email">Email</label><input id="email" name="job_application[email]">
<label for="phone">Phone</label><input id="phone" name="job_application[phone]">
<label for="li">LinkedIn Profile</label><input id="li" name="job_application[answers][0][text_value]">
<label for="salary">Expected salary (CTC)</label><input id="salary" name="salary">
<label for="why">Why do you want to join Acme?</label><textarea id="why" name="why"></textarea>
<button type="submit">Submit application</button></form></body></html>`;

let context: BrowserContext;
let extensionId = "";

test.beforeAll(async () => {
  execFileSync("node", ["apps/extension/build.mjs"], { env: { ...process.env, ORBIT_WEB_URL: WEB, ORBIT_API_URL: API }, stdio: "inherit" });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "orbit-ext-")), {
    // Full Chromium (new headless) loads extensions; ORBIT_E2E_CHROMIUM points at a local build when the pinned one
    // isn't installed.
    ...(process.env.ORBIT_E2E_CHROMIUM ? { executablePath: process.env.ORBIT_E2E_CHROMIUM } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let worker = context.serviceWorkers()[0];
  for (let i = 0; !worker && i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    worker = context.serviceWorkers()[0];
  }
  extensionId = new URL(worker!.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test("connect, clip, check fit, save, and fill without submitting", async () => {
  const email = `ext-${crypto.randomUUID()}@example.com`;
  const signup = await context.request.post(`${API}/v1/auth/register`, { data: { email, password: "correct horse battery", name: "Asha Rao" } });
  expect(signup.status(), await signup.text()).toBe(201);
  await context.request.post(`${API}/v1/resumes`, {
    data: { title: "Main resume", data: { basics: { name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210",
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/asha" }] }, skills: [{ name: "Skills", items: ["Python", "PostgreSQL", "AWS"] }] } },
  });

  const site = await context.newPage();
  await site.goto(`${WEB}/extension/connect`);
  await site.getByRole("button", { name: "Connect the extension" }).click();
  await expect(site.getByText("Connected.", { exact: false })).toBeVisible();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.getByText(`Signed in as ${email}`)).toBeVisible();
  const token = await popup.evaluate(async () => (await chrome.storage.local.get(["token"])).token as string);

  const job = await context.newPage();
  await job.route("https://jobs.example-ats.test/**", (r) => r.fulfill({ contentType: "text/html", body: JOB_PAGE }));
  await job.goto("https://jobs.example-ats.test/acme/backend-engineer");
  await job.addScriptTag({ path: join(EXT, "page.js") });
  const clipped = await job.evaluate(() => (globalThis as unknown as PageHelpers).__orbitExtension.extractJob());
  expect(clipped).toMatchObject({ title: "Backend Engineer", company: "Acme Robotics", location: "Bengaluru, IN" });
  expect(clipped.description).toContain("We need Python, PostgreSQL");

  const call = (path: string, body: unknown) =>
    popup.evaluate(async ([p, b, t]) => {
      const r = await fetch(`http://127.0.0.1:8000${p}`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    }, [path, body, token] as const);
  const fit = await call("/v1/extension/fit", { job_text: `${clipped.title}\n${clipped.description}` });
  expect(fit.status).toBe(200);
  expect(fit.body.matched).toEqual(expect.arrayContaining(["Python", "PostgreSQL", "AWS"]));
  expect(fit.body.missing).toEqual(expect.arrayContaining(["Kafka"]));
  expect((await call("/v1/jobs/tracker/manual", { title: clipped.title, company: clipped.company, url: clipped.url })).status).toBe(201);

  const form = await context.newPage();
  await form.route("https://jobs.example-ats.test/**", (r) => r.fulfill({ contentType: "text/html", body: FORM_PAGE }));
  await form.goto("https://jobs.example-ats.test/acme/apply");
  await form.fill("#last_name", "Typed-By-Me");
  let submitted = false;
  form.on("request", (r) => {
    if (r.method() === "POST") submitted = true;
  });
  const profile = await popup.evaluate(async (t) => (await fetch("http://127.0.0.1:8000/v1/extension/profile", { headers: { Authorization: `Bearer ${t}` } })).json(), token);
  await form.addScriptTag({ path: join(EXT, "page.js") });
  const result = await form.evaluate((p) => (globalThis as unknown as PageHelpers).__orbitExtension.fillForm(p), profile);
  expect(result.filled.sort()).toEqual(["email", "first_name", "linkedin", "phone"]);
  await expect(form.locator("#first_name")).toHaveValue("Asha");
  await expect(form.locator("#last_name")).toHaveValue("Typed-By-Me"); // never overwrites
  await expect(form.locator("#salary")).toHaveValue(""); // the person's own answers
  await expect(form.locator("#why")).toHaveValue("");
  await expect(form.getByRole("status")).toContainText("Orbit never submits");
  await form.waitForTimeout(300);
  expect(submitted).toBe(false);
});
