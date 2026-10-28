import { expect, test } from "@playwright/test";

const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";

test("website and sign-in show FIRST10; cart validates and passes the code to checkout", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  await expect(page.getByRole("complementary", { name: "First purchase offer" })).toContainText("FIRST10");
  await page.goto("/login");
  await expect(page.getByRole("complementary", { name: "First purchase offer" })).toContainText("10% off");
  const created = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `first10-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Cart candidate", country: "IN",
  } });
  expect(created.status(), await created.text()).toBe(201);
  // Advertise a test payment method even when real gateway credentials are absent.
  await page.route("**/v1/billing/packs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: (await response.json()).map((p: Record<string, unknown>) => ({
      ...p, buyable: true, checkout: "razorpay",
    })) });
  });
  await page.route("**/v1/billing/quote**", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({ response }); return; }
    await route.fulfill({ response, json: { ...(await response.json()), checkout: "razorpay" } });
  });
  await page.goto("/billing?pack=mini");
  const cart = page.getByRole("dialog", { name: "Your cart" });
  await expect(cart).toBeVisible();
  await expect(cart).toContainText("₹499");
  await cart.getByLabel("Promotion code").fill("WRONG10");
  await cart.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cart.getByRole("alert")).toContainText("Only FIRST10");
  await cart.getByLabel("Promotion code").fill("first10");
  await cart.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cart.getByRole("status")).toContainText("FIRST10 applied");
  await expect(cart.getByRole("button", { name: "Pay ₹449 securely" })).toBeEnabled();
  await cart.getByRole("button", { name: "Remove code" }).click();
  await expect(cart.getByRole("button", { name: "Pay ₹499 securely" })).toBeEnabled();
  await cart.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cart.getByRole("button", { name: "Pay ₹449 securely" })).toBeEnabled();
  let sent: unknown;
  await page.route("**/v1/billing/razorpay/orders", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { detail: "Test checkout: no payment created." } });
  });
  await cart.getByRole("button", { name: "Pay ₹449 securely" }).click();
  await expect.poll(() => sent).toEqual({ pack: "mini", code: "FIRST10" });
  await expect(cart.getByRole("alert")).toContainText("Test checkout");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
