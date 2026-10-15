import { describe, expect, it } from "vitest";
import type { LinkedInCheck } from "@orbit/types";
import { profileUrl, rewriteBrief, scoreWord, sectionScores, topFixes } from "./model";

const c = (id: string, section: LinkedInCheck["section"], ok: boolean, points: number, max: number): LinkedInCheck =>
  ({ id, section, ok, points, max, title: id, tip: "" });

describe("LinkedIn AI model", () => {
  const checks = [c("h1", "headline", true, 4, 4), c("h2", "headline", false, 0, 5), c("a1", "about", false, 2, 5), c("s1", "skills", false, 0, 9)];

  it("adds up each section", () => {
    expect(sectionScores(checks)).toEqual([
      { id: "headline", label: "Headline", points: 4, max: 9, todo: 1 },
      { id: "about", label: "About", points: 2, max: 5, todo: 1 },
      { id: "skills", label: "Skills", points: 0, max: 9, todo: 1 },
    ]);
  });

  it("puts the fixes worth most first", () => {
    expect(topFixes(checks).map((x) => x.id)).toEqual(["s1", "h2", "a1"]);
  });

  it("names the score and briefs the writer", () => {
    expect(scoreWord(90)).toBe("Strong");
    expect(scoreWord(30)).toBe("Thin");
    expect(rewriteBrief("Backend Engineer", ["Go", "Kafka"])).toBe("Backend Engineer\n\nSkills employers ask for: Go, Kafka");
    expect(rewriteBrief("Backend Engineer", [])).toBe("Backend Engineer");
  });

  it("reads a profile link however it's pasted", () => {
    expect(profileUrl("https://www.linkedin.com/in/asha-rao/")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("linkedin.com/in/asha-rao")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("https://in.linkedin.com/in/asha-rao?utm_source=share")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("https://www.linkedin.com/company/orbit")).toBeNull();
    expect(profileUrl("https://evil.com/linkedin.com/in/x")).toBeNull();
    expect(profileUrl("")).toBeNull();
  });
});
