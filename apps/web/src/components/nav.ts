import { BadgeIndianRupee, Banknote, GraduationCap, House, INDIA, IdCard, MOCK_INTERVIEW_ENABLED, Video, isIndia, type LucideIcon } from "@orbit/ui";
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
  id: "practice", to: "/mock", label: "Practice", icon: PRODUCTS.practice.icon, product: "practice",
  current: (p) => /^\/mock(\/|$)/.test(p),
};
// The AI video interview: a face-to-face practice call with the AI interviewer (pages/VideoInterview.tsx).
const VIDEO: NavItem = { id: "video", to: "/interview", label: "Video interview", icon: Video, current: (p) => p === "/interview" };
const RESUME: NavItem = {
  id: "resume", to: RESUME_AI_HOME, label: "Resume", tab: "Resume", icon: PRODUCTS.resume.icon, product: "resume",
  current: under(RESUME_AI_HOME),
};
const LEARNING: NavItem = { id: "learning", to: LEARN_HOME, label: "Learning", icon: GraduationCap, current: (p) => LEARNING_PATH.test(p) };
const JOBS: NavItem = {
  id: "jobs", to: JOBS_AI_HOME, label: "Career launchpad", tab: "Career", icon: PRODUCTS.jobs.icon, product: "jobs",
  current: under(JOBS_AI_HOME),
};
const LINKEDIN: NavItem = { id: "linkedin", to: LINKEDIN_HOME, label: "LinkedIn", icon: IdCard, current: under(LINKEDIN_HOME) };
const COPILOT: NavItem = {
  id: "copilot", to: "/sessions", label: "Copilot", tab: "Copilot", icon: PRODUCTS.interview.icon, product: "interview",
  current: (p) => COPILOT_PATH.test(p),
};
const OFFER: NavItem = { id: "offer", to: OFFERS_HOME, label: "Offers", icon: BadgeIndianRupee, current: under(OFFERS_HOME) };
// Outside India, the offer tool's mark is money in general, not the rupee.
const OFFER_WORLD: NavItem = { ...OFFER, icon: Banknote };

/** The sidebar, top to bottom. Practice only when mock interviews are switched on. `country`: where the user applies. */
export function navGroups(mock: boolean = MOCK_INTERVIEW_ENABLED, country: string = INDIA): NavGroup[] {
  const offer = isIndia(country) ? OFFER : OFFER_WORLD;
  return [
    { label: null, items: [HOME, JOBS, { id: "tools", to: "/tools", label: "Explore tools", icon: House, current: under("/tools") }] },
    { label: "Prepare", items: [...(mock ? [PRACTICE, VIDEO] : []), RESUME, LEARNING, LINKEDIN] },
    { label: "Interview & offer", items: [COPILOT, offer] },
  ];
}

export function allNavItems(mock: boolean = MOCK_INTERVIEW_ENABLED, country: string = INDIA): NavItem[] {
  return navGroups(mock, country).flatMap((g) => g.items);
}

/** Phones: four tabs and Explore (five destinations). Practice is the fourth, or the copilot when mock is off. */
export function phoneTabs(mock: boolean = MOCK_INTERVIEW_ENABLED): NavItem[] {
  return [HOME, JOBS, RESUME, mock ? PRACTICE : COPILOT];
}

/** Everything else, in the Explore sheet (in the sidebar's order). */
export function exploreItems(mock: boolean = MOCK_INTERVIEW_ENABLED, country: string = INDIA): NavItem[] {
  const tabs = new Set(phoneTabs(mock).map((t) => t.id));
  return allNavItems(mock, country).filter((i) => !tabs.has(i.id));
}

/** The sidebar's state on this device; with no choice yet, collapsed on narrower screens. */
export const SIDEBAR_KEY = "orbit.sidebar";
export function sidebarCollapsed(saved: string | null, width: number): boolean {
  if (saved === "collapsed") return true;
  if (saved === "expanded") return false;
  return width < 1280;
}
