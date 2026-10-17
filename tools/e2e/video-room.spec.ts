import { expect, test, type BrowserContext } from "@playwright/test";

const API = "http://127.0.0.1:8000";

// Saba's device voice goes through the OS speech engine, which plays past the browser's mute: keep the tests silent
// with a stand-in that only says it started and finished.
async function quietVoice(context: BrowserContext) {
  await context.addInitScript(() => {
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices: () => [],
      speak: (u: SpeechSynthesisUtterance) => {
        setTimeout(() => u.onstart?.(new Event("start") as SpeechSynthesisEvent), 30);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 600);
      },
      cancel() {},
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
  });
}

async function videoSession(context: BrowserContext): Promise<string> {
  // The admin (ORBIT_ADMIN_EMAIL) has interview minutes whichever spec signed up first on this network.
  const auth = { email: "qa-admin@example.com", password: "correct horse battery" };
  const r = await context.request.post(`${API}/v1/auth/register`, { data: { ...auth, name: "QA Admin" } });
  if (r.status() !== 201) expect((await context.request.post(`${API}/v1/auth/login`, { data: auth })).status()).toBe(200);
  const created = await context.request.post(`${API}/v1/sessions`, {
    data: { title: "Video interview: SQL", type: "mock", mock: { video: true, topic: "SQL and databases", duration_minutes: 10 } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

// The AI video interview on a 360 px phone, with the camera coach's button too (ORBIT_VIDEO_MOCK is on for this API):
// every round control stays on screen, End most of all. Seven 48 px buttons used to push Mute mic and End off the edges.
test("the video interview's controls all fit a 360 px phone", async ({ page, context }) => {
  await quietVoice(context);
  const id = await videoSession(context);
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
  // The transcript is a drawer above the controls on a phone: opened, it never covers them.
  await page.getByRole("button", { name: /^Transcript/ }).click();
  const transcript = page.getByRole("region", { name: "Interview transcript" });
  await expect(transcript.getByRole("log")).toContainText("Saba", { timeout: 15_000 });
  const drawer = (await transcript.boundingBox())!;
  const dock = (await page.locator("footer").boundingBox())!;
  expect(drawer.y + drawer.height, "the transcript covers the controls").toBeLessThanOrEqual(dock.y + 1);
  await context.request.post(`${API}/v1/sessions/${id}/end`);
});

// Saba is a voice on the call: a canvas visualizer with her state in words beside it, and her tile says it to screen
// readers; muting the mic changes both.
test("Saba's voice visualizer shows her state, in words too", async ({ page, context }) => {
  await quietVoice(context);
  const id = await videoSession(context);
  await page.goto(`/live/${id}`);
  await expect(page.locator("canvas[data-voice-visualizer]")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-mood-label]")).toContainText(/Saba · (speaking|listening)/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Mute mic" }).click();
  await expect(page.locator("canvas[data-voice-visualizer]")).toHaveAttribute("data-mood", "paused");
  await expect(page.locator("[data-mood-label]")).toContainText("your mic is paused");
  await expect(page.getByRole("status").filter({ hasText: "Your mic is paused" })).toBeAttached();
  await context.request.post(`${API}/v1/sessions/${id}/end`);
});
