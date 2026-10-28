import { expect, test, type BrowserContext } from "@playwright/test";
const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
async function signup(context: BrowserContext) {
  const response = await context.request.post(`${API}/v1/auth/register`, { data: { email: `tools-${crypto.randomUUID()}@example.com`, password: "correct horse battery", country: "IN" } });
  expect(response.status(), await response.text()).toBe(201);
}

test("writing drafts save, recover after reload, detect conflicts and stay private", async ({ page, context, browser }) => {
  await signup(context);
  await page.goto("/bullet-builder");
  const field = page.getByLabel("What did you do?", { exact: true });
  await expect(field).toBeEnabled();
  await field.fill("Built private cohort reports");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Account version loaded" })).toBeVisible();
  await page.reload();
  await expect(field).toHaveValue("Built private cohort reports");
  // A second tab writes a newer revision; the first must retain its unsaved work.
  const second = await context.newPage();
  await second.goto("/bullet-builder");
  await expect(second.getByLabel("What did you do?", { exact: true })).toBeEnabled();
  await second.getByLabel("What did you do?", { exact: true }).fill("Second tab change");
  await second.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(second.getByRole("status").filter({ hasText: "Account version loaded" })).toBeVisible();
  await field.fill("First tab unsaved work");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /newer|changed/i })).toBeVisible();
  await expect(field).toHaveValue("First tab unsaved work");
  await expect(page.getByRole("button", { name: "Download draft", exact: true })).toBeEnabled();
  const other = await browser.newContext();
  await signup(other);
  const otherPage = await other.newPage(); await otherPage.goto("/bullet-builder");
  await expect(otherPage.getByLabel("What did you do?", { exact: true })).toBeEnabled();
  await expect(otherPage.getByLabel("What did you do?", { exact: true })).toHaveValue("");
  await other.close();
});

test("blocked clipboard offers a readable download and mobile output fits", async ({ page, context }) => {
  await signup(context);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("blocked"); } }, configurable: true });
    document.execCommand = () => false;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/career-gap");
  await expect(page.getByLabel("From", { exact: true })).toBeEnabled();
  await page.getByLabel("From", { exact: true }).fill("March 2024");
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Clipboard access was blocked" })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download text", exact: true }).first().click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("resume-line.txt");
  let content = "";
  for await (const chunk of (await file.createReadStream())!) content += chunk.toString();
  expect(content).toContain("March 2024");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("background clock jumps advance discussion and finish aptitude without duplicate scores", async ({ page, context }) => {
  await signup(context);
  await page.goto("/group-discussion");
  await page.clock.install();
  await page.getByRole("button", { name: "Start: 2 minutes to plan", exact: true }).click();
  await page.clock.setSystemTime(new Date(Date.now() + 121000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Speak now: open, add value, include others, summarise", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("4:59");
  await page.clock.setSystemTime(new Date(Date.now() + 500000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("How did it go?", { exact: true })).toBeVisible();
  await page.clock.resume();
  await page.goto("/aptitude");
  await page.getByRole("button", { name: "Start the test", exact: true }).click();
  await page.clock.setSystemTime(new Date(Date.now() + 1800000));
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("heading", { name: "You scored 0 of 15", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change setup", exact: true }).click();
  await expect(page.getByText("0/15", { exact: true })).toHaveCount(1);
});

test("GitHub paginates, caps selection and keeps account provenance when cancelling", async ({ page, context }) => {
  await signup(context);
  const repo = (i: number) => ({ name: `project-${i}`, html_url: `https://github.com/alice/project-${i}`, description: "A public project", language: "TypeScript" });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.searchParams.get("page") === "1" ? Array.from({ length: 100 }, (_, i) => repo(i)) : [repo(100)] });
  });
  await page.goto("/github-projects");
  await page.getByRole("textbox", { name: "GitHub username or profile link" }).fill("alice");
  await page.getByRole("button", { name: "Read my repositories", exact: true }).click();
  await expect(page.getByRole("heading", { name: "alice repositories (101)", exact: true })).toBeVisible();
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(4);
  await page.locator('li input[type="checkbox"]:not(:checked)').first().check();
  await expect(page.locator('li input[type="checkbox"]:checked')).toHaveCount(5);
  await expect(page.locator('li input[type="checkbox"]:not(:checked)').first()).toBeDisabled();
  await expect(page.getByText("Technologies detected", { exact: true })).toBeVisible();
  await page.unroute("https://api.github.com/**");
  let release: (() => void) | undefined;
  await page.route("https://api.github.com/**", async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: [repo(999)] }).catch(() => {});
  });
  await page.getByRole("textbox", { name: "GitHub username or profile link" }).fill("bob");
  await page.getByRole("button", { name: "Read my repositories", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  release?.();
  await expect(page.getByRole("heading", { name: /repositories \(/ })).toHaveCount(0);
});
