import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
// The company's owner: a new address at the company's own domain each run. The run's one admin (ADMIN) can own
// only three companies, so it only grants the plan, from a context of its own.
const DOMAIN = "orbit-review-e2e.com";
const OWNER = `owner-${crypto.randomUUID().slice(0, 8)}@${DOMAIN}`;
async function token(email: string, pattern: RegExp) {
  let result = "";
  await expect.poll(async () => {
    const text = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? "";
    result = pattern.exec(text)?.[1] ?? ""; return result.length;
  }).toBeGreaterThan(10);
  return result;
}
async function register(context: BrowserContext, email: string, name: string) {
  const response = await context.request.post(`${API}/v1/auth/register`, { data: { email, name, password: "correct horse battery" } });
  // Every Business spec shares the one admin of the run (playwright.config.ts): later specs sign in.
  if (response.status() === 409) {
    const login = await context.request.post(`${API}/v1/auth/login`, { data: { email, password: "correct horse battery" } });
    expect(login.ok(), await login.text()).toBe(true);
    return (await login.json()).user.id as string;
  }
  expect(response.status(), await response.text()).toBe(201);
  const verification = await token(email, /verify-email\?token=([\w-]+)/);
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: verification } })).ok()).toBe(true);
  return (await response.json()).user.id as string;
}
/** The run's admin, signed in from a context of its own, for the admin-only calls. */
async function asAdmin(browser: Browser) {
  const admin = await browser.newContext();
  await register(admin, ADMIN, "Orbit Admin");
  return admin.request;
}

test("Business policy review: owner, opt-in reminder, AI brief, update flag and safe confirmation", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const ownerId = await register(context, OWNER, "Alex Policy Owner");
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Review Studio", website: `https://${DOMAIN}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201);
  const cid = (await made.json()).id as string;
  expect((await (await asAdmin(browser)).post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true);
  const reader = await browser.newContext(); await reader.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const email = `reader-${crypto.randomUUID().slice(0, 8)}@orbit-review-e2e.com`;
  await register(reader, email, "Pat Interviewer");
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/invites`, { data: { email, role: "interviewer" } })).status()).toBe(201);
  const invitation = await token(email, /\/business\/invite\/([\w-]+)/);
  expect((await reader.request.post(`${API}/v1/business/invites/accept`, { data: { token: invitation } })).ok()).toBe(true);
  const knowledge = `${API}/v1/business/companies/${cid}/knowledge`;
  const reviews = `${API}/v1/business/companies/${cid}/knowledge-reviews`;
  const content = { title: "Independent interview feedback", body: "Interview feedback policy: submit your independent scorecard before reading peer feedback. Record observed evidence and discuss disagreements in the debrief.", category: "interview", audience: "all_hiring", review_due: "2020-01-01" };
  const draft = await context.request.post(knowledge, { data: { request_id: crypto.randomUUID(), data: content } });
  expect(draft.ok(), await draft.text()).toBe(true);
  let document = await draft.json();
  const published = await context.request.post(`${knowledge}/${document.id}/actions`, { data: { base_revision: document.revision, action: "publish", note: "Reviewed guidance for the company hiring team." } });
  document = await published.json();
  const privateText = "Private draft: this alternative instruction is proposed only and must not replace the published guidance yet.";
  const saved = await context.request.put(`${knowledge}/${document.id}`, { data: { base_revision: document.revision, data: { ...content, body: privateText, audience: "coordinators" } } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/business/app/${cid}/knowledge-reviews`);
  await expect(page.getByRole("heading", { name: "Policy review inbox", exact: true })).toBeVisible();
  await page.getByText("Coordinate review", { exact: true }).click();
  await expect(page.getByLabel("Review owner", { exact: true })).toHaveValue(ownerId);
  await page.getByLabel("Enable internal reminders for the assigned owner", { exact: true }).check();
  await page.getByLabel("Review note", { exact: true }).fill("Assign review responsibility and enable internal reminders.");
  await page.getByRole("button", { name: "Save review owner", exact: true }).click();
  await page.getByText("Coordinate review", { exact: true }).click();
  await expect(page.getByLabel("Enable internal reminders for the assigned owner", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Run opted-in reminders", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "new internal reminder" })).toBeVisible();
  await page.getByRole("button", { name: "Run opted-in reminders", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "0 new internal reminders" })).toBeVisible();
  const notifications = await (await context.request.get(`${API}/v1/business/notifications`)).json();
  expect(notifications.filter((n: { kind: string }) => n.kind === "knowledge_review")).toHaveLength(1);
  await page.getByRole("button", { name: "Review changes with AI", exact: true }).click();
  await expect(page.getByText("Test review · no AI model called", { exact: true })).toBeVisible();
  await page.getByLabel("Review note", { exact: true }).fill("Review the changed procedure before company members use it.");
  await page.getByRole("button", { name: "Request document updates", exact: true }).click();
  await expect(page.getByText("Updates requested · published version", { exact: false })).toBeVisible();
  const readerPage = await reader.newPage(); await readerPage.goto(`/business/app/${cid}/knowledge`);
  await readerPage.getByLabel("Your question", { exact: true }).fill("How should independent interview feedback be recorded?");
  await readerPage.getByRole("button", { name: "Ask with sources", exact: true }).click();
  await expect(readerPage.getByText("A cited document has been flagged for updates", { exact: false })).toBeVisible();
  await page.getByText("Coordinate review", { exact: true }).click();
  const nextDate = await page.getByLabel("Next review date", { exact: true }).inputValue();
  await page.getByLabel("Review note", { exact: true }).fill("Confirmed only the current published guidance remains accurate.");
  await page.getByRole("button", { name: "Confirm published guidance", exact: true }).click();
  await expect(page.getByText("Scheduled · published version", { exact: false })).toBeVisible();
  const current = await (await context.request.get(`${knowledge}/${document.id}`)).json();
  expect(current.published.body).toBe(content.body); expect(current.published.audience).toBe("all_hiring");
  expect(current.published.review_due).toBe(nextDate); expect(current.data.body).toBe(privateText);
  expect(current.data.audience).toBe("coordinators"); expect(current.needs_update).toBe(false);
  await readerPage.getByRole("button", { name: "Refresh library", exact: true }).click();
  await expect(readerPage.getByText("Test preview · no AI model called", { exact: true })).toHaveCount(0);
  await readerPage.getByRole("button", { name: "Ask with sources", exact: true }).click();
  await expect(readerPage.getByText("Test preview · no AI model called", { exact: true })).toBeVisible();
  await expect(readerPage.getByText("A cited document has been flagged for updates", { exact: false })).toHaveCount(0);
  // A stale review action retains its note and offers a portable backup.
  await page.getByText("Coordinate review", { exact: true }).click();
  const changed = await context.request.put(`${reviews}/${document.id}/owner`, { data: { base_revision: current.revision, owner_id: ownerId, reminders: false, note: "Disable reminders in another coordinator's current tab." } });
  expect(changed.ok(), await changed.text()).toBe(true);
  await page.getByLabel("Review note", { exact: true }).fill("Retain this unsaved note when the review changes elsewhere.");
  await page.getByRole("button", { name: "Confirm published guidance", exact: true }).click();
  await expect(page.getByText("This document changed.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Review note", { exact: true })).toHaveValue("Retain this unsaved note when the review changes elsewhere.");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review notes", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("orbit-policy-review-draft.json");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.evaluate(() => window.scrollTo(0, 0));
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("business-policy-reviews-mobile.png"), fullPage: true });
  await reader.close();
});
