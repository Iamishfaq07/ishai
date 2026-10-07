import { describe, expect, it } from "vitest";
import { pageFor } from "./routes";

describe("pageFor (what the nav warms before a click)", () => {
  it("warms Resume AI's home and its editor", () => {
    expect(pageFor("/resume-ai")).toBe("resumes");
    expect(pageFor("/resume-ai/3f2a9c")).toBe("resumeEditor");
  });

  it("never reads the Jobs portal's address as a resume", () => {
    expect(pageFor("/resume-ai/jobs")).toBeNull();
    expect(pageFor("/resume-ai/jobs/saved")).toBeNull();
    expect(pageFor("/resume-ai/jobsearch")).toBe("resumeEditor");
  });

  it("keeps Documents its own page", () => {
    expect(pageFor("/documents")).toBe("documents");
    expect(pageFor("/documents/stories")).toBe("stories");
  });
});
