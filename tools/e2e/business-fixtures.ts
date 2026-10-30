import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

export const API = "http://127.0.0.1:8106";
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
export async function seed(context: BrowserContext) {
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
export async function a11y(page: Page) {
  // Audit the foreground page after transient confirmations finish, not halfway through a toast's opacity fade.
  await page.bringToFront();
  await page.mouse.move(0, 0);
  // From the top, the same each run: axe's target-size counts a control scrolled half under the sticky header as
  // "partially obscured", so where the last click left the page decided the result.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("listitem")).toHaveCount(0);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`).join(", ")}`)).toEqual([]);
}

