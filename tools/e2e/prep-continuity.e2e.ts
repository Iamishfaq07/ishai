import { expect, test, type BrowserContext } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";
test.use({ actionTimeout: 10_000, timezoneId: "Asia/Kolkata" });

async function job(context: BrowserContext, date?: string, title = "Graduate developer") {
  const response = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
    title, company: "Example Studio", status: "interviewing", ...(date ? { next_at: date } : {}),
  } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

for (const viewport of [{ width: 1440, height: 1000, name: "desktop" }, { width: 360, height: 800, name: "mobile" }, { width: 320, height: 800, name: "narrow-dark" }]) {
  test(`Completed work survives reschedule and is reviewed before reuse (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.name === "narrow-dark" ? "dark" : "light" });
    await context.addInitScript(() => { localStorage.setItem("orbit.cookies.v1", "1"); localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" })); });
    await seed(context); const entry = await job(context, new Date(Date.now() + 4 * 86400000).toISOString());
    let ai = 0; let writes = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/coach/plan")) ai++;
      if (request.method() === "PUT" && request.url().includes("/plan/checks/")) writes++;
    });
    await page.goto(`/jobs/mission/${entry.id}?guide=1&tab=plan`);
    await expect(page.getByRole("region", { name: "Suggested preparation task", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show upcoming prep days (4)", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Show upcoming prep days (4)", exact: true }).click();
    await expect(page.getByText(/^Tomorrow ·/)).toBeVisible();
    await page.getByRole("button", { name: "Hide upcoming prep days", exact: true }).click();
    await expect(page.getByText(/^Tomorrow ·/)).toHaveCount(0);
    expect(writes).toBe(0); expect(ai).toBe(0);
    await page.getByRole("checkbox", { name: "Tick off: Read the job post and the company again", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Untick: Read the job post and the company again", exact: true })).toBeChecked();
    await expect(page.getByText("Completed preparation (1)", { exact: true })).toBeVisible();
    expect(writes).toBe(1); expect(ai).toBe(0);
    expect((await context.request.patch(`${API}/v1/jobs/tracker/${entry.id}`, { data: { next_at: new Date(Date.now() + 8 * 86400000).toISOString() } })).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Tick off: Read the job post and the company again", exact: true })).not.toBeChecked();
    await page.getByRole("button", { name: "Review earlier work", exact: true }).click();
    const review = page.getByRole("group", { name: "Review earlier preparation", exact: true });
    await expect(review.getByRole("button", { name: "Use this preparation", exact: true })).toBeDisabled();
    expect(writes).toBe(1); expect(ai).toBe(0);
    await review.getByLabel("I checked the current job and materials. This earlier work still meets this task.", { exact: true }).check();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`prep-reuse-${viewport.name}.png`), fullPage: true });
    await review.getByRole("button", { name: "Use this preparation", exact: true }).click();
    await expect(page.getByRole("region", { name: "Suggested preparation task", exact: true }).getByRole("heading")).toBeFocused();
    await expect(page.getByRole("checkbox", { name: "Untick: Read the job post and the company again", exact: true })).toBeChecked();
    await page.getByText("Completed preparation (2)", { exact: true }).click();
    await expect(page.getByText(/Earlier work reviewed and reused/)).toBeVisible();
    expect(writes).toBe(2); expect(ai).toBe(0);
    await page.getByText("Plan my interview preparation with AI", { exact: true }).click();
    const help = page.getByRole("button", { name: "Help me with this step", exact: true });
    await expect(help).toBeEnabled(); expect(ai).toBe(0); await help.click();
    await expect(page.getByText("Demo opportunity guidance", { exact: true })).toBeVisible();
    await expect(page.getByText(/browser-day plan \(UTC offset 330 minutes\)/)).toBeVisible();
    expect(ai).toBe(1); await a11y(page);
    await page.screenshot({ path: info.outputPath(`prep-history-${viewport.name}.png`), fullPage: true });
    const state = await (await context.request.get(`${API}/v1/jobs/tracker/${entry.id}/plan?tz_offset=330`)).json();
    expect(state.completed_total).toBe(2); expect(state.done).toBe(1);
  });
}

test("Date-free practice guides a fresher without recording an interview or calling AI on entry", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const entry = await job(context);
  let ai = 0; let confirm = 0;
  page.on("request", (request) => { if (request.url().endsWith("/coach/plan")) ai++; if (request.url().endsWith("/message-update/confirm")) confirm++; });
  await page.goto(`/jobs/mission/${entry.id}?guide=1&tab=plan`);
  await expect(page.getByRole("heading", { name: "Practice before an interview is booked", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Suggested preparation task", exact: true }).getByRole("link", { name: "Start this task", exact: true })).toHaveAttribute("href", `/jobs/mission/${entry.id}?guide=1&tab=company`);
  await page.getByText("Plan my interview preparation with AI", { exact: true }).click();
  const help = page.getByRole("button", { name: "Help me with this step", exact: true });
  await expect(help).toBeEnabled(); expect(ai).toBe(0); expect(confirm).toBe(0); await help.click();
  await expect(page.getByText("Demo opportunity guidance", { exact: true })).toBeVisible();
  await expect(page.getByText(/No upcoming interview is assumed/)).toBeVisible();
  const saved = await (await context.request.get(`${API}/v1/jobs/tracker/${entry.id}/message-update`)).json();
  expect(saved.next_at).toBeNull(); expect(ai).toBe(1); expect(confirm).toBe(0);
  await a11y(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("prep-rehearsal-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Add a confirmed interview date", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Interview", exact: true })).toBeFocused();
});

test("A delayed completion cannot replace the plan after switching jobs", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const first = await job(context); const second = await job(context, undefined, "Second role");
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/plan/checks/**", async (route) => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); });
  await page.goto(`/jobs/mission/${first.id}?guide=1&tab=plan`);
  await page.getByRole("checkbox", { name: /^Tick off:/ }).first().click(); await requested;
  await page.goto(`/jobs/mission/${second.id}?guide=1&tab=plan`);
  await expect(page.getByText("Completed preparation (0)", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Second role", exact: true })).toBeVisible();
  await expect(page.getByText("Completed preparation (0)", { exact: true })).toBeVisible();
});
