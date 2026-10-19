import { Suspense, lazy, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { FlagGate } from "./components/FlagGate";
import { AdminOnly } from "./components/AdminOnly";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { InviteLinkPage } from "./pages/InviteLink";
import { Layout } from "./components/Layout";
import { CookieNotice } from "./components/CookieNotice";
import { SupportChat } from "./components/SupportChat";
import { Spinner } from "./components/ui";
import { EmptyState, Skeleton, toast } from "@orbit/ui";
import { signedInHereBefore, useAuth } from "./lib/auth";
import { routeDescription, routeTitle } from "./lib/routeTitle";
import { servedHeadFor } from "./lib/servedHead";
import { useDocumentTitle } from "./lib/useDocumentTitle";
import { Prerendered, handOff, useHandOffElsewhere } from "./lib/prerender";
import { JOBS_AI_HOME, movedJobsPath } from "./pages/jobs/paths";
import { RESUME_AI_HOME, movedResumePath } from "./pages/resume/paths";
import {
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
  StopJobAlertsPage,
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
  ExtensionConnectPage,
  VideoInterviewPage,
  StoriesPage,
  EvidencePage,
  AnswersPage,
  ResumeAiHomePage,
  ResumeAiPublicPage,
  ResumeEditorPage,
  JobsAiSection,
  JobsAiHomePage,
  JobsAiPublicPage,
  JobMatchesPage,
  JobDetailPage,
  JobMissionPage,
  JobTrackerPage,
  JobActionDeskPage,
  JobOutreachPage,
  JobProfilePage,
  AutoApplySetupPage,
  CareerJourneyPage,
  ApplicationsPage,
  OffersPage,
  LinkedInPage,
  CodeHomePage,
  LearningPage,
  CodeProblemPage,
  OfferDetailPage,
  AdminUsersPage,
  AdminPaymentsPage,
  AdminAuditPage,
  AdminInboxPage,
  AdminSupportPage,
  AdminReferralsPage,
  AdminBusinessPage,
  ApplicationStatusPage,
  BusinessPages,
  CompanyCareersPage,
  PublicJobPage,
  ContactPage,
  NotFoundPage,
  TechnicalPage,
  PricingPage,
  CopilotPublicPage,
  PracticePublicPage,
  LinkedInPublicPage,
  CompaniesPage,
  CompanyPage,
  RolesPage,
  RolePage,
  GuidesHubPage,
  GuideArticlePage,
  prefetchLikelyRoutes,
  publicPageFor,
} from "./routes";

/** While a page's code downloads (first visit only; later visits are instant). */
export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6">
      <Skeleton variant="line" count={2} label="Loading" className="max-w-sm" />
      <Skeleton variant="card" count={2} ghost />
    </div>
  );
}

/**
 * Signed out, a page asks you to sign in first, except one with a public face (`publicPage`): "/" shows the front
 * page, and Resume AI's and Jobs AI's homes their product pages.
 */
export function RequireAuth({ children, publicPage }: { children: ReactNode; publicPage?: (pathname: string) => ReactNode }) {
  const { user, loading, unreachable, recheck } = useAuth();
  const location = useLocation();
  if (loading) {
    // A browser nobody has signed in on: the public face now, not a spinner until the session check answers (the
    // front page's first paint). Anyone who has signed in here waits, so a signed-in person never sees it flash.
    const early = publicPage && !signedInHereBefore() ? publicPage(location.pathname) : null;
    if (early) return early;
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) {
    const page = publicPage?.(location.pathname);
    // The session check got no answer (offline, the server restarting): someone who has signed in here is told so
    // and can try again, instead of being sent to sign in by a blip. A first visit still gets the public page.
    if (unreachable && (signedInHereBefore() || !page)) return <CantReach message={unreachable} onRetry={recheck} />;
    if (page) return page;
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Signed>{children}</Signed>;
}

/** The whole page while the session can't be checked: what happened, and Try again (it also retries when back online). */
function CantReach({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-5 py-16">
      <EmptyState
        kind="offline"
        title="Can't reach Orbit"
        body={`${message} If you were signed in, you still are.`}
        onRetry={onRetry}
      />
    </main>
  );
}

/** Signed in: warm the daily pages in the background so the next click doesn't wait for a download. A signed-in
 *  page is never the built public copy of its address (the front page at "/"), so the app takes over at once. */
function Signed({ children }: { children: ReactNode }) {
  useLayoutEffect(handOff, []);
  useEffect(() => prefetchLikelyRoutes(), []);
  return <>{children}</>;
}

/** Signed out at "/", the front page; at /resume-ai or /jobs, what that product does, and "Start free". */
const PUBLIC_PAGES: Record<NonNullable<ReturnType<typeof publicPageFor>>, ReactNode> = {
  landing: (
    <Prerendered>
      <LandingPage />
    </Prerendered>
  ),
  resumeAiPublic: (
    <Prerendered>
      <ResumeAiPublicPage />
    </Prerendered>
  ),
  jobsAiPublic: (
    <Prerendered>
      <JobsAiPublicPage />
    </Prerendered>
  ),
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
  useHandOffElsewhere(pathname);
  // Signed out on the page the document was served as, its own served title and description stay (lib/servedHead.ts).
  const served = user ? null : servedHeadFor(pathname);
  useDocumentTitle(served?.title ?? routeTitle(pathname, !loading && !user), served ? served.description : routeDescription(pathname), !!served);
}

/** Continue with Google took an unconfirmed password account: say so once, then drop the query. */
function GoogleClaimNotice() {
  const [params, setParams] = useSearchParams();
  const claimed = params.get("google") === "claimed";
  const said = useRef(false);
  useEffect(() => {
    if (!claimed || said.current) return;
    said.current = true;
    toast("Google is connected. The old password no longer works. Set a new one in Settings if you want one.");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("google");
      return next;
    }, { replace: true });
  }, [claimed, setParams]);
  return null;
}

// The component gallery: development builds only (the import sits in a branch the production build drops).
const ComponentGalleryPage = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./pages/dev/ComponentGallery")).ComponentGalleryPage }))
  : null;

export function App() {
  useRouteTitle();
  return (
    <Suspense fallback={<PageLoading />}>
    <GoogleClaimNotice />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* Public: an invite (or creator, campus) link. Its code is kept for the sign-up, then on to it. */}
      <Route path="/r/:code" element={<InviteLinkPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
      {/* Public: the job alert email's "stop these emails" link (the token says whose). */}
      <Route path="/jobs/alerts/off" element={<StopJobAlertsPage />} />
      {/* Public: the scanned code is the credential, so the phone needn't sign in. */}
      <Route path="/companion" element={<CompanionPage />} />
      {/* Public: one practice question with instant feedback, no account needed (Workstream C's page). */}
      <Route path="/warmup" element={<Prerendered><WarmupPage /></Prerendered>} />
      {/* Public: the Contact page's form, signed in or out (its messages wait in the admin's Inbox). */}
      <Route path="/contact" element={<Prerendered><ContactPage /></Prerendered>} />
      {/* Public: live latency, the answer pipeline, the desktop app's protections. */}
      <Route path="/technical" element={<Prerendered><TechnicalPage /></Prerendered>} />
      {/* Public: the prices in rupees and dollars, and the copilot's and Practice's product pages (D73). */}
      <Route path="/pricing" element={<Prerendered><PricingPage /></Prerendered>} />
      <Route path="/interview-copilot" element={<Prerendered><CopilotPublicPage /></Prerendered>} />
      <Route path="/mock-interview" element={<Prerendered><PracticePublicPage /></Prerendered>} />
      {/* LinkedIn AI's product page (D79): the tool itself is /linkedin, signed in. */}
      <Route path="/linkedin-ai" element={<Prerendered><LinkedInPublicPage /></Prerendered>} />
      {/* Public: the question bank, how companies interview and what interviews for a job test (pages/bank). Built
          as HTML too (src/prerender), like the pages above, so it reads without JavaScript. */}
      <Route path="/companies" element={<Prerendered><CompaniesPage /></Prerendered>} />
      <Route path="/companies/:slug" element={<Prerendered><CompanyPage /></Prerendered>} />
      <Route path="/roles" element={<Prerendered><RolesPage /></Prerendered>} />
      <Route path="/roles/:slug" element={<Prerendered><RolePage /></Prerendered>} />
      {/* Public: Orbit's interview-prep articles (pages/guides), built as HTML too. */}
      <Route path="/guides" element={<Prerendered><GuidesHubPage /></Prerendered>} />
      <Route path="/guides/:slug" element={<Prerendered><GuideArticlePage /></Prerendered>} />
      {/* Orbit for Business (D82): its public page; the company app (its own area, signed in); an invite; the
          careers pages (served as HTML by the Worker too, worker/careers.js) and an applicant's status page. */}
      <Route path="/business/*" element={<BusinessPages />} />
      <Route path="/company/:slug" element={<CompanyCareersPage />} />
      <Route path="/company/:slug/jobs/:jobSlug" element={<PublicJobPage />} />
      <Route path="/application/:token" element={<ApplicationStatusPage />} />
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
        <Route path="documents/evidence" element={<FlagGate flag="evidence_vault" fallback="/documents"><EvidencePage /></FlagGate>} />
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
          <Route path="mission/:entryId" element={<JobMissionPage />} />
          <Route path="tracker" element={<JobTrackerPage />} />
          <Route path="actions" element={<JobActionDeskPage />} />
          <Route path="outreach" element={<JobOutreachPage />} />
          <Route path="profile" element={<JobProfilePage />} />
          <Route path="auto-apply" element={<AutoApplySetupPage />} />
          <Route path="journey" element={<CareerJourneyPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="*" element={<Navigate to={JOBS_AI_HOME} replace />} />
        </Route>
        <Route path="linkedin" element={<LinkedInPage />} />
        <Route path="learn" element={<LearningPage />} />
        <Route path="code" element={<CodeHomePage />} />
        <Route path="code/:problemId" element={<CodeProblemPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="offers/:offerId" element={<OfferDetailPage />} />
        <Route path="mock" element={<MockPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="extension/connect" element={<ExtensionConnectPage />} />
        <Route path="interview" element={<VideoInterviewPage />} />
        <Route path="admin/users" element={<AdminOnly><AdminUsersPage /></AdminOnly>} />
        <Route path="admin/payments" element={<AdminOnly><AdminPaymentsPage /></AdminOnly>} />
        <Route path="admin/audit" element={<AdminOnly><AdminAuditPage /></AdminOnly>} />
        <Route path="admin/inbox" element={<AdminOnly><AdminInboxPage /></AdminOnly>} />
        <Route path="admin/support" element={<AdminOnly><AdminSupportPage /></AdminOnly>} />
        <Route path="admin/referrals" element={<AdminOnly><AdminReferralsPage /></AdminOnly>} />
        <Route path="admin/business" element={<AdminOnly><AdminBusinessPage /></AdminOnly>} />
        {ComponentGalleryPage && <Route path="dev/components" element={<ComponentGalleryPage />} />}
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    {/* After the page in the DOM, so the first Tab stop is the page's "Skip to content", not the floating support
        button or the cookie note (both are fixed in place, so where they sit in the markup doesn't move them). */}
    <CookieNotice />
    <SupportChat />
    </Suspense>
  );
}
