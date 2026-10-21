import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const API = "http://127.0.0.1:8000";

test("candidate reviews, unlinks and reassigns a completed session without changing its report", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const account = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `association-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Robin Park", country: "US",
  } });
  expect(account.status(), await account.text()).toBe(201);
  const jobs: string[] = [];
  for (const company of ["Opportunity One", "Opportunity Two"]) {
    const response = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { company, title: "Developer" } });
    expect(response.status(), await response.text()).toBe(201); jobs.push((await response.json()).id);
  }
  const created = await context.request.post(`${API}/v1/sessions`, { data: {
    type: "mock", title: "My general practice to review", company: "Original practice context", role: "Original role",
  } });
  expect(created.status(), await created.text()).toBe(201); const session = (await created.json()).id;
  expect((await context.request.post(`${API}/v1/sessions/${session}/end`)).status()).toBe(200);
  const openRounds = async (id: string, company: string) => {
    await page.goto(`/jobs/mission/${id}?tab=practice`);
    await expect(page.getByRole("heading", { name: `Practice for ${company}`, exact: true })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Review previous rounds, then try again" }).click();
  };
  const choose = async (job: string, review = false) => {
    await page.getByRole("button", { name: "Link a completed session", exact: true }).click();
    await page.getByRole("combobox", { name: "Completed session", exact: true }).selectOption(session);
    await expect(page.getByRole("link", { name: "Review selected report", exact: true })).toHaveAttribute("href", `/sessions/${session}?job=${job}&career_from=practice`);
    if (review) {
      await page.getByRole("link", { name: "Review selected report", exact: true }).click();
      await expect(page.getByRole("link", { name: "Back to this job", exact: true })).toHaveAttribute("href", `/jobs/mission/${job}?guide=1&tab=practice`);
      // Navigation alone must not attach a generic report or change progress.
      expect((await (await context.request.get(`${API}/v1/sessions/${session}`)).json()).session.application_id).toBeNull();
      await page.getByRole("link", { name: "Back to this job", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Practice for Opportunity One", exact: true })).toBeVisible();
      await page.locator("summary").filter({ hasText: "Review previous rounds, then try again" }).click();
      await page.getByRole("button", { name: "Link a completed session", exact: true }).click();
      await page.getByRole("combobox", { name: "Completed session", exact: true }).selectOption(session);
    }
    await page.getByRole("button", { name: "Review and link session", exact: true }).click();
  };
  const count = (number: number) => expect(page.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Completed practice" }) }).locator("dd")).toHaveText(String(number));
  await openRounds(jobs[0], "Opportunity One"); await count(0);
  await choose(jobs[0], true);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("does not rewrite the original session context");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await count(0);
  await page.getByRole("button", { name: "Review and link session", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm association", exact: true }).click();
  await count(1);
  await expect(page.getByRole("status").filter({ hasText: "Session linked after your review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlink session", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("session-reviewed-linked-390.png"), fullPage: true });
  await page.getByRole("button", { name: "Unlink session", exact: true }).click();
  await expect(dialog).toContainText("original transcript, report and recorded context remain unchanged");
  await dialog.getByRole("button", { name: "Unlink session", exact: true }).click();
  await count(0);
  await expect(page.locator("#orbit-confirm-title")).toHaveCount(0);
  await expect(page.getByText("Session unlinked. Its report is preserved.", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("session-unlinked-390.png"), fullPage: true });
  await openRounds(jobs[1], "Opportunity Two"); await choose(jobs[1]);
  await dialog.getByRole("button", { name: "Confirm association", exact: true }).click(); await count(1);
  const detail = await (await context.request.get(`${API}/v1/sessions/${session}`)).json();
  expect(detail.session.company).toBe("Original practice context"); expect(detail.session.role).toBe("Original role");
  expect(detail.session.application_id).toBe(jobs[1]);
  await page.goto(`/sessions/${session}`);
  await expect(page.getByRole("link", { name: "Back to this opportunity", exact: true })).toHaveAttribute("href", `/jobs/mission/${jobs[1]}?tab=practice`);
  await openRounds(jobs[0], "Opportunity One"); await count(0);
  const history = await (await context.request.get(`${API}/v1/jobs/tracker/${jobs[0]}/timeline`)).json();
  expect(history.filter((event: { kind: string }) => event.kind === "association")).toHaveLength(2);
  const exported = await (await context.request.get(`${API}/v1/auth/me/export`)).json();
  expect(exported.opportunity_session_associations).toHaveLength(3);
});
