import { describe, expect, it } from "vitest";
import { sessionKindLine, sessionTitle } from "./format";

describe("a new session's title", () => {
  it("is the session type, then the role", () => {
    expect(sessionTitle("coding", " SDE II ")).toBe("Coding interview — SDE II");
    expect(sessionTitle("interview", "")).toBe("Interview");
  });

  it("names a mock round plainly, not with the picker's description", () => {
    expect(sessionTitle("mock", "Backend Engineer")).toBe("Mock interview — Backend Engineer");
    // and the lists don't repeat what the title says
    expect(sessionKindLine({ title: sessionTitle("mock", "Backend Engineer"), type: "mock", role: "Backend Engineer" })).toBe("");
  });
});
