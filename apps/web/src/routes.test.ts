import { describe, expect, it } from "vitest";
import { pageFor } from "./routes";

describe("pageFor (what the nav warms before a click)", () => {
  it("warms Resume AI's home and its editor", () => {
    expect(pageFor("/resume-ai")).toBe("resumes");
    expect(pageFor("/resume-ai/3f2a9c")).toBe("resumeEditor");
  });

  it("warms Jobs AI for every one of its pages", () => {
    for (const path of ["/jobs", "/jobs/", "/jobs/matches", "/jobs/listing/8c1d2e", "/jobs/tracker", "/jobs/profile"]) {
      expect(pageFor(path)).toBe("jobs");
    }
    expect(pageFor("/jobsearch")).toBeNull();
  });

  it("warms Jobs AI for Jobs' old addresses in Resume AI, never the resume editor", () => {
    expect(pageFor("/resume-ai/jobs")).toBe("jobs");
    expect(pageFor("/resume-ai/jobs/tracker")).toBe("jobs");
    expect(pageFor("/resume-ai/jobsearch")).toBe("resumeEditor");
  });

  it("keeps Documents its own page", () => {
    expect(pageFor("/documents")).toBe("documents");
    expect(pageFor("/documents/stories")).toBe("stories");
  });
});
