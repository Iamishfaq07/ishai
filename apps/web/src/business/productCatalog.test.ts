import { describe, expect, it } from "vitest";
import type { BizCompany, BizPermissions } from "@orbit/types";
import { BUSINESS_TOOLS, ROLLOUT_GOALS, canOpenTool, findTools, requestedBusinessTool, rolloutGoal, rolloutMarkdown } from "./productCatalog";

const permissions: BizPermissions = { manage_company: false, manage_members: false, manage_plan: false, manage_jobs: false, all_jobs: false, move_applicants: false, delete_applicants: false, view_audit: false, scorecards_only: true };
const interviewer: Pick<BizCompany, "role" | "permissions"> = { role: "interviewer", permissions };

describe("Business tool discovery and rollout", () => {
  it("keeps untrusted chooser input within the registered workspace set", () => {
    for (const tool of BUSINESS_TOOLS) expect(requestedBusinessTool(tool.path)).toBe(tool.path);
    expect(requestedBusinessTool("launchpad")).toBe("launchpad");
    for (const input of [null, "https://example.com", "//example.com", "../settings", "jobs/../../admin", "jobs?company=elsewhere", "talent%2F..", "constructor"]) expect(requestedBusinessTool(input)).toBe("");
  });
  it("keeps restricted directory links out of interviewer discovery", () => {
    const visible = BUSINESS_TOOLS.filter(tool => canOpenTool(tool, interviewer)).map(tool => tool.path);
    expect(visible).toEqual(["jobs", "hiring-desk", "knowledge", "knowledge-reading"]);
    const coordinator = { role: "recruiter" as const, permissions: { ...permissions, move_applicants: true, all_jobs: true } };
    expect(BUSINESS_TOOLS.filter(tool => canOpenTool(tool, coordinator)).map(tool => tool.path)).toContain("workflow-reviews");
    expect(BUSINESS_TOOLS.filter(tool => canOpenTool(tool, coordinator)).map(tool => tool.path)).not.toContain("knowledge-reviews");
  });
  it("combines all query terms with the selected work category", () => {
    expect(findTools("  independent   REVIEW ", "Coordinate").map(tool => tool.path)).toEqual(["workflow-studio"]);
    expect(findTools("sources that do not exist", "Plan")).toEqual([]);
    expect(findTools("", "Learn").some(tool => tool.path === "experience")).toBe(true);
    expect(findTools("cited").map(tool => tool.path)).toEqual(["knowledge"]);
    expect(findTools("AI").map(tool => tool.path)).toEqual(BUSINESS_TOOLS.filter(tool => tool.ai).map(tool => tool.path));
  });
  it("falls back from malformed goal URLs and gives every step a shipped workspace", () => {
    expect(rolloutGoal("__proto__").id).toBe("launch");
    expect(rolloutGoal(null).id).toBe("launch");
    expect(new Set(BUSINESS_TOOLS.map(tool => tool.path)).size).toBe(BUSINESS_TOOLS.length);
    for (const goal of ROLLOUT_GOALS) for (const step of goal.steps) expect(BUSINESS_TOOLS.some(tool => tool.path === step.tool)).toBe(true);
  });
  it("exports only the selected goal's checkmarks with explicit self-reporting limits", () => {
    const output = rolloutMarkdown(rolloutGoal("community"), ["launch:0", "community:2"]);
    expect(output).toContain("## [ ] 1. Define the community purpose");
    expect(output).toContain("## [x] 3. Review role suggestions");
    expect(output).not.toContain("Agree on the hiring need");
    expect(output).toContain("Completion is self-reported");
    expect(output).toContain("curated templates, not a model");
  });
});
