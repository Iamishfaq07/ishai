import { describe, expect, it } from "vitest";
import { currentJobTool, findJobTools, JOB_TOOLS, JOB_WORKSPACES, jobWorkspace, workspaceTools } from "./workspace";
import { MISSION_GROUPS, MISSION_TOOLS } from "./mission";

describe("Jobs task navigation", () => {
  it.each([
    ["/jobs", "today"], ["/jobs/actions/", "today"], ["/jobs/weekly", "today"],
    ["/jobs/matches", "find"], ["/jobs/profile/", "find"], ["/jobs/listing/a%2Fb", "find"],
    ["/jobs/tracker", "applications"], ["/jobs/mission/abc", "applications"],
    ["/jobs/journey", "applications"], ["/jobs/applications/", "applications"], ["/jobs/auto-apply", "applications"],
    ["/jobs/outreach/", "people"],
  ])("maps the existing deep link %s to one area", (path, group) => {
    expect(jobWorkspace(path)?.id).toBe(group);
    expect(JOB_WORKSPACES.filter((area) => area.paths.test(path))).toHaveLength(1);
  });

  it("does not select a misleading area for a different product or route prefix", () => {
    for (const path of ["/jobs-other", "/jobs/matches-other", "/jobs/outreach-old", "/business/jobs", "/jobs/mission/abc/more"]) {
      expect(jobWorkspace(path)).toBeUndefined();
    }
  });

  it("keeps old names and candidate goals discoverable", () => {
    expect(findJobTools(" action desk ").map((tool) => tool.label)).toEqual(["Daily actions"]);
    expect(findJobTools("weekly studio").map((tool) => tool.label)).toEqual(["Weekly plan"]);
    expect(findJobTools("INTERVIEW").map((tool) => tool.label)).toContain("Tracker");
    expect(findJobTools("recruiter").map((tool) => tool.label)).toContain("Contact finder");
    expect(findJobTools("unknown-tool")).toEqual([]);
    expect(findJobTools(" ")).toHaveLength(JOB_TOOLS.length);
  });

  it("keeps context links short and marks deep tools in their parent", () => {
    expect(workspaceTools("applications").map((tool) => tool.label)).toEqual(["Tracker", "Auto-apply agent", "Review queue"]);
    expect(currentJobTool("/jobs/auto-apply/")).toBe("/jobs/journey");
    expect(currentJobTool("/jobs/mission/a")).toBe("/jobs/tracker");
    expect(currentJobTool("/jobs/listing/a")).toBe("/jobs/matches");
    expect(currentJobTool("/jobs/actions")).toBe("/jobs/actions");
  });

  it("keeps every mission deep-link tool in exactly one task group", () => {
    expect(MISSION_TOOLS.map((tool) => tool.id).sort()).toEqual(["company", "fit", "interview", "offer", "plan", "practice", "resume", "timeline"]);
    for (const tool of MISSION_TOOLS) expect(MISSION_GROUPS.filter((group) => group.id === tool.group)).toHaveLength(1);
    for (const group of MISSION_GROUPS) expect(MISSION_TOOLS.find((tool) => tool.id === group.first)?.group).toBe(group.id);
  });
});
