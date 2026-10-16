import { describe, expect, it } from "vitest";
import { allNavItems, exploreItems, navGroups, phoneTabs, sidebarCollapsed } from "./nav";

describe("app navigation", () => {
  it("groups the tools by task, every tool once", () => {
    expect(navGroups(true).map((g) => g.label)).toEqual([null, "Prepare", "Apply", "Interview & offer"]);
    const ids = allNavItems(true).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["home", "practice", "video", "resume", "learning", "jobs", "linkedin", "copilot", "offer"]);
  });

  it("gives phones five destinations: four tabs and Explore with the rest", () => {
    expect(phoneTabs(true).map((t) => t.id)).toEqual(["home", "jobs", "resume", "practice"]);
    expect(exploreItems(true).map((t) => t.id)).toEqual(["video", "learning", "linkedin", "copilot", "offer"]);
    // Mock interviews off: the copilot takes Practice's tab, and nothing is lost.
    expect(phoneTabs(false).map((t) => t.id)).toEqual(["home", "jobs", "resume", "copilot"]);
    expect([...phoneTabs(false), ...exploreItems(false)].length).toBe(allNavItems(false).length);
  });

  it("marks the right item current, deep links included", () => {
    const current = (p: string) => allNavItems(true).filter((i) => i.current(p)).map((i) => i.id);
    expect(current("/")).toEqual(["home"]);
    expect(current("/documents/stories")).toEqual(["copilot"]);
    expect(current("/code/two-sum")).toEqual(["learning"]);
    expect(current("/mock")).toEqual(["practice"]);
    expect(current("/interview")).toEqual(["video"]);
  });

  it("remembers the sidebar choice, otherwise collapses on narrower screens", () => {
    expect(sidebarCollapsed(null, 1024)).toBe(true);
    expect(sidebarCollapsed(null, 1440)).toBe(false);
    expect(sidebarCollapsed("expanded", 1024)).toBe(false);
    expect(sidebarCollapsed("collapsed", 1920)).toBe(true);
  });
});
