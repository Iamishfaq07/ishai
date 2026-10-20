import { expect, test, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

const API = "http://127.0.0.1:8105";
async function candidate(context: BrowserContext) {
  const email = `personal-hosted-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: { email, name: "Asha Candidate", password: "hosted fixture password" } });
  expect(registered.status(), await registered.text()).toBe(201);
  let token = "";
  await expect.poll(async () => {
    const mail = (await readFile(resolve("apps/api/hosted-e2e-outbox.txt"), "utf8")).split("--- to=").filter((m) => m.startsWith(email)).at(-1) ?? "";
    token = /verify-email\?token=([\w-]+)/.exec(mail)?.[1] ?? "";
    return token.length > 10;
  }).toBe(true);
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token } })).ok()).toBe(true);
  const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "Approved career resume",
    data: { basics: { name: "Asha Candidate", email, headline: "Backend engineer", phone: "+91 9876543210", location: "Bengaluru, India" }, skills: [{ name: "Skills", items: ["Python", "PostgreSQL"] }] } } });
  expect(created.status(), await created.text()).toBe(201);
  const rid = (await created.json()).id as string;
  const profile = await context.request.put(`${API}/v1/jobs/profile`, { data: { resume_id: rid, prefs: { titles: ["Backend Engineer"], skills: ["Python"], locations: ["Bengaluru"], workplace: ["remote", "hybrid", "onsite"], posted_within: 30 } } });
  expect(profile.ok(), await profile.text()).toBe(true);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
}

for (const mobile of [false, true]) test(`personal hosted setup, explicit consent and runtime status (${mobile ? "mobile" : "desktop"})`, async ({ page, context }, info) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await candidate(context);
  await page.goto("/jobs/auto-apply");
  await expect(page.getByRole("heading", { name: "Set up Orbit Apply" })).toBeVisible();
  await page.getByRole("button", { name: "Approve this resume", exact: true }).click();
  await page.getByRole("button", { name: /Mode and limits/ }).click();
  await page.getByRole("radio", { name: /Hosted · continue when my browser is closed/ }).check();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`personal-hosted-mode-${mobile ? "mobile" : "desktop"}.png`), fullPage: true });
  await page.getByRole("button", { name: /Consent$/ }).click();
  await page.getByLabel("I agree", { exact: true }).check();
  await expect(page.getByRole("button", { name: "Save and turn on", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I authorise hosted applications/ }).check();
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/v1/apply/setup") && r.request().method() === "PUT"),
    page.getByRole("button", { name: "Save and turn on", exact: true }).click(),
  ]);
  expect(saved.ok(), await saved.text()).toBe(true);
  await expect(page.getByTestId("hosted-state")).toBeVisible();
  const setup = await (await context.request.get(`${API}/v1/apply/setup`)).json();
  expect(setup.execution).toBe("hosted"); expect(setup.hosted_consent_at).toBeTruthy();
  const heartbeat = await context.request.post(`${API}/v1/internal/apply/heartbeat`, {
    headers: { "X-Orbit-Worker-Secret": "hosted-browser-tests-fixture-1234567890" }, data: { worker_id: `fixture-worker-${crypto.randomUUID()}` } });
  expect(heartbeat.ok(), await heartbeat.text()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("hosted-state")).toContainText("Hosted applying is ready");
  await page.goto("/jobs/journey");
  await page.getByText(/^Your full career journey ·/).click();
  await expect(page.getByRole("heading", { name: "Choose where applications run" })).toBeVisible();
  await expect(page.getByText("Hosted worker online · supported applications can continue with your browser closed.", { exact: true })).toBeVisible();
});
