// Core Jobs AI pages share a chunk; larger workspaces load on demand (routes.ts).
import { createElement, lazy } from "react";
// The weekly workspace is loaded on demand; public pages do not carry its dependency map.
const Weekly = lazy(async () => ({ default: (await import("./WeeklyStudio")).WeeklyStudioPage }));
export function WeeklyStudioPage() { return createElement(Weekly); }
export { JobsAiSection } from "./JobsAi";
const Actions = lazy(async () => ({ default: (await import("./Today")).JobsTodayPage }));
export function JobActionDeskPage() { return createElement(Actions); }
export function JobsAiHomePage() { return createElement(Actions); }
export { JobMatchesPage } from "./Matches";
export { JobDetailPage } from "./JobDetail";
export { JobTrackerPage } from "./Tracker";
export { JobOutreachPage } from "./Outreach";
export { JobProfilePage } from "./Profile";
const Mission = lazy(async () => ({ default: (await import("./JobMission")).JobMissionPage }));
export function JobMissionPage() { return createElement(Mission); }
