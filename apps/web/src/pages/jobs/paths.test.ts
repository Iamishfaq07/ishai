import { describe, expect, it } from "vitest";
import { JOBS_MATCHES, JOBS_OUTREACH, JOBS_TRACKER, isJobsAiHome, isOutreach, jobPath, jobsForResume, movedJobsPath, outreachPath } from "./paths";

describe("Jobs's addresses", () => {
  it("opens a job under /jobs, its id kept safe in the address", () => {
    expect(jobPath("8c1d2e")).toBe("/jobs/listing/8c1d2e");
    expect(jobPath("a/b c")).toBe("/jobs/listing/a%2Fb%20c");
  });

  it("asks for one resume's matches in the query", () => {
    expect(jobsForResume("3f2a9c")).toBe("/jobs/matches?resume=3f2a9c");
    expect(jobsForResume("a&b")).toBe("/jobs/matches?resume=a%26b");
  });

  it("opens Outreach for a job and a resume, each in the query and kept safe there", () => {
    expect(outreachPath()).toBe("/jobs/outreach");
    expect(outreachPath({ resume: "3f2a9c" })).toBe("/jobs/outreach?resume=3f2a9c");
    expect(outreachPath({ job: "8c1d2e", resume: "3f2a9c" })).toBe("/jobs/outreach?job=8c1d2e&resume=3f2a9c");
    expect(outreachPath({ job: "a&b", resume: null })).toBe("/jobs/outreach?job=a%26b");
    expect(isOutreach(JOBS_OUTREACH)).toBe(true);
    expect(isOutreach("/jobs/outreach/")).toBe(true);
    expect(isOutreach(JOBS_MATCHES)).toBe(false);
    expect(isOutreach("/jobs/outreachx")).toBe(false);
  });

  it("knows the product home (where a signed-out visitor sees the product page), and nothing under it", () => {
    expect(isJobsAiHome("/jobs")).toBe(true);
    expect(isJobsAiHome("/jobs/")).toBe(true);
    expect(isJobsAiHome(JOBS_MATCHES)).toBe(false);
    expect(isJobsAiHome(JOBS_OUTREACH)).toBe(false);
    expect(isJobsAiHome("/jobsearch")).toBe(false);
    expect(isJobsAiHome("/resume-ai/jobs")).toBe(false);
  });
});

describe("Jobs' old addresses in Resume", () => {
  it("send the feed to the matches and the tracker view to the tracker", () => {
    expect(movedJobsPath("/resume-ai/jobs")).toEqual({ pathname: JOBS_MATCHES, search: "" });
    expect(movedJobsPath("/resume-ai/jobs/")).toEqual({ pathname: JOBS_MATCHES, search: "" });
    expect(movedJobsPath("/resume-ai/jobs", "?view=tracker")).toEqual({ pathname: JOBS_TRACKER, search: "" });
    expect(movedJobsPath("/resume-ai/jobs", "?view=matches")).toEqual({ pathname: JOBS_MATCHES, search: "" });
  });

  it("keep the rest of the query", () => {
    expect(movedJobsPath("/resume-ai/jobs", "?view=tracker&utm_source=mail")).toEqual({ pathname: JOBS_TRACKER, search: "?utm_source=mail" });
    expect(movedJobsPath("/resume-ai/jobs", "?q=react")).toEqual({ pathname: JOBS_MATCHES, search: "?q=react" });
  });

  it("send anything under the old address to the same place under /jobs", () => {
    expect(movedJobsPath("/resume-ai/jobs/tracker")).toEqual({ pathname: "/jobs/tracker", search: "" });
    expect(movedJobsPath("/resume-ai/jobs/profile/")).toEqual({ pathname: "/jobs/profile", search: "" });
    expect(movedJobsPath("/resume-ai/jobs/listing/8c1d2e")).toEqual({ pathname: "/jobs/listing/8c1d2e", search: "" });
  });

  it("leave every other address alone, resumes included", () => {
    for (const path of ["/resume-ai", "/resume-ai/3f2a9c", "/resume-ai/jobsearch", "/jobs", "/jobs/matches", "/"]) {
      expect(movedJobsPath(path)).toBeNull();
    }
  });
});
