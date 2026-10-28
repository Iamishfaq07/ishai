import { expect, test } from "@playwright/test";

const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
test("admin reviews failed work and records a reason before retrying", async ({ page, context }) => {
  const credentials = { email: process.env.ORBIT_TEST_ADMIN_EMAIL ?? "qa-admin@example.com", password: "correct horse battery", country: "IN" };
  const joined = await context.request.post(`${API}/v1/auth/register`, { data: credentials });
  if (joined.status() === 409) {
    const login = await context.request.post(`${API}/v1/auth/login`, { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(joined.status(), await joined.text()).toBe(201);
  const failed = { id: "reviewable-report", kind: "report", attempts: 3, updated_at: "2026-10-28T00:00:00+00:00", error_type: "RuntimeError", can_retry: true };
  let retried = false;
  let request: unknown;
  await page.route("**/v1/admin/workflows", (route) => route.fulfill({ json: {
    counts: { failed: retried ? 0 : 1, running: 0 }, due: retried ? 1 : 0, expired_leases: 0,
    oldest_due_at: null, failed: retried ? [] : [failed], truncated: false,
  } }));
  await page.route("**/v1/admin/workflows/reviewable-report/retry", (route) => {
    request = route.request().postDataJSON(); retried = true;
    return route.fulfill({ json: { id: failed.id, status: "queued" } });
  });
  await page.goto("/admin/users");
  const workflows = page.getByRole("region", { name: "Background workflows" });
  await expect(workflows.getByRole("button", { name: "Retry report", exact: true })).toBeDisabled();
  await workflows.getByLabel("Reason for retry").fill("Provider connectivity restored");
  await workflows.getByRole("button", { name: "Retry report", exact: true }).click();
  await expect(workflows.getByText("No failed background workflows.", { exact: true })).toBeVisible();
  expect(request).toEqual({ updated_at: failed.updated_at, reason: "Provider connectivity restored" });
});
