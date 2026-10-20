import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`AI workflows: reviewed Business plan and personal action desk (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid } = await seed(context);
    const path = `/v1/business/companies/${cid}/jobs/${jid}/hiring-plan`;
    await page.goto(`/business/app/${cid}/jobs/${jid}/interview-plan`);
    await page.getByRole("button", { name: "Draft interview plan with AI", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Demo AI preview/ })).toBeVisible();
    expect((await (await context.request.get(`${API}${path}`)).json()).revision).toBe(0);
    await a11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`business-ai-plan-${viewport.name}.png`), fullPage: true });
    // Local changes invalidate a preview; it must never overwrite those edits silently.
    await page.getByLabel("Skill or outcome", { exact: true }).first().fill("A new skill from my edit");
    await expect(page.getByRole("button", { name: "Use this draft in the editor", exact: true })).toHaveCount(0);
    if (viewport.name === "desktop") {
      let received = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**${path}/assist`, async (route) => {
        const response = await route.fetch(); received = true;
        await gate;
        await route.fulfill({ response });
      });
      await page.getByRole("button", { name: "Draft interview plan with AI", exact: true }).click();
      await expect.poll(() => received).toBe(true);
      await page.getByLabel("Skill or outcome", { exact: true }).first().fill("Keep my newer work");
      release();
      await expect(page.getByText("Your editor changed while AI was drafting. Generate a fresh preview to keep those edits safe.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Use this draft in the editor", exact: true })).toHaveCount(0);
      await page.unroute(`**${path}/assist`);
    }
    await page.getByRole("button", { name: "Draft interview plan with AI", exact: true }).click();
    await page.getByRole("button", { name: "Use this draft in the editor", exact: true }).click();
    await expect(page.getByLabel("Core question", { exact: true }).first()).toHaveValue(/^\[mock\]/);
    expect((await (await context.request.get(`${API}${path}`)).json()).revision).toBe(0);
    await page.getByRole("button", { name: "Save interview plan", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`${API}${path}`)).json()).revision).toBe(1);

    const contact = await context.request.post(`${API}/v1/jobs/contacts`, { data: {
      name: "Alex Recruiter", company: "Northstar", follow_up_at: new Date(Date.now() - 86400000).toISOString(),
    } });
    expect(contact.status(), await contact.text()).toBe(201);
    const contactId = (await contact.json()).id as string;
    const job = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Platform engineer", company: "Northstar", status: "interviewing",
      next_at: new Date(Date.now() + 86400000).toISOString(),
    } });
    expect(job.status(), await job.text()).toBe(201);
    await page.goto("/jobs/actions");
    await expect(page.getByRole("heading", { name: "Daily actions", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alex Recruiter", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Build my AI brief", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Demo AI brief", exact: true })).toBeVisible();
    await page.getByText("Filters, refresh & calendar", { exact: true }).click();
    await page.getByRole("button", { name: "Past due", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Platform engineer · Northstar", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`personal-action-desk-${viewport.name}.png`), fullPage: true });
    expect((await context.request.delete(`${API}/v1/jobs/contacts/${contactId}`)).status()).toBe(204);
    await page.getByRole("button", { name: "Refresh records", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Alex Recruiter", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Demo AI brief", exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator("svg circle").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
}
