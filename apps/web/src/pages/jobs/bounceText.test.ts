import { describe, expect, it } from "vitest";
import { bounceLinks, feedbackRequest } from "./bounceText";

describe("feedbackRequest", () => {
  it("names the role, the company and the candidate", () => {
    const text = feedbackRequest({ company: "Swiggy", title: "SDE 2" }, "Asha Rao");
    expect(text).toContain("the SDE 2 role");
    expect(text).toContain("future roles at Swiggy");
    expect(text.endsWith("Asha Rao")).toBe(true);
  });

  it("reads naturally with blanks", () => {
    const text = feedbackRequest({ company: " ", title: "" }, "");
    expect(text).toContain("letting me know about the role, and");
    expect(text).toContain("considered for future roles.");
    expect(text.endsWith("Best regards,")).toBe(true);
  });
});

describe("bounceLinks", () => {
  it("searches the same title and practises for the company", () => {
    expect(bounceLinks({ company: "Swiggy", title: "SDE 2" })).toEqual({
      similar: "/jobs/matches?q=SDE+2",
      practice: "/mock?role=SDE+2&company=Swiggy",
    });
  });

  it("leaves out empty fields", () => {
    expect(bounceLinks({ company: "", title: "" })).toEqual({ similar: "/jobs/matches", practice: "/mock" });
  });
});
