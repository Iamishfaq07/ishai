import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Career launchpad: resume evidence to reviewed search (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "College projects", data: {
      skills: [{ items: ["Python", "SQL"] }], education: [{ degree: "BSc", field: "Computer science" }],
      projects: [{ name: "Library search", description: "Built a search tool for college books" }],
    } } });
    expect(created.status(), await created.text()).toBe(201);
    const resume = await created.json();
    await page.goto("/jobs?start=1");
    const launchpad = page.getByRole("region", { name: "A clear start. A next step you can take.", exact: true });
    await expect(launchpad.getByLabel("Resume to explore")).toHaveValue(resume.id);
    expect((await (await context.request.get(`${API}/v1/jobs/profile`)).json()).saved).toBe(false);
    await launchpad.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
    await launchpad.getByLabel("Job title to explore").fill("Graduate developer");
    await launchpad.getByRole("button", { name: "Suggest roles from my resume", exact: true }).click();
    await expect(launchpad.getByRole("heading", { name: "Graduate developer", exact: true })).toBeVisible();
    await expect(launchpad.locator("blockquote")).toContainText("“Python”");
    await launchpad.getByLabel("Preferred city (optional)").fill("Bengaluru");
    await launchpad.getByRole("button", { name: "Use Graduate developer", exact: true }).click();
    await launchpad.getByRole("button", { name: "Save this search", exact: true }).click();
    await expect(launchpad.getByRole("link", { name: "Find matching jobs", exact: true })).toBeVisible();
    const prefs = (await (await context.request.get(`${API}/v1/jobs/profile`)).json()).prefs;
    expect(prefs.titles).toEqual(["Graduate developer"]);
    expect(prefs.level).toBe("fresher"); expect(prefs.years).toBe(0);
    expect(prefs.job_types).toEqual(["full_time", "internship"]);
    await expect(launchpad.getByRole("link", { name: "Practice with Saba", exact: true })).toHaveAttribute("href", "/mock?role=Graduate+developer");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`career-launchpad-${viewport.name}.png`), fullPage: true });
    await launchpad.getByRole("button", { name: "Back to role", exact: true }).click();
    await launchpad.getByLabel("Job title to explore").fill("Junior analyst");
    await launchpad.getByRole("button", { name: "Review my search", exact: true }).click();
    await launchpad.getByRole("button", { name: "Save this search", exact: true }).click();
    await expect(launchpad.getByRole("button", { name: "Search settings saved", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "← Back to all career steps", exact: true }).click();
    await expect(launchpad).not.toBeVisible();
    await page.goBack();
    await launchpad.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
    await expect(launchpad.getByLabel("Job title to explore")).toHaveValue("Junior analyst");
  });
}

test("No resume: manual search, resume starter and stale settings recovery", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context);
  await page.goto("/jobs?start=1");
  await page.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
  await expect(page.getByRole("button", { name: "Suggest roles from my resume", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to resume", exact: true }).click();
  await page.getByRole("link", { name: "Build a resume", exact: true }).click();
  await expect(page.getByRole("button", { name: /Student|Campus|Fresher/i }).first()).toBeVisible();
  expect((await (await context.request.get(`${API}/v1/resumes`)).json()).length).toBe(0);
  await page.goBack();
  await page.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
  await page.getByLabel("Job title to explore").fill("Customer support trainee");
  await page.getByRole("button", { name: "Review my search", exact: true }).click();
  const old = await (await context.request.get(`${API}/v1/jobs/profile`)).json();
  await context.request.put(`${API}/v1/jobs/profile`, { data: { prefs: { ...old.prefs, exclude: ["night shift"] } } });
  await page.getByRole("button", { name: "Save this search", exact: true }).click();
  await expect(page.getByText(/Your resume or search settings changed/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh launchpad", exact: true }).click();
  await page.getByRole("button", { name: "Back to role", exact: true }).click();
  await expect(page.getByLabel("Job title to explore")).toHaveValue("Customer support trainee");
  await page.getByRole("button", { name: "Review my search", exact: true }).click();
  await page.getByLabel("Include internships").uncheck();
  await page.getByRole("button", { name: "Save this search", exact: true }).click();
  await expect(page.getByRole("link", { name: "Find matching jobs", exact: true })).toBeVisible();
  const prefs = (await (await context.request.get(`${API}/v1/jobs/profile`)).json()).prefs;
  expect(prefs.exclude).toEqual(["night shift"]); expect(prefs.job_types).toEqual(["full_time"]);
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Launchpad home and step navigation scroll correctly (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Career launchpad", exact: true })).toBeVisible();
    const steps = page.getByRole("navigation", { name: "Your career steps", exact: true });
    await expect(steps.getByRole("listitem")).toHaveCount(5);
    await steps.getByText("Tools for this step", { exact: true }).nth(2).click();
    await expect(steps.getByRole("link", { name: "Auto-apply agent", exact: true })).toBeVisible();
    await expect(steps.getByRole("link", { name: "Contacts & outreach", exact: true })).toBeVisible();
    await a11y(page);
    await page.screenshot({ path: info.outputPath(`career-hub-${viewport.name}.png`), fullPage: true });
    // Open a query-only page transition from a real, scrolled position.
    await page.getByRole("link", { name: "Start guided setup", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("link", { name: "Start guided setup", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue to role ideas", exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
    const heading = page.getByRole("heading", { name: "2. Choose a direction", exact: true });
    await expect(heading).toBeFocused();
    const bounds = await heading.boundingBox();
    const headerBottom = await page.locator('header.sticky').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bounds!.y).toBeGreaterThanOrEqual(headerBottom);
    expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height - 80);
    await page.getByLabel("Job title to explore").fill("Graduate analyst");
    await page.getByRole("button", { name: "Review my search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "3. Review your search", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Back to role", exact: true }).click();
    await expect(page.getByLabel("Job title to explore")).toHaveValue("Graduate analyst");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a11y(page);
  });
}
