import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { useDocumentTitle } from "./lib/useDocumentTitle";
import { BillingPage } from "./pages/Billing";
import { DocumentsPage } from "./pages/Documents";
import { HomePage } from "./pages/Home";
import { LivePage } from "./pages/Live";
import {
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./pages/Auth";
import { MockPage } from "./pages/Mock";
import { SessionDetailPage } from "./pages/SessionDetail";
import { SessionSetupPage } from "./pages/SessionSetup";
import { SessionsPage } from "./pages/Sessions";
import { SettingsPage } from "./pages/Settings";

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
  return <>{children}</>;
}

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Home"],
  [/^\/start/, "New session"],
  [/^\/sessions\/[^/]+/, "Session"],
  [/^\/sessions/, "Sessions"],
  [/^\/documents/, "Documents"],
  [/^\/mock/, "Practice"],
  [/^\/billing/, "Billing"],
  [/^\/settings/, "Settings"],
  [/^\/live\//, "Live session"],
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
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
        <Route path="mock" element={<MockPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
