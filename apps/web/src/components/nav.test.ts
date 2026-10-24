import { describe, expect, it } from "vitest";
import { allNavItems, exploreItems, navGroups, phoneTabs, sidebarCollapsed } from "./nav";

describe("app navigation", () => {
  it("has four task destinations with specialist tools behind More", () => {
    expect(navGroups(true)[0]!.items.map((i) => i.label)).toEqual(["Today", "Job Search", "Interview Prep", "My Career"]);
    // The main AI tools by name, right under the tasks.
    expect(navGroups(true)[1]!.items.map((i) => i.id)).toEqual(expect.arrayContaining(["auto-apply", "resume", "all-tools"]));
    const ids = allNavItems(true).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("resume"); expect(ids).toContain("copilot");
  });
  it("uses the same four phone tasks with every specialist available in More", () => {
    expect(phoneTabs(true).map((t) => t.id)).toEqual(["home", "jobs", "resume", "prepare", "career"]);
    expect(phoneTabs(false).map((t) => t.id)).toEqual(phoneTabs(true).map((t) => t.id));
    expect(exploreItems(true).map((t) => t.id)).toContain("linkedin");
    expect(exploreItems(false).map((t) => t.id)).not.toContain("practice");
    expect([...phoneTabs(false), ...exploreItems(false)].length).toBe(allNavItems(false).length);
  });
  it("highlights exactly one primary task for contextual deep links", () => {
    // Across the whole sidebar (tasks and AI tools), one item is lit.
    const current = (p: string) => navGroups(true).flatMap((g) => g.items).filter((i) => i.current(p)).map((i) => i.id);
    expect(current("/")).toEqual(["home"]);
    expect(current("/jobs/listing/example")).toEqual(["jobs"]);
    expect(current("/jobs/mission/example")).toEqual(["jobs"]);
    expect(current("/jobs/applications")).toEqual(["auto-apply"]);
    expect(current("/jobs/journey")).toEqual(["auto-apply"]);
    expect(current("/toolkit")).toEqual(["all-tools"]);
    expect(current("/jobs/matches")).toEqual(["jobs"]);
    expect(current("/code/two-sum")).toEqual(["prepare"]);
    expect(current("/mock")).toEqual(["practice"]);
    expect(current("/interview")).toEqual(["prepare"]);
    expect(current("/resume-ai/example")).toEqual(["resume"]);
    expect(current("/offers/example")).toEqual(["offer"]);
  });
  it("remembers the sidebar choice, otherwise collapses on narrower screens", () => {
    expect(sidebarCollapsed(null, 1024)).toBe(true);
    expect(sidebarCollapsed(null, 1440)).toBe(false);
    expect(sidebarCollapsed("expanded", 1024)).toBe(false);
    expect(sidebarCollapsed("collapsed", 1920)).toBe(true);
  });
});

describe("the offer tool's mark", () => {
  it("is the rupee in India and money in general elsewhere", async () => {
    const { BadgeIndianRupee, Banknote } = await import("@orbit/ui");
    const offer = (country?: string) => allNavItems(true, country).find((i) => i.id === "offer")!;
    expect(offer().icon).toBe(BadgeIndianRupee);
    expect(offer("IN").icon).toBe(BadgeIndianRupee);
    expect(offer("US").icon).toBe(Banknote);
    expect(exploreItems(true, "GB").find((i) => i.id === "offer")?.icon).toBe(Banknote);
    expect(navGroups(true, "US").map((g) => g.items.map((i) => i.id))).toEqual(navGroups(true).map((g) => g.items.map((i) => i.id)));
  });
});
