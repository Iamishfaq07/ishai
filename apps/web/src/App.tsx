import { Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SupportChat } from "./components/SupportChat";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { routeTitle } from "./lib/routeTitle";
import { useDocumentTitle } from "./lib/useDocumentTitle";
import { JOBS_AI_HOME, movedJobsPath } from "./pages/jobs/paths";
import { RESUME_AI_HOME, movedResumePath } from "./pages/resume/paths";
import {
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./pages/Auth";
import {
  BillingPage,
  CompanionPage,
  DocumentsPage,
  HomePage,
  LandingPage,
  WelcomePage,
  WarmupPage,
  LivePage,
  MockPage,
  SessionDetailPage,
  SessionSetupPage,
  SessionsPage,
  SettingsPage,
  StoriesPage,
  AnswersPage,
  ResumeAiHomePage,
  ResumeAiPublicPage,
  ResumeEditorPage,
  JobsAiSection,
  JobsAiHomePage,
  JobsAiPublicPage,
  JobMatchesPage,
  JobDetailPage,
  JobTrackerPage,
  JobOutreachPage,
  JobProfilePage,
  AdminUsersPage,
  AdminPaymentsPage,
  AdminAuditPage,
  AdminInboxPage,
  AdminSupportPage,
  ContactPage,
  prefetchLikelyRoutes,
  publicPageFor,
} from "./routes";

/** While a page's code downloads (first visit only; later visits are instant). */
export function PageLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner big />
    </div>
  );
}

/**
 * Signed out, a page asks you to sign in first, except one with a public face (`publicPage`): "/" shows the front
 * page, and Resume AI's and Jobs AI's homes their product pages.
 */
function RequireAuth({ children, publicPage }: { children: ReactNode; publicPage?: (pathname: string) => ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) {
    const page = publicPage?.(location.pathname);
    if (page) return page;
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Signed>{children}</Signed>;
}

/** Signed in: warm the daily pages in the background so the next click doesn't wait for a download. */
function Signed({ children }: { children: ReactNode }) {
  useEffect(() => prefetchLikelyRoutes(), []);
  return <>{children}</>;
}

/** Signed out at "/", the front page; at /resume-ai or /jobs, what that product does, and "Start free". */
const PUBLIC_PAGES: Record<NonNullable<ReturnType<typeof publicPageFor>>, ReactNode> = {
  landing: <LandingPage />,
  resumeAiPublic: <ResumeAiPublicPage />,
  jobsAiPublic: <JobsAiPublicPage />,
};
const publicProductPage = (pathname: string): ReactNode => {
  const key = publicPageFor(pathname);
  return key ? PUBLIC_PAGES[key] : null;
};

/** An old resume maker address (Documents → Resume maker, /resume-maker): the same place in Resume AI. */
function MovedResume() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={{ pathname: movedResumePath(pathname) ?? RESUME_AI_HOME, search, hash }} replace />;
}

/** An address from when Jobs was a tab of Resume AI (/resume-ai/jobs…): the same page in Jobs AI. */
function MovedJobs() {
  const { pathname, search, hash } = useLocation();
  const to = movedJobsPath(pathname, search) ?? { pathname: JOBS_AI_HOME, search: "" };
  return <Navigate to={{ ...to, hash }} replace />;
}

function useRouteTitle(): void {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();
  useDocumentTitle(routeTitle(pathname, !loading && !user));
}

export function App() {
  useRouteTitle();
  return (
    <Suspense fallback={<PageLoading />}>
    <SupportChat />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
      {/* Public: the scanned code is the credential, so the phone needn't sign in. */}
      <Route path="/companion" element={<CompanionPage />} />
      {/* Public: one practice question with instant feedback, no account needed (Workstream C's page). */}
      <Route path="/warmup" element={<WarmupPage />} />
      {/* Public: the Contact page's form, signed in or out (its messages wait in the admin's Inbox). */}
      <Route path="/contact" element={<ContactPage />} />
      {/* Right after sign-up: the three welcome questions, outside the nav so nothing competes with them. */}
      <Route
        path="/welcome"
        element={
          <RequireAuth>
            <WelcomePage />
          </RequireAuth>
        }
      />
      {/* The old signed-out resume maker: Resume AI's home, which is its product page when signed out. */}
      <Route path="/resume-maker" element={<MovedResume />} />
      {/* Jobs was a tab of Resume AI: its old addresses go to the same page in Jobs AI (signed out, through sign-in
          there). A route of its own, so "jobs" is never opened as a resume by "resume-ai/:resumeId". */}
      <Route path="/resume-ai/jobs/*" element={<MovedJobs />} />
      <Route
        path="/live/:sessionId"
        element={
          <RequireAuth>
            <LivePage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth publicPage={publicProductPage}>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="start" element={<SessionSetupPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/stories" element={<StoriesPage />} />
        <Route path="documents/answers" element={<AnswersPage />} />
        {/* Resume AI used to be Documents → Resume maker. Signed out, these go through sign-in first, as before. */}
        <Route path="documents/resumes" element={<MovedResume />} />
        <Route path="documents/resumes/:resumeId" element={<MovedResume />} />
        <Route path="resume-ai" element={<ResumeAiHomePage />} />
        <Route path="resume-ai/:resumeId" element={<ResumeEditorPage />} />
        {/* Orbit Jobs AI: its pages share the tabs, the search profile and the tracker (pages/jobs/JobsAi.tsx). */}
        <Route path="jobs" element={<JobsAiSection />}>
          <Route index element={<JobsAiHomePage />} />
          <Route path="matches" element={<JobMatchesPage />} />
          <Route path="listing/:listingId" element={<JobDetailPage />} />
          <Route path="tracker" element={<JobTrackerPage />} />
          <Route path="outreach" element={<JobOutreachPage />} />
          <Route path="profile" element={<JobProfilePage />} />
          <Route path="*" element={<Navigate to={JOBS_AI_HOME} replace />} />
        </Route>
        <Route path="mock" element={<MockPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
        <Route path="admin/payments" element={<AdminPaymentsPage />} />
        <Route path="admin/audit" element={<AdminAuditPage />} />
        <Route path="admin/inbox" element={<AdminInboxPage />} />
        <Route path="admin/support" element={<AdminSupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
