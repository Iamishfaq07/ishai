import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { seed, a11y } from "./business-fixtures";

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

