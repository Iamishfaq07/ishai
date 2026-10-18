import { lazy, type ComponentType } from "react";
import { isJobsAiHome, movedJobsPath } from "./pages/jobs/paths";
import { isResumeAiHome } from "./pages/resume/paths";

/**
 * Pages load on demand: the first visit downloads only what that screen needs (sign-in doesn't ship the live
 * session). Each loader is also a prefetch: `prefetchRoute("/sessions")` warms the chunk before the click (nav
 * hover/focus/touch) and `prefetchLikelyRoutes()` warms the daily pages once the browser is idle.
 */
const loaders = {
  home: () => import("./pages/Home"),
  landing: () => import("./pages/Landing"),
  welcome: () => import("./pages/Welcome"),
  // The warm-up, which can also open a company's or a role's questions (pages/bank/WarmupRoute.tsx).
  warmup: () => import("./pages/bank/WarmupRoute"),
  // The question bank's public pages: /companies, /roles and a guide per company and role.
  bank: () => import("./pages/bank/BankPages"),
  // Orbit's interview-prep articles: /guides and one page per article (pages/guides).
  guides: () => import("./pages/guides/GuidesPages"),
  contact: () => import("./pages/Contact"),
  notFound: () => import("./pages/NotFound"),
  technical: () => import("./pages/Technical"),
  // The public pricing page and the copilot's and Practice's product pages (D73).
  pricing: () => import("./pages/Pricing"),
  copilotPublic: () => import("./pages/CopilotPublic"),
  practicePublic: () => import("./pages/PracticePublic"),
  setup: () => import("./pages/SessionSetup"),
  live: () => import("./pages/Live"),
  sessions: () => import("./pages/Sessions"),
  sessionDetail: () => import("./pages/SessionDetail"),
  documents: () => import("./pages/Documents"),
  stories: () => import("./pages/Stories"),
  evidence: () => import("./pages/Evidence"),
  answers: () => import("./pages/Answers"),
  resumes: () => import("./pages/resume/Resumes"),
  resumeEditor: () => import("./pages/resume/ResumeEditor"),
  resumeAiPublic: () => import("./pages/resume/ResumeAiPublic"),
  jobs: () => import("./pages/jobs/JobsAiPages"),
  jobsAiPublic: () => import("./pages/jobs/JobsAiPublic"),
  mock: () => import("./pages/Mock"),
  offers: () => import("./pages/offers/OffersPages"),
  linkedin: () => import("./pages/linkedin/LinkedIn"),
  code: () => import("./pages/code/CodePages"),
  learn: () => import("./pages/learn/Learning"),
  billing: () => import("./pages/Billing"),
  settings: () => import("./pages/Settings"),
  extensionConnect: () => import("./pages/ExtensionConnect"),
  videoInterview: () => import("./pages/VideoInterview"),
  companion: () => import("./pages/Companion"),
  adminUsers: () => import("./pages/AdminUsers"),
  adminPayments: () => import("./pages/AdminPayments"),
  adminAudit: () => import("./pages/AdminAudit"),
  adminInbox: () => import("./pages/AdminInbox"),
  adminSupport: () => import("./pages/AdminSupport"),
  adminReferrals: () => import("./pages/AdminReferrals"),
} as const;

function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  return lazy(async () => ({ default: pick(await load()) }));
}

export const HomePage = page(loaders.home, (m) => m.HomePage);
export const LandingPage = page(loaders.landing, (m) => m.LandingPage);
export const WelcomePage = page(loaders.welcome, (m) => m.WelcomePage);
export const WarmupPage = page(loaders.warmup, (m) => m.WarmupRoute);
export const CompaniesPage = page(loaders.bank, (m) => m.CompaniesPage);
export const CompanyPage = page(loaders.bank, (m) => m.CompanyPage);
export const RolesPage = page(loaders.bank, (m) => m.RolesPage);
export const RolePage = page(loaders.bank, (m) => m.RolePage);
export const GuidesHubPage = page(loaders.guides, (m) => m.GuidesHubPage);
export const GuideArticlePage = page(loaders.guides, (m) => m.GuideArticlePage);
export const ContactPage = page(loaders.contact, (m) => m.ContactPage);
// An address that isn't a page: rare, so its code (and the public layout it brings) stays out of the first download.
export const NotFoundPage = page(loaders.notFound, (m) => m.NotFoundPage);
export const TechnicalPage = page(loaders.technical, (m) => m.TechnicalPage);
export const PricingPage = page(loaders.pricing, (m) => m.PricingPage);
export const CopilotPublicPage = page(loaders.copilotPublic, (m) => m.CopilotPublicPage);
export const PracticePublicPage = page(loaders.practicePublic, (m) => m.PracticePublicPage);
export const SessionSetupPage = page(loaders.setup, (m) => m.SessionSetupPage);
export const LivePage = page(loaders.live, (m) => m.LivePage);
export const SessionsPage = page(loaders.sessions, (m) => m.SessionsPage);
export const SessionDetailPage = page(loaders.sessionDetail, (m) => m.SessionDetailPage);
export const DocumentsPage = page(loaders.documents, (m) => m.DocumentsPage);
export const StoriesPage = page(loaders.stories, (m) => m.StoriesPage);
export const EvidencePage = page(loaders.evidence, (m) => m.EvidencePage);
export const AnswersPage = page(loaders.answers, (m) => m.AnswersPage);
export const ResumeAiHomePage = page(loaders.resumes, (m) => m.ResumeAiHomePage);
export const ResumeEditorPage = page(loaders.resumeEditor, (m) => m.ResumeEditorPage);
export const ResumeAiPublicPage = page(loaders.resumeAiPublic, (m) => m.ResumeAiPublicPage);
export const JobsAiSection = page(loaders.jobs, (m) => m.JobsAiSection);
export const JobsAiHomePage = page(loaders.jobs, (m) => m.JobsAiHomePage);
export const JobMatchesPage = page(loaders.jobs, (m) => m.JobMatchesPage);
export const JobDetailPage = page(loaders.jobs, (m) => m.JobDetailPage);
export const JobMissionPage = page(loaders.jobs, (m) => m.JobMissionPage);
export const JobTrackerPage = page(loaders.jobs, (m) => m.JobTrackerPage);
export const JobOutreachPage = page(loaders.jobs, (m) => m.JobOutreachPage);
export const LearningPage = page(loaders.learn, (m) => m.LearningPage);
export const CodeHomePage = page(loaders.code, (m) => m.CodeHomePage);
export const CodeProblemPage = page(loaders.code, (m) => m.CodeProblemPage);
export const LinkedInPage = page(loaders.linkedin, (m) => m.LinkedInPage);
export const OffersPage = page(loaders.offers, (m) => m.OffersPage);
export const OfferDetailPage = page(loaders.offers, (m) => m.OfferDetailPage);
export const JobProfilePage = page(loaders.jobs, (m) => m.JobProfilePage);
export const JobsAiPublicPage = page(loaders.jobsAiPublic, (m) => m.JobsAiPublicPage);
export const MockPage = page(loaders.mock, (m) => m.MockPage);
export const BillingPage = page(loaders.billing, (m) => m.BillingPage);
export const SettingsPage = page(loaders.settings, (m) => m.SettingsPage);
export const ExtensionConnectPage = page(loaders.extensionConnect, (m) => m.ExtensionConnectPage);
export const VideoInterviewPage = page(loaders.videoInterview, (m) => m.VideoInterviewPage);
export const CompanionPage = page(loaders.companion, (m) => m.CompanionPage);
export const AdminUsersPage = page(loaders.adminUsers, (m) => m.AdminUsersPage);
export const AdminPaymentsPage = page(loaders.adminPayments, (m) => m.AdminPaymentsPage);
export const AdminAuditPage = page(loaders.adminAudit, (m) => m.AdminAuditPage);
export const AdminInboxPage = page(loaders.adminInbox, (m) => m.AdminInboxPage);
export const AdminSupportPage = page(loaders.adminSupport, (m) => m.AdminSupportPage);
export const AdminReferralsPage = page(loaders.adminReferrals, (m) => m.AdminReferralsPage);

type PageKey = keyof typeof loaders;

const BY_PATH: Array<[RegExp, PageKey | null]> = [
  [/^\/$/, "home"],
  [/^\/welcome\/?$/, "welcome"],
  [/^\/warmup\/?$/, "warmup"],
  [/^\/(companies|roles)(\/|$)/, "bank"],
  [/^\/guides(\/|$)/, "guides"],
  [/^\/contact\/?$/, "contact"],
  [/^\/technical\/?$/, "technical"],
  [/^\/pricing\/?$/, "pricing"],
  [/^\/interview-copilot\/?$/, "copilotPublic"],
  [/^\/mock-interview\/?$/, "practicePublic"],
  [/^\/start/, "setup"],
  [/^\/live\//, "live"],
  [/^\/sessions\/[^/]+/, "sessionDetail"],
  [/^\/sessions/, "sessions"],
  [/^\/documents\/stories/, "stories"],
  [/^\/documents\/evidence/, "evidence"],
  [/^\/documents\/answers/, "answers"],
  [/^\/documents/, "documents"],
  [/^\/resume-ai\/[^/]+/, "resumeEditor"],
  [/^\/resume-ai/, "resumes"],
  [/^\/jobs(\/|$)/, "jobs"],
  [/^\/mock/, "mock"],
  [/^\/offers(\/|$)/, "offers"],
  [/^\/linkedin(\/|$)/, "linkedin"],
  [/^\/code(\/|$)/, "code"],
  [/^\/learn(\/|$)/, "learn"],
  [/^\/billing/, "billing"],
  [/^\/settings/, "settings"],
];

/**
 * The page whose code an address needs, or null when there's nothing to warm (exported for the unit test). Jobs' old
 * addresses in Resume AI warm the Jobs AI page they go to, never the resume editor.
 */
export function pageFor(path: string): PageKey | null {
  const moved = movedJobsPath(path);
  if (moved) return pageFor(moved.pathname);
  return BY_PATH.find(([re]) => re.test(path))?.[1] ?? null;
}

/**
 * Signed out, the addresses with a public face instead of the sign-in page: the front page at "/" and the two
 * product pages. Everything else signed out asks to sign in (exported for the unit test).
 */
export function publicPageFor(pathname: string): "landing" | "resumeAiPublic" | "jobsAiPublic" | null {
  if (pathname === "/") return "landing";
  if (isResumeAiHome(pathname)) return "resumeAiPublic";
  if (isJobsAiHome(pathname)) return "jobsAiPublic";
  return null;
}

/**
 * At startup, on an address with a public face: start its page's code at once, alongside the session check, rather
 * than after it (the front page's first paint waits on that chunk). Harmless for someone signed in: it's small and
 * cached.
 */
export function preloadPublicPage(pathname: string): void {
  const key = publicPageFor(pathname);
  if (key) void loaders[key]().catch(() => undefined);
}

/** Start downloading a page's code (no-op once loaded; the browser caches the module). */
export function prefetchRoute(path: string): void {
  const key = pageFor(path);
  if (key) void loaders[key]().catch(() => undefined);
}

/** After sign-in, when the browser is idle: the pages people open next. Not the live session. That chunk is the
 * heaviest (the interview itself) and only starts when they open one, so it doesn't compete with Home. */
export function prefetchLikelyRoutes(): void {
  const run = () => {
    for (const key of ["home", "setup", "sessions", "mock", "documents", "resumes", "jobs"] as const) {
      void loaders[key]().catch(() => undefined);
    }
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
