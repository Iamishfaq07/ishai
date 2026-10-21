import { JOBS_APPLICATIONS, JOBS_AUTO_APPLY, JOBS_MATCHES, JOBS_OUTREACH, JOBS_PROFILE, JOBS_TRACKER } from "./paths";

export const JOB_WORKSPACES = [
  // The launchpad and daily actions merged into Today ("/"); /jobs and /jobs/actions redirect there.
  { id: "today", label: "Today", to: "/", paths: /^\/jobs(?:\/(?:actions|weekly))?\/?$/ },
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
  { group: "today", to: "/", label: "Today", description: "Your next step, due interviews, follow-ups and applications to review.", keywords: "overview action desk daily actions launchpad calendar follow up reminders fresher graduate student first job" },
  { group: "today", to: "/jobs?work=updates", label: "Employer message helper", description: "Review pasted replies, then confirm stage or interview-date changes.", keywords: "email recruiter inbox reply classification messages updates received rejected offer interview" },
  { group: "today", to: "/jobs?work=resume", label: "Guided resume", description: "Add, import or edit your resume one section at a time.", keywords: "fresher student education projects skills builder editing" },
  { group: "today", to: "/jobs?work=plan", label: "Next-step companion", description: "Get an AI plan grounded in your saved career activity.", keywords: "coach automatic guidance resume progress hired journey" },
  { group: "today", to: "/jobs/weekly", label: "Weekly plan", description: "Set targets and review your recorded progress.", keywords: "weekly studio goals experiment" },
  { group: "find", to: JOBS_MATCHES, label: "Matches", description: "Discover jobs, check fit and save your shortlist.", keywords: "search listings openings" },
  { group: "find", to: JOBS_PROFILE, label: "Search preferences", description: "Choose your resume, roles, locations and job filters.", keywords: "profile settings skills" },
  { group: "applications", to: JOBS_TRACKER, label: "Tracker", description: "Open one job's connected resume, requirements, practice, application and outcome steps.", keywords: "mission practice company evidence fit timeline learning workshop project story interview replay review rounds tools source" },
  { group: "applications", to: "/jobs/journey", label: "Auto-apply", description: "Orbit finds matching jobs, prepares each application and sends what it can.", keywords: "application agent hosted automatic apply for me" },
  { group: "applications", to: JOBS_APPLICATIONS, label: "Needs you", description: "Applications to approve, answer or send, with receipts for the ones sent.", keywords: "review queue inbox search filter statuses receipts packets sent approval answers send yourself" },
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
  const tools = JOB_TOOLS.filter((tool) => tool.group === group && !["/", JOBS_AUTO_APPLY, JOBS_OUTREACH].includes(tool.to) && !tool.to.includes("?"));
  // People (outreach and referrals) belongs to applying; with the area tabs gone it lives beside the tracker.
  if (group === "applications") return [...tools, { group, to: JOBS_OUTREACH, label: "People", description: "", keywords: "" }];
  return tools;
}

export function currentJobTool(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  if (path.startsWith("/jobs/mission/")) return JOBS_TRACKER;
  if (path.startsWith("/jobs/listing/")) return JOBS_MATCHES;
  if (path === JOBS_AUTO_APPLY) return "/jobs/journey";
  return path;
}
