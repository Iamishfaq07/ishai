import { describe, expect, it } from "vitest";
import { routeTitle } from "./routeTitle";

describe("routeTitle", () => {
  it("names Resume AI's pages, the product home and each resume alike", () => {
    expect(routeTitle("/resume-ai")).toBe("Resume AI");
    expect(routeTitle("/resume-ai/3f2a9c")).toBe("Resume AI");
    expect(routeTitle("/resume-ai/jobsearch")).toBe("Resume AI");
  });

  it("names the Jobs portal inside Resume AI", () => {
    expect(routeTitle("/resume-ai/jobs")).toBe("Jobs");
  });

  it("keeps Documents and the Story bank apart from Resume AI", () => {
    expect(routeTitle("/documents")).toBe("Documents");
    expect(routeTitle("/documents/stories")).toBe("Story bank");
  });

  it("picks the deeper page first", () => {
    expect(routeTitle("/sessions/abc")).toBe("Session");
    expect(routeTitle("/sessions")).toBe("Sessions");
    expect(routeTitle("/")).toBe("Home");
  });

  it("has no title for an address it doesn't know", () => {
    expect(routeTitle("/nowhere")).toBeNull();
  });
});
