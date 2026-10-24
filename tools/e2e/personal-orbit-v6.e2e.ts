import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { API, a11y, seed } from "./business-fixtures";
import { prepareReview } from "./personal-apply-fixtures";

for (const width of [320, 1440]) {
  test(`V6 Today to reviewed application (${width})`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => { localStorage.setItem("orbit.cookies.v1", "1"); localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" })); });
    const { jid } = await seed(context);
    const { packet, tracker } = await prepareReview(context, jid);
    let ai = 0;
    page.on("request", (req) => { if (req.method() === "POST" && /\/(plan|brief|profile\/suggest)$/.test(req.url())) ai++; });
    await page.goto("/");
    const before = process.env.ORBIT_V6_BEFORE === "1";
    if (before) {
      await expect(page.getByRole("heading", { name: /Good / })).toBeVisible();
      const dir = resolve("docs/implementation/screenshots"); await mkdir(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/before-today-${width}.png`, fullPage: true }); return;
    }
    await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    const next = page.getByRole("region", { name: "Suggested next action", exact: true });
    await expect(next.getByRole("link", { name: "Open next step", exact: true })).toHaveAttribute("href", `/jobs/applications?packet=${packet.id}`);
    expect(ai).toBe(0);
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`today-${width}.png`), fullPage: true });
    await next.getByRole("link", { name: "Open next step", exact: true }).click();
    const tools = page.getByRole("navigation", { name: "Tools for this application", exact: true });
    await tools.getByRole("link", { name: "Prepare for this role", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/mission/${tracker.id}`));
    await expect(page.getByRole("heading", { name: "Backend engineer", exact: true })).toBeVisible();
    await page.goBack(); await expect(tools).toBeVisible();
    await page.goto(`/jobs/mission/${tracker.id}?tab=timeline&guide=1`);
    const kit = page.getByRole("region", { name: "Application kit for this job", exact: true });
    await expect(kit.getByRole("heading", { name: "Review before sending", exact: true })).toBeVisible();
    await expect(kit.getByRole("link", { name: "Open this job’s application kit", exact: true })).toHaveAttribute("href", `/jobs/applications?packet=${packet.id}`);
    await kit.getByRole("link", { name: "Open this job’s application kit", exact: true }).click();
    await expect(tools).toBeVisible();
    expect((await (await context.request.get(`${API}/v1/apply/packets/${packet.id}`)).json()).status).toBe("review");
    await page.goto("/prepare");
    await expect(page.getByRole("heading", { name: "Prepare", exact: true })).toBeVisible();
    await page.getByRole("link", { name: /^Backend engineer · Northstar Studio/ }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/mission/${tracker.id}`));
    await page.goto("/career");
    await expect(page.getByRole("heading", { name: "My Career", exact: true })).toBeVisible();
    await page.getByText("Experience, documents and advanced tools", { exact: true }).click();
    await expect(page.getByRole("link", { name: /^Resume Build, import/ }).first()).toHaveAttribute("href", "/jobs?work=resume");
    await a11y(page);
    await page.screenshot({ path: info.outputPath(`career-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(ai).toBe(0);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`V6 responsive empty career and recovery (${theme})`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(() => { localStorage.setItem("orbit.cookies.v1", "1"); localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" })); });
    await seed(context);
    let calls = 0;
    page.on("request", (req) => { if (req.method() === "POST" && /\/(plan|brief|profile\/suggest)$/.test(req.url())) calls++; });
    for (const width of [320, 360, 390, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const next = page.getByRole("region", { name: "Suggested next action", exact: true });
      await expect(next.getByRole("heading", { name: "Add or import a resume", exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if ([320, 390, 1440].includes(width)) await a11y(page);
      await page.screenshot({ path: info.outputPath(`today-empty-${theme}-${width}.png`), fullPage: true });
      if (width === 320) {
        await page.getByRole("button", { name: "More tools and account", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "More tools and account", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "More tools and account", exact: true })).toBeFocused();
      }
    }
    await page.route("**/v1/jobs/launchpad/progress", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Saved career information is temporarily unavailable" }) }));
    await page.goto("/");
    await expect(page.getByText("Saved career information is temporarily unavailable", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open next step", exact: true })).toHaveCount(0);
    await page.unroute("**/v1/jobs/launchpad/progress");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open next step", exact: true })).toBeVisible();
    expect(calls).toBe(0);
  });
}
