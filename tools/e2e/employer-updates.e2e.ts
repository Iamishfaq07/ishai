import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";
test.use({ actionTimeout: 10_000, timezoneId: "Asia/Kolkata" });

async function job(context: Parameters<typeof seed>[0], title = "Graduate developer") {
  const response = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { title, company: "Example Studio", status: "applied" } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Employer message to reviewed tracker and interview date (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const entry = await job(context);
    const at = new Date(Date.now() + 2 * 86400000); at.setUTCSeconds(0, 0);
    const text = `We would like to invite you to an interview. Your interview is confirmed for ${at.toISOString().replace(".000Z", "Z")}. Please confirm your availability.`;
    let aiCalls = 0; let writes = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/message-update/preview") && request.postDataJSON()?.mode === "ai") aiCalls++;
      if (request.url().endsWith("/message-update/confirm")) writes++;
    });
    await page.goto("/jobs?work=updates");
    await page.getByLabel("1. Choose the job this message is about").selectOption(entry.id);
    const helper = page.getByRole("region", { name: "Review an employer message", exact: true });
    await helper.getByLabel("2. Paste the relevant employer message").fill(text);
    await helper.getByRole("button", { name: "Review message for free", exact: true }).click();
    await expect(helper.getByRole("heading", { name: "3. Review suggested changes", exact: true })).toBeFocused();
    await expect(helper.getByText("Pattern suggestion · Interview invitation", { exact: true })).toBeVisible();
    expect(aiCalls).toBe(0); expect(writes).toBe(0);
    await expect(helper.getByLabel("Set a confirmed next date", { exact: true })).not.toBeChecked();
    await expect(helper.getByLabel("Next date and time (your browser’s time zone)")).not.toHaveValue("");
    await expect(helper.getByRole("button", { name: "Save reviewed changes", exact: true })).toBeDisabled();
    await helper.getByLabel("Set a confirmed next date", { exact: true }).check();
    await helper.getByLabel("I checked that this message is for this job and confirm these changes.", { exact: true }).check();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`employer-update-${viewport.name}.png`), fullPage: true });
    await helper.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
    await expect(helper.getByRole("heading", { name: "Reviewed changes saved", exact: true })).toBeVisible();
    await expect(helper.getByLabel("2. Paste the relevant employer message")).toHaveValue("");
    expect(writes).toBe(1);
    const result = await (await context.request.get(`${API}/v1/jobs/tracker/${entry.id}/message-update`)).json();
    expect(result.status).toBe("interviewing"); expect(Date.parse(result.next_at)).toBe(at.valueOf());
    const actions = await (await context.request.get(`${API}/v1/jobs/actions`)).json();
    expect(actions.items.some((action: { path: string }) => action.path === `/jobs/mission/${entry.id}?tab=plan`)).toBe(true);
    await helper.getByRole("link", { name: "Continue with this job", exact: true }).click();
    await expect(page.getByRole("region", { name: "Opportunity context", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interview", exact: true })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Help and updates for this job" }).click();
    await page.getByRole("button", { name: "Employer reply", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review an employer message", exact: true }).getByLabel("2. Paste the relevant employer message")).toHaveValue("");
    await a11y(page);
  });
}

test("AI suggestions stay editable and stale tracker changes preserve pasted text", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const entry = await job(context);
  await page.goto(`/jobs?work=updates&job=${entry.id}`);
  const helper = page.getByRole("region", { name: "Review an employer message", exact: true });
  const text = "We would like to invite you to an interview. Please confirm your availability.";
  await helper.getByLabel("2. Paste the relevant employer message").fill(text);
  await helper.getByRole("button", { name: "Ask AI to interpret", exact: true }).click();
  await expect(helper.getByText("Demo AI suggestion · Interview invitation", { exact: true })).toBeVisible();
  await helper.getByLabel("I checked that this message is for this job and confirm these changes.", { exact: true }).check();
  expect((await context.request.patch(`${API}/v1/jobs/tracker/${entry.id}`, { data: { status: "offer" } })).ok()).toBe(true);
  await helper.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await expect(helper.getByText(/This job changed or is closed/)).toBeVisible();
  await expect(helper.getByLabel("2. Paste the relevant employer message")).toHaveValue(text);
  await helper.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(helper.getByText("Current stage: offer", { exact: true })).toBeVisible();
  await expect(helper.getByRole("heading", { name: "3. Review suggested changes", exact: true })).toHaveCount(0);
  await expect(helper.getByLabel("2. Paste the relevant employer message")).toHaveValue(text);
});

test("A delayed suggestion cannot appear under a different job", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const first = await job(context); const second = await job(context, "Another role");
  await page.goto(`/jobs?work=updates&job=${first.id}`);
  const helper = page.getByRole("region", { name: "Review an employer message", exact: true });
  await helper.getByLabel("2. Paste the relevant employer message").fill("We would like to invite you to an interview.");
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/message-update/preview", async (route) => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  await helper.getByRole("button", { name: "Ask AI to interpret", exact: true }).click(); await requested;
  await page.getByLabel("1. Choose the job this message is about").selectOption(second.id);
  await expect(helper.getByText("Another role · Example Studio", { exact: true })).toBeVisible();
  const finished = page.waitForResponse((response) => response.url().endsWith("/message-update/preview"));
  release(); await finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(helper.getByRole("heading", { name: "3. Review suggested changes", exact: true })).toHaveCount(0);
  await expect(helper.getByLabel("2. Paste the relevant employer message")).toHaveValue("");
});
