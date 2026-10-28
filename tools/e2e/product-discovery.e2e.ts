import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Public tool discovery, filters and mode switch (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    if (viewport.name === "mobile") await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/tools");
    await expect(page.getByRole("heading", { name: "Find your next move.", exact: true })).toBeVisible();
    await page.getByLabel("Search tools", { exact: true }).fill("Workday");
    await expect(page.getByRole("heading", { name: "Auto Apply", exact: true })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel("Search tools", { exact: true })).toHaveValue("Workday");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("button", { name: "Orbit for Business", exact: true }).click();
    await page.getByLabel("Show", { exact: true }).selectOption("automation");
    await expect(page.getByRole("heading", { name: "Hiring automations", exact: true })).toBeVisible();
    await page.getByLabel("Search tools", { exact: true }).fill("not-a-tool");
    await expect(page.getByRole("heading", { name: "No tools match these filters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator("svg circle.motion-safe\\:animate-pulse").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`tool-explorer-${viewport.name}.png`), fullPage: true });
    await page.getByRole("link", { name: "Switch to Business Orbit", exact: true }).click();
    await expect(page).toHaveURL(/\/business$/);
    await page.getByRole("link", { name: "Switch to Personal Orbit", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    if (viewport.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test(`Company tool routing, personal shortlist and AI second reader (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, jid } = await seed(context);
    await page.goto("/tools?audience=business");
    await page.getByRole("link", { name: "Open control room", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your companies", exact: true })).toBeVisible();
    await page.getByRole("link").filter({ hasText: "Northstar Studio" }).click();
    await expect(page).toHaveURL(new RegExp(`/business/app/${cid}/control-room$`));
    await page.getByRole("link", { name: "Switch to Personal Orbit", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Switch to Business Orbit", exact: true })).toBeVisible();
    const me = await (await context.request.get(`${API}/v1/auth/me`)).json();
    const resume = await context.request.post(`${API}/v1/resumes`, { data: { title: "Hiring workflow fixture",
      data: { basics: { name: "Morgan Recruiter", email: me.email, headline: "Backend Engineer", location: "Bengaluru, India", summary: "Build Python APIs with PostgreSQL." }, skills: [{ name: "Skills", items: ["Python", "Postgres", "PostgreSQL"] }] } } });
    expect(resume.status(), await resume.text()).toBe(201);
    const rid = (await resume.json()).id;
    expect((await context.request.put(`${API}/v1/jobs/profile`, { data: { resume_id: rid, prefs: { titles: ["Backend Engineer"], skills: ["Python", "Postgres"], locations: ["Bengaluru"], workplace: ["remote", "hybrid", "onsite"], posted_within: 30 } } })).ok()).toBe(true);
    const setup = await context.request.put(`${API}/v1/apply/setup`, { data: { resume_id: rid, approve_resume: true,
      facts: { first_name: "Morgan", last_name: "Recruiter", email: me.email, city: "Bengaluru", country: "IN" },
      filters: { titles: ["Backend Engineer"], countries: ["IN"], days: 30 }, threshold: 45, mode: "review", daily_limit: 5, consent: true } });
    expect(setup.ok(), await setup.text()).toBe(true);
    const lid = `biz:${jid.replaceAll("-", "")}`;
    const saved = await context.request.post(`${API}/v1/jobs/tracker`, { data: { listing_id: lid } });
    expect(saved.status(), await saved.text()).toBe(201);
    await page.goto("/jobs/journey");
    await expect(page.getByRole("heading", { name: "Auto Apply", exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Backend engineer Northstar Studio", exact: true }).check();
    await page.getByRole("button", { name: "Prepare selected (1/20)", exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`${API}/v1/apply/packets`)).json()).length).toBe(1);
    const packet = (await (await context.request.get(`${API}/v1/apply/packets`)).json())[0];
    expect(packet.status).toBe("review");
    await a11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`application-agent-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "Pause agent", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume agent", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume agent", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause agent", exact: true })).toBeVisible();
    await page.goto(`/jobs/applications?packet=${packet.id}`);
    await page.getByText("Job posting captured with this application", { exact: true }).click();
    await expect(page.getByText("Build reliable APIs and explain engineering trade-offs for a small product team.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open AI second reader", exact: true }).click();
    await page.getByRole("button", { name: "Review with AI", exact: true }).click();
    await expect(page.getByText("AI suggestions · check against your records", { exact: true })).toBeVisible();
    expect((await (await context.request.get(`${API}/v1/apply/packets/${packet.id}`)).json()).status).toBe("review");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`application-review-${viewport.name}.png`), fullPage: true });
  });
}
