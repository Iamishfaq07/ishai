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
  warmup: () => import("./pages/Warmup"),
  contact: () => import("./pages/Contact"),
  setup: () => import("./pages/SessionSetup"),
  live: () => import("./pages/Live"),
  sessions: () => import("./pages/Sessions"),
  sessionDetail: () => import("./pages/SessionDetail"),
  documents: () => import("./pages/Documents"),
  stories: () => import("./pages/Stories"),
  answers: () => import("./pages/Answers"),
  resumes: () => import("./pages/resume/Resumes"),
  resumeEditor: () => import("./pages/resume/ResumeEditor"),
  resumeAiPublic: () => import("./pages/resume/ResumeAiPublic"),
  jobs: () => import("./pages/jobs/JobsAiPages"),
  jobsAiPublic: () => import("./pages/jobs/JobsAiPublic"),
  mock: () => import("./pages/Mock"),
  billing: () => import("./pages/Billing"),
  settings: () => import("./pages/Settings"),
  companion: () => import("./pages/Companion"),
  adminUsers: () => import("./pages/AdminUsers"),
  adminPayments: () => import("./pages/AdminPayments"),
  adminAudit: () => import("./pages/AdminAudit"),
  adminInbox: () => import("./pages/AdminInbox"),
} as const;

function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  return lazy(async () => ({ default: pick(await load()) }));
}

export const HomePage = page(loaders.home, (m) => m.HomePage);
export const LandingPage = page(loaders.landing, (m) => m.LandingPage);
export const WelcomePage = page(loaders.welcome, (m) => m.WelcomePage);
export const WarmupPage = page(loaders.warmup, (m) => m.WarmupPage);
export const ContactPage = page(loaders.contact, (m) => m.ContactPage);
export const SessionSetupPage = page(loaders.setup, (m) => m.SessionSetupPage);
export const LivePage = page(loaders.live, (m) => m.LivePage);
export const SessionsPage = page(loaders.sessions, (m) => m.SessionsPage);
export const SessionDetailPage = page(loaders.sessionDetail, (m) => m.SessionDetailPage);
export const DocumentsPage = page(loaders.documents, (m) => m.DocumentsPage);
export const StoriesPage = page(loaders.stories, (m) => m.StoriesPage);
export const AnswersPage = page(loaders.answers, (m) => m.AnswersPage);
export const ResumeAiHomePage = page(loaders.resumes, (m) => m.ResumeAiHomePage);
export const ResumeEditorPage = page(loaders.resumeEditor, (m) => m.ResumeEditorPage);
export const ResumeAiPublicPage = page(loaders.resumeAiPublic, (m) => m.ResumeAiPublicPage);
export const JobsAiSection = page(loaders.jobs, (m) => m.JobsAiSection);
export const JobsAiHomePage = page(loaders.jobs, (m) => m.JobsAiHomePage);
export const JobMatchesPage = page(loaders.jobs, (m) => m.JobMatchesPage);
export const JobDetailPage = page(loaders.jobs, (m) => m.JobDetailPage);
export const JobTrackerPage = page(loaders.jobs, (m) => m.JobTrackerPage);
export const JobOutreachPage = page(loaders.jobs, (m) => m.JobOutreachPage);
export const JobProfilePage = page(loaders.jobs, (m) => m.JobProfilePage);
export const JobsAiPublicPage = page(loaders.jobsAiPublic, (m) => m.JobsAiPublicPage);
export const MockPage = page(loaders.mock, (m) => m.MockPage);
export const BillingPage = page(loaders.billing, (m) => m.BillingPage);
export const SettingsPage = page(loaders.settings, (m) => m.SettingsPage);
export const CompanionPage = page(loaders.companion, (m) => m.CompanionPage);
export const AdminUsersPage = page(loaders.adminUsers, (m) => m.AdminUsersPage);
export const AdminPaymentsPage = page(loaders.adminPayments, (m) => m.AdminPaymentsPage);
export const AdminAuditPage = page(loaders.adminAudit, (m) => m.AdminAuditPage);
export const AdminInboxPage = page(loaders.adminInbox, (m) => m.AdminInboxPage);

type PageKey = keyof typeof loaders;

const BY_PATH: Array<[RegExp, PageKey | null]> = [
  [/^\/$/, "home"],
  [/^\/welcome\/?$/, "welcome"],
  [/^\/warmup\/?$/, "warmup"],
  [/^\/contact\/?$/, "contact"],
  [/^\/start/, "setup"],
  [/^\/live\//, "live"],
  [/^\/sessions\/[^/]+/, "sessionDetail"],
  [/^\/sessions/, "sessions"],
  [/^\/documents\/stories/, "stories"],
  [/^\/documents\/answers/, "answers"],
  [/^\/documents/, "documents"],
  [/^\/resume-ai\/[^/]+/, "resumeEditor"],
  [/^\/resume-ai/, "resumes"],
  [/^\/jobs(\/|$)/, "jobs"],
  [/^\/mock/, "mock"],
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

/** Start downloading a page's code (no-op once loaded; the browser caches the module). */
export function prefetchRoute(path: string): void {
  const key = pageFor(path);
  if (key) void loaders[key]().catch(() => undefined);
}

/** After sign-in, when the browser is idle: the pages people open next. */
export function prefetchLikelyRoutes(): void {
  const run = () => {
    for (const key of ["home", "setup", "sessions", "live", "mock", "documents", "resumes", "jobs"] as const) {
      void loaders[key]().catch(() => undefined);
    }
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
