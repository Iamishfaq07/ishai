import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Interview coordination: find, book, request and confirm replacement (${viewport.name})`, async ({ page, context, browser }, info) => {
    await page.setViewportSize(viewport);
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const { cid, aid, token } = await seed(context);
    const staffPath = `/business/app/${cid}/applications/${aid}`;
    await page.goto(staffPath);
    await page.getByText("Find panel times", { exact: true }).click();
    await page.getByRole("button", { name: "Find available times", exact: true }).click();
    const finder = page.locator("details").filter({ has: page.getByText("Find panel times", { exact: true }) });
    for (let i = 0; i < 3; i++) await finder.getByRole("checkbox").nth(i).check();
    await finder.getByRole("button", { name: "Use selected times", exact: true }).click();
    await page.getByLabel("Where", { exact: true }).fill("https://meet.example.test/coordination");
    await page.getByRole("button", { name: "Send times", exact: true }).click();
    await expect(page.getByText("Waiting for them to pick one of 3 times. Sending new times replaces those.", { exact: true })).toBeVisible();
    const candidate = await browser.newContext({ viewport, timezoneId: "Asia/Kolkata" });
    await candidate.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    const candidatePage = await candidate.newPage();
    await candidatePage.goto(`http://127.0.0.1:5186/application/${token}`);
    await candidatePage.getByRole("radio").first().check();
    await candidatePage.getByRole("button", { name: "Book this time", exact: true }).click();
    await expect(candidatePage.getByRole("button", { name: "Choose another offered time", exact: true })).toBeVisible();
    const before = (await (await context.request.get(`${API}/v1/public/business/applications/${token}`)).json()).interview.chosen;
    const start = new Date(Date.now() + 5 * 86400000); start.setHours(9, 0, 0, 0);
    // Candidate inputs run in Kolkata; construct their local wall clock from that browser's zone.
    const wall = await candidatePage.evaluate((stamp) => {
      const d = new Date(stamp); const p = (n: number) => String(n).padStart(2, "0");
      d.setHours(10, 0, 0, 0);
      const format = (v: Date) => `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`;
      return { start: format(d), end: format(new Date(d.getTime() + 3 * 3600000)) };
    }, start.getTime());
    await candidatePage.getByLabel("Start 1", { exact: true }).fill(wall.start);
    await candidatePage.getByLabel("End 1", { exact: true }).fill(wall.end);
    await candidatePage.getByLabel("Scheduling note", { exact: true }).fill("Could we arrange another time within this availability window please?");
    await candidatePage.getByRole("button", { name: "Request different times", exact: true }).click();
    await expect(candidatePage.getByText("Request: waiting", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Time request · waiting", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Find times in shared availability", exact: true }).click();
    const coordination = page.locator("section").filter({ has: page.getByRole("heading", { name: "Interview coordination", exact: true }) });
    await coordination.getByRole("group", { name: "Replacement interview times", exact: true }).getByRole("checkbox").first().check();
    await coordination.getByLabel("Scheduling reply", { exact: true }).fill("Please select this new time if it works. Your original booking remains until then.");
    await coordination.getByRole("button", { name: "Offer 1 replacement time", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Time request · awaiting candidate", exact: true })).toBeVisible();
    const during = (await (await context.request.get(`${API}/v1/public/business/applications/${token}`)).json()).interview.chosen;
    expect(during).toBe(before);
    await a11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`business-coordination-staff-${viewport.name}.png`), fullPage: true });
    await candidatePage.getByRole("button", { name: "Refresh scheduling updates", exact: true }).click();
    await expect(candidatePage.getByText("Request: awaiting candidate", { exact: true })).toBeVisible();
    await a11y(candidatePage);
    await candidatePage.evaluate(() => window.scrollTo(0, 0));
    await candidatePage.screenshot({ path: info.outputPath(`business-coordination-candidate-${viewport.name}.png`), fullPage: true });
    await candidatePage.getByRole("button", { name: "Choose another offered time", exact: true }).click();
    await candidatePage.getByRole("radio").last().check();
    await candidatePage.getByRole("button", { name: "Book this time", exact: true }).click();
    await expect(candidatePage.getByText("Request: resolved", { exact: true })).toBeVisible();
    const after = (await (await context.request.get(`${API}/v1/public/business/applications/${token}`)).json()).interview.chosen;
    expect(after).not.toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await candidatePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await candidate.close();
  });
}
