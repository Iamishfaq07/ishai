import { JOBS_AI_HOME, JOBS_APPLICATIONS, JOBS_AUTO_APPLY, JOBS_MATCHES, JOBS_OUTREACH, JOBS_PROFILE, JOBS_TRACKER } from "./paths";

export const JOB_WORKSPACES = [
  { id: "today", label: "Launchpad", to: JOBS_AI_HOME, paths: /^\/jobs(?:\/(?:actions|weekly))?\/?$/ },
  { id: "find", label: "Find jobs", to: JOBS_MATCHES, paths: /^\/jobs\/(?:matches|profile|listing(?:\/[^/]+)?)\/?$/ },
  { id: "applications", label: "Applications", to: JOBS_TRACKER, paths: /^\/jobs\/(?:tracker|applications|auto-apply|journey|mission(?:\/[^/]+)?)\/?$/ },
  { id: "people", label: "People", to: JOBS_OUTREACH, paths: /^\/jobs\/outreach\/?$/ },
] as const;
export type JobWorkspace = typeof JOB_WORKSPACES[number]["id"];

/** One home per task; old addresses remain valid and map to exactly one area. */
export function jobWorkspace(path: string) {
  return JOB_WORKSPACES.find((group) => group.paths.test(path));
}

export const JOB_TOOLS: { group: JobWorkspace; to: string; label: string; description: string; keywords: string }[] = [
  { group: "today", to: JOBS_AI_HOME, label: "Career launchpad", description: "Start a resume, explore roles with AI and review your search setup.", keywords: "fresher graduate student first job entry level internship career change learning projects" },
  { group: "today", to: "/jobs/actions", label: "Daily actions", description: "Due interviews, reminders and an AI brief from your saved activity.", keywords: "overview action desk calendar follow up" },
  { group: "today", to: "/jobs/weekly", label: "Weekly plan", description: "Set targets and review your recorded progress.", keywords: "weekly studio goals experiment" },
  { group: "find", to: JOBS_MATCHES, label: "Matches", description: "Discover jobs, check fit and save your shortlist.", keywords: "search listings openings" },
  { group: "find", to: JOBS_PROFILE, label: "Search preferences", description: "Choose your resume, roles, locations and job filters.", keywords: "profile settings skills" },
  { group: "applications", to: JOBS_TRACKER, label: "Tracker", description: "Track jobs and open each job's resume, interview prep or offer.", keywords: "mission practice company evidence fit timeline" },
  { group: "applications", to: "/jobs/journey", label: "Auto-apply agent", description: "Prepare your shortlist and manage application automation.", keywords: "application agent hosted browser closed" },
  { group: "applications", to: JOBS_APPLICATIONS, label: "Review queue", description: "Find applications, review materials, check outcomes and resolve requests for your input.", keywords: "inbox search filter statuses receipts packets sent approval answers" },
  { group: "applications", to: JOBS_AUTO_APPLY, label: "Auto-apply settings", description: "Approve your facts, limits, consent and execution mode.", keywords: "setup resume answers bank permissions" },
  { group: "people", to: `${JOBS_OUTREACH}?network=1`, label: "Contact finder", description: "Research people at a company and review their source evidence.", keywords: "career ops recruiter referral hiring manager" },
  { group: "people", to: `${JOBS_OUTREACH}?view=messages`, label: "Messages & profiles", description: "Draft outreach, follow-ups and LinkedIn or Naukri profiles.", keywords: "outreach email thank you resume" },
  { group: "people", to: JOBS_OUTREACH, label: "Saved people", description: "Keep contacts, notes and reminder dates together.", keywords: "network relationships contacts" },
];

export function findJobTools(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return JOB_TOOLS.filter((tool) => words.every((word) => `${tool.label} ${tool.description} ${tool.keywords}`.toLowerCase().includes(word)));
}

/** Secondary navigation contains only the frequent tools for the current area. */
export function workspaceTools(group: JobWorkspace) {
  return JOB_TOOLS.filter((tool) => tool.group === group && ![JOBS_AI_HOME, JOBS_AUTO_APPLY, JOBS_OUTREACH].includes(tool.to) && !tool.to.includes("?"));
}

export function currentJobTool(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  if (path.startsWith("/jobs/mission/")) return JOBS_TRACKER;
  if (path.startsWith("/jobs/listing/")) return JOBS_MATCHES;
  if (path === JOBS_AUTO_APPLY) return "/jobs/journey";
  return path;
}
