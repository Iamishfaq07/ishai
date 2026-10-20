export type Audience = "personal" | "business";
export type Stage = "prepare" | "apply" | "interview" | "hire";
export interface Tool {
  id: string; name: string; line: string; detail: string; audience: Audience; stage: Stage;
  href: string; label: string; ai?: boolean; automation?: boolean;
  keywords?: string[];
}
const company = (tool: string) => `/business/app?tool=${encodeURIComponent(tool)}`;
export const TOOLS: Tool[] = [
  { id: "playbook", name: "Follow-up playbook", line: "Keep the next step from slipping away.", detail: "Opt in to application follow-ups and interview preparation windows from your saved records. New actions feed your AI brief; no messages are sent.", audience: "personal", stage: "apply", href: "/jobs/actions", label: "Configure follow-up rules", automation: true },
  { id: "resume", name: "Resume", line: "Turn experience into a clear first impression.", detail: "Build or import a resume, check ATS readability, and review truthful changes per role.", audience: "personal", stage: "prepare", href: "/resume-ai", label: "Build your resume", ai: true },
  { id: "matches", name: "Job matches", line: "Find roles with reasons you can inspect.", detail: "Search employer feeds, compare skills and save a shortlist. External boards open their own search.", audience: "personal", stage: "apply", href: "/jobs/matches", label: "Find matches", ai: true },
  { id: "agent", name: "Application agent", line: "Keep eligible applications moving with your device off.", detail: "Hosted applying supports Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Workable and Recruitee. Needs an online worker and your consent; employer checks may need you.", audience: "personal", stage: "apply", href: "/jobs/journey", label: "Open your agent", ai: true, automation: true, keywords: ["auto apply", "autoapply", "automatic applications", "no extension", "browser closed", "background"] },
  { id: "review", name: "Application second reader", line: "Get a fresh pair of eyes before you send.", detail: "Open a prepared application for AI suggestions with exact quotes from your own materials. Advice never approves an application.", audience: "personal", stage: "apply", href: "/jobs/applications", label: "Review application materials", ai: true },
  { id: "weekly", name: "Weekly studio", line: "Make the next week manageable.", detail: "Set goals, see recorded progress and ask for an AI experiment to improve your approach.", audience: "personal", stage: "prepare", href: "/jobs/weekly", label: "Plan your week", ai: true },
  { id: "network", name: "Job contact finder", line: "Find a person behind the posting.", detail: "Check saved company contacts, research public leads with source excerpts, capture a recruiter reply and prepare a personal outreach draft. Live search requires a configured provider; nothing is sent automatically.", audience: "personal", stage: "apply", href: "/jobs/outreach?network=1", label: "Find job contacts", ai: true, automation: true, keywords: ["recruiter", "hiring manager", "contacts", "network", "career ops"] },
  { id: "actions", name: "Action desk", line: "Know what needs your attention next.", detail: "See due interviews, follow-ups and blocked application packets, with calendar export and an optional AI brief.", audience: "personal", stage: "apply", href: "/jobs/actions", label: "See next actions", ai: true, automation: true },
  { id: "outreach", name: "Outreach studio", line: "Write messages grounded in your experience.", detail: "Prepare referrals, recruiter notes and follow-ups. You review and send the messages yourself.", audience: "personal", stage: "apply", href: "/jobs/outreach", label: "Draft outreach", ai: true },
  { id: "saba", name: "Practice with Saba", line: "Rehearse the interview before the interview.", detail: "Practice role-specific questions and review feedback from your session.", audience: "personal", stage: "interview", href: "/mock", label: "Start practice", ai: true },
  { id: "learn", name: "Learning", line: "Build evidence for your next role.", detail: "Work through a focused learning path and practice useful skills.", audience: "personal", stage: "prepare", href: "/learn", label: "Explore learning", ai: true },
  { id: "offers", name: "Offer workspace", line: "Understand the decision in front of you.", detail: "Review offer terms and prepare negotiation drafts. Confirm details directly with the employer.", audience: "personal", stage: "hire", href: "/offers", label: "Review offers", ai: true },
  { id: "post", name: "Job publishing", line: "Start with a clear role and a public careers page.", detail: "Draft requirements, verify your company, and publish roles for candidates to discover and apply.", audience: "business", stage: "prepare", href: company("jobs/new"), label: "Create a role" },
  { id: "control", name: "Hiring control room", line: "Spot the bottleneck before the week runs away.", detail: "Review role readiness, pipeline age and panel capacity. Get an AI brief from aggregate operational facts.", audience: "business", stage: "apply", href: company("control-room"), label: "Open control room", ai: true },
  { id: "automation", name: "Hiring automations", line: "Turn due work into visible team tasks.", detail: "Configure opt-in reminders and interview preparation tasks. See what ran and resolve issues from the source.", audience: "business", stage: "apply", href: company("automations"), label: "Configure automations", automation: true },
  { id: "pipeline", name: "Candidate pipeline", line: "Keep every candidate and next step in view.", detail: "Open a role to review applicants, evidence, stages and structured comparisons. A person makes hiring decisions.", audience: "business", stage: "apply", href: company("jobs"), label: "Review roles and applicants", ai: true },
  { id: "business-saba", name: "Business interview workspace", line: "Bring Saba into structured hiring interviews.", detail: "Open a candidate from the hiring desk to prepare and run an interview, with agreed criteria and human review.", audience: "business", stage: "interview", href: company("hiring-desk"), label: "Open hiring desk", ai: true },
  { id: "interview-plan", name: "Interview plan composer", line: "Ask questions tied to the actual role.", detail: "Open a role’s interview plan, draft with AI from saved requirements, review, then save a versioned plan.", audience: "business", stage: "interview", href: company("jobs"), label: "Choose a role for its plan", ai: true },
  { id: "team", name: "Hiring team", line: "Give the right people the right access.", detail: "Invite teammates and assign company roles. Your personal Orbit materials stay private.", audience: "business", stage: "prepare", href: company("team"), label: "Manage your team" },
  { id: "decision", name: "Hiring decisions", line: "Keep evidence and decisions connected.", detail: "Review candidate records, structured interview feedback and the audit trail before recording an outcome.", audience: "business", stage: "hire", href: company("hiring-desk"), label: "Review hiring decisions" },
];

export const STAGES: Array<{ id: Stage; label: string; personal: string; business: string }> = [
  { id: "prepare", label: "Prepare", personal: "Build your source resume and plan", business: "Define the role and assemble the team" },
  { id: "apply", label: "Apply", personal: "Find matches and prepare applications", business: "Publish, review and move applicants" },
  { id: "interview", label: "Interview", personal: "Practice and prepare for each round", business: "Run structured interviews with your panel" },
  { id: "hire", label: "Next chapter", personal: "Review offers and confirm your role", business: "Review evidence and record a decision" },
];

export function filterTools(audience: Audience, query: string, stage: Stage | "all", kind: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return TOOLS.filter((tool) => tool.audience === audience && (stage === "all" || tool.stage === stage)
    && (kind !== "ai" || tool.ai) && (kind !== "automation" || tool.automation)
    && words.every((word) => `${tool.name} ${tool.line} ${tool.detail} ${(tool.keywords ?? []).join(" ")}`.toLowerCase().includes(word)));
}
