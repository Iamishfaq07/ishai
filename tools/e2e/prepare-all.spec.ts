import { expect, test, type BrowserContext } from "@playwright/test";

const API = process.env.ORBIT_TEST_API_URL ?? "http://127.0.0.1:8000";
async function signup(context: BrowserContext) {
  const result = await context.request.post(`${API}/v1/auth/register`, { data: {
    email: `prepare-all-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Prepare all", country: "IN",
  } });
  expect(result.status(), await result.text()).toBe(201);
}

test("Prepare everything links a resume, writes interview questions and skips what's done", async ({ page, context }) => {
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  const resume = await (await context.request.post(`${API}/v1/resumes`, { data: { title: "Main", data: {
    basics: { name: "Asha Rao", email: "a@example.com", headline: "Backend developer", summary: "Backend developer building Python APIs." },
    experience: [{ title: "Engineer", company: "Acme", start: "Jul 2022", end: "", current: true, location: "Pune", bullets: ["Built Python APIs on PostgreSQL"] }],
    education: [], skills: [{ name: "Backend", items: ["Python", "PostgreSQL"] }], projects: [], certifications: [], extras: [], section_order: [],
  } } })).json();
  expect(resume.id).toBeTruthy(); // the main resume until another is chosen: the newest
  const job = await (await context.request.post(`${API}/v1/jobs/tracker/manual`, { data: { company: "Zepto", title: "Backend engineer" } })).json();
  const fit = await context.request.post(`${API}/v1/jobs/tracker/${job.id}/fit`, { data: {
    job_text: "We are hiring a backend engineer to build Python services on PostgreSQL with Redis caching. Bengaluru." } });
  expect(fit.ok(), await fit.text()).toBe(true);

  await page.goto(`/jobs/mission/${job.id}`);
  const card = page.getByRole("region", { name: "Prepare everything for this job" });
  await expect(card).toContainText("Uses 1 Resume credit.");
  await card.getByRole("button", { name: "Prepare everything" }).click();
  await expect(card).toContainText("Main resume linked");
  await expect(card).toContainText(/\d+ questions ready on the Interview tab/);
  await card.getByRole("button", { name: "See the interview questions" }).click();
  await expect(page).toHaveURL(/tab=interview/);
  // Everything done: the card steps aside on the next visit.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Backend engineer" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Prepare everything for this job" })).toHaveCount(0);
});
