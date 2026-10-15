import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary, initDesign } from "@orbit/ui";
import { App } from "./App";
import { initGlass } from "./glass";
import { initWindowPrivacy } from "./windowPrivacy";
import { initTheme } from "./theme";
import "./index.css";

initTheme();
initDesign();
initGlass();
initWindowPrivacy();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
