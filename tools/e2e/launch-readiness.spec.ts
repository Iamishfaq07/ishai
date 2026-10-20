import { expect, test, type BrowserContext } from "@playwright/test";

const API = "http://127.0.0.1:8000";
async function signup(context: BrowserContext) {
  const r = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `browser-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Ana" },
  });
  expect(r.status(), await r.text()).toBe(201);
}

test("cancelled autosave preserves newer text; another tab receives a conflict", async ({ page, context }) => {
  await signup(context);
  const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "Original" } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  await page.goto(`/resume-ai/${id}`);
  const name = page.getByLabel("Resume name");
  await expect(name).toHaveValue("Original");
  let release: (() => void) | undefined;
  let held = false;
  await page.route(`${API}/v1/resumes/${id}`, async (route) => {
    if (route.request().method() === "PUT" && !held) {
      held = true;
      await new Promise<void>((resolve) => { release = resolve; });
    }
    await route.continue().catch(() => undefined); // The first request is intentionally aborted by the editor.
  });
  await name.fill("First edit");
  await expect.poll(() => held).toBe(true);
  await name.fill("Newest edit");
  release?.();
  await expect.poll(async () => (await (await context.request.get(`${API}/v1/resumes/${id}`)).json()).title).toBe("Newest edit");
  const tab = await context.newPage();
  await tab.goto(`/resume-ai/${id}`);
  await expect(tab.getByLabel("Resume name")).toHaveValue("Newest edit");
  await name.fill("Saved from first tab");
  await expect.poll(async () => (await (await context.request.get(`${API}/v1/resumes/${id}`)).json()).title).toBe("Saved from first tab");
  await tab.getByLabel("Resume name").fill("Conflicting second tab");
  await expect(tab.getByText("Saved in another tab or device", { exact: false })).toBeVisible();
  expect((await (await context.request.get(`${API}/v1/resumes/${id}`)).json()).title).toBe("Saved from first tab");
});

test("mobile target context survives a reload and a trip through Home", async ({ page, context }, info) => {
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/mock?role=Platform%20engineer&company=Acme&interview_stage=Staff%20panel&tech_stack=%5B%22Go%22%5D");
  await page.getByRole("button", { name: "Dismiss the cookie note", exact: true }).click();
  await expect(page).toHaveURL(/company=Acme/);
  await page.reload();
  await expect(page).toHaveURL(/role=Platform/);
  await expect(page.getByLabel("Company (optional)", { exact: true })).toHaveValue("Acme");
  await expect(page.getByLabel("Interview stage", { exact: true })).toHaveValue("Staff panel");
  // Today routes through the contextual Prepare space. Its plain /mock link restores this tab's target.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mobile-home.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Prepare", exact: true }).click();
  await page.getByRole("link", { name: /^Practice with Saba/ }).click();
  await expect(page).toHaveURL(/\/mock\?.*company=Acme/);
  await expect(page.getByLabel("Company (optional)", { exact: true })).toHaveValue("Acme");
});

test("live coding exposes the spoken walkthrough and architecture defense", async ({ page, context }, info) => {
  await signup(context);
  await page.emulateMedia({ colorScheme: "dark" });
  const created = await context.request.post(`${API}/v1/sessions`, { data: { title: "Coding QA", type: "coding" } });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  await page.goto(`/live/${id}`);
  await page.getByRole("button", { name: "Dismiss the cookie note", exact: true }).click();
  await page.getByText("Critique architecture / diagram", { exact: true }).click();
  await page.getByLabel("Architecture notes", { exact: false }).fill("A Go API writes events to Kafka and stores idempotent ledger entries in Postgres.");
  await page.getByRole("button", { name: "Build Defense Card" }).click();
  await expect(page.getByRole("heading", { name: "Defense Card", exact: true })).toBeVisible();
  await expect(page.getByText("Three likely follow-up questions", { exact: true })).toBeVisible();
  // Feed the real WebSocket via the developer simulation controls; no mocked HTTP responses.
  await page.getByRole("combobox", { name: /speed/ }).selectOption("10");
  await page.getByRole("button", { name: "coding interview", exact: true }).click();
  const spoken = page.getByRole("tab", { name: "30s Spoken Walkthrough" });
  await expect(spoken).toBeVisible({ timeout: 30_000 });
  await spoken.click();
  await expect(page.getByRole("heading", { name: "Before typing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complexity defense" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("coding-defense-walkthrough.png"), fullPage: true });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.waitForURL(`**/sessions/${id}`);
  await expect(page.getByRole("heading", { name: "Debrief Studio", exact: true })).toBeVisible();
  await page.getByLabel("Retry this question", { exact: true }).fill("I store earlier values in a hash map and check the complement before insertion. Each input is scanned once; duplicates cannot reuse the same index.");
  await page.getByRole("button", { name: "Score my retry", exact: true }).click();
  await expect(page.getByText("Latest retry: 4/5", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Concept depth radar", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("debrief-radar-retry.png"), fullPage: true });
});
