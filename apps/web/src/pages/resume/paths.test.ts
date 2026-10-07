import { describe, expect, it } from "vitest";
import { isResumeAiHome, movedResumePath, resumePath } from "./paths";

describe("Resume AI's addresses", () => {
  it("opens a resume under /resume-ai, its id kept safe in the address", () => {
    expect(resumePath("3f2a9c")).toBe("/resume-ai/3f2a9c");
    expect(resumePath("a/b c")).toBe("/resume-ai/a%2Fb%20c");
  });

  it("knows the product home (where a signed-out visitor sees the product page), and nothing under it", () => {
    expect(isResumeAiHome("/resume-ai")).toBe(true);
    expect(isResumeAiHome("/resume-ai/")).toBe(true);
    expect(isResumeAiHome("/resume-ai/3f2a9c")).toBe(false);
    expect(isResumeAiHome("/resume-ai/jobs")).toBe(false);
    expect(isResumeAiHome("/resume-aix")).toBe(false);
    expect(isResumeAiHome("/")).toBe(false);
  });
});

describe("the resume maker's old addresses", () => {
  it("go to the same place in Resume AI", () => {
    expect(movedResumePath("/documents/resumes")).toBe("/resume-ai");
    expect(movedResumePath("/documents/resumes/")).toBe("/resume-ai");
    expect(movedResumePath("/documents/resumes/3f2a9c")).toBe("/resume-ai/3f2a9c");
    expect(movedResumePath("/documents/resumes/3f2a9c/")).toBe("/resume-ai/3f2a9c");
    expect(movedResumePath("/resume-maker")).toBe("/resume-ai");
    expect(movedResumePath("/resume-maker/")).toBe("/resume-ai");
  });

  it("leave every other address alone", () => {
    for (const path of ["/documents", "/documents/stories", "/documents/resumesx", "/documents/resumes/a/b", "/resume-ai", "/"]) {
      expect(movedResumePath(path)).toBeNull();
    }
  });
});
