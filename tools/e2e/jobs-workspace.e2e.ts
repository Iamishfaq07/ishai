import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Today, job sections and contact deep links (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    // The launchpad and daily actions now live on Today.
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/$/);
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Platform Engineer", company: "Northstar Personal", status: "interviewing",
      next_at: new Date(Date.now() + 86_400_000).toISOString(),
    } });
    expect(created.status(), await created.text()).toBe(201);
    const job = await created.json();
    await page.goto("/jobs/actions");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", { name: "Your next stop", exact: true }).getByText("Platform Engineer · Northstar Personal", { exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`jobs-today-${viewport.name}.png`), fullPage: true });

    await page.goto("/jobs/weekly");
    await expect(page.getByRole("heading", { name: "Your weekly studio", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set my weekly targets", exact: true })).toBeVisible();

    // A job's sections are one row of buttons; each one is its own ?tab= entry in history.
    await page.goto(`/jobs/mission/${job.id}?tab=resume&source=reminder`);
    const sections = page.getByRole("navigation", { name: "Sections of this job", exact: true });
    await expect(sections.getByRole("button")).toHaveCount(8);
    const current = sections.locator('[aria-current="page"]');
    await expect(current).toHaveText("Resume");
    await expect(page.getByRole("region", { name: "Resume kit", exact: true })).toBeVisible();
    await sections.getByRole("button", { name: /^Interviews/ }).click();
    await expect(current).toHaveText(/^Interviews/);
    await sections.getByRole("button", { name: "Practice", exact: true }).click();
    await expect(page).toHaveURL(/tab=practice&source=reminder$/);
    await page.goBack();
    await expect(current).toHaveText(/^Interviews/);
    await page.goBack();
    await expect(current).toHaveText("Resume");
    await sections.getByRole("button", { name: "Offer", exact: true }).click();
    await expect(page.getByRole("region", { name: "Offer", exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`jobs-mission-${viewport.name}.png`), fullPage: true });

    await page.goto(`/jobs/outreach?view=messages&job=${encodeURIComponent(job.listing_id)}`);
    await expect(page.getByRole("button", { name: "Close writing tools", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close writing tools", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Make a resume first", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Open contact finder", exact: true }).click();
    await expect(page.getByRole("region", { name: "Contact finder", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("region", { name: "Contact finder", exact: true })).toHaveCount(0);
    await page.goto(`/jobs/outreach?network=1&job=${encodeURIComponent(job.listing_id)}`);
    await page.getByRole("button", { name: "Close contact finder", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open writing tools", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Make a resume first", exact: true })).toBeHidden();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
