import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8000";
const outbox = resolve("apps/api/e2e-outbox.txt");
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
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`).join(", ")}`)).toEqual([]);
}

test("Business Hiring Studio: plan, private draft, candidate challenge, debrief and desk", async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const { cid, jid, aid, other, token } = await seed(context);
  const base = `/business/app/${cid}`;
  const room = `${base}/applications/${aid}/interview`;
  await page.goto(`${base}/jobs/${jid}/interview-plan`);
  await expect(page.getByRole("heading", { name: "Design the interview" })).toBeVisible();
  await page.getByLabel("Add a practical challenge to this plan").check();
  await page.getByRole("button", { name: "Use engineering scenario", exact: true }).click();
  await page.getByRole("button", { name: "Save interview plan", exact: true }).click();
  await expect(page.getByText("Plan version 1", { exact: true })).toBeVisible();
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-interview-plan.png"), fullPage: true });
  await page.goto(room);
  await expect(page.getByRole("heading", { name: "Interview · Robin Candidate" })).toBeVisible();
  await page.getByRole("button", { name: "Practical challenge", exact: true }).click();
  await page.getByRole("button", { name: "Assign to candidate", exact: true }).click();
  await expect(page.getByText("Waiting for the candidate's initial solution.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Interview", exact: true }).click();
  await page.getByLabel("What did you actually observe?", { exact: true }).first().fill("Explained a persisted idempotency key and tested retries before issuing the payment.");
  await page.getByLabel("Assessment", { exact: true }).first().selectOption("3");
  await page.getByRole("button", { name: "Save private draft", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await page.getByRole("button", { name: "Interview", exact: true }).click();
  await expect(page.getByLabel("What did you actually observe?", { exact: true }).first()).toHaveValue(/idempotency/);
  await page.getByRole("button", { name: "Submit feedback", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit feedback", exact: true }).click();
  await expect(page.getByText("Your submitted feedback is sealed", { exact: true })).toBeVisible();
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-sealed-feedback.png"), fullPage: true });
  // The bearer application link works in a separate signed-out browser; it exposes no team feedback.
  const candidate = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await candidate.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const applicant = await candidate.newPage();
  await applicant.goto(`/application/${token}`);
  await expect(applicant.getByRole("heading", { name: "Prepare for the conversation" })).toBeVisible();
  await expect(applicant.getByText("A changed constraint", { exact: true })).toHaveCount(0);
  await applicant.getByLabel("Your solution", { exact: true }).fill("I store an order identifier before charging and persist the provider response so repeated requests return the same result.");
  await applicant.getByLabel("Explain your decisions and trade-offs", { exact: true }).fill("The persisted key gives the next worker a way to recover the previous outcome. I would test concurrent retries and errors.");
  await applicant.getByLabel("What assistance did you use?", { exact: true }).selectOption("documentation");
  await applicant.getByRole("button", { name: "Submit initial solution", exact: true }).click();
  await applicant.getByRole("alertdialog").getByRole("button", { name: "Submit solution", exact: true }).click();
  await expect(applicant.getByText("A changed constraint", { exact: true })).toBeVisible();
  await applicant.getByLabel("Your adaptation", { exact: true }).fill("I first reconcile the order against the provider's idempotency record. A timed-out charge cannot safely be retried as a new payment.");
  await applicant.getByLabel("Explain your decisions and trade-offs", { exact: true }).fill("A provider lookup may delay the customer response but avoids charging twice when a prior response was lost.");
  await applicant.getByRole("button", { name: "Submit adaptation", exact: true }).click();
  await applicant.getByRole("alertdialog").getByRole("button", { name: "Submit solution", exact: true }).click();
  await expect(applicant.getByText("Both responses are saved", { exact: true })).toBeVisible();
  await applicant.getByLabel("Your question", { exact: true }).fill("Could you clarify the next interview format and its expected duration?");
  await applicant.getByRole("button", { name: "Send question to hiring team" }).click();
  await expect(applicant.getByText("Your question is saved.", { exact: false })).toBeVisible();
  await a11y(applicant);
  expect(await applicant.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await applicant.evaluate(() => window.scrollTo(0, 0));
  await applicant.screenshot({ path: info.outputPath("candidate-practical-challenge-mobile.png"), fullPage: true });
  await candidate.close();
  await page.reload();
  await page.getByRole("button", { name: "Team debrief", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "Explained a persisted idempotency key" })).toBeVisible();
  await page.getByLabel("Evidence and rationale", { exact: true }).fill("Collect a further example for the remaining criterion and discuss the candidate's adaptation before the final decision.");
  await page.getByRole("button", { name: "Save decision record" }).click();
  await expect(page.getByText("Collect a further example for the remaining criterion", { exact: false })).toBeVisible();
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-evidence-debrief.png"), fullPage: true });
  await page.goto(`${base}/jobs/${jid}/compare?ids=${aid}&ids=${other}`);
  await expect(page.getByRole("heading", { name: "Compare evidence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Robin Candidate", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alex Candidate", exact: true })).toBeVisible();
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-candidate-comparison.png"), fullPage: true });
  await page.goto(`${base}/hiring-desk`);
  await expect(page.getByText("Candidate asked a question; reply from their application", { exact: true })).toBeVisible();
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-hiring-desk.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByText("Candidate asked a question; reply from their application", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a11y(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("business-hiring-desk-mobile.png"), fullPage: true });
});
