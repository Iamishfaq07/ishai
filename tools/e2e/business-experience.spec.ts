import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
const OUTBOX = process.env.ORBIT_TEST_OUTBOX ?? "apps/api/e2e-outbox.txt";
const ADMIN = process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com";
async function mailToken(email: string, pattern: RegExp) {
  let result = "";
  await expect.poll(async () => {
    const text = (await readFile(OUTBOX, "utf8")).split("--- to=").filter(m => m.startsWith(email)).at(-1) ?? "";
    result = pattern.exec(text)?.[1] ?? ""; return result.length;
  }).toBeGreaterThan(10);
  return result;
}
async function register(context: BrowserContext, email: string) {
  const response = await context.request.post(`${API}/v1/auth/register`, { data: { email, name: "Alex Experience Owner", password: "correct horse battery" } });
  expect(response.status(), await response.text()).toBe(201);
  const token = await mailToken(email, /verify-email\?token=([\w-]+)/);
  expect((await context.request.post(`${API}/v1/auth/verify-email/confirm`, { data: { token } })).ok()).toBe(true);
}
test("Candidate experience: opt-in portals, fixed reporting group, AI improvement plan and candidate withdrawal", async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await register(context, ADMIN);
  const domain = ADMIN.split("@")[1]!;
  const made = await context.request.post(`${API}/v1/business/companies`, { data: { name: "Experience Studio", website: `https://${domain}`, size: "11-50", country: "IN" } });
  expect(made.status(), await made.text()).toBe(201);
  const cid = (await made.json()).id as string;
  const base = `${API}/v1/business/companies/${cid}`;
  expect((await context.request.post(`${base}/verification/account`)).ok()).toBe(true);
  const created = await context.request.post(`${base}/jobs`, { data: { title: "Operations coordinator", description_html: "<p>Coordinate documented onboarding workflows and improve clarity for a small product team.</p>", department: "Operations", workplace: "remote", must_haves: ["Process coordination"] } });
  expect(created.status(), await created.text()).toBe(201);
  const jid = (await created.json()).id as string;
  expect((await context.request.post(`${base}/jobs/${jid}/publish`)).ok()).toBe(true);
  const docx = execFileSync(resolve("apps/api/.venv/bin/python"), ["-c", "import io,sys; from docx import Document; d=Document(); d.add_paragraph('Fictional candidate has coordinated documented operations and clear communication for a product team.'); b=io.BytesIO(); d.save(b); sys.stdout.buffer.write(b.getvalue())"]);
  const candidates: Array<{ context: BrowserContext; token: string; id: string; email: string }> = [];
  for (let i = 0; i < 5; i++) {
    const candidate = await browser.newContext(); await candidate.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const email = `feedback-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const applied = await candidate.request.post(`${API}/v1/public/business/jobs/${jid}/apply`, { multipart: {
      name: `Private Candidate ${i}`, email, consent: "true", notice_version: "2026-10-19.2", answers: "[]",
      file: { name: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx },
    } });
    expect(applied.ok(), await applied.text()).toBe(true);
    const token = await mailToken(email, /\/application\/([\w-]+)/);
    expect((await candidate.request.post(`${API}/v1/public/business/applications/${token}/confirm`)).ok()).toBe(true);
    const list = await (await context.request.get(`${base}/jobs/${jid}/applications`)).json();
    const id = list.items.find((a: { email: string; id: string }) => a.email === email).id as string;
    candidates.push({ context: candidate, token, id, email });
  }
  expect((await context.request.post(`${base}/applications/move`, { data: { ids: candidates.map(c => c.id), stage_id: "interview", notify: false } })).ok()).toBe(true);
  await page.goto(`/business/app/${cid}/experience`);
  await expect(page.getByRole("heading", { name: "Candidate experience", exact: true })).toBeVisible();
  await expect(page.getByLabel("Enable optional candidate feedback", { exact: true })).not.toBeChecked();
  await page.getByLabel("Enable optional candidate feedback", { exact: true }).check();
  await page.getByRole("button", { name: "Save feedback campaign", exact: true }).click();
  await expect(page.getByLabel("Enable optional candidate feedback", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Prepare opted-in invitations", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "feedback invitations prepared" })).toBeVisible();
  for (const c of candidates.slice(0, 4)) {
    const endpoint = `${API}/v1/public/business/applications/${c.token}/experience`;
    const own = await (await c.context.request.get(endpoint)).json();
    const answer = await c.context.request.post(endpoint, { data: { request_id: crypto.randomUUID(), notice_version: own.notice_version, acknowledge: true, communication: 4, clarity: 4, respect: 4, improvement: "communication" } });
    expect(answer.ok(), await answer.text()).toBe(true);
  }
  await page.getByRole("button", { name: "Refresh experience report", exact: true }).click();
  await expect(page.getByText("Results remain withheld until a complete group of five", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare experience brief", exact: true })).toBeDisabled();
  const last = candidates[4]!;
  const candidatePage = await last.context.newPage(); await candidatePage.goto(`/application/${last.token}`);
  await expect(candidatePage.getByRole("heading", { name: "Your hiring experience", exact: true })).toBeVisible();
  await expect(candidatePage.getByRole("button", { name: "Submit optional feedback", exact: true })).toBeDisabled();
  for (const question of ["I received useful communication about the process.", "The next steps and expectations were clear.", "The hiring process treated my time respectfully."]) await candidatePage.getByLabel(question, { exact: true }).selectOption("4");
  await candidatePage.getByLabel("What should the team improve first?", { exact: true }).selectOption("communication");
  await candidatePage.getByLabel("I read the notice and choose to share this process feedback.", { exact: true }).check();
  await candidatePage.getByRole("button", { name: "Submit optional feedback", exact: true }).click();
  await expect(candidatePage.getByText("Your feedback is saved.", { exact: false })).toBeVisible();
  const ownDownload = candidatePage.waitForEvent("download");
  await candidatePage.getByRole("button", { name: "Download my feedback", exact: true }).click();
  expect((await ownDownload).suggestedFilename()).toBe("orbit-my-process-feedback.json");
  await page.getByRole("button", { name: "Refresh experience report", exact: true }).click();
  await expect(page.getByText("4/5", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Prepare experience brief", exact: true }).click();
  await expect(page.getByText("Test experience brief · no AI model called", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use AI suggestions in plan", exact: true }).click();
  await expect(page.getByLabel("Improvement actions", { exact: true })).not.toHaveValue("");
  expect((await (await context.request.get(`${base}/experience/${jid}`)).json()).plan).toEqual({});
  await page.getByLabel("Improvement goal", { exact: true }).fill("Improve clarity of recruiting updates for the next interview cycle.");
  await page.getByLabel("Plan status", { exact: true }).selectOption("active");
  await page.getByLabel("Plan review date", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "Save improvement plan", exact: true }).click();
  await expect(page.getByLabel("Plan status", { exact: true })).toHaveValue("active");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download aggregate report", exact: true }).click();
  const downloaded = await downloadEvent; expect(downloaded.suggestedFilename()).toBe("orbit-candidate-experience-report.json");
  let text = ""; for await (const chunk of (await downloaded.createReadStream())!) text += chunk.toString();
  for (const c of candidates) { expect(text).not.toContain(c.token); expect(text).not.toContain(c.email); expect(text).not.toContain(c.id); }
  expect(text).not.toContain("Private Candidate");
  for (const target of [page, candidatePage]) {
    await target.setViewportSize({ width: 390, height: 844 });
    await target.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await target.evaluate(() => { document.documentElement.classList.add("dark"); window.scrollTo(0, 0); });
    const audit = await new AxeBuilder({ page: target }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("business-experience-mobile.png"), fullPage: true });
  await candidatePage.screenshot({ path: info.outputPath("candidate-feedback-mobile.png"), fullPage: true });
  candidatePage.once("dialog", dialog => void dialog.accept());
  await candidatePage.getByRole("button", { name: "Remove my feedback", exact: true }).click();
  await expect(candidatePage.getByText("Your feedback was removed", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Refresh experience report", exact: true }).click();
  await expect(page.getByText("Results remain withheld until a complete group of five", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare experience brief", exact: true })).toBeDisabled();
  for (const c of candidates) {
    const status = await (await c.context.request.get(`${API}/v1/public/business/applications/${c.token}`)).json();
    expect(status.application_state).toBe("active"); await c.context.close();
  }
});
