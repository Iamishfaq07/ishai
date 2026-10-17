import {
  AudioLines,
  BadgeIndianRupee,
  Banknote,
  Briefcase,
  Code2,
  FileText,
  GraduationCap,
  IdCard,
  Target,
  type LucideIcon,
} from "@orbit/ui";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { RESUME_AI_HOME } from "../pages/resume/paths";

/**
 * The products as the public site names them: the header's Products menu, the phone menu and the footer read this one
 * list. The four main products have a section of the front page (or a page of their own); the other four tools sit in
 * the front page's "More in your account" section, each with its own anchor, so no menu link ends on a sign-in wall.
 */
export interface SiteProduct {
  id: "copilot" | "practice" | "resume" | "jobs" | "linkedin" | "code" | "offer" | "learning";
  name: string;
  /** One line: what it does for you. */
  line: string;
  href: string;
  icon: LucideIcon;
  /** The four main products wear their own colour on their mark; the others are ink. */
  main: boolean;
}

export function siteProducts(india: boolean): SiteProduct[] {
  return [
    { id: "copilot", name: "Interview copilot", line: "Live answers from your resume, in calls where AI help is allowed.", href: "/#copilot", icon: AudioLines, main: true },
    { id: "practice", name: "Practice", line: "Mock and video interviews with an AI interviewer, then a scorecard.", href: "/#practice", icon: Target, main: true },
    { id: "resume", name: "Resume AI", line: "An ATS score out of 100 and a tailored resume for every job.", href: RESUME_AI_HOME, icon: FileText, main: true },
    { id: "jobs", name: "Jobs AI", line: "New jobs that fit you, a tracker and messages for referrals.", href: JOBS_AI_HOME, icon: Briefcase, main: true },
    { id: "linkedin", name: "LinkedIn AI", line: "How your profile reads to a recruiter, and what to fix first.", href: "/#linkedin-ai", icon: IdCard, main: false },
    { id: "code", name: "Code AI", line: "Coding rounds by pattern: run the tests, then get a review.", href: "/#code-ai", icon: Code2, main: false },
    {
      id: "offer",
      name: "Offer AI",
      line: india ? "What an offer pays each month, and a plan to ask for more." : "What an offer is worth in year one, and how to ask for more.",
      href: "/#offer-ai",
      icon: india ? BadgeIndianRupee : Banknote,
      main: false,
    },
    { id: "learning", name: "Learning AI", line: "The skills interviews test, with free cybersecurity lessons.", href: "/#learning-ai", icon: GraduationCap, main: false },
  ];
}

/** The tile colour of a product's mark: the main four use the app's product colours (components/products.tsx). */
export const PRODUCT_TILE: Record<SiteProduct["id"], string> = {
  copilot: "bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-400/10 dark:text-indigo-200 dark:ring-indigo-300/20",
  practice: "bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-400/10 dark:text-orange-200 dark:ring-orange-300/20",
  resume: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/20",
  jobs: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20",
  linkedin: "bg-zinc-100 text-zinc-700 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10",
  code: "bg-zinc-100 text-zinc-700 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10",
  offer: "bg-zinc-100 text-zinc-700 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10",
  learning: "bg-zinc-100 text-zinc-700 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10",
};

/** The section links in the header and the footer. Router links: "/#pricing" scrolls once the front page is drawn. */
export const SITE_LINKS = {
  pricing: "/#pricing",
  security: "/#security",
  faq: "/#faq",
  howItWorks: "/technical",
  warmup: "/warmup",
  /** The question bank's guides (pages/bank): how companies interview, and what interviews for a job test. */
  companies: "/companies",
  roles: "/roles",
};
