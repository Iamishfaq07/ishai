import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";
import { prepareReview } from "./personal-apply-fixtures";


for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Daily focus resumes the right application and keeps job context (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { jid } = await seed(context);
    const { packet, tracker, listingId } = await prepareReview(context, jid);
    const later = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Later interview", company: "Other company", status: "interviewing",
      next_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
    } });
    expect(later.status(), await later.text()).toBe(201);
    await page.goto("/jobs/actions");
    const focus = page.getByRole("region", { name: "Recommended next action", exact: true });
    await expect(focus.getByRole("heading", { name: "Backend engineer · Northstar Studio", exact: true })).toBeVisible();
    await expect(focus.getByText("Your prepared application is waiting for your review.", { exact: true })).toBeVisible();
    await expect(focus.getByRole("link", { name: "Review application", exact: true })).toHaveAttribute("href", `/jobs/applications?packet=${packet.id}`);
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`daily-focus-${viewport.name}.png`), fullPage: true });
    await focus.getByRole("link", { name: "Review application", exact: true }).click();
    const tools = page.getByRole("navigation", { name: "Tools for this application", exact: true });
    await expect(tools.getByRole("link", { name: "Prepare for this role", exact: true })).toHaveAttribute("href", `/jobs/mission/${tracker.id}?tab=plan`);
    await tools.getByRole("link", { name: "Prepare for this role", exact: true }).click();
    await expect(page.getByLabel("Workspace tool", { exact: true })).toHaveValue("plan");
    await expect(page.getByRole("heading", { name: "Backend engineer", exact: true })).toBeVisible();
    await page.goBack();
    await tools.getByRole("link", { name: "Find people at this company", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/outreach\\?job=${encodeURIComponent(listingId)}&network=1$`));
    await expect(page.getByRole("region", { name: "Contact finder", exact: true }).getByLabel("Job to research", { exact: true })).toHaveValue(tracker.id);
    const closed = await context.request.patch(`${API}/v1/jobs/tracker/${tracker.id}`, { data: { status: "withdrawn" } });
    expect(closed.ok(), await closed.text()).toBe(true);
    await page.goto("/jobs/actions");
    await expect(focus.getByRole("heading", { name: "Later interview · Other company", exact: true })).toBeVisible();
    const current = await (await context.request.get(`${API}/v1/jobs/actions`)).json();
    expect(current.items.some((action: { id: string }) => action.id === `packet:${packet.id}`)).toBe(false);
    expect((await (await context.request.get(`${API}/v1/apply/packets/${packet.id}`)).json()).status).toBe("review");
    await a11y(page);
  });
}
