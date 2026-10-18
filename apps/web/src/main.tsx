import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfirmHost, ErrorBoundary, SpaceBackdrop, ToastHost, initDesign } from "@orbit/ui";
import { App } from "./App";
import { AppError } from "./components/AppError";
import { OutOfCreditsHost } from "./components/OutOfCreditsDialog";
import { AuthProvider, signedInHereBefore } from "./lib/auth";
import { setUpOfflinePage } from "./lib/offlinePage";
import { captureRefFromUrl } from "./lib/referral";
import { reloadForNewBuild } from "./lib/staleBuild";
import { preloadPublicPage } from "./routes";
import "./index.css";

initDesign();
// An invite or creator code in the address (?ref=): kept for the sign-up (lib/referral.ts).
captureRefFromUrl();
// Offline, a page load shows Orbit's "You're offline" page instead of the browser's error (public/sw.js).
setUpOfflinePage();
// A first visit to a page with a public face starts its code now; someone who has signed in here gets the app instead.
if (!signedInHereBefore()) preloadPublicPage(window.location.pathname);

// A tab opened before a deploy asks for page files that no longer exist: load the new build once (lib/staleBuild.ts).
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={(error, reset) => <AppError error={error} reset={reset} />}>
      <BrowserRouter>
        <AuthProvider>
          <SpaceBackdrop />
          <App />
          <ConfirmHost />
          <OutOfCreditsHost />
          <ToastHost />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
