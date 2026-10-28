import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Personal career flow: saved action, AI plan, refresh and reminder rules (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Graduate engineer", company: "Example Studio", status: "interviewing",
      next_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    } });
    expect(created.status(), await created.text()).toBe(201);
    const job = await created.json();
    let modelCalls = 0;
    page.on("request", (request) => { if (request.url().endsWith("/v1/jobs/launchpad/plan")) modelCalls++; });
    // The launchpad overview moved to Today; the companion is the focused next-step panel.
    await page.goto("/jobs?work=plan");
    const companion = page.getByRole("region", { name: "Your next-step companion", exact: true });
    const next = companion.getByRole("region", { name: "Suggested next action", exact: true });
    await expect(next.getByRole("link", { name: "Continue", exact: true })).toHaveAttribute("href", `/jobs/mission/${job.id}?tab=plan`);
    expect(modelCalls).toBe(0);
    await companion.getByRole("button", { name: "Build my next-step plan", exact: true }).click();
    await expect(companion.getByText("Demo AI plan", { exact: true })).toBeVisible();
    expect(modelCalls).toBe(1);
    await a11y(page);
    await page.screenshot({ path: info.outputPath(`career-flow-${viewport.name}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Refreshing reads saved activity again, without another AI request.
    expect((await context.request.patch(`${API}/v1/jobs/tracker/${job.id}`, { data: { status: "withdrawn" } })).ok()).toBe(true);
    await companion.getByRole("button", { name: "Refresh saved progress", exact: true }).click();
    await expect(next.getByRole("link", { name: "Continue", exact: true })).toHaveAttribute("href", "/career");
    await expect(companion.getByText("Demo AI plan", { exact: true })).toHaveCount(0);
    expect(modelCalls).toBe(1);
    await page.getByRole("link", { name: "← Back to Today", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    // The reminder rules live on Today and open from their link.
    await page.goto("/#follow-up-rules");
    await expect(page.getByText("Your workflow rules", { exact: true })).toBeFocused();
    await expect(page.getByRole("checkbox", { name: "Application follow-ups", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Application follow-ups", exact: true })).not.toBeChecked();
    await a11y(page);
    // Browser titles and labels use the same simplified tool names, with legacy URLs still working.
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Learning", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Learning · Orbit");
    await page.goto("/linkedin");
    await expect(page.getByRole("heading", { name: "LinkedIn Optimizer", exact: true })).toBeVisible();
  });
}

test("Launchpad recovers a failed progress request without generating a plan", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context);
  await page.route("**/v1/jobs/launchpad/progress", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Progress is temporarily unavailable" }) }));
  await page.goto("/jobs?work=plan");
  const companion = page.getByRole("region", { name: "Your next-step companion", exact: true });
  await expect(companion.getByText("Progress is temporarily unavailable", { exact: true })).toBeVisible();
  await expect(companion.getByRole("link", { name: "Continue", exact: true })).toHaveCount(0);
  await page.unroute("**/v1/jobs/launchpad/progress");
  await companion.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(companion.getByRole("link", { name: "Continue", exact: true })).toHaveAttribute("href", "/career");
});
