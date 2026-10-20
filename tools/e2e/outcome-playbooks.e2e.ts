import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

function ageFixture(id: string, kind: "application" | "offer_response") {
  const code = kind === "application"
    ? "c.execute('UPDATE job_applications SET applied_at=?,status_at=? WHERE id=?',(stamp,stamp,os.environ['ORBIT_PLAYBOOK_FIXTURE']));"
    : "c.execute('UPDATE biz_events SET created_at=? WHERE application_id=? AND kind=?',(stamp,os.environ['ORBIT_PLAYBOOK_FIXTURE'],'offer_response'));";
  execFileSync("uv", ["run", "python", "-c", "import sqlite3,os; from datetime import datetime,timezone,timedelta; " +
    "c=sqlite3.connect(os.environ['ORBIT_ENTERPRISE_E2E_DB']); stamp=(datetime.now(timezone.utc)-timedelta(days=14)).isoformat(); " +
    code + "c.commit(); c.close()"], { cwd: resolve("apps/api"), env: { ...process.env, ORBIT_PLAYBOOK_FIXTURE: id } });
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Personal follow-up rules, conflict recovery and AI brief (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Platform engineer", company: "Northstar Personal", status: "applied",
    } });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).id as string;
    ageFixture(id, "application");
    await page.goto("/jobs/actions");
    await page.getByText("Your follow-up playbook", { exact: true }).click();
    await page.getByLabel("Application follow-ups", { exact: true }).check();
    const days = page.getByLabel("Wait after application or latest contact (days)", { exact: true });
    await days.fill("");
    await expect(days).toBeEnabled();
    await days.fill("7");
    await page.getByRole("button", { name: "Save follow-up rules", exact: true }).click();
    await expect(page.getByText("Your playbook · Application follow-up", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Build my AI brief", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Demo AI brief", exact: true })).toBeVisible();
    const current = await (await context.request.get(`${API}/v1/jobs/playbook`)).json();
    const changed = await context.request.put(`${API}/v1/jobs/playbook`, { data: { base_revision: current.revision, follow_up_days: 8, prep_hours: 24 } });
    expect(changed.ok(), await changed.text()).toBe(true);
    await days.fill("10");
    await page.getByRole("button", { name: "Save follow-up rules", exact: true }).click();
    await expect(page.getByText(/Your draft is kept/)).toBeVisible();
    await expect(days).toHaveValue("10");
    await page.getByRole("button", { name: "Reload saved rules", exact: true }).click();
    await expect(days).toHaveValue("8");
    await expect(page.getByLabel("Interview preparation window", { exact: true })).toBeChecked();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`personal-playbook-${viewport.name}.png`), fullPage: true });
    expect((await context.request.patch(`${API}/v1/jobs/tracker/${id}`, { data: { status: "interviewing", next_at: new Date(Date.now() + 12 * 3600000).toISOString() } })).ok()).toBe(true);
    await page.getByText("Filters, refresh & calendar", { exact: true }).click();
    await page.getByRole("button", { name: "Refresh records", exact: true }).click();
    await expect(page.getByText("Your playbook · Interview preparation", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Demo AI brief", exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByText("Your follow-up playbook", { exact: true }).click();
    await expect(days).toHaveValue("8");
  });

  test(`Business offer deadlines and accepted-offer handoff (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid, aid, token } = await seed(context);
    const base = `${API}/v1/business/companies/${cid}/applications/${aid}`;
    const published = await context.request.post(`${base}/offer`, { data: {
      role: "Backend engineer", compensation: "INR 2,400,000 per year", start_date: "To be agreed",
      terms: "Review the formal agreement and first-day arrangements with the hiring team.", expires_days: 1, request_id: crypto.randomUUID(),
    } });
    expect(published.ok(), await published.text()).toBe(true);
    const offer = (await published.json()).offer;
    await page.goto(`/business/app/${cid}/automations`);
    await page.getByLabel("Job", { exact: true }).selectOption(jid);
    await page.getByLabel("Run these automations for Backend engineer").check();
    for (const label of ["Stalled pipeline", "Candidate questions", "Panel feedback", "Assessment review"]) {
      const box = page.getByRole("checkbox", { name: label, exact: true });
      if (await box.count()) await box.uncheck();
    }
    await page.getByLabel("Offer response deadline", { exact: true }).check();
    await page.getByLabel("Accepted offer handoff", { exact: true }).check();
    await page.getByRole("button", { name: "Preview conditions", exact: true }).click();
    await expect(page.getByText("1 current follow-up conditions", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save playbook", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review the offer response deadline", exact: true })).toBeVisible();
    const accepted = await context.request.post(`${API}/v1/public/business/applications/${token}/offer/respond`, { data: {
      offer_id: offer.id, response: "accepted", acknowledge: true, request_id: crypto.randomUUID(),
    } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    ageFixture(aid, "offer_response");
    await page.getByRole("button", { name: "Run saved playbook now", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Prepare the accepted offer joining plan", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the offer response deadline", exact: true })).toHaveCount(0);
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`offer-playbook-${viewport.name}.png`), fullPage: true });
    const handoff = await context.request.post(`${base}/handoff`, { data: {
      introduction: "Review the first-day arrangements together and flag anything unclear.", start_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      tasks: [{ title: "Prepare equipment", instructions: "Arrange the agreed equipment and first-day access.", owner: "team", due_date: null }], request_id: crypto.randomUUID(),
    } });
    expect(handoff.ok(), await handoff.text()).toBe(true);
    await page.getByRole("button", { name: "Run saved playbook now", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Prepare the accepted offer joining plan", exact: true })).toHaveCount(0);
  });
}
