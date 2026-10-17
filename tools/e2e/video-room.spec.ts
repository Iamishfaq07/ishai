import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8000";

// The AI video interview on a 360 px phone, with the camera coach's button too (ORBIT_VIDEO_MOCK is on for this API):
// every round control stays on screen, End most of all. Seven 48 px buttons used to push Mute mic and End off the edges.
test("the video interview's controls all fit a 360 px phone", async ({ page, context }) => {
  // The admin (ORBIT_ADMIN_EMAIL) has interview minutes whichever spec signed up first on this network.
  const auth = { email: "qa-admin@example.com", password: "correct horse battery" };
  const r = await context.request.post(`${API}/v1/auth/register`, { data: { ...auth, name: "QA Admin" } });
  if (r.status() !== 201) expect((await context.request.post(`${API}/v1/auth/login`, { data: auth })).status()).toBe(200);
  const created = await context.request.post(`${API}/v1/sessions`, {
    data: { title: "Video interview: SQL", type: "mock", mock: { video: true, topic: "SQL and databases", duration_minutes: 10 } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/live/${id}`);
  await expect(page.getByRole("button", { name: "End interview" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Camera coach/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Repeat the question|Skip)$/ })).toBeVisible({ timeout: 30_000 });
  const controls = page.locator("footer button[aria-label]");
  expect(await controls.count()).toBe(7);
  for (const control of await controls.all()) {
    const box = (await control.boundingBox())!;
    const name = await control.getAttribute("aria-label");
    expect(box.x, `${name} starts off screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} ends off screen`).toBeLessThanOrEqual(360);
  }
  await context.request.post(`${API}/v1/sessions/${id}/end`);
});
