import {
  BookOpen, BookmarkCheck, Brain, Briefcase, Building2, CalendarPlus, ClipboardCheck, Code2, FileText, Gauge, GraduationCap,
  Headphones, IdCard, ListChecks, MOCK_INTERVIEW_ENABLED, MessageSquareQuote, Mic, NotebookPen, Search, Send, ShieldCheck, Sparkles,
  Target, Users, UsersRound, Video, Wallet, Zap, Wand2, Route, MessagesSquare, LogOut,
} from "@orbit/ui";
import { TOOLS, type Tool } from "./catalog";

/** The signed-in tab each personal tool lives under. Tools are found where the task is, not in a separate catalogue. */
export type Home = "today" | "jobs" | "prepare" | "career" | "copilot";

const HOMES: Record<string, Home> = {
  playbook: "today", actions: "today", weekly: "today", "employer-updates": "today", "wrap-up": "today",
  matches: "jobs", agent: "jobs", review: "jobs", network: "jobs", outreach: "jobs", "auto-tailor": "jobs",
  "whats-working": "jobs", "skill-gaps": "jobs", "scam-check": "jobs", "first-look": "jobs", "first-90": "jobs",
  saba: "prepare", debrief: "prepare", pitch: "prepare", references: "prepare", promises: "prepare", learn: "prepare",
  stories: "prepare", "interview-checklist": "prepare", video: "prepare", warmup: "prepare", code: "prepare", aptitude: "prepare", "star-check": "prepare", priority: "jobs", "group-discussion": "prepare", readiness: "prepare", campus: "prepare",
  resume: "career", linkedin: "career", offers: "career", "decision-matrix": "career", "bullet-builder": "career", "career-gap": "career", "salary-scripts": "career", resign: "career", "offer-letter": "career", "github-projects": "career", "red-flags": "prepare",
  copilot: "copilot",
};

/** Each tool's icon; anything not listed falls back to its stage's icon. */
const TOOL_ICONS: Record<string, typeof Search> = {
  playbook: ListChecks, resume: FileText, matches: Search, agent: Zap, "employer-updates": MessageSquareQuote,
  review: ClipboardCheck, weekly: Gauge, network: Users, actions: CalendarPlus, outreach: Send, saba: Headphones,
  debrief: NotebookPen, "skill-gaps": Target, "first-look": Sparkles, "auto-tailor": FileText, "whats-working": Gauge,
  "first-90": Briefcase, pitch: Mic, references: UsersRound, promises: ClipboardCheck, learn: GraduationCap,
  offers: Wallet, "decision-matrix": ClipboardCheck, "interview-checklist": ClipboardCheck, aptitude: Brain, "star-check": ListChecks, priority: Gauge, "group-discussion": UsersRound, readiness: Gauge, campus: GraduationCap, "bullet-builder": Wand2, "career-gap": Route, "salary-scripts": MessagesSquare, resign: LogOut, "offer-letter": FileText, "github-projects": Code2, "red-flags": ShieldCheck, copilot: Sparkles, "scam-check": ShieldCheck, stories: BookOpen, video: Video, warmup: Zap, code: Code2, linkedin: IdCard,
  "wrap-up": BookmarkCheck, team: Users, pipeline: ListChecks, "interview-plan": NotebookPen, "business-saba": Headphones,
  decision: ClipboardCheck, post: Building2,
};
const STAGE_ICONS: Record<string, typeof Search> = { prepare: FileText, apply: Send, interview: Mic, hire: Briefcase };

export function toolIcon(tool: Tool): typeof Search {
  return TOOL_ICONS[tool.id] ?? STAGE_ICONS[tool.stage] ?? Sparkles;
}

/** The personal tools that live under one tab, minus the paths that tab already shows as its own cards or links. */
export function toolsFor(home: Home, shown: readonly string[] = []): Tool[] {
  const skip = new Set(shown.map((p) => p.split("?")[0]));
  return TOOLS.filter((t) => t.audience === "personal" && HOMES[t.id] === home
    && (MOCK_INTERVIEW_ENABLED || !["saba", "video"].includes(t.id))
    && !skip.has(t.href.split("?")[0]));
}
