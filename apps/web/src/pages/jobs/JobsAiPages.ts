// The Jobs section and its lazy workspaces. Matches, a listing, the tracker, outreach and the profile are chunks of
// their own (routes.ts), so the Jobs home doesn't download them.
import { createElement, lazy } from "react";
// The weekly workspace is loaded on demand; public pages do not carry its dependency map.
const Weekly = lazy(async () => ({ default: (await import("./WeeklyStudio")).WeeklyStudioPage }));
export function WeeklyStudioPage() { return createElement(Weekly); }
export { JobsAiSection } from "./JobsAi";
const Actions = lazy(async () => ({ default: (await import("./Today")).JobsTodayPage }));
export function JobActionDeskPage() { return createElement(Actions); }
export function JobsAiHomePage() { return createElement(Actions); }
const Mission = lazy(async () => ({ default: (await import("./JobMission")).JobMissionPage }));
export function JobMissionPage() { return createElement(Mission); }
const Priority = lazy(async () => ({ default: (await import("./ApplyPriority")).ApplyPriorityPage }));
export function ApplyPriorityPage() { return createElement(Priority); }
