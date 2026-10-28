import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
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
  expect(response.status(), await response.text()).toBe(201);
  const verification = await token(email, /verify-email\?token=([\w-]+)/);
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: verification } })).ok()).toBe(true);
}

test("Business reading: published text, AI help, explicit receipts, changed guidance and team coverage", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await register(context, ADMIN, "Alex Policy Owner");
  const domain = ADMIN.split("@")[1]!;
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Reading Studio", website: `https://${domain}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201);
  const cid = (await made.json()).id as string;
  expect((await context.request.post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true);
  const reader = await browser.newContext(); await reader.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const email = `reader-${crypto.randomUUID().slice(0, 8)}@${domain}`;
  await register(reader, email, "Pat Interviewer");
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/invites`, { data: { email, role: "interviewer" } })).status()).toBe(201);
  const invitation = await token(email, /\/business\/invite\/([\w-]+)/);
  expect((await reader.request.post(`${API}/v1/business/invites/accept`, { data: { token: invitation } })).ok()).toBe(true);
  const knowledge = `${API}/v1/business/companies/${cid}/knowledge`;
  const content = { title: "Independent interview feedback", body: "Interview feedback policy: submit your independent scorecard before reading peer feedback. Record observed evidence and discuss disagreements in the debrief.", category: "interview", audience: "all_hiring", review_due: "" };
  const draft = await context.request.post(knowledge, { data: { request_id: crypto.randomUUID(), data: content } });
  let document = await draft.json();
  document = await (await context.request.post(`${knowledge}/${document.id}/actions`, { data: { base_revision: document.revision, action: "publish", note: "Reviewed guidance for the company hiring team." } })).json();
  const privateText = "PRIVATE DRAFT: proposed wording that is not approved for company readers. The reader must never see this text here.";
  const saved = await context.request.put(`${knowledge}/${document.id}`, { data: { base_revision: document.revision, data: { ...content, body: privateText, audience: "coordinators" } } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const readerPage = await reader.newPage();
  await readerPage.goto(`/business/app/${cid}/knowledge-reading`);
  await expect(readerPage.getByRole("heading", { name: "Team reading desk", exact: true })).toBeVisible();
  await expect(readerPage.getByRole("link", { name: "Verify", exact: true })).toHaveCount(0);
  await expect(readerPage.getByRole("button", { name: "Team coverage", exact: true })).toHaveCount(0);
  await readerPage.getByRole("button", { name: `Read ${content.title}`, exact: true }).click();
  await expect(readerPage.getByTestId("published-reading-text")).toHaveText(content.body);
  await expect(readerPage.getByText(privateText, { exact: true })).toHaveCount(0);
  await expect(readerPage.getByRole("button", { name: "Record my acknowledgement", exact: true })).toBeDisabled();
  await readerPage.getByRole("button", { name: "Prepare AI reading guide", exact: true }).click();
  await expect(readerPage.getByText("Test reading guide · no AI model called", { exact: true })).toBeVisible();
  await expect(readerPage.getByRole("button", { name: "Record my acknowledgement", exact: true })).toBeDisabled();
  await readerPage.getByLabel("I personally read the full published text shown above.", { exact: true }).check();
  await readerPage.getByRole("button", { name: "Record my acknowledgement", exact: true }).click();
  await expect(readerPage.getByRole("button", { name: "Download my receipt", exact: true })).toBeVisible();
  const receiptEvent = readerPage.waitForEvent("download");
  await readerPage.getByRole("button", { name: "Download my receipt", exact: true }).click();
  expect((await receiptEvent).suggestedFilename()).toBe("orbit-reading-receipt.json");
  await page.goto(`/business/app/${cid}/knowledge-reading`);
  await page.getByRole("button", { name: "Team coverage", exact: true }).click();
  await expect(page.getByText("1 of 2 eligible readers acknowledged current text · 1 remaining", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `View readers for ${content.title}`, exact: true }).click();
  await expect(page.getByText("Pat Interviewer", { exact: true })).toBeVisible();
  // A stale page cannot acknowledge changed wording; preserve its view until an explicit reload.
  const nextBody = content.body + " Ask the coordinator to clarify any missing observation before the panel debrief.";
  let current = await (await context.request.get(`${knowledge}/${document.id}`)).json();
  current = await (await context.request.put(`${knowledge}/${document.id}`, { data: { base_revision: current.revision, data: { ...content, body: nextBody } } })).json();
  expect((await context.request.post(`${knowledge}/${document.id}/actions`, { data: { base_revision: current.revision, action: "publish", note: "Publish clarified instructions for the next hiring panel." } })).ok()).toBe(true);
  await readerPage.getByRole("button", { name: "Reload published text", exact: true }).click();
  await expect(readerPage.getByTestId("published-reading-text")).toHaveText(nextBody);
  await expect(readerPage.getByText("Updated since you last acknowledged", { exact: false })).toBeVisible();
  await expect(readerPage.getByLabel("I personally read the full published text shown above.", { exact: true })).not.toBeChecked();
  await readerPage.getByLabel("I personally read the full published text shown above.", { exact: true }).check();
  // Publish another update after the checkbox is checked to exercise the content-hash conflict.
  current = await (await context.request.get(`${knowledge}/${document.id}`)).json();
  current = await (await context.request.put(`${knowledge}/${document.id}`, { data: { base_revision: current.revision, data: { ...content, body: nextBody + " Record the clarification." } } })).json();
  expect((await context.request.post(`${knowledge}/${document.id}/actions`, { data: { base_revision: current.revision, action: "publish", note: "Publish the final observation clarification step." } })).ok()).toBe(true);
  await readerPage.getByRole("button", { name: "Record my acknowledgement", exact: true }).click();
  await expect(readerPage.getByText("Published guidance changed.", { exact: false })).toBeVisible();
  await expect(readerPage.getByLabel("I personally read the full published text shown above.", { exact: true })).not.toBeChecked();
  await readerPage.getByRole("button", { name: "Reload published text", exact: true }).click();
  await expect(readerPage.getByTestId("published-reading-text")).toContainText("Record the clarification.");
  await readerPage.getByLabel("I personally read the full published text shown above.", { exact: true }).check();
  await readerPage.getByRole("button", { name: "Record my acknowledgement", exact: true }).click();
  await expect(readerPage.getByRole("button", { name: "Download my receipt", exact: true })).toBeVisible();
  await readerPage.getByRole("button", { name: "Withdraw my acknowledgement", exact: true }).click();
  await expect(readerPage.getByRole("button", { name: "Download my receipt", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh coverage", exact: true }).click();
  await expect(page.getByText("0 of 2 eligible readers acknowledged current text · 2 remaining", { exact: true })).toBeVisible();
  for (const target of [page, readerPage]) {
    await target.setViewportSize({ width: 390, height: 844 });
    await target.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await target.evaluate(() => { document.documentElement.classList.add("dark"); window.scrollTo(0, 0); });
    const audit = await new AxeBuilder({ page: target }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await readerPage.screenshot({ path: info.outputPath("business-reading-mobile.png"), fullPage: true });
  await reader.close();
});
