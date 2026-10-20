import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }]) {
  test(`Guided resume to reviewed search and AI plan (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "Guided fresher", data: {} } });
    expect(created.status(), await created.text()).toBe(201);
    const resume = await created.json();
    await page.goto("/jobs?work=resume");
    await expect(page.getByLabel("Resume to work on")).toHaveValue(resume.id);
    await page.getByRole("link", { name: "Edit step by step", exact: true }).click();
    const guide = page.getByRole("region", { name: "Guided resume editor", exact: true });
    await expect(guide.getByRole("heading", { name: "Your details", exact: true })).toBeVisible();
    await expect(guide.getByRole("button", { name: "Add education", exact: true })).toHaveCount(0);
    await guide.getByLabel("Full name", { exact: true }).fill("Robin Graduate");
    await guide.getByLabel("Email", { exact: true }).fill("robin@example.com");
    await guide.getByRole("button", { name: "Next: Education", exact: true }).click();
    await expect(guide.getByRole("heading", { name: "Education", exact: true }).first()).toBeFocused();
    await guide.getByRole("button", { name: "Add education", exact: true }).click();
    await guide.getByLabel("School, college or university", { exact: true }).fill("City College");
    await guide.getByLabel(/Degree/).fill("BSc Computer science");
    await guide.getByRole("button", { name: "Next: Projects", exact: true }).click();
    await guide.getByRole("button", { name: "Add project", exact: true }).click();
    await guide.getByLabel("Name", { exact: true }).fill("College library");
    await guide.getByLabel("Description", { exact: true }).fill("Built a small catalogue for college books.");
    await guide.getByRole("button", { name: "Next: Work experience", exact: true }).click();
    await expect(guide.getByText(/You can skip this if you have no work experience/)).toBeVisible();
    await guide.getByRole("button", { name: "Next: Skills", exact: true }).click();
    await guide.getByRole("button", { name: "Add group", exact: true }).click();
    await guide.getByLabel("Skills, separated by commas").fill("Python, SQL");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guide.getByRole("button", { name: "Next: Summary", exact: true }).click();
    await guide.locator("#r-summary").fill("Computer science graduate who built a college library catalogue.");
    await guide.getByRole("button", { name: "Next: Review & continue", exact: true }).click();
    await a11y(page);
    await page.screenshot({ path: info.outputPath(`guided-resume-${viewport.name}.png`), fullPage: true });
    await guide.getByRole("button", { name: "Save & continue to jobs", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs\\?start=1&resume_id=${resume.id}$`));
    await expect(page.getByLabel("Resume to explore")).toHaveValue(resume.id);
    const saved = await (await context.request.get(`${API}/v1/resumes/${resume.id}`)).json();
    expect(saved.data.basics.name).toBe("Robin Graduate");
    expect(saved.data.skills[0].items).toEqual(["Python", "SQL"]);
    expect(saved.data.experience).toEqual([]);
    await page.getByRole("button", { name: "Continue to role ideas", exact: true }).click();
    await page.getByLabel("Job title to explore").fill("Graduate analyst");
    await page.getByRole("button", { name: "Review my search", exact: true }).click();
    await page.getByRole("button", { name: "Save this search", exact: true }).click();
    await expect(page.getByRole("link", { name: "Find matching jobs", exact: true })).toBeVisible();
    const profile = await (await context.request.get(`${API}/v1/jobs/profile`)).json();
    expect(profile.resume.id).toBe(resume.id);
    await page.goto("/jobs?work=plan");
    await page.getByRole("button", { name: "Build my next-step plan", exact: true }).click();
    await expect(page.getByText("Demo AI plan", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open contact details", exact: true })).toHaveAttribute("href", `/resume-ai/${resume.id}?guide=1&section=basics`);
    await a11y(page);
  });
}

test("A failed resume save keeps edits and blocks the handoff", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context);
  const resume = await (await context.request.post(`${API}/v1/resumes`, { data: { title: "Save guard", data: {} } })).json();
  await page.goto(`/resume-ai/${resume.id}?guide=1`);
  const guide = page.getByRole("region", { name: "Guided resume editor", exact: true });
  await page.route(`**/v1/resumes/${resume.id}`, async (route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Temporary save failure" }) });
    else await route.continue();
  });
  await guide.getByLabel("Full name", { exact: true }).fill("Edits to keep");
  await guide.getByLabel("Jump to a section").selectOption("6");
  await guide.getByRole("button", { name: "Save & continue to jobs", exact: true }).click();
  await expect(guide.getByText(/Temporary save failure/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/resume-ai/${resume.id}\\?`));
  await guide.getByLabel("Jump to a section").selectOption("0");
  await expect(guide.getByLabel("Full name", { exact: true })).toHaveValue("Edits to keep");
  await page.unroute(`**/v1/resumes/${resume.id}`);
  await guide.getByLabel("Jump to a section").selectOption("6");
  await guide.getByRole("button", { name: "Save & continue to jobs", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs\\?start=1&resume_id=${resume.id}$`));
});

test("A delayed save does not pull the candidate back after navigation", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context);
  const resume = await (await context.request.post(`${API}/v1/resumes`, { data: { title: "Leave safely", data: {} } })).json();
  await page.goto(`/resume-ai/${resume.id}?guide=1&section=review`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`**/v1/resumes/${resume.id}`, async (route) => {
    if (route.request().method() === "PUT") { requested(); await gate; }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save & continue to jobs", exact: true }).click();
  await started;
  await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Discover", exact: true }).click();
  const completed = page.waitForResponse((response) => response.url().endsWith(`/v1/resumes/${resume.id}`) && response.request().method() === "PUT");
  release(); await completed;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/\/jobs\/matches$/);
});

test("Guided creation remains an explicit candidate action", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context);
  await page.goto("/jobs?work=resume");
  await page.getByRole("link", { name: "Build a resume", exact: true }).click();
  expect((await (await context.request.get(`${API}/v1/resumes`)).json()).length).toBe(0);
  await page.getByRole("button", { name: /Student|Fresher|Campus/i }).first().click();
  await expect(page.getByRole("region", { name: "Guided resume editor", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/resume-ai\/[^?]+\?guide=1$/);
  expect((await (await context.request.get(`${API}/v1/resumes`)).json()).length).toBe(1);
});
