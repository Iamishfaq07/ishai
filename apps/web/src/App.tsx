import { Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { useDocumentTitle } from "./lib/useDocumentTitle";
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
  LivePage,
  MockPage,
  SessionDetailPage,
  SessionSetupPage,
  SessionsPage,
  SettingsPage,
  StoriesPage,
  ResumesPage,
  ResumeEditorPage,
  AdminUsersPage,
  AdminPaymentsPage,
  prefetchLikelyRoutes,
} from "./routes";

/** While a page's code downloads (first visit only; later visits are instant). */
export function PageLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Signed>{children}</Signed>;
}

/** Signed in: warm the daily pages in the background so the next click doesn't wait for a download. */
function Signed({ children }: { children: ReactNode }) {
  useEffect(() => prefetchLikelyRoutes(), []);
  return <>{children}</>;
}

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Home"],
  [/^\/start/, "New session"],
  [/^\/sessions\/[^/]+/, "Session"],
  [/^\/sessions/, "Sessions"],
  [/^\/documents\/stories/, "Story bank"],
  [/^\/documents\/resumes/, "Resume maker"],
  [/^\/documents/, "Documents"],
  [/^\/mock/, "Practice"],
  [/^\/billing/, "Billing"],
  [/^\/admin\/users/, "Users & access"],
  [/^\/admin\/payments/, "Payments"],
  [/^\/settings/, "Settings"],
  [/^\/live\//, "Live session"],
  [/^\/companion/, "Phone companion"],
  [/^\/login/, "Sign in"],
  [/^\/register/, "Create account"],
  [/^\/forgot-password/, "Reset password"],
  [/^\/reset-password/, "Reset password"],
  [/^\/verify-email/, "Verify email"],
  [/^\/confirm-email-change/, "Confirm email"],
];

function useRouteTitle(): void {
  const { pathname } = useLocation();
  useDocumentTitle(ROUTE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null);
}

export function App() {
  useRouteTitle();
  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
      {/* Public: the scanned code is the credential, so the phone needn't sign in. */}
      <Route path="/companion" element={<CompanionPage />} />
      {/* Public: the free resume maker needs no account; the resume stays in the visitor's browser. */}
      {/* The signed-out resume maker is now part of the account: old links go to sign-up. */}
      <Route path="/resume-maker" element={<Navigate to="/register" replace />} />
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
          <RequireAuth>
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
        <Route path="documents/resumes" element={<ResumesPage />} />
        <Route path="documents/resumes/:resumeId" element={<ResumeEditorPage />} />
        <Route path="mock" element={<MockPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
        <Route path="admin/payments" element={<AdminPaymentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
