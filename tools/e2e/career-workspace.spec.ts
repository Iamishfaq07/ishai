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
  await expect(page.getByText("Account version loaded", { exact: false })).toBeVisible();
  await page.getByLabel("Initial work and test results").fill("Synthetic SQL dataset: three repeat buyers among ten eligible customers. Tests passed locally.");
  await page.getByLabel("Your revised solution").fill("Excluded refunded orders and incomplete observation windows; rechecked the denominator.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Account version loaded", { exact: false })).toBeVisible();
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
