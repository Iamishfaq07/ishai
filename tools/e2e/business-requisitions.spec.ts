import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
// The company's owner: a new address at the company's own domain each run. The run's one admin (ADMIN) can own
// only three companies, so it only grants the plan, from a context of its own.
const DOMAIN = "orbit-business-e2e.com";
const OWNER = `owner-${crypto.randomUUID().slice(0, 8)}@${DOMAIN}`;
const password = "correct horse battery";
async function token(email: string, pattern: RegExp) {
  let value = "";
  await expect.poll(async () => {
    const text = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? "";
    value = pattern.exec(text)?.[1] ?? "";
    return value.length;
  }).toBeGreaterThan(10);
  return value;
}
async function register(context: BrowserContext, email: string, name: string) {
  const created = await context.request.post(`${API}/v1/auth/register`, { data: { email, name, password } });
  // Every Business spec shares the one admin of the run (playwright.config.ts): later specs sign in.
  if (created.status() === 409) {
    const login = await context.request.post(`${API}/v1/auth/login`, { data: { email, password: password } });
    expect(login.ok(), await login.text()).toBe(true);
    return (await login.json()).user.id as string;
  }
  expect(created.status(), await created.text()).toBe(201);
  const verification = await token(email, /verify-email\?token=([\w-]+)/);
  const verified = await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: verification } });
  expect(verified.ok(), await verified.text()).toBe(true);
}
/** The run's admin, signed in from a context of its own, for the admin-only calls. */
async function asAdmin(browser: Browser) {
  const admin = await browser.newContext();
  await register(admin, ADMIN, "Orbit Admin");
  return admin.request;
}

test("Business requisition: AI planning, approval, conflict recovery and one private job handoff", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await register(context, OWNER, "Morgan Requester");
  const created = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Requisition Studio", website: `https://${DOMAIN}`, size: "11-50", country: "IN" } });
  expect(created.status(), await created.text()).toBe(201);
  const cid = (await created.json()).id as string;
  const granted = await (await asAdmin(browser)).post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } });
  expect(granted.ok(), await granted.text()).toBe(true);
  const reviewer = await browser.newContext();
  await reviewer.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const email = `reviewer-${crypto.randomUUID().slice(0, 8)}@orbit-business-e2e.com`;
  await register(reviewer, email, "Alex Approver");
  const invited = await context.request.post(`${API}/v1/business/companies/${cid}/invites`, { data: { email, role: "admin" } });
  expect(invited.status(), await invited.text()).toBe(201);
  const invitation = await token(email, /\/business\/invite\/([\w-]+)/);
  const accepted = await reviewer.request.post(`${API}/v1/business/invites/accept`, { data: { token: invitation } });
  expect(accepted.ok(), await accepted.text()).toBe(true);

  const base = `/business/app/${cid}/requisitions`;
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Hiring requests", exact: true })).toBeVisible();
  await page.getByLabel("Role title", { exact: true }).fill("Customer success lead");
  await page.getByRole("button", { name: "Create hiring request", exact: true }).click();
  await expect(page.getByLabel("Business case", { exact: true })).toBeEnabled();
  await page.getByLabel("Business case", { exact: true }).fill("Private growth plan for onboarding coverage across two regions.");
  await page.getByLabel("Measurable role outcomes", { exact: true }).fill("Reduce onboarding handoff delays against a team-agreed baseline.");
  await page.getByLabel("Essential requirements", { exact: true }).fill("Customer onboarding\nProcess improvement");
  await page.getByLabel("Annual budget per position", { exact: true }).fill("1500000");
  await page.getByLabel("Positions", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save request", exact: true })).toBeDisabled();
  await page.getByLabel("Review focus", { exact: true }).selectOption("assessment");
  await page.getByRole("button", { name: "Review saved request with AI", exact: true }).click();
  await expect(page.getByText("Test preview · no AI model called", { exact: true })).toBeVisible();
  await expect(page.getByText("Read source fact", { exact: true }).first()).toBeVisible();

  // Save from a second tab and verify the first retains a stale unsaved draft for download.
  const parallel = await context.newPage(); await parallel.goto(page.url());
  await expect(parallel.getByLabel("Department", { exact: true })).toBeEnabled();
  await parallel.getByLabel("Department", { exact: true }).fill("Customer Success");
  await parallel.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(parallel.getByRole("button", { name: "Save request", exact: true })).toBeDisabled();
  await page.getByLabel("Department", { exact: true }).fill("Unsaved local edit");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(page.getByText("This requisition changed.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Department", { exact: true })).toHaveValue("Unsaved local edit");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download request", exact: true }).click();
  const download = await downloadEvent;
  let backup = ""; for await (const part of (await download.createReadStream())!) backup += part.toString();
  expect(backup).toContain("Unsaved local edit");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Reload request", exact: true }).click();
  await expect(page.getByLabel("Department", { exact: true })).toHaveValue("Customer Success");
  await parallel.close();
  await page.getByLabel("Add approval reviewer", { exact: true }).selectOption({ label: "Alex Approver" });
  await page.getByLabel("Action note", { exact: true }).fill("Please review this headcount and cost envelope.");
  await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(page.getByText("Awaiting approval · revision", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Business case", { exact: true })).toBeDisabled();
  const reviewPage = await reviewer.newPage();
  await reviewPage.goto(page.url());
  await expect(reviewPage.getByRole("button", { name: "Approve current step", exact: true })).toBeVisible();
  await reviewPage.getByLabel("Action note", { exact: true }).fill("Reviewed outcomes and the internal annual budget envelope.");
  await reviewPage.getByRole("button", { name: "Approve current step", exact: true }).click();
  await expect(reviewPage.getByText("Approved · revision", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Reload request", exact: true }).click();
  await page.getByLabel("Action note", { exact: true }).fill("Prepare a draft job for the recruiting team to review.");
  await page.getByRole("button", { name: "Create job draft", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open linked job draft", exact: true })).toBeVisible();
  const detailUrl = page.url();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const violations = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("business-request-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Open linked job draft", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/edit/);
  const rows = await context.request.get(`${API}/v1/business/companies/${cid}/jobs`);
  const jobs = await rows.json();
  expect(jobs).toHaveLength(1); expect(jobs[0].status).toBe("draft");
  const job = await (await context.request.get(`${API}/v1/business/companies/${cid}/jobs/${jobs[0].id}`)).json();
  expect(job.salary_min).toBeNull(); expect(job.salary_max).toBeNull();
  expect(job.description_html).not.toContain("Private growth plan");
  await page.goto(detailUrl);
  await expect(page.getByRole("link", { name: "Open linked job draft", exact: true })).toBeVisible();
  await reviewer.close();
});
