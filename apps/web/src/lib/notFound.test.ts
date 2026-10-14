import { describe, expect, it } from "vitest";
import { recoveryFor } from "./notFound";

describe("the 404 page's way back", () => {
  it("reads where a broken address was heading from its first segment", () => {
    expect(recoveryFor("/practice/abc")?.to).toBe("/mock");
    expect(recoveryFor("/job/123")?.to).toBe("/jobs/matches");
    expect(recoveryFor("/Resume/old-link")?.to).toBe("/resume-ai");
    expect(recoveryFor("/session/s-1/report")?.to).toBe("/sessions");
    expect(recoveryFor("/pricing")?.label).toBe("See plans and credits");
  });

  it("offers nothing when the address gives nothing to go on", () => {
    expect(recoveryFor("/")).toBeNull();
    expect(recoveryFor("/xyzzy")).toBeNull();
    expect(recoveryFor("/practicex")).toBeNull(); // whole segments only
  });
});
