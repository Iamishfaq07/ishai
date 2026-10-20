import type { MissionTool } from "../pages/jobs/mission";
import { missionPath } from "../pages/jobs/paths";

const tools: readonly string[] = ["resume", "fit", "company", "interview", "plan", "practice", "timeline", "offer"];
const supported = /^\/(?:learn|code(?:\/[^/?#]+)?|documents\/(?:stories|evidence)|sessions\/[a-zA-Z0-9-]{1,36})$/;
export interface OpportunityTrail {
  jobId: string;
  from: MissionTool;
  requirement?: string;
  kind?: "project" | "explanation" | "code";
  step?: string;
  workshop: boolean;
}

/** Carry only bounded navigation identity. No raw job text, arbitrary return URL or automatic artifact link. */
export function opportunityTrail(params: URLSearchParams): OpportunityTrail | null {
  const jobId = params.get("job") ?? "";
  if (!/^[a-zA-Z0-9-]{1,36}$/.test(jobId)) return null;
  const from = params.get("career_from") ?? "fit";
  const requirement = params.get("requirement") ?? "";
  const kind = params.get("practice_kind");
  const step = params.get("practice_step") ?? "";
  return { jobId, from: tools.includes(from) ? from as MissionTool : "fit",
    requirement: /^[0-9a-f]{64}$/.test(requirement) ? requirement : undefined,
    kind: kind === "project" || kind === "explanation" || kind === "code" ? kind : undefined,
    step: /^[0-3]$/.test(step) ? step : undefined, workshop: params.get("workshop") === "1" };
}

function addPractice(params: URLSearchParams, trail: OpportunityTrail) {
  if (trail.requirement) params.set("requirement", trail.requirement);
  if (trail.kind) params.set("practice_kind", trail.kind);
  if (trail.step) params.set("practice_step", trail.step);
  if (trail.workshop || trail.requirement) params.set("workshop", "1");
}

export function opportunityReturnHref(trail: OpportunityTrail, tab: MissionTool = trail.from): string {
  const params = new URLSearchParams({ guide: "1", tab });
  addPractice(params, trail);
  return `${missionPath(trail.jobId)}?${params}`;
}

/** Context is propagated only to the supported personal learning/library routes, never an external site. */
export function careerToolHref(path: string, params: URLSearchParams): string {
  const trail = opportunityTrail(params);
  if (!trail || !path.startsWith("/") || path.startsWith("//")) return path;
  const target = new URL(path, "https://orbit.invalid");
  if (target.origin !== "https://orbit.invalid" || !supported.test(target.pathname)) return path;
  target.searchParams.set("job", trail.jobId); target.searchParams.set("career_from", trail.from);
  addPractice(target.searchParams, trail);
  return `${target.pathname}${target.search}${target.hash}`;
}
