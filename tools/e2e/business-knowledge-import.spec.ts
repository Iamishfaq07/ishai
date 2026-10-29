import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
// The company's owner: a new address at the company's own domain each run. The run's one admin (ADMIN) can own
// only three companies, so it only grants the plan, from a context of its own.
const DOMAIN = "orbit-import-e2e.com";
const OWNER = `owner-${crypto.randomUUID().slice(0, 8)}@${DOMAIN}`;
async function token(email: string, pattern: RegExp) {
  let value = "";
  await expect.poll(async () => {
    const message = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? "";
    value = pattern.exec(message)?.[1] ?? ""; return value.length;
  }).toBeGreaterThan(10);
  return value;
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
}
/** The run's admin, signed in from a context of its own, for the admin-only calls. */
async function asAdmin(browser: Browser) {
  const admin = await browser.newContext();
  await register(admin, ADMIN, "Orbit Admin");
  return admin.request;
}
test("Business policy import: DOCX tables, optional AI, reviewed draft, explicit publication and duplicate warning", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await register(context, OWNER, "Alex Policy Owner");
  const domain = DOMAIN;
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Import Studio", website: `https://${domain}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201);
  const cid = (await made.json()).id as string;
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/verification/account`)).ok()).toBe(true);
  expect((await (await asAdmin(browser)).post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true);
  const reader = await browser.newContext(); await reader.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const email = `reader-${crypto.randomUUID().slice(0, 8)}@${domain}`;
  await register(reader, email, "Pat Interviewer");
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/invites`, { data: { email, role: "interviewer" } })).status()).toBe(201);
  const invitation = await token(email, /\/business\/invite\/([\w-]+)/);
  expect((await reader.request.post(`${API}/v1/business/invites/accept`, { data: { token: invitation } })).ok()).toBe(true);
  const docx = execFileSync(resolve("apps/api/.venv/bin/python"), ["-c", "import io,sys; from docx import Document; d=Document(); d.add_paragraph('Interview policy: submit independent scorecards before reading peer feedback.'); t=d.add_table(rows=2,cols=2); t.cell(0,0).text='Step'; t.cell(0,1).text='Owner'; t.cell(1,0).text='Submit scorecard'; t.cell(1,1).text='Interviewer'; d.add_paragraph('Then discuss observed evidence with the coordinator.'); b=io.BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())"]);
  await page.goto(`/business/app/${cid}/knowledge`);
  await page.getByRole("button", { name: "Import policy file", exact: true }).click();
  await page.getByLabel("Policy source file", { exact: true }).setInputFiles({ name: "Interview policy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
  await page.getByRole("button", { name: "Extract policy text", exact: true }).click();
  await expect(page.getByLabel("Extracted policy text", { exact: true })).toContainText("Step | Owner");
  await expect(page.getByLabel("Extracted policy text", { exact: true })).toContainText("Submit scorecard | Interviewer");
  await expect(page.getByRole("button", { name: "Save imported draft", exact: true })).toBeDisabled();
  const library = `${API}/v1/business/companies/${cid}/knowledge`;
  expect((await (await context.request.get(library)).json()).items).toHaveLength(0);
  await page.getByRole("button", { name: "Review extraction with AI", exact: true }).click();
  await expect(page.getByText("Test extraction review · no AI model called", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save imported draft", exact: true })).toBeDisabled();
  const extracted = await page.getByLabel("Extracted policy text", { exact: true }).inputValue();
  await page.getByLabel("Extracted policy text", { exact: true }).fill(extracted + "\nAsk the coordinator to clarify any missing observation.");
  await expect(page.getByText("Test extraction review · no AI model called", { exact: true })).toHaveCount(0);
  await page.getByLabel("Audience after publication", { exact: true }).selectOption("all_hiring");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download import preview", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("orbit-policy-import-preview.json");
  await page.getByLabel("I reviewed this text against the original and checked what extraction may omit.", { exact: true }).check();
  await page.getByRole("button", { name: "Save imported draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Imported source", exact: true })).toBeVisible();
  await expect(page.getByText("Text was edited before the imported draft was saved.", { exact: false })).toBeVisible();
  expect((await (await reader.request.get(library)).json()).items).toHaveLength(0);
  await page.getByLabel("Publication action note", { exact: true }).fill("Checked the imported text against the original source before publication.");
  await page.getByRole("button", { name: "Publish saved version", exact: true }).click();
  const available = await (await reader.request.get(library)).json();
  expect(available.items).toHaveLength(1);
  const readerPage = await reader.newPage(); await readerPage.goto(`/business/app/${cid}/knowledge?document=${available.items[0].id}`);
  await expect(readerPage.getByText("Ask the coordinator to clarify any missing observation.", { exact: false })).toBeVisible();
  await expect(readerPage.getByRole("heading", { name: "Imported source", exact: true })).toHaveCount(0);
  await expect(readerPage.getByRole("button", { name: "Import policy file", exact: true })).toHaveCount(0);
  // Re-importing the same bytes warns without overwriting the saved publication.
  await page.goto(`/business/app/${cid}/knowledge?import=1`);
  await page.getByLabel("Policy source file", { exact: true }).setInputFiles({ name: "Interview policy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
  await page.getByRole("button", { name: "Extract policy text", exact: true }).click();
  await expect(page.getByText("This source file was imported before", { exact: true })).toBeVisible();
  expect((await (await context.request.get(library)).json()).items).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); window.scrollTo(0, 0); });
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("business-policy-import-mobile.png"), fullPage: true });
  await reader.close();
});
