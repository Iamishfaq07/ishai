import { test, expect, type BrowserContext } from "@playwright/test";

const API = process.env.CAREER_TEST_API ?? "http://127.0.0.1:8000";
async function register(context: BrowserContext) {
  const response = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `career-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, password: "career-workspace-test-password", name: "Career Tester" },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test("workspace saves across tabs, preserves a conflicting draft and isolates another account", async ({ page, context, browser }) => {
  await register(context);
  await page.goto("/readiness");
  await expect(page.getByText("Account version loaded", { exact: false })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/readiness");
  await expect(second.getByText("Account version loaded", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Skill name", exact: true }).fill("SQL");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Account version loaded", { exact: false })).toBeVisible();
  await second.getByRole("textbox", { name: "Skill name", exact: true }).fill("Python");
  await second.getByRole("button", { name: "Add skill", exact: true }).click();
  await second.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(second.getByRole("alert").filter({ hasText: "workspace changed" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Download draft" })).toBeVisible();
  second.once("dialog", (dialog) => dialog.accept());
  await second.getByRole("button", { name: "Load account version" }).click();
  await expect(second.getByRole("option", { name: "SQL", exact: true })).toHaveCount(1);
  await expect(second.getByRole("option", { name: "Python", exact: true })).toHaveCount(0);
  const other = await browser.newContext();
  try {
    await register(other);
    const otherPage = await other.newPage();
    await otherPage.goto(new URL("/readiness", page.url()).href);
    await expect(otherPage.getByText("Account version loaded", { exact: false })).toBeVisible();
    await expect(otherPage.getByRole("option", { name: "SQL", exact: true })).toHaveCount(0);
  } finally { await other.close(); }
});

test("practical project sharing requires excerpt review and can be revoked on mobile", async ({ page, context }) => {
  await register(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn");
  await expect(page.getByText("Account version loaded", { exact: false }).first()).toBeVisible();
  await page.getByLabel("Initial work and test results").fill("Synthetic SQL dataset: three repeat buyers among ten eligible customers. Tests passed locally.");
  await page.getByLabel("Your revised solution").fill("Excluded refunded orders and incomplete observation windows; rechecked the denominator.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Account version loaded", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review excerpt to share" }).click();
  await expect(page.getByRole("heading", { name: "This exact excerpt will be shared" })).toBeVisible();
  await page.getByRole("button", { name: "Create 7-day reviewer link" }).click();
  const link = page.locator('a[href*="/v1/career/evidence-shares/view/"]');
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  expect((await context.request.get(href)).status()).toBe(200);
  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByRole("button", { name: "Revoke link" })).toHaveCount(0);
  expect((await context.request.get(href)).status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("transition plan saves role evidence and actions across reload", async ({ page, context }) => {
  await register(context);
  await page.goto("/learn");
  const planner = page.locator('section[aria-labelledby="transition-heading"]');
  await expect(planner.getByText("Account version loaded", { exact: false })).toBeVisible();
  await planner.getByRole("button", { name: "Backend developer starter", exact: true }).click();
  await planner.getByLabel("Current role or starting point").fill("Customer support");
  const requirement = planner.locator("article").first();
  await requirement.getByLabel("Your supporting evidence").fill("Synthetic API exercise with validation tests recorded locally.");
  await requirement.getByLabel("Next concrete action").fill("Test concurrent requests against the synthetic API");
  await planner.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(planner.getByText("Account version loaded", { exact: false })).toBeVisible();
  await page.reload();
  await expect(planner.getByLabel("Target role", { exact: true })).toHaveValue("Backend developer");
  await expect(planner.locator("article").first().getByLabel("Your supporting evidence")).toHaveValue("Synthetic API exercise with validation tests recorded locally.");
});

test("Today presents the connected overview and preparation queue", async ({ page, context }) => {
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `today-${Date.now()}@example.com`, password: "career-workspace-test-password", name: "Today Tester" } });
  expect(registered.status()).toBe(201);
  const token = (await registered.json()).access_token;
  const saved = await context.request.put(`${API}/v1/career/workspace/transition`, { headers: { Authorization: `Bearer ${token}` }, data: {
    revision: 0, data: { currentRole: "Support", targetRole: "Analyst", motivation: "Data work", requirements: [{
      id: "sql", requirement: "SQL", evidence: "", nextAction: "Run synthetic cohort query", state: "practising", due: "" }] } } });
  expect(saved.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your career overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open transition plan" }).first()).toBeVisible();
  await page.locator("summary").filter({ hasText: "Your action queue" }).click();
  await page.locator("summary").filter({ hasText: "Filters, refresh & calendar" }).click();
  await page.getByRole("button", { name: "Preparation", exact: true }).click();
  await expect(page.getByText("Run synthetic cohort query", { exact: true }).last()).toBeVisible();
});
