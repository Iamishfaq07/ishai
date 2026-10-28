import { expect, test } from "@playwright/test";
import { API, a11y, seed } from "./business-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`job networking: saved contacts, draft, search links and job switching (${viewport.name})`, async ({ page, context }, info) => {
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
    await expect(finder.getByRole("heading", { name: "Saved at Acme", exact: true })).toBeVisible();
    // Automatic search is off in demo AI mode; candidates never see the server reason (only admins do).
    await expect(finder.getByRole("button", { name: "Find people at Acme", exact: true })).toBeDisabled();
    await expect(finder.getByText(/DEEPSEEK|LLM_PROVIDER/)).toHaveCount((await (await context.request.get(`${API}/v1/admin/status`)).json()).is_admin ? 1 : 0);
    await expect(finder.getByRole("heading", { name: "Search yourself", exact: true })).toBeVisible();
    await expect(finder.getByRole("link", { name: /LinkedIn|Google/ }).first()).toHaveAttribute("target", "_blank");
    await finder.getByRole("button", { name: "Write a message to Jamie Mentor", exact: true }).click();
    await expect(finder.getByRole("heading", { name: "Draft for Jamie Mentor", exact: true })).toBeVisible();
    await finder.getByRole("button", { name: "Draft outreach with AI", exact: true }).click();
    await expect(finder.getByLabel("Outreach draft", { exact: true })).toHaveValue(/\[mock\]/);
    // A draft is only a draft: nothing is marked as contacted.
    const stored = (await (await context.request.get(`${API}/v1/jobs/contacts`)).json()).find((c: { name: string }) => c.name === "Jamie Mentor");
    expect(stored.last_contacted_at).toBeNull();
    const tracker = await (await context.request.get(`${API}/v1/jobs/tracker`)).json();
    expect(tracker.find((j: { id: string }) => j.id === job.id).status).toBe("saved");
    await a11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`contact-research-${viewport.name}.png`), fullPage: true });
    await finder.getByLabel("Job", { exact: true }).selectOption({ label: "Platform Engineer · Other Company" });
    await expect(finder.getByRole("heading", { name: "Draft for Jamie Mentor", exact: true })).toHaveCount(0);
    await expect(finder.getByRole("heading", { name: "Saved at Acme", exact: true })).toHaveCount(0);
    await expect(finder.getByRole("button", { name: "Find people at Other Company", exact: true })).toBeVisible();
    // A link to a job that isn't tracked opens the finder on a saved job instead of an empty page.
    await page.goto("/jobs/outreach?network=1&job=removed-or-unsaved-job");
    const unlinked = page.getByRole("region", { name: "Contact finder", exact: true });
    await expect(unlinked.getByLabel("Job", { exact: true })).not.toHaveValue("");
    await unlinked.getByLabel("Job", { exact: true }).selectOption({ label: "Platform Engineer · Other Company" });
    await expect(unlinked.getByRole("button", { name: "Find people at Other Company", exact: true })).toBeVisible();
  });
}
