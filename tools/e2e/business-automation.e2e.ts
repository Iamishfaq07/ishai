import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8106";
const outbox = resolve("apps/api/enterprise-e2e-outbox.txt");
const password = "correct horse battery";
test.use({ actionTimeout: 10_000 });
async function mailLink(email: string, pattern: RegExp) {
  let token = "";
  await expect.poll(async () => {
    const mail = (await readFile(outbox, "utf8")).split("--- to=").filter((m) => m.startsWith(email)).at(-1) ?? "";
    token = pattern.exec(mail)?.[1] ?? "";
    return token.length > 10;
  }).toBe(true);
  return token;
}
async function seed(context: BrowserContext) {
  const domain = `studio-${crypto.randomUUID().slice(0, 8)}.com`;
  const email = `owner@${domain}`;
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: { email, password, name: "Morgan Recruiter" } });
  expect(registered.status(), await registered.text()).toBe(201);
  const user = (await registered.json()).user as { id: string };
  const verification = await mailLink(email, /verify-email\?token=([\w-]+)/);
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token: verification } })).ok()).toBe(true);
  const created = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Northstar Studio", website: `https://${domain}`, size: "11-50", country: "IN", about: "A fictional company for browser tests." } });
  expect(created.status(), await created.text()).toBe(201);
  const cid = (await created.json()).id as string;
  const verified = await context.request.post(`${API}/v1/business/companies/${cid}/verification/account`);
  expect(verified.ok(), await verified.text()).toBe(true);
  const job = await context.request.post(`${API}/v1/business/companies/${cid}/jobs`, { data: {
    title: "Backend engineer", description_html: "<p>Build reliable APIs and explain engineering trade-offs for a small product team.</p>",
    department: "Engineering", locations: ["Bengaluru, IN"], workplace: "remote", must_haves: ["Python", "Postgres"], salary_min: 2000000, salary_max: 3500000,
  } });
  expect(job.status(), await job.text()).toBe(201);
  const jid = (await job.json()).id as string;
  expect((await context.request.post(`${API}/v1/business/companies/${cid}/jobs/${jid}/publish`)).ok()).toBe(true);
  // A local fixture DOCX, parsed by the real upload path. No external email or real candidate data.
  const docx = execFileSync("uv", ["run", "python", "-c", "import io,sys; from docx import Document; d=Document(); d.add_paragraph('Robin Candidate built Python APIs backed by Postgres and tested safe retries.'); b=io.BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())"], { cwd: resolve("apps/api") });
  const candidate = `candidate-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const applied = await context.request.post(`${API}/v1/public/business/jobs/${jid}/apply`, { multipart: {
    name: "Robin Candidate", email: candidate, consent: "true", notice_version: "2026-10-19.2", answers: "[]",
    file: { name: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx },
  } });
  expect(applied.ok(), await applied.text()).toBe(true);
  const token = await mailLink(candidate, /\/application\/([\w-]+)/);
  expect((await context.request.post(`${API}/v1/public/business/applications/${token}/confirm`)).ok()).toBe(true);
  const list = await context.request.get(`${API}/v1/business/companies/${cid}/jobs/${jid}/applications`);
  const aid = (await list.json()).items[0].id as string;
  expect((await context.request.patch(`${API}/v1/business/companies/${cid}/applications/${aid}`, { data: { interviewers: [user.id] } })).ok()).toBe(true);
  const second = await context.request.post(`${API}/v1/public/business/jobs/${jid}/apply`, { multipart: {
    name: "Alex Candidate", email: `alex-${crypto.randomUUID().slice(0, 8)}@example.com`, consent: "true",
    notice_version: "2026-10-19.2", answers: "[]",
    file: { name: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx },
  } });
  expect(second.ok(), await second.text()).toBe(true);
  const updated = await (await context.request.get(`${API}/v1/business/companies/${cid}/jobs/${jid}/applications`)).json();
  const other = updated.items.find((a: { id: string }) => a.id !== aid).id as string;
  return { cid, jid, aid, other, token };
}
async function a11y(page: Page) {
  // Audit the foreground page after transient confirmations finish, not halfway through a toast's opacity fade.
  await page.bringToFront();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("listitem")).toHaveCount(0);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`).join(", ")}`)).toEqual([]);
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Enterprise automation: preview, activate, handle and add follow-ups (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid, aid } = await seed(context);
    // Age only this isolated fixture. Exercise real HTTP and browser actions for all workflow transitions.
    execFileSync("uv", ["run", "python", "-c",
      "import os,sqlite3; from datetime import datetime,timezone,timedelta; " +
      "c=sqlite3.connect(os.environ['ORBIT_ENTERPRISE_E2E_DB']); " +
      "c.execute('UPDATE biz_applications SET stage_changed_at=? WHERE id=?', " +
      "((datetime.now(timezone.utc)-timedelta(days=5)).isoformat(),os.environ['ORBIT_ENTERPRISE_E2E_APP'])); c.commit(); c.close()"],
      { cwd: resolve("apps/api"), env: { ...process.env, ORBIT_ENTERPRISE_E2E_APP: aid } });
    const base = `/business/app/${cid}`;
    await page.goto(`${base}/automations`);
    await expect(page.getByRole("heading", { name: "Automation center", exact: true })).toBeVisible();
    await page.getByLabel("Job", { exact: true }).selectOption(jid);
    await page.getByLabel("Run these automations for Backend engineer").check();
    await page.getByLabel("Default task owner", { exact: true }).selectOption({ label: "Morgan Recruiter" });
    await page.getByRole("button", { name: "Preview conditions", exact: true }).click();
    await expect(page.getByText("1 current follow-up conditions", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save playbook", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review the stalled pipeline stage", exact: true })).toBeVisible();
    await expect(page.getByText("Saved playbook enabled.", { exact: false })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`enterprise-automations-${viewport.name}.png`), fullPage: true });
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Review the stalled pipeline stage", exact: true }) });
    await card.getByText("Update task", { exact: true }).click();
    await card.getByLabel("Reason for the audit trail", { exact: true }).fill("Reviewed the stage and contacted the coordinator.");
    await card.getByRole("button", { name: "Save task update", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review the stalled pipeline stage", exact: true })).toHaveCount(0);
    await page.getByLabel("Task status", { exact: true }).selectOption("done");
    await expect(page.getByRole("heading", { name: "Review the stalled pipeline stage", exact: true })).toBeVisible();
    await page.goto(`${base}/applications/${aid}`);
    await page.getByLabel("Task", { exact: true }).fill("Coordinate candidate availability");
    await page.getByLabel("Due (your local time)", { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
    await expect(page.getByText("Follow-up saved in the shared task queue.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Open automation center", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Coordinate candidate availability", exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

