// apps/web/src/main.tsx without what a film doesn't need (the service worker's offline page, referral codes, the
// stale-build reload, the public pages' preload), so the app renders exactly as it does for a signed-in user.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfirmHost, ErrorBoundary, SpaceBackdrop, ToastHost, initDesign } from "@orbit/ui";
import { App } from "../../../../apps/web/src/App";
import { AppError } from "../../../../apps/web/src/components/AppError";
import { OutOfCreditsHost } from "../../../../apps/web/src/components/OutOfCreditsDialog";
import { AuthProvider } from "../../../../apps/web/src/lib/auth";
import "../../../../apps/web/src/index.css";

initDesign();

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
