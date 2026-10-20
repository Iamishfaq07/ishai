import { describe, expect, it } from "vitest";
import { filterTools, STAGES, TOOLS } from "./catalog";

describe("tool discovery", () => {
  it("finds hosted applying by the platform people search for", () => {
    for (const query of ["workday", "auto apply", "autoapply", "no extension", "browser closed"]) {
      expect(filterTools("personal", query, "all", "all").map((t) => t.id)).toEqual(["agent"]);
    }
  });
  it("combines workflow, search and automation filters", () => {
    expect(filterTools("personal", "workday", "apply", "automation").map((t) => t.id)).toEqual(["agent"]);
    expect(filterTools("business", "reminders", "apply", "automation").map((t) => t.id)).toEqual(["automation"]);
    expect(filterTools("personal", "nothing matches this search", "all", "all")).toEqual([]);
  });
  it("has tools at every step for both audiences and links business tools through company selection", () => {
    for (const audience of ["personal", "business"] as const) {
      for (const stage of STAGES) expect(filterTools(audience, "", stage.id, "all").length).toBeGreaterThan(0);
    }
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(TOOLS.filter((t) => t.audience === "business").every((t) => t.href.startsWith("/business/app?tool="))).toBe(true);
  });
});
