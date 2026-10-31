import type { BizCompany } from "@orbit/types";

export const TOOL_GROUPS = ["All tools", "Plan", "Attract", "Coordinate", "Learn"] as const;
export type ToolGroup = typeof TOOL_GROUPS[number];
type Access = "member" | "coordinator" | "all_jobs" | "manage_company" | "manage_members" | "view_audit";
export interface BusinessTool {
  path: string; name: string; group: Exclude<ToolGroup, "All tools">;
  description: string; ai?: string; access: Access;
}

/** Only shipped workspaces. Public discovery is descriptive; the API remains the authority for access and plans. */
export const BUSINESS_TOOLS: readonly BusinessTool[] = [
  { path: "requisitions", name: "Hiring requests", group: "Plan", description: "Build the case for a role, review budget intake and record an independent approval before a draft job handoff.", ai: "Quoted intake review", access: "coordinator" },
  { path: "capacity", name: "Hiring capacity", group: "Plan", description: "Compare approved headcount with confirmed hires and keep different currency envelopes separate.", ai: "Capacity summaries", access: "coordinator" },
  { path: "control-room", name: "Hiring control room", group: "Plan", description: "See role readiness, aging applications and the next seven days of booked panel commitments.", access: "coordinator" },
  { path: "jobs", name: "Jobs and careers pages", group: "Attract", description: "Publish verified company jobs with Google for Jobs markup and review resume evidence in a shared pipeline.", ai: "Job drafts and evidence ranking", access: "member" },
  { path: "talent", name: "Talent communities", group: "Attract", description: "Let candidates opt into a purpose and retention period. Search current profiles and suggest relevant open roles.", access: "all_jobs" },
  { path: "workflow-studio", name: "Workflow Studio", group: "Coordinate", description: "Build reusable playbooks with dependencies, owners, due offsets and independent review checkpoints.", ai: "Playbook drafts and progress briefs", access: "coordinator" },
  { path: "workflow-reviews", name: "Review inbox", group: "Coordinate", description: "Review frozen evidence, request changes, pause capped reminders or hand off to another eligible reviewer.", access: "coordinator" },
  { path: "hiring-desk", name: "Hiring desk", group: "Coordinate", description: "Coordinate interview plans, rooms, scorecards and evidence review around your hiring team.", access: "member" },
  { path: "automations", name: "Automation center", group: "Coordinate", description: "Set up internal follow-up tasks and inspect automation activity without automatic hiring decisions.", access: "coordinator" },
  { path: "team", name: "Team and roles", group: "Coordinate", description: "Invite your hiring team and assign roles with scoped responsibilities.", access: "manage_members" },
  { path: "knowledge", name: "Knowledge Studio", group: "Learn", description: "Import policy drafts from files, publish reviewed versions and ask questions with exact source quotes.", ai: "Cited answers and import review", access: "member" },
  { path: "knowledge-reading", name: "Team reading", group: "Learn", description: "Read published policies and record which published revision you acknowledged.", access: "member" },
  { path: "knowledge-reviews", name: "Policy reviews", group: "Learn", description: "Assign policy owners, schedule review dates and confirm public versions while keeping drafts separate.", access: "manage_company" },
  { path: "experience", name: "Candidate experience", group: "Learn", description: "Collect optional process feedback, report only qualifying groups and track reviewed improvements.", ai: "Aggregate feedback briefs", access: "coordinator" },
  { path: "audit", name: "Audit log", group: "Learn", description: "Trace recorded changes and decisions within your company workspace.", access: "view_audit" },
];

/** A chooser destination is always a known relative workspace, never user-supplied navigation. */
export function requestedBusinessTool(wanted: string | null): string {
  return wanted === "launchpad" || wanted === "jobs/new" || BUSINESS_TOOLS.some(tool => tool.path === wanted) ? wanted! : "";
}

export const ROLLOUT_GOALS = [
  { id: "launch", label: "Launch a role", headline: "A considered launch. A clearer first impression.", summary: "Align the request, prepare a role and give your team a shared launch checklist.", steps: [
    { tool: "requisitions", task: "Agree on the hiring need", owner: "Hiring manager", done: "An independent reviewer has approved the request and its budget intake." },
    { tool: "jobs", task: "Prepare the job and careers page", owner: "Recruiter", done: "Requirements and screening questions are reviewed; the company domain is verified before publication." },
    { tool: "workflow-studio", task: "Make launch responsibilities explicit", owner: "Recruiting lead", done: "A saved playbook names owners and dependencies; a separate reviewer owns the launch checkpoint." },
    { tool: "hiring-desk", task: "Align the interview team", owner: "Hiring manager", done: "The interview plan, scorecards and panel responsibilities have been reviewed." },
  ] },
  { id: "coordinate", label: "Unblock the team", headline: "Less chasing. More visible next steps.", summary: "Connect process signals to named owners, reviewed evidence and bounded follow-ups.", steps: [
    { tool: "control-room", task: "Find where work is waiting", owner: "Recruiting lead", done: "The team has reviewed aging stages, missing role setup and booked panel load." },
    { tool: "workflow-studio", task: "Build the shared playbook", owner: "Recruiter", done: "Each step has an owner and prerequisites; review checkpoints have independent reviewers." },
    { tool: "workflow-reviews", task: "Resolve review checkpoints", owner: "Independent reviewer", done: "The reviewer has read the frozen evidence and recorded a decision or requested changes." },
    { tool: "automations", task: "Set an internal follow-up rhythm", owner: "Recruiting lead", done: "Internal follow-up rules and their activity have been reviewed by the team." },
  ] },
  { id: "community", label: "Build a talent community", headline: "Stay connected, with permission.", summary: "Build a purpose-led community and connect interested candidates with relevant open roles.", steps: [
    { tool: "talent", task: "Define the community purpose", owner: "Company owner or admin", done: "The purpose and retention period are reviewed before inviting candidates to opt in." },
    { tool: "jobs", task: "Keep relevant roles current", owner: "Recruiter", done: "Published jobs are accurate and available; unsuitable or closed roles are removed." },
    { tool: "talent", task: "Review role suggestions", owner: "Recruiter", done: "Suggestions use current consented profiles; candidates choose whether to apply separately." },
    { tool: "experience", task: "Listen to the application process", owner: "Recruiting lead", done: "Optional feedback is reviewed through qualifying groups without changing hiring assessments." },
  ] },
  { id: "knowledge", label: "Align team knowledge", headline: "Shared knowledge. Sources you can inspect.", summary: "Turn policy files into reviewed publications, cited answers and a visible review rhythm.", steps: [
    { tool: "knowledge", task: "Import and review a policy draft", owner: "Policy editor", done: "Extracted text is checked against the source file and saved as an unpublished draft." },
    { tool: "knowledge", task: "Publish the reviewed version", owner: "Policy publisher", done: "A permitted publisher has checked the audience and published the intended version." },
    { tool: "knowledge-reading", task: "Read and acknowledge the publication", owner: "Team member", done: "The team reads the current published revision before recording acknowledgments." },
    { tool: "knowledge-reviews", task: "Assign the next policy review", owner: "Company owner or admin", done: "A policy owner and review date are set, with reminder settings reviewed." },
  ] },
] as const;
export type RolloutGoal = typeof ROLLOUT_GOALS[number];

export function rolloutGoal(id: string | null): RolloutGoal {
  return ROLLOUT_GOALS.find(goal => goal.id === id) ?? ROLLOUT_GOALS[0];
}

export function canOpenTool(tool: BusinessTool, company: Pick<BizCompany, "role" | "permissions">): boolean {
  switch (tool.access) {
    case "member": return true;
    case "coordinator": return company.permissions.move_applicants;
    default: return company.permissions[tool.access];
  }
}

export function findTools(query: string, group: ToolGroup = "All tools"): readonly BusinessTool[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return BUSINESS_TOOLS.filter(tool => (group === "All tools" || tool.group === group) && terms.every(term =>
    `${tool.name} ${tool.description} ${tool.ai ? `AI ${tool.ai}` : ""}`.toLocaleLowerCase().includes(term)));
}

export function rolloutMarkdown(goal: RolloutGoal, checked: readonly string[]): string {
  return ["# Orbit for Business rollout plan", "", `Goal: ${goal.label}`, "", goal.summary, "",
    "Planning checklist only. Completion is self-reported in this browser session; it does not verify or change company setup, approvals, permissions or plan limits.", "",
    ...goal.steps.flatMap((step, index) => [
      `## ${checked.includes(`${goal.id}:${index}`) ? "[x]" : "[ ]"} ${index + 1}. ${step.task}`,
      `Suggested owner: ${step.owner}`, `Ready when: ${step.done}`,
      `Workspace: ${BUSINESS_TOOLS.find(tool => tool.path === step.tool)!.name}`, "",
    ]), "AI outputs in Orbit are drafts or summaries for human review. This checklist uses curated templates, not a model.", ""].join("\n");
}
