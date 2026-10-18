// Orbit for Business's own small router chunk (D82): the one loader the app's entry has for every business address
// (/business/*, the careers pages, an applicant's status page, the admin's screen). Each page then loads on its own,
// so nothing of Business is in a candidate page's first download, and the entry lists just this chunk.
import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { RequireAuth } from "../App";
import { Prerendered } from "../lib/prerender";

const BusinessLandingPage = lazy(async () => ({ default: (await import("./BusinessLanding")).BusinessLandingPage }));
const BusinessApp = lazy(async () => ({ default: (await import("./BusinessApp")).BusinessApp }));
const InvitePage = lazy(async () => ({ default: (await import("./InvitePage")).InvitePage }));
const NotFoundPage = lazy(async () => ({ default: (await import("../pages/NotFound")).NotFoundPage }));
const Careers = lazy(async () => ({ default: (await import("./CareersPages")).CompanyCareersPage }));
const Job = lazy(async () => ({ default: (await import("./CareersPages")).PublicJobPage }));
const Status = lazy(async () => ({ default: (await import("./CareersPages")).ApplicationStatusPage }));
const Admin = lazy(async () => ({ default: (await import("./AdminBusiness")).AdminBusinessPage }));

// Plain components around the lazy ones: routes.ts loads this module lazily, and a lazy component can't resolve to
// another lazy one.
export const CompanyCareersPage = () => <Careers />;
export const PublicJobPage = () => <Job />;
export const ApplicationStatusPage = () => <Status />;
export const AdminBusinessPage = () => <Admin />;

/** /business/*: the public page (built as HTML too), the company app (signed in) and an invite. */
export function BusinessRoutes() {
  return (
    <Routes>
      <Route
        index
        element={
          <Prerendered>
            <BusinessLandingPage />
          </Prerendered>
        }
      />
      <Route
        path="app/*"
        element={
          <RequireAuth>
            <BusinessApp />
          </RequireAuth>
        }
      />
      <Route path="invite/:token" element={<InvitePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
