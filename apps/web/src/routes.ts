import { lazy, type ComponentType } from "react";

/**
 * Pages load on demand: the first visit downloads only what that screen needs (sign-in doesn't ship the live
 * session). Each loader is also a prefetch: `prefetchRoute("/sessions")` warms the chunk before the click (nav
 * hover/focus/touch) and `prefetchLikelyRoutes()` warms the daily pages once the browser is idle.
 */
const loaders = {
  home: () => import("./pages/Home"),
  setup: () => import("./pages/SessionSetup"),
  live: () => import("./pages/Live"),
  sessions: () => import("./pages/Sessions"),
  sessionDetail: () => import("./pages/SessionDetail"),
  documents: () => import("./pages/Documents"),
  stories: () => import("./pages/Stories"),
  resumes: () => import("./pages/resume/Resumes"),
  resumeEditor: () => import("./pages/resume/ResumeEditor"),
  mock: () => import("./pages/Mock"),
  billing: () => import("./pages/Billing"),
  settings: () => import("./pages/Settings"),
  companion: () => import("./pages/Companion"),
  adminUsers: () => import("./pages/AdminUsers"),
} as const;

function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  return lazy(async () => ({ default: pick(await load()) }));
}

export const HomePage = page(loaders.home, (m) => m.HomePage);
export const SessionSetupPage = page(loaders.setup, (m) => m.SessionSetupPage);
export const LivePage = page(loaders.live, (m) => m.LivePage);
export const SessionsPage = page(loaders.sessions, (m) => m.SessionsPage);
export const SessionDetailPage = page(loaders.sessionDetail, (m) => m.SessionDetailPage);
export const DocumentsPage = page(loaders.documents, (m) => m.DocumentsPage);
export const StoriesPage = page(loaders.stories, (m) => m.StoriesPage);
export const ResumesPage = page(loaders.resumes, (m) => m.ResumesPage);
export const ResumeEditorPage = page(loaders.resumeEditor, (m) => m.ResumeEditorPage);
export const MockPage = page(loaders.mock, (m) => m.MockPage);
export const BillingPage = page(loaders.billing, (m) => m.BillingPage);
export const SettingsPage = page(loaders.settings, (m) => m.SettingsPage);
export const CompanionPage = page(loaders.companion, (m) => m.CompanionPage);
export const AdminUsersPage = page(loaders.adminUsers, (m) => m.AdminUsersPage);

const BY_PATH: Array<[RegExp, keyof typeof loaders]> = [
  [/^\/$/, "home"],
  [/^\/start/, "setup"],
  [/^\/live\//, "live"],
  [/^\/sessions\/[^/]+/, "sessionDetail"],
  [/^\/sessions/, "sessions"],
  [/^\/documents\/stories/, "stories"],
  [/^\/documents\/resumes\/[^/]+/, "resumeEditor"],
  [/^\/documents\/resumes/, "resumes"],
  [/^\/documents/, "documents"],
  [/^\/mock/, "mock"],
  [/^\/billing/, "billing"],
  [/^\/settings/, "settings"],
];

/** Start downloading a page's code (no-op once loaded; the browser caches the module). */
export function prefetchRoute(path: string): void {
  const hit = BY_PATH.find(([re]) => re.test(path));
  if (hit) void loaders[hit[1]]().catch(() => undefined);
}

/** After sign-in, when the browser is idle: the pages people open next. */
export function prefetchLikelyRoutes(): void {
  const run = () => {
    for (const key of ["home", "setup", "sessions", "live", "mock", "documents"] as const) {
      void loaders[key]().catch(() => undefined);
    }
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
