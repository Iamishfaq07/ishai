import { describe, expect, it } from "vitest";
import type { BizPermissions } from "@orbit/types";
import { businessNavItems, currentBusinessWorkspace } from "./navigation";

const restricted: BizPermissions = { manage_company: false, manage_members: false, manage_plan: false, manage_jobs: false, all_jobs: false, move_applicants: false, delete_applicants: false, view_audit: false, scorecards_only: true };
const interviewer = { role: "interviewer" as const, permissions: restricted };
const owner = { role: "owner" as const, permissions: Object.fromEntries(Object.keys(restricted).map(key => [key, true])) as unknown as BizPermissions };

describe("Business workspace discovery", () => {
  it("keeps the established role gates in grouped navigation and search", () => {
    expect(businessNavItems(interviewer).map(item => item.to)).toEqual(["", "launchpad", "jobs", "hiring-desk", "knowledge", "knowledge-reading", "team"]);
    expect(businessNavItems(interviewer, "talent")).toEqual([]);
    expect(businessNavItems(owner)).toHaveLength(19);
    const manager = { role: "hiring_manager" as const, permissions: { ...restricted, move_applicants: true } };
    expect(businessNavItems(manager).map(item => item.to)).toContain("capacity");
    expect(businessNavItems(manager).map(item => item.to)).not.toContain("talent");
    expect(businessNavItems(manager).map(item => item.to)).not.toContain("settings");
  });
  it("searches label and purpose group without widening access", () => {
    expect(businessNavItems(owner, "  POLICY ").map(item => item.to)).toEqual(["knowledge-reviews"]);
    expect(businessNavItems(owner, "coordination review").map(item => item.to)).toEqual(["workflow-reviews"]);
    expect(businessNavItems(interviewer, "Company").map(item => item.to)).toEqual(["team"]);
  });
  it("uses path boundaries for nested job pages and keeps the dashboard exact", () => {
    const items = businessNavItems(owner);
    expect(currentBusinessWorkspace("jobs/role-id/edit", items)?.to).toBe("jobs");
    expect(currentBusinessWorkspace("", items)?.to).toBe("");
    expect(currentBusinessWorkspace("jobs-elsewhere", items)).toBeUndefined();
    expect(currentBusinessWorkspace("workflow-reviews", items)?.to).toBe("workflow-reviews");
  });
});
