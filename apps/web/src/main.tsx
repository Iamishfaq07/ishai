import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfirmHost, ErrorBoundary, SpaceBackdrop, ToastHost, initDesign } from "@orbit/ui";
import { App } from "./App";
import { OutOfCreditsHost } from "./components/OutOfCreditsDialog";
import { AuthProvider } from "./lib/auth";
import "./index.css";

initDesign();

// A tab opened before a deploy asks for page chunks that no longer exist (their names change with every build): load
// the new build once. The timestamp stops a reload loop when the chunk is missing for another reason (offline, a bad
// deploy); the page's error boundary shows then. Never mid-interview: a reload would drop the mic and tab audio.
const PRELOAD_RELOAD_KEY = "orbit.preloadReloadAt";
const PRELOAD_RELOAD_GAP_MS = 60_000;
window.addEventListener("vite:preloadError", (event) => {
  if (window.location.pathname.startsWith("/live/")) return;
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY)) || 0;
    if (Date.now() - last < PRELOAD_RELOAD_GAP_MS) return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    return; // no storage, so no loop guard: leave it to the error boundary
  }
  event.preventDefault();
  window.location.reload();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
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
