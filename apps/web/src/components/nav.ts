import { BadgeIndianRupee, GraduationCap, House, IdCard, MOCK_INTERVIEW_ENABLED, type LucideIcon } from "@orbit/ui";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { LEARN_HOME } from "../pages/learn/links";
import { LINKEDIN_HOME } from "../pages/linkedin/model";
import { OFFERS_HOME } from "../pages/offers/model";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { PRODUCTS, type ProductId } from "./products";

/**
 * The signed-in app's navigation ("Career Mission Control"), in one place for the desktop sidebar, the phone tab bar
 * and the phone's Explore sheet. Grouped by the job to be done: prepare, apply, then interview and the offer. The
 * addresses are the ones the products always had, so no link or bookmark changes.
 */
export interface NavItem {
  id: string;
  to: string;
  label: string;
  /** The phone tab bar's label, when shorter. */
  tab?: string;
  icon: LucideIcon;
  product?: ProductId;
  /** An AI tool: shown with the AI mark at its top right. */
  ai?: true;
  /** Which addresses it's current on. */
  current: (pathname: string) => boolean;
}

export interface NavGroup {
  /** null: the ungrouped top (Home). */
  label: string | null;
  items: NavItem[];
}

const under = (home: string) => (p: string) => p === home || p.startsWith(`${home}/`);

export const COPILOT_PATH = /^\/(sessions|documents|start)(\/|$)/;
export const LEARNING_PATH = /^\/(learn|code)(\/|$)/;

const HOME: NavItem = { id: "home", to: "/", label: "Home", icon: House, current: (p) => p === "/" };
const PRACTICE: NavItem = {
  id: "practice", to: "/mock", label: "Practice", icon: PRODUCTS.practice.icon, product: "practice", ai: true,
  current: (p) => /^\/mock(\/|$)/.test(p),
};
const RESUME: NavItem = {
  id: "resume", to: RESUME_AI_HOME, label: "Resume AI", tab: "Resume", icon: PRODUCTS.resume.icon, product: "resume", ai: true,
  current: under(RESUME_AI_HOME),
};
const LEARNING: NavItem = { id: "learning", to: LEARN_HOME, label: "Learning AI", icon: GraduationCap, ai: true, current: (p) => LEARNING_PATH.test(p) };
const JOBS: NavItem = {
  id: "jobs", to: JOBS_AI_HOME, label: "Jobs AI", tab: "Jobs", icon: PRODUCTS.jobs.icon, product: "jobs", ai: true,
  current: under(JOBS_AI_HOME),
};
const LINKEDIN: NavItem = { id: "linkedin", to: LINKEDIN_HOME, label: "LinkedIn AI", icon: IdCard, ai: true, current: under(LINKEDIN_HOME) };
const COPILOT: NavItem = {
  id: "copilot", to: "/sessions", label: "Copilot AI", tab: "Copilot", icon: PRODUCTS.interview.icon, product: "interview", ai: true,
  current: (p) => COPILOT_PATH.test(p),
};
const OFFER: NavItem = { id: "offer", to: OFFERS_HOME, label: "Offer AI", icon: BadgeIndianRupee, ai: true, current: under(OFFERS_HOME) };

/** The sidebar, top to bottom. Practice only when mock interviews are switched on. */
export function navGroups(mock: boolean = MOCK_INTERVIEW_ENABLED): NavGroup[] {
  return [
    { label: null, items: [HOME] },
    { label: "Prepare", items: [...(mock ? [PRACTICE] : []), RESUME, LEARNING] },
    { label: "Apply", items: [JOBS, LINKEDIN] },
    { label: "Interview & offer", items: [COPILOT, OFFER] },
  ];
}

export function allNavItems(mock: boolean = MOCK_INTERVIEW_ENABLED): NavItem[] {
  return navGroups(mock).flatMap((g) => g.items);
}

/** Phones: four tabs and Explore (five destinations). Practice is the fourth, or the copilot when mock is off. */
export function phoneTabs(mock: boolean = MOCK_INTERVIEW_ENABLED): NavItem[] {
  return [HOME, JOBS, RESUME, mock ? PRACTICE : COPILOT];
}

/** Everything else, in the Explore sheet (in the sidebar's order). */
export function exploreItems(mock: boolean = MOCK_INTERVIEW_ENABLED): NavItem[] {
  const tabs = new Set(phoneTabs(mock).map((t) => t.id));
  return allNavItems(mock).filter((i) => !tabs.has(i.id));
}

/** The sidebar's state on this device; with no choice yet, collapsed on narrower screens. */
export const SIDEBAR_KEY = "orbit.sidebar";
export function sidebarCollapsed(saved: string | null, width: number): boolean {
  if (saved === "collapsed") return true;
  if (saved === "expanded") return false;
  return width < 1280;
}
