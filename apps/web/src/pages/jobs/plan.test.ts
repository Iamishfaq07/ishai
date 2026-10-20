import { describe, expect, it } from "vitest";
import { dayLabel, planItemLink } from "./plan";

const entry = { document_id: null, live: true, listing_id: "abc", title: "Engineer", company: "Hooli", url: "" };

describe("prep plan helpers", () => {
  it("names the days plainly", () => {
    expect(dayLabel("2026-10-20", 0, "2026-10-16")).toBe("Interview day");
    expect(dayLabel("2026-10-16", 4, "2026-10-16")).toBe("Today");
    expect(dayLabel("2026-10-17", 3, "2026-10-16")).toBe("Tomorrow");
    expect(dayLabel("2026-10-16", null, "2026-10-16")).toBe("Today");
    expect(dayLabel("2026-10-17", null, "2026-10-16")).toBe("Tomorrow");
  });
  it("sends each task where it's done", () => {
    expect(planItemLink("queue", entry)).toBe("/mock");
    expect(planItemLink("story", entry)).toBe("/documents/stories");
    expect(planItemLink("logistics", entry)).toBe("/start");
    expect(planItemLink("research", entry)).toBe("/jobs/listing/abc");
    expect(planItemLink("research", { ...entry, live: false })).toBeNull();
  });
});
