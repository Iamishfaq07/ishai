import type { BizCompany } from "@orbit/types";

export const BUSINESS_NAV_GROUPS = ["Overview", "Hiring", "Coordination", "Relationships", "Knowledge", "Company"] as const;
type Access = "member" | "coordinator" | "non_interviewer" | "all_jobs" | "manage_company" | "view_audit" | "admin";
export interface BusinessNavItem { to: string; label: string; group: typeof BUSINESS_NAV_GROUPS[number]; access: Access }
export const BUSINESS_NAV: readonly BusinessNavItem[] = [
  { to: "", label: "Dashboard", group: "Overview", access: "member" },
  { to: "launchpad", label: "Business launchpad", group: "Overview", access: "member" },
  { to: "control-room", label: "Control room", group: "Overview", access: "non_interviewer" },
  { to: "jobs", label: "Jobs", group: "Hiring", access: "member" },
  { to: "requisitions", label: "Hiring requests", group: "Hiring", access: "non_interviewer" },
  { to: "capacity", label: "Hiring capacity", group: "Hiring", access: "non_interviewer" },
  { to: "hiring-desk", label: "Hiring desk", group: "Hiring", access: "member" },
  { to: "workflow-reviews", label: "Review inbox", group: "Coordination", access: "coordinator" },
  { to: "workflow-studio", label: "Workflow Studio", group: "Coordination", access: "coordinator" },
  { to: "automations", label: "Automations", group: "Coordination", access: "coordinator" },
  { to: "talent", label: "Talent communities", group: "Relationships", access: "all_jobs" },
  { to: "experience", label: "Candidate experience", group: "Relationships", access: "coordinator" },
  { to: "knowledge", label: "Knowledge studio", group: "Knowledge", access: "member" },
  { to: "knowledge-reading", label: "Team reading", group: "Knowledge", access: "member" },
  { to: "knowledge-reviews", label: "Policy reviews", group: "Knowledge", access: "manage_company" },
  { to: "team", label: "Team", group: "Company", access: "member" },
  { to: "settings", label: "Settings", group: "Company", access: "manage_company" },
  { to: "plan", label: "Plan", group: "Company", access: "admin" },
  { to: "audit", label: "Audit log", group: "Company", access: "view_audit" },
];

/** Discovery preserves the existing shell's role rules. Each destination's API remains authoritative. */
export function businessNavItems(company: Pick<BizCompany, "role" | "permissions">, query = ""): BusinessNavItem[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return BUSINESS_NAV.filter(item => {
    const allowed = item.access === "member" ? true : item.access === "coordinator" ? company.permissions.move_applicants
      : item.access === "non_interviewer" ? company.role !== "interviewer"
      : item.access === "admin" ? company.role === "owner" || company.role === "admin" : company.permissions[item.access];
    return allowed && terms.every(term => `${item.label} ${item.group}`.toLowerCase().includes(term));
  });
}

export function currentBusinessWorkspace(relativePath: string, items: readonly BusinessNavItem[]): BusinessNavItem | undefined {
  return [...items].sort((a, b) => b.to.length - a.to.length).find(item => item.to
    ? relativePath === item.to || relativePath.startsWith(`${item.to}/`) : relativePath === "");
}
