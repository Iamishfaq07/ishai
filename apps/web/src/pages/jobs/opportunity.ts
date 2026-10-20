import type { JobMission } from "@orbit/types";
import type { MissionTool } from "./mission";

export const OPPORTUNITY_STEPS = [
  { tool: "resume", label: "Resume", hint: "Choose the resume for this role. Review real education, projects and experience; keep a copy of what you send." },
  { tool: "fit", label: "Fit", hint: "Compare the actual requirements with your evidence. A prior fit check may have used another resume." },
  { tool: "timeline", label: "Application", hint: "Review prepared materials and required answers. Record Applied only after you have actually applied." },
  { tool: "interview", label: "Interview", hint: "Record a confirmed round and date, then prepare and practise for this role." },
  { tool: "offer", label: "Outcome", hint: "Review offer details or record what happened. A saved stage is not employer verification." },
] as const;
export function opportunityStep(tool: MissionTool) {
  return tool === "company" ? 1 : ["plan", "practice"].includes(tool) ? 3 : OPPORTUNITY_STEPS.findIndex((step) => step.tool === tool);
}
export function opportunityStart(status: string, mission: JobMission | null): MissionTool {
  if (["offer", "hired", "rejected", "withdrawn"].includes(status)) return "offer";
  if (status === "interviewing") return "interview";
  if (status === "applied") return mission?.resume && !mission.snapshots.length ? "resume" : "interview";
  return mission?.resume ? "fit" : "resume";
}
