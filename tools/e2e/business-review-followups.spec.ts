import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
const password = "correct horse battery";
async function mailToken(email: string, pattern: RegExp) {
  let value = "";
  await expect.poll(async () => { const text = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? ""; value = pattern.exec(text)?.[1] ?? ""; return value.length; }).toBeGreaterThan(10);
  return value;
}
async function register(context: BrowserContext, email: string, name: string) {
  const result = await context.request.post(`${API}/v1/auth/register`, { data: { email, name, password } });
  if (email === ADMIN && result.status() === 409) { const login = await context.request.post(`${API}/v1/auth/login`, { data: { email, password } }); expect(login.ok(), await login.text()).toBe(true); return (await login.json()).user.id as string; }
  expect(result.status(), await result.text()).toBe(201); const id = (await result.json()).user.id as string;
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: await mailToken(email, /verify-email\?token=([\w-]+)/) } })).ok()).toBe(true); return id;
}
test("Review follow-ups: opt-in due date, personal pause, independent handoff and retained evidence", async ({ page, context, browser }, info) => {
  test.setTimeout(90000);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const domain = `followups-${crypto.randomUUID().slice(0, 8)}.com`;
  const owner = await register(context, `owner@${domain}`, "Morgan Followup Owner");
  const company = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Northstar Followup Studio", website: `https://${domain}`, size: "11-50", country: "IN" } });
  expect(company.status(), await company.text()).toBe(201); const cid = (await company.json()).id as string; const base = `${API}/v1/business/companies/${cid}`;
  const admin = await browser.newContext(); await register(admin, ADMIN, "Orbit Admin");
  expect((await admin.request.post(`${API}/v1/admin/business/companies/${cid}/plan`, { data: { plan: "starter" } })).ok()).toBe(true); await admin.close();
  expect((await context.request.post(`${base}/verification/account`)).ok()).toBe(true);
  const reviewers: Array<{ context: BrowserContext; id: string }> = [];
  for (const name of ["Alex Initial Reviewer", "Jordan Handoff Reviewer"]) {
    const user = await browser.newContext(); await user.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const email = `reviewer-${crypto.randomUUID().slice(0, 8)}@example.com`; const id = await register(user, email, name);
    const invitation = await context.request.post(`${base}/invites`, { data: { email, role: "recruiter" } });
    expect(invitation.status(), await invitation.text()).toBe(201);
    expect((await user.request.post(`${API}/v1/business/invites/accept`, { data: { token: await mailToken(email, /\/business\/invite\/([\w-]+)/) } })).ok()).toBe(true);
    reviewers.push({ context: user, id });
  }
  const created = await context.request.post(`${base}/jobs`, { data: { title: "Platform engineer", description_html: "<p>Prepare reliable Python services and consistent engineering interview criteria.</p>", workplace: "remote", must_haves: ["Python services"] } });
  expect(created.status(), await created.text()).toBe(201); const jid = (await created.json()).id as string;
  const endpoint = `${base}/workflow-studio/${jid}`;
  const index = await (await context.request.get(`${base}/workflow-studio`)).json();
  const current = await (await context.request.get(endpoint)).json();
  const saved = await context.request.put(`${endpoint}/plan`, { data: { base_revision: current.revision, source_version: current.version, plan: index.templates.find((t: { id: string }) => t.id === "approval").plan } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const started = await context.request.post(`${endpoint}/runs`, { data: { request_id: crypto.randomUUID(), base_revision: (await saved.json()).revision, start_date: new Date().toISOString().slice(0, 10), default_owner_id: owner } });
  expect(started.status(), await started.text()).toBe(201); let run = await started.json(); const rid = run.id as string;
  for (const sid of ["scope", "criteria", "panel"]) {
    const done = await context.request.post(`${endpoint}/runs/${rid}/steps/${sid}`, { data: { base_revision: run.revision, action: "done", note: "Prepared the role checklist evidence with the coordinating team." } });
    expect(done.ok(), await done.text()).toBe(true); run = await done.json();
  }
  await page.goto(`/business/app/${cid}/workflow-studio?job=${jid}&run=${rid}`);
  await page.getByLabel("Independent reviewer for step 4", { exact: true }).selectOption(reviewers[0]!.id);
  await page.getByLabel("Evidence note for step 4", { exact: true }).fill("Review the prepared criteria and documented team responsibilities for this checkpoint.");
  await page.getByRole("button", { name: "Request review for step 4", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review: pending" })).toBeVisible();
  await page.getByText("Follow-ups and reviewer handoff for step 4", { exact: true }).click();
  const due = new Date(Date.now() - 86400000).toISOString().slice(0, 10); const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Review due date for step 4 (UTC)", { exact: true }).fill(due);
  await page.getByLabel("Enable internal overdue reminders for this review", { exact: true }).check();
  await page.getByRole("button", { name: "Save review follow-ups for step 4", exact: true }).click();
  await expect(page.getByText(/Internal reminders on/)).toBeVisible();
  await page.goto(`/business/app/${cid}/workflow-reviews`);
  await page.getByRole("button", { name: "Check due review reminders", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "due internal reminders prepared." })).toBeVisible();
  const notifications = await (await reviewers[0]!.context.request.get(`${API}/v1/business/notifications`)).json();
  expect(notifications.filter((n: { kind: string }) => n.kind === "workflow_review")).toHaveLength(1);
  await page.goto(`/business/app/${cid}/workflow-studio?job=${jid}&run=${rid}`);
  const original = (await (await context.request.get(`${endpoint}/runs/${rid}`)).json()).steps[3].review;
  const alex = await reviewers[0]!.context.newPage(); await alex.goto(`/business/app/${cid}/workflow-reviews`);
  await alex.getByRole("link", { name: "Open checkpoint review", exact: true }).click();
  await alex.getByText("Follow-ups and reviewer handoff for step 4", { exact: true }).click();
  await alex.getByLabel("Pause reminders until for step 4 (UTC)", { exact: true }).fill(tomorrow);
  await alex.getByRole("button", { name: "Pause reminders for step 4", exact: true }).click();
  await expect(alex.getByText(/Paused until/)).toBeVisible();
  await alex.goto(`/business/app/${cid}/workflow-reviews`);
  await alex.getByLabel("Review inbox filter", { exact: true }).selectOption("snoozed");
  await expect(alex.getByRole("link", { name: "Open checkpoint review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh run", exact: true }).click();
  await expect(page.getByText(/Paused until/)).toBeVisible();
  await page.getByText("Follow-ups and reviewer handoff for step 4", { exact: true }).click();
  await page.getByLabel("New reviewer for step 4", { exact: true }).selectOption(reviewers[1]!.id);
  await page.getByLabel("Handoff reason for step 4", { exact: true }).fill("Jordan will review this checkpoint while Alex is unavailable this week.");
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("Follow-ups and reviewer handoff for step 4", { exact: true }).locator("..").screenshot({ path: info.outputPath("review-followups-mobile.png") });
  await page.getByRole("button", { name: "Hand off review for step 4", exact: true }).click();
  await expect(page.getByText("Requested by Morgan Followup Owner · reviewer Jordan Handoff Reviewer", { exact: true })).toBeVisible();
  const next = (await (await context.request.get(`${endpoint}/runs/${rid}`)).json()).steps[3].review;
  expect(next.previous_review_id).toBe(original.id); expect(next.fingerprint).toBe(original.fingerprint); expect(next.due_date).toBe(due); expect(next.reminders_enabled).toBe(true); expect(next.snoozed_until).toBeNull();
  await alex.getByRole("button", { name: "Refresh review inbox", exact: true }).click();
  await expect(alex.getByText("No current checkpoint reviews are assigned to you.", { exact: true })).toBeVisible();
  const jordan = await reviewers[1]!.context.newPage(); await jordan.goto(`/business/app/${cid}/workflow-reviews`);
  await jordan.setViewportSize({ width: 390, height: 844 }); await jordan.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await jordan.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(jordan.getByText(`Due ${due} UTC · Overdue`, { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page: jordan }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await jordan.screenshot({ path: info.outputPath("review-inbox-due-date-mobile.png"), fullPage: true });
  await jordan.getByRole("link", { name: "Open checkpoint review", exact: true }).click();
  await jordan.getByRole("button", { name: "Review evidence and history for step 4", exact: true }).click();
  await jordan.getByLabel("Decision note for step 4", { exact: true }).fill("Reviewed the preserved checkpoint evidence and approve this preparation record.");
  await jordan.getByLabel("I reviewed this checkpoint evidence snapshot and choose to record my decision.", { exact: true }).check();
  await jordan.getByRole("button", { name: "Approve checkpoint 4", exact: true }).click();
  await expect(jordan.getByRole("progressbar", { name: "Workflow completion" })).toHaveAttribute("aria-valuenow", "100");
  expect((await (await context.request.get(`${base}/jobs/${jid}`)).json()).status).toBe("draft");
  for (const user of reviewers) await user.context.close();
});
