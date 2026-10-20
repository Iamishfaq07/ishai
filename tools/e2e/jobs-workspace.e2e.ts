import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Jobs AI grouped workflows and deep links (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    await page.goto("/jobs");
    await expect(page.getByRole("navigation", { name: "Your career steps", exact: true }).getByRole("listitem")).toHaveCount(5);
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Platform Engineer", company: "Northstar Personal", status: "interviewing",
      next_at: new Date(Date.now() + 86_400_000).toISOString(),
    } });
    expect(created.status(), await created.text()).toBe(201);
    const job = await created.json();
    await page.goto("/jobs/actions");
    const nav = page.getByRole("navigation", { name: "Jobs AI", exact: true });
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Launchpad");
    await expect(page.getByRole("heading", { name: "Daily actions", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Platform Engineer · Northstar Personal", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Choose your next step", exact: true })).toHaveCount(0);
    expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await a11y(page);
    await page.screenshot({ path: info.outputPath(`jobs-today-${viewport.name}.png`), fullPage: true });

    await page.getByRole("button", { name: "Find a tool", exact: true }).click();
    const finder = page.getByRole("region", { name: "Find a Jobs AI tool", exact: true });
    await finder.getByLabel("What do you want to do?", { exact: true }).fill("weekly studio");
    await expect(finder.getByRole("link")).toHaveCount(1);
    await finder.getByRole("link", { name: /Weekly plan/ }).click();
    await expect(page).toHaveURL(/\/jobs\/weekly$/);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Launchpad");
    await expect(page.getByRole("button", { name: "Set my weekly targets", exact: true })).toBeVisible();
    await expect(finder).toHaveCount(0);

    await page.goto(`/jobs/mission/${job.id}?tab=resume&source=reminder`);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("Applications");
    const areas = page.getByRole("group", { name: "Job workspace areas", exact: true });
    await expect(areas.getByRole("button")).toHaveCount(3);
    const tool = page.getByLabel("Workspace tool", { exact: true });
    await expect(tool).toHaveValue("resume");
    await areas.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(tool).toHaveValue("interview");
    await tool.selectOption("practice");
    await expect(page).toHaveURL(/tab=practice&source=reminder$/);
    await page.goBack();
    await expect(tool).toHaveValue("interview");
    await page.goBack();
    await expect(tool).toHaveValue("resume");
    await areas.getByRole("button", { name: "Progress & offer", exact: true }).click();
    await tool.selectOption("offer");
    await expect(page.getByRole("region", { name: "Offer", exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`jobs-mission-${viewport.name}.png`), fullPage: true });

    await page.goto(`/jobs/outreach?view=messages&job=${encodeURIComponent(job.listing_id)}`);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("People");
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
