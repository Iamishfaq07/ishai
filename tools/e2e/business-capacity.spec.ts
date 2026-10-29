import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
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
test("Business capacity: approved handoff, recorded hire, AI brief, opt-in alerts and reopened vacancy", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const ownerId = await register(context, ADMIN, "Alex Capacity Owner");
  const domain = ADMIN.split("@")[1]!;
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Capacity Studio", website: `https://${domain}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201);
  const cid = (await made.json()).id as string;
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/verification/account`)).ok()).toBe(true);
  expect((await context.request.post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true);
  const manager = await browser.newContext();
  const managerEmail = `manager-${crypto.randomUUID().slice(0, 8)}@${domain}`;
  await register(manager, managerEmail, "Morgan Hiring Manager");
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/invites`, { data: { email: managerEmail, role: "hiring_manager" } })).status()).toBe(201);
  const invitation = await token(managerEmail, /\/business\/invite\/([\w-]+)/);
  expect((await manager.request.post(`${API}/v1/business/invites/accept`, { data: { token: invitation } })).ok()).toBe(true);
  const root = `${API}/v1/business/companies/${cid}`;
  const data = { title: "Customer onboarding lead", department: "Success", reason: "growth", positions: 1,
    annual_budget_per_position: 100000, currency: "INR", target_date: "2020-01-01", location: "Remote", workplace: "remote",
    business_case: "Improve ownership of customer onboarding and reduce process gaps.", outcomes: "Document the onboarding process and coordinate the first month of implementation.", requirements: ["Customer onboarding"] };
  let row = await (await manager.request.post(`${root}/requisitions`, { data: { request_id: crypto.randomUUID(), data } })).json();
  const action = async (who: BrowserContext, kind: string, extra = {}) => {
    const response = await who.request.post(`${root}/requisitions/${row.id}/actions`, { data: { base_revision: row.revision, action: kind, note: "Reviewed the current request and its capacity assumptions.", ...extra } });
    expect(response.ok(), await response.text()).toBe(true); row = await response.json();
  };
  await action(manager, "submit", { approver_ids: [ownerId] }); await action(context, "approve");
  await page.goto(`/business/app/${cid}/capacity`);
  await expect(page.getByRole("heading", { name: "Hiring capacity", exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting job handoff · Success", { exact: true })).toBeVisible();
  await action(context, "create_job");
  const jid = row.job_id as string;
  expect((await context.request.post(`${root}/jobs/${jid}/publish`)).ok()).toBe(true);
  await page.getByRole("button", { name: "Refresh capacity", exact: true }).click();
  await expect(page.getByText("1 approved · 0 recorded hires · 1 remaining", { exact: true })).toBeVisible();
  await page.getByText("Capacity alert settings", { exact: true }).click();
  await page.getByLabel("Alert owner", { exact: true }).selectOption(ownerId);
  await page.getByLabel("Enable internal capacity alerts", { exact: true }).check();
  await page.getByRole("button", { name: "Save capacity alert", exact: true }).click();
  await page.getByRole("button", { name: "Run opted-in capacity alerts", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 new internal capacity alerts." })).toBeVisible();
  await page.getByRole("button", { name: "Run opted-in capacity alerts", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "0 new internal capacity alerts." })).toBeVisible();
  await page.getByLabel("Planning focus", { exact: true }).selectOption("budget");
  await page.getByRole("button", { name: "Prepare capacity brief", exact: true }).click();
  await expect(page.getByText("Test capacity brief · no AI model called", { exact: true })).toBeVisible();
  const docx = execFileSync(resolve("apps/api/.venv/bin/python"), ["-c", "import io,sys; from docx import Document; d=Document(); d.add_paragraph('Fictional candidate has coordinated customer onboarding with clear process documentation.'); b=io.BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())"]);
  const email = `candidate-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const applied = await context.request.post(`${API}/v1/public/business/jobs/${jid}/apply`, { multipart: {
    name: "Fictional Candidate", email, consent: "true", notice_version: "2026-10-19.2", answers: "[]",
    file: { name: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx },
  } });
  expect(applied.ok(), await applied.text()).toBe(true);
  const applicantToken = await token(email, /\/application\/([\w-]+)/);
  expect((await context.request.post(`${API}/v1/public/business/applications/${applicantToken}/confirm`)).ok()).toBe(true);
  const aid = (await (await context.request.get(`${root}/jobs/${jid}/applications`)).json()).items[0].id as string;
  expect((await context.request.post(`${root}/applications/move`, { data: { ids: [aid], stage_id: "hired", notify: false } })).ok()).toBe(true);
  await page.getByRole("button", { name: "Refresh capacity", exact: true }).click();
  await expect(page.getByText("1 approved · 1 recorded hires · 0 remaining", { exact: true })).toBeVisible();
  await expect(page.getByText("Approved positions filled · Success", { exact: true })).toBeVisible();
  await expect(page.getByText("Test capacity brief · no AI model called", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Run opted-in capacity alerts", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "0 new internal capacity alerts." })).toBeVisible();
  expect((await context.request.post(`${root}/applications/move`, { data: { ids: [aid], stage_id: "applied", notify: false } })).ok()).toBe(true);
  await page.getByRole("button", { name: "Refresh capacity", exact: true }).click();
  await expect(page.getByText("1 approved · 0 recorded hires · 1 remaining", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run opted-in capacity alerts", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 new internal capacity alerts." })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download capacity snapshot", exact: true }).click();
  const downloaded = await downloadEvent; expect(downloaded.suggestedFilename()).toBe("orbit-hiring-capacity.json");
  let exportText = ""; for await (const chunk of (await downloaded.createReadStream())!) exportText += chunk.toString();
  expect(exportText).not.toContain("Fictional Candidate"); expect(exportText).not.toContain(applicantToken);
  const managerData = await (await manager.request.get(`${root}/capacity`)).json();
  expect(managerData.items[0].hired).toBe(0); expect(managerData.can_manage).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); window.scrollTo(0, 0); });
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("business-capacity-mobile.png"), fullPage: true });
  await manager.close();
});
