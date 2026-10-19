// Core Jobs AI pages share a chunk; larger workspaces load on demand (routes.ts).
import { createElement, lazy } from "react";
// The weekly workspace is loaded on demand; public pages do not carry its dependency map.
const Weekly = lazy(async () => ({ default: (await import("./WeeklyStudio")).WeeklyStudioPage }));
export function WeeklyStudioPage() { return createElement(Weekly); }
export { JobsAiSection } from "./JobsAi";
export { JobActionDeskPage } from "./ActionDesk";
export { JobsAiHomePage } from "./Overview";
export { JobMatchesPage } from "./Matches";
export { JobDetailPage } from "./JobDetail";
export { JobTrackerPage } from "./Tracker";
export { JobOutreachPage } from "./Outreach";
export { JobProfilePage } from "./Profile";
export { JobMissionPage } from "./JobMission";
