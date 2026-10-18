import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// LinkedIn AI, like Resume AI: read a profile, fix one part with the AI (mock provider), apply it to Orbit's copy so
// the score moves, tick it done on LinkedIn, and find it all still there after a reload. Then the filled page against
// WCAG A/AA in both themes. The profile is made up.
const API = "http://127.0.0.1:8000";

const PROFILE = `Contact
meera.kulkarni@example.com
www.linkedin.com/in/meera-kulkarni-8a41b2c9 (LinkedIn)
Top Skills
SQL
Excel
Tableau
Certifications
Google Data Analytics Certificate
Meera Kulkarni
Data Analyst at BrightCart
Pune, Maharashtra, India
Summary
I am a data analyst who likes working with numbers and people. I enjoy learning new tools and solving problems for the business.
Experience
BrightCart
Data Analyst
March 2022 - Present (2 years 8 months)
Built the weekly sales dashboard in Tableau used by 40 store managers. Wrote SQL to clean order data from 3 regions and cut the monthly report from 4 days to 1 day.
Lakeview Finance
Junior Analyst
July 2020 - February 2022 (1 year 8 months)
Prepared monthly reports in Excel for the operations team.
Education
Savitribai Phule Pune University
B.Sc., Statistics`;

async function signup(context: BrowserContext) {
  const r = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `li-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Meera Kulkarni", country: "IN" },
  });
  expect(r.status(), await r.text()).toBe(201);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
}

async function score(page: Page): Promise<number> {
  const text = await page.locator(".stat-value .sr-only").first().textContent();
  return Number(text?.match(/\d+/)?.[0] ?? NaN);
}

test("LinkedIn AI: fix the headline, apply it, tick it done, and it all stays", async ({ page, context }) => {
  test.setTimeout(90_000);
  await signup(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/linkedin");
  await expect(page.getByText("See your LinkedIn the way recruiters do")).toBeVisible();

  await page.getByRole("button", { name: "Or paste the profile" }).click();
  await page.getByLabel("Your profile, copied").fill(PROFILE);
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("heading", { name: "What would raise it" })).toBeVisible();
  await expect(page.getByText("How a recruiter's search shows you")).toBeVisible();
  const before = await score(page);

  const row = page.locator("li", { hasText: "Rewrite the headline" }).first();
  await expect(page.locator("#li-ai-cost")).toContainText("AI fixes");
  await row.getByRole("button", { name: "Fix with AI" }).click();
  const card = page.locator("article", { has: page.getByRole("heading", { name: "Headline", exact: true }) });
  await expect(card.getByRole("radio")).toHaveCount(3);
  await expect(card).toContainText("/220 characters");
  await expect(card).toContainText("Where to paste it on LinkedIn");
  await card.getByRole("radio").nth(1).check();
  await card.getByRole("button", { name: "Apply to my Orbit copy" }).click();
  await expect(card.getByText("In Orbit's copy")).toBeVisible();
  await expect.poll(() => score(page)).toBeGreaterThan(before);

  const saved = page.waitForResponse((r) => r.url().includes("/v1/linkedin/suggestions/") && r.request().method() === "PATCH");
  await card.getByLabel("Done on LinkedIn").check();
  await saved;
  await page.reload();
  const again = page.locator("article", { has: page.getByRole("heading", { name: "Headline", exact: true }) });
  await expect(again.getByLabel("Done on LinkedIn")).toBeChecked();
  await expect(again.getByText("In Orbit's copy")).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuetext", "1 of 1");
});

for (const scheme of ["light", "dark"] as const) {
  test(`LinkedIn AI with a fix written has no WCAG A/AA violations (${scheme})`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await signup(context);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const read = await context.request.post(`${API}/v1/linkedin/read`, { data: { text: PROFILE } });
    expect(read.status(), await read.text()).toBe(200);
    for (const part of ["headline", "url", "open_to_work"]) {
      const r = await context.request.post(`${API}/v1/linkedin/fix`, { data: { part } });
      expect(r.status(), await r.text()).toBe(200);
    }
    await page.goto("/linkedin");
    await expect(page.getByRole("heading", { name: "Your fixes, ready to paste" })).toBeVisible();
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const found = violations.map((v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    expect(found, found.join("\n")).toEqual([]);
  });
}
