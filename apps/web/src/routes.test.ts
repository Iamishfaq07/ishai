import { describe, expect, it } from "vitest";
import { pageFor, publicPageFor } from "./routes";

describe("pageFor (what the nav warms before a click)", () => {
  it("warms both contextual personal task spaces", () => {
    expect(pageFor("/career")).toBe("careerSpaces"); expect(pageFor("/prepare")).toBe("careerSpaces");
    expect(publicPageFor("/career")).toBeNull(); expect(publicPageFor("/prepare")).toBeNull();
  });
  it("warms the public tool explorer without a workspace", () => {
    expect(pageFor("/tools")).toBe("tools");
  });
  it("warms Resume's home and its editor", () => {
    expect(pageFor("/resume-ai")).toBe("resumes");
    expect(pageFor("/resume-ai/3f2a9c")).toBe("resumeEditor");
  });

  it("warms Jobs' own page where it has one, and the section otherwise", () => {
    for (const path of ["/jobs", "/jobs/", "/jobs/mission/8c1d2e", "/jobs/weekly"]) expect(pageFor(path)).toBe("jobs");
    expect(pageFor("/jobs/matches")).toBe("jobsMatches");
    expect(pageFor("/jobs/listing/8c1d2e")).toBe("jobsDetail");
    expect(pageFor("/jobs/tracker")).toBe("jobsTracker");
    expect(pageFor("/jobs/outreach")).toBe("jobsOutreach");
    expect(pageFor("/jobs/profile")).toBe("jobsProfile");
    expect(pageFor("/jobsearch")).toBeNull();
  });

  it("warms Jobs for Jobs' old addresses in Resume, never the resume editor", () => {
    expect(pageFor("/resume-ai/jobs")).toBe("jobsMatches"); // it opens Matches
    expect(pageFor("/resume-ai/jobs/tracker")).toBe("jobsTracker");
    expect(pageFor("/resume-ai/jobsearch")).toBe("resumeEditor");
  });

  it("keeps Documents its own page", () => {
    expect(pageFor("/documents")).toBe("documents");
    expect(pageFor("/documents/stories")).toBe("stories");
    expect(pageFor("/documents/answers")).toBe("answers");
  });

  it("warms Home at the root (the front page is for signed-out visitors, who don't prefetch)", () => {
    expect(pageFor("/")).toBe("home");
  });

  it("knows the Contact page, and only its address", () => {
    expect(pageFor("/contact")).toBe("contact");
    expect(pageFor("/contact/")).toBe("contact");
    expect(pageFor("/contacts")).toBeNull();
  });

  it("knows the welcome questions and the free practice question, and only those addresses", () => {
    expect(pageFor("/welcome")).toBe("welcome");
    expect(pageFor("/welcome/")).toBe("welcome");
    expect(pageFor("/warmup")).toBe("warmup");
    expect(pageFor("/warmup/")).toBe("warmup");
    expect(pageFor("/welcomed")).toBeNull();
    expect(pageFor("/warmups")).toBeNull();
  });
});

describe("publicPageFor (what a signed-out visitor sees instead of sign-in)", () => {
  it("shows the front page at the root, and the product pages at their homes", () => {
    expect(publicPageFor("/")).toBe("landing");
    expect(publicPageFor("/resume-ai")).toBe("resumeAiPublic");
    expect(publicPageFor("/resume-ai/")).toBe("resumeAiPublic");
    expect(publicPageFor("/jobs")).toBe("jobsAiPublic");
    expect(publicPageFor("/jobs/")).toBe("jobsAiPublic");
  });

  it("asks to sign in everywhere else", () => {
    for (const path of ["/sessions", "/mock", "/jobs/matches", "/resume-ai/3f2a9c", "/billing", "/welcome", "/documents"]) {
      expect(publicPageFor(path)).toBeNull();
    }
  });
});

describe("the public pricing and product pages (D73)", () => {
  it("warm their own code, never the signed-in Practice or video interview", () => {
    expect(pageFor("/pricing")).toBe("pricing");
    expect(pageFor("/interview-copilot")).toBe("copilotPublic");
    expect(pageFor("/mock-interview")).toBe("practicePublic");
    expect(pageFor("/mock")).toBe("mock");
    expect(pageFor("/pricings")).toBeNull();
  });

  it("gives LinkedIn's product page its own code, apart from the signed-in tool (D79)", () => {
    expect(pageFor("/linkedin-ai")).toBe("linkedinPublic");
    expect(pageFor("/linkedin")).toBe("linkedin");
  });
});
