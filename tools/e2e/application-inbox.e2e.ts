import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";
import { prepareReview } from "./personal-apply-fixtures";

function markUnconfirmed(id: string) {
  execFileSync("uv", ["run", "python", "-c", "import os,sqlite3; from datetime import datetime,timezone; " +
    "c=sqlite3.connect(os.environ['ORBIT_ENTERPRISE_E2E_DB']); stamp=datetime.now(timezone.utc).isoformat(); " +
    "c.execute('UPDATE application_packets SET status=?,submission_started_at=?,updated_at=? WHERE id=?'," +
    "('failed',stamp,stamp,os.environ['ORBIT_INBOX_FIXTURE'])); c.commit(); c.close()"],
  { cwd: resolve("apps/api"), env: { ...process.env, ORBIT_INBOX_FIXTURE: id } });
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Application inbox finds, explains and restores applications (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid } = await seed(context);
    const first = await prepareReview(context, jid);
    const closed = await context.request.post(`${API}/v1/business/companies/${cid}/jobs/${jid}/close`);
    expect(closed.ok(), await closed.text()).toBe(true);
    const job = await context.request.post(`${API}/v1/business/companies/${cid}/jobs`, { data: {
      title: "Backend Engineer All Action", description_html: "<p>Build reliable Python APIs and PostgreSQL services. Explain engineering trade-offs to the product team.</p>",
      department: "Engineering", locations: ["Bengaluru, IN"], workplace: "remote", must_haves: ["Python", "Postgres"],
    } });
    expect(job.status(), await job.text()).toBe(201);
    const secondId = (await job.json()).id;
    const published = await context.request.post(`${API}/v1/business/companies/${cid}/jobs/${secondId}/publish`);
    expect(published.ok(), await published.text()).toBe(true);
    const secondListing = `biz:${secondId.replaceAll("-", "")}`;
    expect((await context.request.post(`${API}/v1/jobs/tracker`, { data: { listing_id: secondListing } })).ok()).toBe(true);
    const planned = await context.request.post(`${API}/v1/apply/plan-shortlist`, { data: { listing_ids: [secondListing] } });
    expect(planned.ok(), await planned.text()).toBe(true);
    const packets = await (await context.request.get(`${API}/v1/apply/packets`)).json();
    expect(packets).toHaveLength(2);
    const second = packets.find((packet: { listing_id: string }) => packet.listing_id === secondListing);
    expect(second.status).toBe("review");
    markUnconfirmed(first.packet.id);
    await page.goto("/jobs/applications?view=attention&q=all&sort=oldest&from=bookmark");
    const filters = page.getByRole("region", { name: "Find applications", exact: true });
    const search = filters.getByLabel("Search applications", { exact: true });
    await expect(search).toHaveValue("all");
    await expect(page.getByRole("button", { name: /Backend Engineer All Action at Northstar Studio/ })).toBeVisible();
    await expect(filters.getByRole("status")).toHaveText("1 of 2 loaded applications shown");
    await search.fill("action");
    await expect(page).toHaveURL(/q=action/);
    await filters.getByLabel("Sort applications", { exact: true }).selectOption("newest");
    await page.getByRole("button", { name: /Backend Engineer All Action at Northstar Studio/ }).click();
    const status = page.getByRole("region", { name: "Application status", exact: true });
    await expect(status.getByRole("heading", { name: "Review before sending", exact: true })).toBeVisible();
    await expect(status.locator('[aria-current="step"]')).toHaveText("1Prepare");
    await expect(page.getByRole("button", { name: "Preview saved resume (PDF)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prepared materials", exact: true })).toBeVisible();
    await page.goBack();
    await expect(search).toHaveValue("action");
    await expect(filters.getByLabel("Sort applications", { exact: true })).toHaveValue("newest");
    await search.fill("No matching company");
    await expect(page.getByText("No applications match these filters", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show all applications", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page).toHaveURL(/from=bookmark$/);
    await expect(filters.getByRole("status")).toHaveText("2 of 2 loaded applications shown");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`application-inbox-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: /Backend engineer at Northstar Studio/ }).click();
    await expect(status.getByRole("heading", { name: "Employer outcome unconfirmed", exact: true })).toBeVisible();
    await expect(status.locator('[aria-current="step"]')).toHaveText("3Result");
    const retry = page.getByRole("button", { name: /Try again/ });
    await expect(retry).toBeDisabled();
    await page.getByText(/I checked the employer site and my email/).click();
    await expect(retry).toBeEnabled();
    expect((await (await context.request.get(`${API}/v1/apply/packets/${first.packet.id}`)).json()).status).toBe("failed");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`application-status-${viewport.name}.png`), fullPage: true });
    await page.route(`${API}/v1/apply/packets`, (route) => route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ detail: "Application list temporarily unavailable" }) }));
    await page.goto("/jobs/applications");
    await expect(page.getByText("Application list temporarily unavailable", { exact: true })).toBeVisible();
    await page.unroute(`${API}/v1/apply/packets`);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(filters.getByRole("status")).toHaveText("2 of 2 loaded applications shown");
  });
}
