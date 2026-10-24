import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const API = "http://127.0.0.1:8000";
for (const motion of ["off", "full"] as const) {
for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`unified identity and Today ${width} ${scheme} ${motion}`, async ({ page, context }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion === "off" ? "reduce" : "no-preference" });
      await context.addInitScript((motion) => { localStorage.setItem("orbit.cookies.v1", "1"); localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion })); }, motion);
      const registered = await context.request.post(`${API}/v1/auth/register`, { data: {
        email: `unified-${crypto.randomUUID()}@example.com`, name: "Robin Park", password: "correct horse battery", country: "US",
      } });
      expect(registered.status(), await registered.text()).toBe(201);
      const before = process.env.ORBIT_UNIFIED_BEFORE === "1";
      const dir = resolve("docs/implementation/screenshots/unified"); await mkdir(dir, { recursive: true });
      for (const path of ["/", "/career"]) {
        await page.goto(path); await page.waitForLoadState("networkidle");
        // Today opens with a greeting ("Good evening, Ana"); My Career keeps its name.
        await expect(path === "/" ? page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ }) : page.getByRole("heading", { name: "My Career", exact: true })).toBeVisible();
        if (!before) {
          const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          expect(audit.violations).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${dir}/${before ? "before" : "after"}-${path === "/" ? "today" : "career"}-${scheme}-${width}${motion === "full" ? "-full" : ""}.png`, fullPage: true });
      }
    });
  }
}
}

test("reviewed identity flows into Discover and independent opportunity rooms", async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.addInitScript(() => { localStorage.setItem("orbit.cookies.v1", "1"); });
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `journey-${crypto.randomUUID()}@example.com`, name: "Robin Park", password: "correct horse battery", country: "US",
  } });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto("/career");
  await page.getByRole("link", { name: "Import my resume", exact: true }).click();
  // A real portable resume import: no paid inference, invented history, or repeated upload.
  await page.getByLabel("Choose your resume file").setInputFiles({ name: "robin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    basics: { name: "Robin Park", email: "robin@example.com", label: "Graduate developer" },
    education: [{ institution: "Example College", area: "Computer science", studyType: "BSc" }],
    projects: [{ name: "Library project", description: "Built my own college book catalogue" }],
    skills: [{ name: "Languages", keywords: ["Python"] }],
  })) });
  await expect(page.getByRole("region", { name: "Guided resume editor" })).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Robin Park");
  await page.goto("/career");
  const saved = await (await context.request.get(`${API}/v1/resumes`)).json();
  expect(saved).toHaveLength(1);
  const master = saved[0];
  await page.getByRole("combobox", { name: "Saved resume for master" }).selectOption(master.id);
  await page.getByRole("button", { name: "Use as my master", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed this version/ }).check();
  await page.getByRole("button", { name: "Confirm this version", exact: true }).click();
  await expect(page.getByText(/You reviewed this version/)).toBeVisible();
  const identity = await (await context.request.get(`${API}/v1/jobs/launchpad/identity`)).json();
  expect(identity.review).toBe("reviewed"); expect(identity.master.id).toBe(master.id);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("career-reviewed-320.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("link", { name: "Return to Today", exact: true }).click();
  await expect(page.getByRole("region", { name: "Suggested next action" })).toContainText("Choose your search direction");
  await page.getByRole("region", { name: "Suggested next action" }).getByRole("link", { name: "Open next step" }).click();
  const profile = await (await context.request.get(`${API}/v1/jobs/profile`)).json();
  expect(profile.resume.id).toBe(master.id);
  const jobs = [];
  for (const company of ["Northstar Studio", "Second Studio"]) {
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { company, title: "Graduate developer" } });
    expect(created.status()).toBe(201); jobs.push(await created.json());
  }
  await page.goto(`/jobs/mission/${jobs[0].id}?guide=0&tab=resume`);
  await expect(page.getByRole("navigation", { name: "Opportunity room", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow guided steps" })).toHaveCount(0);
  await page.getByLabel("Link a resume", { exact: true }).selectOption(master.id);
  await expect(page.getByLabel("Change linked resume", { exact: true })).toBeVisible();
  const missionA = await (await context.request.get(`${API}/v1/jobs/tracker/${jobs[0].id}/mission`)).json();
  expect(missionA.resume.id).not.toBe(master.id);
  await page.getByRole("navigation", { name: "Opportunity room", exact: true }).getByRole("button", { name: "Prepare with Saba" }).click();
  await expect(page.getByRole("heading", { name: "Practice with Saba", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start practice with Saba", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Practice format" })).toHaveValue("audio");
  expect((await (await context.request.get(`${API}/v1/jobs/tracker/${jobs[1].id}/mission`)).json()).resume).toBeNull();
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("opportunity-saba-390.png"), fullPage: true });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`mission/${jobs[0].id}.*tab=resume`));
  expect((await (await context.request.get(`${API}/v1/jobs/launchpad/identity`)).json()).master.id).toBe(master.id);
  await page.goto(`/resume-ai/${master.id}?guide=1&job=${jobs[0].id}`);
  await expect(page.getByRole("heading", { name: "Review this job’s resume first", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Guided resume editor" })).toHaveCount(0);
  await page.getByRole("link", { name: "Review opportunity materials", exact: true }).click();
  await page.getByRole("link", { name: missionA.resume.title, exact: true }).click();
  await expect(page.getByRole("region", { name: "Guided resume editor" })).toBeVisible();
});

test("Saba creates a job-bound mock and its report returns to that job", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.addInitScript(() => {
    localStorage.setItem("orbit.cookies.v1", "1");
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      speaking: false, pending: false, paused: false, getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
    } });
  });
  const credentials = { email: "qa-admin@example.com", password: "correct horse battery" };
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: { ...credentials, name: "QA Admin" } });
  if (registered.status() !== 201) expect((await context.request.post(`${API}/v1/auth/login`, { data: credentials })).status()).toBe(200);
  const resume = await context.request.post(`${API}/v1/resumes`, { data: { title: "Reviewed practice fixture", data: {
    basics: { name: "Robin Park", email: "robin@example.com", summary: "I built a college library project in Python." },
  } } });
  expect(resume.status()).toBe(201); const rid = (await resume.json()).id;
  const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { company: "Practice Studio", title: "Graduate developer" } });
  expect(created.status()).toBe(201); const job = (await created.json()).id;
  expect((await context.request.put(`${API}/v1/jobs/tracker/${job}/interview`, { data: { resume_id: rid,
    job_text: "Graduate developer role. Build small Python services and discuss your real projects and education.", round_type: "technical" } })).status()).toBe(200);
  await page.goto("/prepare");
  await page.getByRole("combobox", { name: "What are you preparing for?" }).selectOption(job);
  await page.getByRole("link", { name: "Prepare my Saba session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice with Saba", exact: true })).toBeVisible();
  // Exercise the current video engine with no camera permission. Real speech/provider quality is a separate gate.
  await page.getByRole("combobox", { name: "Practice format" }).selectOption("video");
  const started = page.waitForResponse((response) => response.url().endsWith("/v1/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start practice with Saba", exact: true }).click();
  const response = await started; expect(response.status(), await response.text()).toBe(201);
  const session = await response.json();
  expect(session.type).toBe("mock"); expect(session.application_id).toBe(job);
  await expect(page).toHaveURL(new RegExp(`/live/${session.id}`));
  expect((await context.request.post(`${API}/v1/sessions/${session.id}/end`)).status()).toBe(200);
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("link", { name: "Back to this opportunity", exact: true })).toHaveAttribute("href", `/jobs/mission/${job}?tab=practice`);
  await page.getByRole("link", { name: "Back to this opportunity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice for Practice Studio", exact: true })).toBeVisible();
});

test("reply drafts survive room and route changes without restoring approval", async ({ page, context }) => {
  const registered = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `draft-${crypto.randomUUID()}@example.com`, name: "Robin Park", password: "correct horse battery", country: "US",
  } });
  expect(registered.status()).toBe(201);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const response = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { company: "Draft Studio", title: "Developer" } });
  const job = (await response.json()).id;
  await page.goto(`/jobs/mission/${job}?tab=timeline`);
  const support = page.locator("summary").filter({ hasText: "Help and updates for this job" });
  await support.click();
  await page.getByRole("button", { name: "Employer reply", exact: true }).click();
  const message = page.getByRole("textbox", { name: /Paste/ });
  await message.fill("Private draft: thank you for the invitation. Please confirm the next round.");
  await page.getByRole("navigation", { name: "Opportunity room", exact: true }).getByRole("button", { name: "Overview", exact: true }).click();
  await expect(message).toHaveValue(/Private draft/);
  await page.getByRole("link", { name: "Applications", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Your applications", exact: true })).toBeVisible();
  await page.goBack();
  await support.click();
  await page.getByRole("button", { name: "Employer reply", exact: true }).click();
  await expect(message).toHaveValue(/Private draft/);
  await expect(page.getByRole("checkbox", { name: /confirm/i })).toHaveCount(0);
});

test("a delayed identity response cannot cross a real sign-out and sign-in", async ({ page, context }) => {
  const password = "correct horse battery";
  const secondEmail = `second-${crypto.randomUUID()}@example.com`;
  for (const email of [secondEmail, `first-${crypto.randomUUID()}@example.com`]) {
    expect((await context.request.post(`${API}/v1/auth/register`, { data: { email, password, name: "Robin Park", country: "US" } })).status()).toBe(201);
  }
  const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "Private source A", data: { basics: { name: "Alice Private", email: "alice@example.com" } } } });
  const resume = await created.json();
  const initial = await (await context.request.get(`${API}/v1/jobs/launchpad/identity`)).json();
  expect((await context.request.put(`${API}/v1/jobs/launchpad/identity`, { data: { version: initial.version, resume_id: resume.id, resume_revision: resume.revision, action: "select" } })).status()).toBe(200);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>((resolve) => { started = resolve; });
  let first = true;
  await page.route("**/v1/jobs/launchpad/identity", async (route) => {
    if (!first) return route.continue();
    first = false; const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  try {
    await page.goto("/career"); await requested;
    await page.getByRole("button", { name: /account menu$/ }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(secondEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "My Career", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Start with your story.", exact: true })).toBeVisible();
    release();
    await expect(page.getByText("Private source A", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Alice Private", { exact: true })).toHaveCount(0);
    expect((await (await context.request.get(`${API}/v1/jobs/launchpad/identity`)).json()).master).toBeNull();
  } finally { release(); }
});

test("twenty opportunities remain navigable at 320px and CSS 200 percent zoom", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  expect((await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `many-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Robin Park", country: "US",
  } })).status()).toBe(201);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  for (let n = 0; n < 20; n++) {
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { title: `Opportunity ${n}`, company: `Studio ${n}`, status: n % 3 === 0 ? "interviewing" : "saved" } });
    expect(created.status()).toBe(201);
  }
  await page.setViewportSize({ width: 320, height: 900 }); await page.goto("/");
  const focus = page.getByRole("combobox", { name: "Focus an opportunity" });
  await expect(focus.locator("option")).toHaveCount(21);
  await expect(page.getByRole("link", { name: "Open opportunity", exact: true })).toHaveCount(5);
  const options = await focus.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  await focus.selectOption(options[1]!);
  await expect(page.getByRole("link", { name: "Open opportunity", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("today-20-opportunities-320.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await page.screenshot({ path: info.outputPath("today-css-200-percent.png"), fullPage: true });
});

for (const blockedStorage of [false, true]) {
test(`switching accounts in another tab clears private identity (${blockedStorage ? "blocked storage" : "standard"})`, async ({ page, context }) => {
  test.setTimeout(45_000);
  const password = "correct horse battery";
  const secondEmail = `tabs-second-${crypto.randomUUID()}@example.com`;
  for (const email of [secondEmail, `tabs-first-${crypto.randomUUID()}@example.com`]) {
    expect((await context.request.post(`${API}/v1/auth/register`, { data: { email, password, name: "Robin Park", country: "US" } })).status()).toBe(201);
  }
  const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "First tab private CV", data: { basics: { name: "Alice Tab Private", email: "alice@example.com" } } } });
  const resume = await created.json();
  const initial = await (await context.request.get(`${API}/v1/jobs/launchpad/identity`)).json();
  expect((await context.request.put(`${API}/v1/jobs/launchpad/identity`, { data: { version: initial.version, resume_id: resume.id, resume_revision: resume.revision, action: "select" } })).status()).toBe(200);
  await context.addInitScript((blocked) => {
    localStorage.setItem("orbit.cookies.v1", "1");
    if (blocked) Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  }, blockedStorage);
  await page.goto("/career");
  await expect(page.getByRole("heading", { name: "Alice Tab Private", exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/career");
  await other.getByRole("button", { name: /account menu$/ }).click();
  await other.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await other.getByLabel("Email", { exact: true }).fill(secondEmail);
  await other.getByLabel("Password", { exact: true }).fill(password);
  await other.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(other.getByRole("heading", { name: "Start with your story.", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alice Tab Private", exact: true })).toHaveCount(0);
  await other.close();
});

}
