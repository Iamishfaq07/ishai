import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

const API = "http://127.0.0.1:8000";

// The signed-in app's main screens, each checked against WCAG 2.0/2.1/2.2 A and AA in both themes. A new violation
// fails the build, so contrast, names and roles can't drift back while the design changes.
const SCREENS = ["/", "/mock", "/resume-ai", "/jobs", "/jobs/tracker", "/sessions", "/offers", "/billing", "/settings"];

async function signup(context: BrowserContext) {
  const r = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `a11y-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Robin Park", country: "US" },
  });
  expect(r.status(), await r.text()).toBe(201);
}

for (const scheme of ["light", "dark"] as const) {
  test(`the app's main screens have no WCAG A/AA violations (${scheme})`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await signup(context);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const found: string[] = [];
    for (const path of SCREENS) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      for (const v of violations) found.push(`${path}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    }
    expect(found, found.join("\n")).toEqual([]);
  });
}

// The public pages anyone (or any crawler) lands on, signed out: the question bank's lists and guides, and the
// warm-up, opened on a guide's questions too.
const PUBLIC = ["/companies", "/companies/amazon", "/companies/tcs", "/roles", "/roles/data-analyst", "/warmup", "/warmup?track=company%3Aamazon"];

for (const scheme of ["light", "dark"] as const) {
  test(`the public guide pages have no WCAG A/AA violations (${scheme})`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const found: string[] = [];
    for (const path of PUBLIC) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      for (const v of violations) found.push(`${path}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    }
    expect(found, found.join("\n")).toEqual([]);
  });
}
