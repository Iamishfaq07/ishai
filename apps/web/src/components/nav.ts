import { BadgeIndianRupee, Banknote, GraduationCap, House, INDIA, IdCard, MOCK_INTERVIEW_ENABLED, Video, Search, isIndia, type LucideIcon } from "@orbit/ui";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { LEARN_HOME } from "../pages/learn/links";
import { LINKEDIN_HOME } from "../pages/linkedin/model";
import { OFFERS_HOME } from "../pages/offers/model";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { PRODUCTS, type ProductId } from "./products";

/**
 * Five career tasks shared by the desktop sidebar and phone tab bar. Existing specialist routes remain
 * accessible through the More sheet and search; Prepare/My Career collect them in context.
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

const HOME: NavItem = { id: "home", to: "/", label: "Today", icon: House, current: (p) => p === "/" };
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

const DISCOVER: NavItem = { ...JOBS, label: "Discover", tab: "Discover", to: "/jobs/matches", icon: Search,
  current: (p) => /^\/jobs(?:\/(?:matches|profile|listing(?:\/[^/]+)?))?\/?$/.test(p) };
const APPLICATIONS: NavItem = { id: "applications", label: "Applications", tab: "Apply", to: "/jobs/tracker", icon: PRODUCTS.jobs.icon,
  current: (p) => /^\/jobs\/(tracker|mission|applications|journey|auto-apply|outreach)(\/|$)/.test(p) };
const PREPARE: NavItem = { id: "prepare", label: "Prepare", to: "/prepare", icon: PRODUCTS.practice.icon,
  current: (p) => /^\/(prepare|mock|interview|learn|code)(\/|$)/.test(p) };
const CAREER: NavItem = { id: "career", label: "My Career", tab: "Me", to: "/career", icon: IdCard,
  current: (p) => /^\/(career|resume-ai|linkedin|offers)(\/|$)/.test(p) };
const TOOLS: NavItem = { id: "tools", to: "/tools", label: "All tools", icon: House, current: under("/tools") };

/** Five task destinations; specialist tools remain available through More and search. */
export function navGroups(_mock: boolean = MOCK_INTERVIEW_ENABLED, _country: string = INDIA): NavGroup[] {
  return [{ label: null, items: [HOME, DISCOVER, APPLICATIONS, PREPARE, CAREER] }, { label: "More", items: [COPILOT, TOOLS] }];
}
export function allNavItems(mock: boolean = MOCK_INTERVIEW_ENABLED, country: string = INDIA): NavItem[] {
  return [...navGroups(mock, country).flatMap((g) => g.items), ...specialists(mock, country)];
}
function specialists(mock: boolean, country: string): NavItem[] {
  return [...(mock ? [PRACTICE, VIDEO] : []), RESUME, LEARNING, LINKEDIN, isIndia(country) ? OFFER : OFFER_WORLD];
}
export function phoneTabs(_mock: boolean = MOCK_INTERVIEW_ENABLED): NavItem[] {
  return [HOME, DISCOVER, APPLICATIONS, PREPARE, CAREER];
}
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
