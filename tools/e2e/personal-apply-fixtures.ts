import { expect, type BrowserContext } from "@playwright/test";
import { API } from "./business-fixtures";

export async function prepareReview(context: BrowserContext, jobId: string) {
  const me = await (await context.request.get(`${API}/v1/auth/me`)).json();
  const resume = await context.request.post(`${API}/v1/resumes`, { data: { title: "Daily focus fixture",
    data: { basics: { name: "Morgan Recruiter", email: me.email, headline: "Backend Engineer", location: "Bengaluru, India", summary: "Build Python APIs with PostgreSQL." },
      skills: [{ name: "Skills", items: ["Python", "Postgres", "PostgreSQL"] }] } } });
  expect(resume.status(), await resume.text()).toBe(201);
  const rid = (await resume.json()).id;
  const setup = await context.request.put(`${API}/v1/apply/setup`, { data: { resume_id: rid, approve_resume: true,
    facts: { first_name: "Morgan", last_name: "Recruiter", email: me.email, city: "Bengaluru", country: "IN" },
    filters: { titles: ["Backend Engineer"], countries: ["IN"], days: 30 }, threshold: 45, mode: "review", daily_limit: 5, consent: true } });
  expect(setup.ok(), await setup.text()).toBe(true);
  const listingId = `biz:${jobId.replaceAll("-", "")}`;
  const saved = await context.request.post(`${API}/v1/jobs/tracker`, { data: { listing_id: listingId } });
  expect(saved.status(), await saved.text()).toBe(201);
  const tracker = await saved.json();
  const prepared = await context.request.post(`${API}/v1/apply/plan-shortlist`, { data: { listing_ids: [listingId] } });
  expect(prepared.ok(), await prepared.text()).toBe(true);
  const packets = await (await context.request.get(`${API}/v1/apply/packets`)).json();
  expect(packets).toHaveLength(1);
  expect(packets[0].status).toBe("review");
  return { packet: packets[0], tracker, listingId };
}
