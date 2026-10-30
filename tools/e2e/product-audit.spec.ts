import { expect, test, type BrowserContext } from "@playwright/test";

// Regressions from the product audit (DECISIONS D73): a blip that signed people out, an admin page's useless Retry,
// a sign-up button disabled with no reason, the security notice on Home, the extension page's dead end.
const API = "http://127.0.0.1:8000";

async function signup(context: BrowserContext, country = "IN") {
  const r = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `audit-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Ravi Kumar", country },
  });
  expect(r.status(), await r.text()).toBe(201);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
}

test("a failed session check says Orbit can't be reached, and doesn't sign anyone out", async ({ page, context }) => {
  await signup(context);
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: "Copilot", exact: true })).toBeVisible();
  // The API restarting: the session check gets a 503.
  await page.route(`${API}/v1/auth/me`, (route) => route.fulfill({ status: 503, body: "upstream restarting" }));
  await page.reload();
  await expect(page.getByText("Can't reach Orbit")).toBeVisible();
  await expect(page.getByText("If you were signed in, you still are.", { exact: false })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/sessions"); // not sent to /login
  await page.unroute(`${API}/v1/auth/me`);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Copilot", exact: true })).toBeVisible();
});

test("someone who isn't the admin is told an admin page is the admin's", async ({ page, context }) => {
  await signup(context);
  await page.goto("/admin/users");
  await expect(page.getByText("This page is for Orbit's admin")).toBeVisible();
  await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Go to Home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("sign-up says why it can't go on yet instead of a silently disabled button", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await page.goto("/register");
  await page.getByLabel("Email").fill(`audit-${crypto.randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  const create = page.getByRole("button", { name: "Create account" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByText("Tick the box to agree to the terms.")).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to the terms/ }).check();
  await expect(page.getByText("Tick the box to agree to the terms.")).toHaveCount(0);
});

test("Home shows a recent change to the sign-in until it's acknowledged on this device", async ({ page, context }) => {
  await signup(context);
  const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await page.route(`${API}/v1/auth/security-activity`, (route) =>
    route.fulfill({ json: { notice_days: 14, emailed: false, items: [{ id: "e1", action: "auth.passkey_added", text: "A passkey was added", at, notice: true }] } }),
  );
  await page.goto("/");
  await expect(page.getByText(/A passkey was added on/)).toBeVisible();
  await expect(page.getByRole("link", { name: "It wasn't me" })).toHaveAttribute("href", "/forgot-password");
  await page.getByRole("button", { name: "It was me" }).click();
  await expect(page.getByText(/A passkey was added on/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/A passkey was added on/)).toHaveCount(0);
});

test("the extension page without the extension says so and can look again", async ({ page, context }) => {
  await signup(context);
  await page.goto("/extension/connect");
  await expect(page.getByText("The extension isn't on this browser yet", { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("It isn't in the browser stores yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Look again" }).click();
  await expect(page.getByRole("button", { name: "Looking for the extension…" })).toBeVisible();
});
