// Orbit Apply's pages (D84), a lazy chunk of their own (routes.ts): Jobs AI's other tabs don't download them.
export { AutoApplySetupPage } from "./Setup";
export { ApplicationsPage } from "./Applications";
import { createElement, lazy } from "react";
const Journey = lazy(() => import("./Journey").then((m) => ({ default: m.CareerJourneyPage })));
export function CareerJourneyPage() { return createElement(Journey); }
