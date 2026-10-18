import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The front door: every signed-out page, checked against WCAG 2.0/2.1/2.2 A and AA in both themes, at desktop width
// and on a 390 px phone (where nothing may scroll sideways). The workbench's screens, and more of the interview
// guides, are accessibility.spec.ts.
const PAGES = ["/", "/resume-ai", "/jobs", "/linkedin-ai", "/companies", "/companies/amazon", "/roles/data-analyst", "/login", "/register", "/forgot-password", "/contact", "/warmup", "/technical", "/pricing", "/interview-copilot", "/mock-interview", "/no-such-page"];

for (const scheme of ["light", "dark"] as const) {
  test(`the public pages have no WCAG A/AA violations (${scheme})`, async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const found: string[] = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        for (const v of violations) found.push(`${path} @${width}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
        if (width === 390) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (overflow > 0) found.push(`${path} @390: scrolls sideways by ${overflow} px`);
        }
      }
    }
    expect(found, found.join("\n")).toEqual([]);
  });
}

test("the phone menu opens as a dialog, keeps focus inside, and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss the cookie note", exact: true }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Site menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: /Resume AI/ })).toBeVisible();
  for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("the Products menu lists every tool and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Products" });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Interview copilot", "Practice", "Resume AI", "Jobs AI", "LinkedIn AI", "Code AI", "Offer AI", "Learning AI"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});
