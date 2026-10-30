import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
// The company's owner: a new address at the company's own domain each run. The run's one admin (ADMIN) can own
// only three companies, so it only grants the plan, from a context of its own.
const DOMAIN = "orbit-workflow-reviews-e2e.com";
const OWNER = `owner-${crypto.randomUUID().slice(0, 8)}@${DOMAIN}`;
async function token(email: string, pattern: RegExp) {
  let value = "";
  await expect.poll(async () => { const text = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? ""; value = pattern.exec(text)?.[1] ?? ""; return value.length; }).toBeGreaterThan(10);
  return value;
}
async function register(context: BrowserContext, email: string, name: string) {
  const r = await context.request.post(`${API}/v1/auth/register`, { data: { email, name, password: "correct horse battery" } });
  // Every Business spec shares the one admin of the run (playwright.config.ts): later specs sign in.
  if (r.status() === 409) {
    const login = await context.request.post(`${API}/v1/auth/login`, { data: { email, password: "correct horse battery" } });
    expect(login.ok(), await login.text()).toBe(true); return (await login.json()).user.id as string;
  }
  expect(r.status(), await r.text()).toBe(201); const id = (await r.json()).user.id as string;
  const verify = await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: await token(email, /verify-email\?token=([\w-]+)/) } });
  expect(verify.ok(), await verify.text()).toBe(true); return id;
}
/** The run's admin, signed in from a context of its own, for the admin-only calls. */
async function asAdmin(browser: Browser) {
  const admin = await browser.newContext();
  await register(admin, ADMIN, "Orbit Admin");
  return admin.request;
}
test("Workflow reviews: independent decisions, changes requested, evidence history and personal inbox", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const owner = await register(context, OWNER, "Morgan Review Owner");
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Northstar Review Studio", website: `https://${DOMAIN}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201); const cid = (await made.json()).id as string; const base = `${API}/v1/business/companies/${cid}`;
  expect((await (await asAdmin(browser)).post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true);
  expect((await context.request.post(`${base}/verification/account`)).ok()).toBe(true);
  const reviewer = await browser.newContext(); await reviewer.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const email = `reviewer-${crypto.randomUUID().slice(0, 8)}@example.com`; const reviewerId = await register(reviewer, email, "Alex Independent Reviewer");
  const invited = await context.request.post(`${base}/invites`, { data: { email, role: "recruiter" } });
  expect(invited.status(), await invited.text()).toBe(201);
  expect((await reviewer.request.post(`${API}/v1/business/invites/accept`, { data: { token: await token(email, /\/business\/invite\/([\w-]+)/) } })).ok()).toBe(true);
  const madeJob = await context.request.post(`${base}/jobs`, { data: { title: "Platform engineer", description_html: "<p>Build Python services and prepare consistent engineering assessment criteria.</p>", workplace: "remote", must_haves: ["Python services"] } });
  expect(madeJob.status(), await madeJob.text()).toBe(201); const jid = (await madeJob.json()).id as string;
  await page.goto(`/business/app/${cid}/workflow-studio`);
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: /Independent launch review/ }).click();
  await page.getByRole("button", { name: "Save playbook", exact: true }).click();
  await expect(page.getByText("Saved revision 1.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Workflow runs (0)", exact: true }).click();
  await page.getByLabel("Default step owner", { exact: true }).selectOption(owner);
  await page.getByRole("button", { name: "Start saved playbook", exact: true }).click();
  for (const n of [1, 2, 3]) {
    await page.getByLabel(`Update note for step ${n}`, { exact: true }).fill(`Prepared checkpoint prerequisite ${n} and reviewed the team responsibilities.`);
    await page.getByRole("button", { name: `Complete step ${n}`, exact: true }).click();
    await expect(page.getByRole("progressbar", { name: "Workflow completion" })).toHaveAttribute("aria-valuenow", String(n * 25));
  }
  await page.getByLabel("Update note for step 4", { exact: true }).fill("This cannot bypass independent approval.");
  await expect(page.getByRole("button", { name: "Complete step 4", exact: true })).toBeDisabled();
  await page.getByLabel("Independent reviewer for step 4", { exact: true }).selectOption(reviewerId);
  await page.getByLabel("Evidence note for step 4", { exact: true }).fill("Review the frozen criteria and panel preparation notes before this checklist closes.");
  await page.getByRole("button", { name: "Request review for step 4", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review: pending" })).toBeVisible();
  const reviewerPage = await reviewer.newPage();
  await reviewerPage.goto(`/business/app/${cid}/workflow-reviews`);
  await expect(reviewerPage.getByRole("heading", { name: "Review launch readiness", exact: true })).toBeVisible();
  await reviewerPage.getByRole("link", { name: "Open checkpoint review", exact: true }).click();
  await expect(reviewerPage.getByRole("button", { name: "Approve checkpoint 4", exact: true })).toBeDisabled();
  await reviewerPage.getByRole("button", { name: "Review evidence and history for step 4", exact: true }).click();
  await reviewerPage.getByLabel("Decision note for step 4", { exact: true }).fill("Please clarify the coordinator handoff note before approving this checkpoint.");
  await reviewerPage.getByLabel("I reviewed this checkpoint evidence snapshot and choose to record my decision.", { exact: true }).check();
  await reviewerPage.getByRole("button", { name: "Request changes for step 4", exact: true }).click();
  await expect(reviewerPage.getByRole("status").filter({ hasText: "Review: changes requested" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review: changes requested" })).toBeVisible();
  await page.getByLabel("Independent reviewer for step 4", { exact: true }).selectOption(reviewerId);
  await page.getByLabel("Evidence note for step 4", { exact: true }).fill("Clarified coordinator handoff responsibilities; review this updated evidence note.");
  await page.getByRole("button", { name: "Request review for step 4", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review: pending" })).toBeVisible();
  await reviewerPage.goto(`/business/app/${cid}/workflow-reviews`);
  await reviewerPage.setViewportSize({ width: 390, height: 844 }); await reviewerPage.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await reviewerPage.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(reviewerPage.getByRole("link", { name: "Open checkpoint review", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page: reviewerPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await reviewerPage.screenshot({ path: info.outputPath("review-inbox-mobile.png"), fullPage: true });
  await reviewerPage.getByRole("link", { name: "Open checkpoint review", exact: true }).click();
  await reviewerPage.getByRole("button", { name: "Review evidence and history for step 4", exact: true }).click();
  await expect(reviewerPage.getByText("Clarified coordinator handoff responsibilities; review this updated evidence note.", { exact: true })).toBeVisible();
  const download = reviewerPage.waitForEvent("download"); await reviewerPage.getByRole("button", { name: "Download review evidence", exact: true }).first().click();
  expect((await download).suggestedFilename()).toBe("orbit-workflow-review-evidence.json");
  await reviewerPage.getByLabel("Decision note for step 4", { exact: true }).fill("Reviewed the clarified checkpoint evidence and approve completion of this checklist.");
  await reviewerPage.getByLabel("I reviewed this checkpoint evidence snapshot and choose to record my decision.", { exact: true }).check();
  expect((await new AxeBuilder({ page: reviewerPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reviewerPage.getByText("Independent review checkpoint", { exact: true }).locator("..").screenshot({ path: info.outputPath("independent-checkpoint-mobile.png") });
  await reviewerPage.getByRole("button", { name: "Approve checkpoint 4", exact: true }).click();
  await expect(reviewerPage.getByRole("progressbar", { name: "Workflow completion" })).toHaveAttribute("aria-valuenow", "100");
  expect((await (await context.request.get(`${base}/jobs/${jid}`)).json()).status).toBe("draft");
  await reviewerPage.goto(`/business/app/${cid}/workflow-reviews`);
  await expect(reviewerPage.getByText("No current checkpoint reviews are assigned to you.", { exact: true })).toBeVisible();
  await reviewer.close();
});
