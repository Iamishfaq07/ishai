import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfirmHost, ErrorBoundary, SpaceBackdrop, initDesign } from "@orbit/ui";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import "./index.css";

initDesign();

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
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
