import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`job networking: find, review, save, remind and draft (${viewport.name})`, async ({ page, context }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
    await seed(context);
    const created = await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Backend Engineer", company: "Acme", url: "https://acme.example/jobs/backend" } });
    expect(created.status(), await created.text()).toBe(201);
    const job = await created.json();
    await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: {
      title: "Platform Engineer", company: "Other Company", url: "https://other.example/jobs/platform" } });
    const contact = await context.request.post(`${API}/v1/jobs/contacts`, { data: { name: "Jamie Mentor", company: "ACME", title: "Team engineer", relation: "other" } });
    expect(contact.ok(), await contact.text()).toBe(true);
    await page.goto(`/jobs/outreach?network=1&job=${encodeURIComponent(job.listing_id)}`);
    await expect(page.getByRole("heading", { name: "Find the right person for a job", exact: true })).toBeVisible();
    const finder = page.getByRole("region", { name: "Contact finder", exact: true });
    await expect(finder.getByRole("button", { name: "Draft for Jamie Mentor", exact: true })).toBeVisible();
    await expect(finder.getByText("No prior contact logged", { exact: true })).toBeVisible();
    await expect(finder.getByText(/Automatic web search is not configured/)).toBeVisible();
    await finder.getByLabel("Recruiter reply or public profile text (optional)").fill("From: Alex Rivera <alex@acme.com>\nTitle: Talent Acquisition Partner\nAcme is hiring Python engineers.");
    await finder.getByRole("button", { name: "Find contacts with AI", exact: true }).click();
    await expect(finder.getByRole("heading", { name: "Alex Rivera", exact: true })).toBeVisible();
    await finder.getByText("Review source evidence", { exact: true }).click();
    await expect(finder.getByText("Candidate-provided text; identity not independently verified.", { exact: true })).toBeVisible();
    const save = finder.getByRole("button", { name: "Save Alex Rivera to People", exact: true });
    await expect(save).toBeDisabled();
    await finder.getByLabel("I reviewed this lead and its source", { exact: true }).check();
    await finder.getByLabel("Remind me about this contact in 7 days", { exact: true }).check();
    await save.click();
    await expect(finder.getByText("Saved to People with its source.", { exact: true })).toBeVisible();
    await finder.getByRole("button", { name: "Draft outreach with AI", exact: true }).click();
    await expect(finder.getByLabel("Outreach draft", { exact: true })).toHaveValue(/\[mock\]/);
    const stored = (await (await context.request.get(`${API}/v1/jobs/contacts`)).json()).find((c: { name: string }) => c.name === "Alex Rivera");
    expect(stored.last_contacted_at).toBeNull(); expect(stored.follow_up_at).toBeTruthy();
    expect(stored.notes).toContain("Evidence: From: Alex Rivera");
    const tracker = await (await context.request.get(`${API}/v1/jobs/tracker`)).json();
    expect(tracker.find((j: { id: string }) => j.id === job.id).status).toBe("saved");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`contact-research-${viewport.name}.png`), fullPage: true });
    await finder.getByLabel("Job to research", { exact: true }).selectOption({ label: "Platform Engineer · Other Company" });
    await expect(finder.getByRole("heading", { name: "Draft for Alex Rivera", exact: true })).toHaveCount(0);
    await expect(finder.getByLabel("Recruiter reply or public profile text (optional)")).toHaveValue("");
    await expect(finder.getByText("No saved contact at this company yet.", { exact: true })).toBeVisible();
    await page.goto("/jobs/outreach?network=1&job=removed-or-unsaved-job");
    const unlinked = page.getByRole("region", { name: "Contact finder", exact: true });
    await expect(unlinked.getByText(/The linked job is not in your tracker/)).toBeVisible();
    await expect(unlinked.getByLabel("Job to research", { exact: true })).toHaveValue("");
    await expect(unlinked.getByRole("button", { name: "Find contacts with AI", exact: true })).toHaveCount(0);
    await unlinked.getByLabel("Job to research", { exact: true }).selectOption({ label: "Platform Engineer · Other Company" });
    await expect(unlinked.getByRole("button", { name: "Find contacts with AI", exact: true })).toBeVisible();
  });
}
