import { describe, expect, it } from "vitest";
import { sourceLabel, suggestNote } from "./evidence";

describe("evidence vault copy", () => {
  it("names where a claim comes from, and says when the source is gone", () => {
    expect(sourceLabel({ source_kind: "manual", source_title: "", source_id: null })).toBe("In your own words");
    expect(sourceLabel({ source_kind: "story", source_title: "Launch conflict", source_id: "s1" })).toBe("Story: Launch conflict");
    expect(sourceLabel({ source_kind: "story", source_title: "Launch conflict", source_id: null })).toBe("Story: Launch conflict (since deleted)");
    expect(sourceLabel({ source_kind: "resume", source_title: "", source_id: "d1" })).toBe("Resume: your resume");
  });

  it("says how many to check and why some were left out", () => {
    expect(suggestNote(3, 0)).toBe("3 new claims to check below.");
    expect(suggestNote(1, 1)).toMatch(/^1 new claim to check below\. 1 left out because the source doesn't say it word for word/);
    expect(suggestNote(0, 2)).toMatch(/^No new claims/);
  });
});
