import { expect, test, type Page } from "@playwright/test";

// The product pages built with the section kit (DECISIONS D79): every section there, nothing scrolling sideways on a
// phone, and the renders' motion levels: Full plays once and rests on the final frame, Gentle and Off show the final
// frame at once. Axe for these pages is public-pages.spec.ts.
const PAGES = ["/resume-ai", "/jobs", "/linkedin-ai", "/interview-copilot", "/mock-interview"];

async function setMotion(page: Page, motion: "full" | "reduced" | "off") {
  await page.addInitScript((m) => {
    localStorage.setItem("orbit.cookies.v1", "1");
    localStorage.setItem("orbit.site.cta.v1", "1");
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: m }));
  }, motion);
}

test("every product page has its sections, one h1, breadcrumbs, and no sideways scroll at 360 and 390", async ({ page }) => {
  test.setTimeout(120_000);
  await setMotion(page, "off");
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
      for (const s of ["Step 1", "Step 2", "Step 3", "Questions people ask first."]) await expect(page.getByText(s, { exact: false }).first()).toBeAttached();
      await expect(page.locator("#toolkit")).toBeAttached();
      await expect(page.locator("dl").first()).toBeVisible(); // the facts band
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} @${width}`).toBe(0);
    }
  }
});

test("the Resume hero plays its fixes once at Full motion, then offers Play again", async ({ page }) => {
  await setMotion(page, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/resume-ai");
  const hero = page.getByRole("img", { name: /A sample resume in Resume/ });
  await expect(hero).toBeVisible();
  // While the four fixes are made one after another (about four seconds), there is nothing to replay yet.
  await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
  await expect(hero).toContainText("98", { timeout: 8000 });
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByRole("button", { name: "Play again" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible({ timeout: 8000 });
});

for (const motion of ["reduced", "off"] as const) {
  test(`at ${motion === "reduced" ? "Gentle" : "Off"}, the renders show their final frame at once and nothing replays`, async ({ page }) => {
    await setMotion(page, motion);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/resume-ai");
    const hero = page.getByRole("img", { name: /A sample resume in Resume/ });
    await expect(hero).toContainText("98", { timeout: 1500 });
    // The last part of the sequence (the +16 beside the score) is in place, not waiting its turn.
    await expect.poll(() => hero.getByText("+16").evaluate((el) => getComputedStyle(el).opacity), { timeout: 2000 }).toBe("1");
    await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
    // A typed render below the fold is finished as soon as it's on screen.
    const fix = page.getByRole("img", { name: /Fix with AI on a bullet/ });
    await fix.scrollIntoViewIfNeeded();
    await expect(fix).toContainText("Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.", { timeout: 1500 });
  });
}

test("the templates carousel moves a card at a time and says where it is", async ({ page }) => {
  await setMotion(page, "off");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/resume-ai#templates");
  const carousel = page.getByRole("region", { name: "Resume's templates" });
  const previous = carousel.getByRole("button", { name: "Previous" });
  const next = carousel.getByRole("button", { name: "Next" });
  await carousel.scrollIntoViewIfNeeded();
  await expect(previous).toBeDisabled();
  await next.click();
  const track = carousel.getByRole("list");
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  await expect(previous).toBeEnabled();
  await expect(carousel.getByRole("listitem")).toHaveCount(10);
  await expect(carousel.getByRole("listitem").first()).toHaveAttribute("aria-label", "1 of 10");
});

test("a product page's questions open and close", async ({ page }) => {
  await setMotion(page, "off");
  await page.goto("/jobs");
  const q = page.getByText("Where do the jobs come from?");
  await q.scrollIntoViewIfNeeded();
  await q.click();
  await expect(page.getByText(/Greenhouse, Lever, Ashby and SmartRecruiters job boards\) and remote job boards/).first()).toBeVisible();
});

test("LinkedIn's page is in the Products menu, and its search preview switches between before and after", async ({ page }) => {
  await setMotion(page, "off");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Products" }).click();
  await page.getByRole("link", { name: /^LinkedIn/ }).first().click();
  await expect(page).toHaveURL(/\/linkedin-ai$/);
  await expect(page.locator("h1")).toContainText("See your profile");
  const preview = page.getByRole("figure", { name: "A preview of your profile in a search result" });
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toContainText("Dashboards used by");
  await page.getByRole("radio", { name: "As on LinkedIn" }).check({ force: true });
  await expect(preview).toContainText("Data Analyst at Dhan Retail");
});
