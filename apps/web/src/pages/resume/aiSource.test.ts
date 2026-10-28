import { describe, expect, it } from "vitest";
import { newResume } from "./model";
import { resumeAiSource } from "./aiSource";

describe("AI source validation", () => {
  const source = { id: "resume-a", ...newResume() };
  it("rejects changed content, job text, design and another resume", () => {
    const before = resumeAiSource(source);
    for (const changed of [
      { ...source, id: "resume-b" },
      { ...source, job_text: "A different target role" },
      { ...source, design: { ...source.design, accent: "#112233" } },
      { ...source, data: { ...source.data, basics: { ...source.data.basics, summary: "Candidate's new edit" } } },
    ]) expect(resumeAiSource(changed)).not.toBe(before);
  });
  it("accepts an unchanged copy or a file rename", () => {
    const renamed = { ...source, title: "New file name" };
    expect(resumeAiSource(renamed)).toBe(resumeAiSource(source));
    expect(resumeAiSource(JSON.parse(JSON.stringify(source)))).toBe(resumeAiSource(source));
  });
});
