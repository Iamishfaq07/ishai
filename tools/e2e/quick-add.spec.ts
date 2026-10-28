import { expect, test, type BrowserContext } from "@playwright/test";

const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
async function signup(context: BrowserContext) {
  const result = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `quick-add-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Quick add", country: "IN",
  } });
  expect(result.status(), await result.text()).toBe(201);
}

test("Today saves a job from a link or its post and opens the fit check", async ({ page, context }) => {
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await page.goto("/");
  const link = "https://www.naukri.com/job-listings-backend-engineer-razorpay-bengaluru-3-to-6-years-150125009999";
  await page.getByLabel("Job link").fill(link);
  await page.getByRole("button", { name: "Save and check fit" }).click();
  await expect(page).toHaveURL(/\/jobs\/mission\/[\w-]+\?tab=fit$/);
  await expect(page.getByRole("heading", { name: "Backend Engineer" })).toBeVisible();
  const first = page.url();
  // The same link again opens that job instead of adding it twice.
  await page.goto("/");
  await page.getByLabel("Job link").fill(link);
  await page.getByRole("button", { name: "Save and check fit" }).click();
  await expect(page).toHaveURL(first.replace("?tab=fit", ""));
  // No link: the post itself.
  await page.goto("/");
  await page.getByRole("button", { name: "No link? Paste the job post instead" }).click();
  await page.getByLabel("Company").fill("Zepto");
  await page.getByLabel("Job title").fill("Data analyst");
  await page.getByLabel("Job post").fill("We need a data analyst who writes SQL, builds dashboards and explains trends to product teams. Bengaluru.");
  await page.getByRole("button", { name: "Save and check fit with AI" }).click();
  await expect(page).toHaveURL(/\/jobs\/mission\/[\w-]+\?tab=fit$/);
  await expect(page.getByRole("heading", { name: "Data analyst" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
