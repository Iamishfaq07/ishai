import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Command centers: enterprise signals, preparation automation and weekly coaching (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid, aid, token } = await seed(context);
    const base = `/business/app/${cid}`;
    const slots = [3, 4, 5].map((hour) => new Date(Date.now() + hour * 3600000).toISOString());
    const offered = await context.request.post(`${API}/v1/business/companies/${cid}/applications/${aid}/interview`, {
      data: { slots, duration_min: 45, location: "https://meet.example.test/panel" },
    });
    expect(offered.status(), await offered.text()).toBe(201);
    const offeredStatus = await (await context.request.get(`${API}/v1/public/business/applications/${token}`)).json();
    const booked = await context.request.post(`${API}/v1/public/business/applications/${token}/book`, { data: { slot: offeredStatus.interview.slots[0] } });
    expect(booked.ok(), await booked.text()).toBe(true);
    await page.goto(`${base}/control-room`);
    await expect(page.getByRole("heading", { name: "Hiring control room", exact: true })).toBeVisible();
    if (viewport.name === "desktop") await expect(page.getByText("Company workspace", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ask AI for next steps", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Demo AI advice", exact: true })).toBeVisible();
    await a11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`control-room-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "Pipeline signals", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Where the process is waiting", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Panel capacity", exact: true }).click();
    await expect(page.getByText("1 booked interviews · 45 scheduled minutes", { exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto(`${base}/automations`);
    await page.getByLabel("Job", { exact: true }).selectOption(jid);
    await page.getByLabel("Run these automations for Backend engineer").check();
    await page.getByLabel("Interview preparation", { exact: true }).check();
    await page.getByRole("button", { name: "Preview conditions", exact: true }).click();
    await expect(page.getByText("prep: 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save playbook", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Prepare the interview kit", exact: true })).toBeVisible();

    await page.goto("/jobs/weekly");
    await expect(page.getByRole("heading", { name: "Your weekly studio", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Set my weekly targets", exact: true }).click();
    await page.getByLabel("Applications", { exact: true }).fill("8");
    await page.getByRole("spinbutton", { name: "Contacts reached", exact: true }).fill("0");
    await page.getByRole("button", { name: "Save weekly targets", exact: true }).click();
    await expect(page.getByRole("progressbar", { name: "Applications recorded", exact: true })).toHaveAttribute("aria-valuemax", "8");
    await page.getByRole("button", { name: "Set my weekly targets", exact: true }).click();
    await page.getByLabel("Applications", { exact: true }).fill("9");
    const current = await (await context.request.get(`${API}/v1/jobs/weekly`)).json();
    expect((await context.request.put(`${API}/v1/jobs/weekly/targets`, { data: {
      base_revision: current.revision, applications: 7, practice: 2, contacts: 0,
    } })).ok()).toBe(true);
    await page.getByRole("button", { name: "Save weekly targets", exact: true }).click();
    await expect(page.getByText("Your targets changed elsewhere. Your draft is still here. Cancel it and reopen targets to edit the latest version.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Applications", { exact: true })).toHaveValue("9");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Set my weekly targets", exact: true }).click();
    await expect(page.getByLabel("Applications", { exact: true })).toHaveValue("7");
    await page.getByLabel("Applications", { exact: true }).fill("8");
    await page.getByRole("button", { name: "Save weekly targets", exact: true }).click();
    await page.getByRole("button", { name: "Ask AI for next steps", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Demo AI advice", exact: true })).toBeVisible();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator("svg circle.motion-safe\\:animate-pulse").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`weekly-studio-${viewport.name}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole("progressbar", { name: "Applications recorded", exact: true })).toHaveAttribute("aria-valuemax", "8");
    const manual = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Data engineer", company: "Northstar", status: "interviewing", next_at: new Date(Date.now() + 86400000).toISOString(),
    } });
    expect(manual.status(), await manual.text()).toBe(201);
    // Daily actions are Today's action queue now.
    await page.goto("/jobs/actions");
    await page.locator("summary").filter({ hasText: "Your action queue" }).click();
    const file = page.waitForEvent("download");
    await page.getByText("Filters, refresh & calendar", { exact: true }).click();
    await page.getByRole("button", { name: "Export upcoming dates", exact: true }).click();
    expect((await file).suggestedFilename()).toBe("orbit-next-seven-days.ics");
  });
}
