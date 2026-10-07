import { describe, expect, it } from "vitest";
import { pageFor } from "./routes";

describe("pageFor (what the nav warms before a click)", () => {
  it("warms Resume AI's home and its editor", () => {
    expect(pageFor("/resume-ai")).toBe("resumes");
    expect(pageFor("/resume-ai/3f2a9c")).toBe("resumeEditor");
  });

  it("warms the Jobs portal for its address, never the resume editor", () => {
    expect(pageFor("/resume-ai/jobs")).toBe("jobs");
    expect(pageFor("/resume-ai/jobs/saved")).toBe("jobs");
    expect(pageFor("/resume-ai/jobsearch")).toBe("resumeEditor");
  });

  it("keeps Documents its own page", () => {
    expect(pageFor("/documents")).toBe("documents");
    expect(pageFor("/documents/stories")).toBe("stories");
  });
});
