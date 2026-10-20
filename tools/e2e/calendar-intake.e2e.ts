import { expect, test, type BrowserContext } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";
test.use({ actionTimeout: 10_000, timezoneId: "Asia/Kolkata" });

async function job(context: BrowserContext, title = "Graduate developer") {
  const response = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { title, company: "Example Studio", status: "applied" } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
const invitation = (at: Date, extra = "", uid = "private-calendar-id") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Interview invitation\r\nDTSTART:${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 360, height: 800 }, { name: "narrow-dark", width: 320, height: 800 }]) {
  test(`Calendar invitation to reviewed date and grounded preparation (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    if (viewport.name === "narrow-dark") await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await seed(context); const entry = await job(context);
    const at = new Date(Date.now() + 2 * 86400000); at.setUTCSeconds(37, 0);
    let writes = 0; let ai = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/message-update/confirm")) writes++;
      if (request.url().endsWith("/coach/plan")) ai++;
    });
    await page.goto(`/jobs?work=updates&input=calendar&job=${entry.id}`);
    const helper = page.getByRole("region", { name: "Review a calendar invitation", exact: true });
    await helper.getByLabel("Choose an .ics invitation").setInputFiles({ name: "interview.ics", mimeType: "text/calendar", buffer: Buffer.from(invitation(at)) });
    await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
    await expect(helper.getByRole("heading", { name: "Review the event and changes", exact: true })).toBeFocused();
    await expect(helper.getByText("Source time zone:", { exact: false })).toContainText("UTC");
    expect(writes).toBe(0); expect(ai).toBe(0);
    await expect(helper.getByLabel("Mark this job as interviewing")).not.toBeChecked();
    await expect(helper.getByRole("button", { name: "Save reviewed invitation", exact: true })).toBeDisabled();
    await helper.getByLabel("Mark this job as interviewing").check();
    await helper.getByLabel("I verified this event belongs to this job and confirm the date and stage above.", { exact: true }).check();
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`calendar-${viewport.name}.png`), fullPage: true });
    await helper.getByRole("button", { name: "Save reviewed invitation", exact: true }).click();
    await expect(helper.getByRole("heading", { name: "Interview update saved", exact: true })).toBeVisible();
    await expect(helper.getByLabel("Or paste iCalendar text")).toHaveValue("");
    const saved = await (await context.request.get(`${API}/v1/jobs/tracker/${entry.id}/message-update`)).json();
    expect(saved.status).toBe("interviewing"); expect(Date.parse(saved.next_at)).toBe(at.valueOf()); expect(writes).toBe(1);
    await helper.getByRole("link", { name: "Open preparation for this job", exact: true }).click();
    await page.getByText("Plan my interview preparation with AI", { exact: true }).click();
    const help = page.getByRole("button", { name: "Help me with this step", exact: true });
    await expect(help).toBeEnabled(); expect(ai).toBe(0);
    await help.click();
    await expect(page.getByText("Demo opportunity guidance", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open preparation task", exact: true }).first()).toHaveAttribute("href", `/jobs/mission/${entry.id}?guide=1&tab=plan`);
    expect(ai).toBe(1);
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`preparation-${viewport.name}.png`), fullPage: true });
    await page.getByRole("checkbox", { name: /^Tick off:/ }).first().click();
    await expect(page.getByText("Demo opportunity guidance", { exact: true })).toHaveCount(0);
    await expect(help).toBeEnabled(); expect(ai).toBe(1);
  });
}

test("Unsupported recurrence, stale save and repeated invitation keep the candidate in control", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const entry = await job(context);
  const at = new Date(Date.now() + 86400000); at.setMilliseconds(0);
  await page.goto(`/jobs?work=updates&input=calendar&job=${entry.id}`);
  const helper = page.getByRole("region", { name: "Review a calendar invitation", exact: true });
  const text = helper.getByLabel("Or paste iCalendar text");
  await text.fill(invitation(at, "RRULE:FREQ=DAILY\r\n"));
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
  await expect(helper.getByText(/Recurring invitations need/)).toBeVisible();
  await text.fill(invitation(at));
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
  const confirm = helper.getByLabel("I verified this event belongs to this job and confirm the date and stage above.", { exact: true });
  await confirm.check();
  expect((await context.request.patch(`${API}/v1/jobs/tracker/${entry.id}`, { data: { status: "offer" } })).ok()).toBe(true);
  await helper.getByRole("button", { name: "Save reviewed invitation", exact: true }).click();
  await expect(helper.getByText(/This job changed or is closed/)).toBeVisible();
  await expect(text).toHaveValue(invitation(at).replace(/\r\n/g, "\n"));
  await helper.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(helper.getByText(/Saved stage: offer/)).toBeVisible();
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
  await confirm.check();
  await helper.getByRole("button", { name: "Save reviewed invitation", exact: true }).click();
  await expect(helper.getByRole("heading", { name: "Interview update saved", exact: true })).toBeVisible();
  await text.fill(invitation(at));
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
  await expect(helper.getByText("These choices are already saved. No duplicate update is needed.", { exact: true })).toBeVisible();
  await confirm.check();
  await expect(helper.getByRole("button", { name: "Save reviewed invitation", exact: true })).toBeDisabled();
  const saved = await (await context.request.get(`${API}/v1/jobs/tracker/${entry.id}/message-update`)).json();
  expect(saved.status).toBe("offer");
});

test("Multiple events require a choice; delayed results cannot move to another job", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  await seed(context); const entry = await job(context); const second = await job(context, "Second role");
  const at = new Date(Date.now() + 86400000); at.setMilliseconds(0);
  const another = invitation(new Date(at.valueOf() + 3600000), "", "second-event");
  const event = another.slice(another.indexOf("BEGIN:VEVENT"), another.indexOf("END:VCALENDAR"));
  const multiple = invitation(at).replace("END:VCALENDAR", event + "END:VCALENDAR");
  await page.goto(`/jobs?work=updates&input=calendar&job=${entry.id}`);
  const helper = page.getByRole("region", { name: "Review a calendar invitation", exact: true });
  await helper.getByLabel("Or paste iCalendar text").fill(multiple);
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click();
  await expect(helper.getByLabel("Event to use")).toHaveValue("");
  await helper.getByLabel("Event to use").selectOption({ index: 1 });
  const confirm = helper.getByLabel("I verified this event belongs to this job and confirm the date and stage above.", { exact: true });
  await confirm.check();
  await helper.getByLabel("Event to use").selectOption({ index: 2 });
  await expect(confirm).not.toBeChecked();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/calendar-preview", async (route) => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  await helper.getByRole("button", { name: "Review invitation", exact: true }).click(); await requested;
  await page.getByLabel("1. Choose the job this message is about").selectOption(second.id);
  await expect(helper.getByText("Second role · Example Studio", { exact: true })).toBeVisible();
  const finished = page.waitForResponse((response) => response.url().endsWith("/calendar-preview"));
  release(); await finished;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(helper.getByRole("heading", { name: "Review the event and changes", exact: true })).toHaveCount(0);
  await expect(helper.getByLabel("Or paste iCalendar text")).toHaveValue("");
});
