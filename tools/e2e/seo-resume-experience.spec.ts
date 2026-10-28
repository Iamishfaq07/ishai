import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";

const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
async function signup(context: BrowserContext) {
  const result = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `experience-${crypto.randomUUID()}@example.com`, password: "correct horse battery", country: "IN",
  } });
  expect(result.status(), await result.text()).toBe(201);
}

test("client navigation updates canonical and schema, then clears public metadata at sign-in", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", "https://orbitanswer.com/tools");
  await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Pricing", exact: true }).click();
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", "https://orbitanswer.com/pricing");
  await expect(page).toHaveTitle("Orbit pricing: plans and credits in ₹ and US dollars");
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute("content", "https://orbitanswer.com/pricing");
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goBack();
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", "https://orbitanswer.com/pricing");
});

test("mobile tools keep a search across reload and offer a clear reset", async ({ page, context }) => {
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/toolkit?q=github");
  await expect(page.getByRole("searchbox", { name: "Search tools" })).toHaveValue("github");
  await expect(page.getByRole("status").filter({ hasText: "matching" })).toContainText("github");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search tools" })).toHaveValue("github");
  await page.getByRole("button", { name: "Clear tool search" }).click();
  await expect(page).toHaveURL(/\/toolkit$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("older AI fixes cannot replace edits made while the request was running", async ({ page, context }, info) => {
  await signup(context);
  const created = await context.request.post(`${API}/v1/resumes`, { data: { title: "Protected resume" } });
  expect(created.status()).toBe(201);
  const resume = await created.json();
  let release: (() => void) | undefined;
  let requested = false;
  await page.route("**/v1/resumes/fix", async (route) => {
    requested = true;
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: {
      suggestions: [], review: [], questions: [], design: { accent: "#ff0000" }, order: null,
      score_before: 10, score_after: 80, remaining: [], upgrade_required: false, ai_error: null, followup: null,
    } });
  });
  await page.goto(`/resume-ai/${resume.id}`);
  await expect(page.getByRole("region", { name: "Resume editor", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /ATS score|Score/, exact: true }).click();
  await page.getByRole("button", { name: "Fix everything with AI", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("tab", { name: "Content", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Candidate's newer edit");
  release?.();
  await page.getByRole("tab", { name: /ATS score|Score/, exact: true }).click();
  await expect(page.getByText("Your resume changed while AI was working.", { exact: false })).toBeVisible();
  await expect.poll(async () => {
    const current = await context.request.get(`${API}/v1/resumes/${resume.id}`);
    const saved = await current.json();
    return { name: saved.data.basics.name, accent: saved.design.accent };
  }).toEqual({ name: "Candidate's newer edit", accent: resume.design.accent });
  await page.getByText("More formats", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download as plain text", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.txt$/);
  const stream = await file.createReadStream();
  expect(stream).not.toBeNull();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain("Candidate's newer edit");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("More formats", { exact: true }).click();
  const plainText = page.getByRole("button", { name: "Download as plain text", exact: true });
  const bounds = await plainText.boundingBox();
  expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390).toBeTruthy();
  await plainText.focus();
  await page.keyboard.press("Escape");
  await expect(plainText).not.toBeVisible();
  await page.screenshot({ path: info.outputPath("resume-mobile.png") });
});

test("personal page inventory remains readable on a phone", async ({ page, context }, info) => {
  test.setTimeout(180000);
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  const paths = ["/", "/career", "/prepare", "/toolkit", "/sessions", "/documents", "/documents/stories",
    "/documents/answers", "/resume-ai", "/jobs", "/jobs/tracker", "/jobs/profile", "/jobs/auto-apply",
    "/jobs/journey", "/jobs/actions", "/jobs/weekly", "/jobs/priority", "/billing", "/settings",
    "/linkedin", "/learn", "/code", "/offers", "/aptitude", "/star-check", "/bullet-builder",
    "/career-gap", "/group-discussion", "/readiness", "/campus", "/github-projects"];
  const pages: Array<{ path: string; final: string; title: string; headings: number; overflow: number }> = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(page.locator("main h1").first(), `Loaded page heading for ${path}`).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10000 });
    pages.push({ path, final: new URL(page.url()).pathname, ...await page.evaluate(() => ({
      title: document.title, headings: document.querySelectorAll("main h1").length,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    })) });
  }
  const report = info.outputPath("personal-page-audit.json");
  await writeFile(report, JSON.stringify(pages, null, 2));
  await info.attach("personal-page-audit.json", { path: report, contentType: "application/json" });
  expect(pages.filter((p) => p.overflow > 1)).toEqual([]);
  expect(pages.filter((p) => p.headings !== 1)).toEqual([]);
});
