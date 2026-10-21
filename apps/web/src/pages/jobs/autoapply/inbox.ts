import type { ApplyPacketStatus, ApplyPacketSummary } from "@orbit/types";
import { ATS_LABEL } from "./model";

export const INBOX_VIEWS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs action" },
  { id: "active", label: "In progress" },
  { id: "sent", label: "Applied" },
  { id: "history", label: "Not proceeding" },
] as const;
export type InboxView = typeof INBOX_VIEWS[number]["id"];
export type InboxSort = "action" | "newest" | "oldest";

export function inboxView(value: string | null): InboxView {
  return INBOX_VIEWS.find((view) => view.id === value)?.id ?? "all";
}
export function inboxSort(value: string | null): InboxSort {
  return value === "newest" || value === "oldest" ? value : "action";
}

/** `sendYourself`: nothing sends approved applications for this account (model.ts, sendsItself). */
export function packetView(status: ApplyPacketStatus, sendYourself = false): Exclude<InboxView, "all"> {
  if (status === "ready" && sendYourself) return "attention";
  if (status === "ready" || status === "leased") return "active";
  if (status === "submitted" || status === "applied") return "sent";
  if (status === "skipped" || status === "cancelled") return "history";
  return "attention";
}

const STEPS: Record<ApplyPacketStatus, { stage: 0 | 1 | 2; label: string; detail: string }> = {
  needs_answer: { stage: 0, label: "Answer required questions", detail: "Add the facts only you can confirm, then review the prepared materials." },
  review: { stage: 0, label: "Review before sending", detail: "Check the resume and answers. This application is waiting for approval." },
  ready: { stage: 1, label: "Queued for applying", detail: "Prepared materials are ready. Your permissions, schedule and limits still apply." },
  leased: { stage: 1, label: "Processing application", detail: "A worker is processing this application. Submission is not confirmed yet." },
  submitted: { stage: 2, label: "Submission recorded", detail: "Orbit recorded a submission. Open the saved confirmation and monitor employer updates." },
  applied: { stage: 2, label: "Marked applied by you", detail: "You recorded manual completion. Check your employer confirmation for its current status." },
  needs_you: { stage: 1, label: "Resolve a blocker", detail: "Read where it stopped and complete any required employer checks yourself." },
  handoff: { stage: 1, label: "Ready for you to send", detail: "Open the employer form, use the prepared answers and tailored resume, then mark it applied." },
  failed: { stage: 2, label: "Review the saved result", detail: "Read what happened and check the employer site before choosing whether to retry." },
  expired: { stage: 2, label: "Review expired materials", detail: "The prepared materials expired. Check the job and saved result before a new attempt." },
  skipped: { stage: 2, label: "Review skipped application", detail: "This application was skipped. Open its saved reason for more detail." },
  cancelled: { stage: 2, label: "Not proceeding", detail: "You chose not to apply. The saved materials remain available for reference." },
};

export function packetGuidance(packet: Pick<ApplyPacketSummary, "status" | "submission_uncertain">, sendYourself = false) {
  if (packet.submission_uncertain && packet.status !== "submitted" && packet.status !== "applied") {
    return { stage: 2 as const, label: "Employer outcome unconfirmed", detail: "Check the employer site and your email. Orbit cannot confirm whether this attempt was submitted." };
  }
  if (packet.status === "ready" && sendYourself) return STEPS.handoff;
  return STEPS[packet.status] ?? { stage: 1 as const, label: "Review application details", detail: "Open the saved application to check its current state." };
}

const rank = (packet: ApplyPacketSummary, mine: boolean) => {
  const view = packetView(packet.status, mine);
  return packet.submission_uncertain && view === "attention" ? 0 : packet.status === "needs_answer" ? 1
    : packet.status === "review" ? 2 : view === "attention" ? 3 : view === "active" ? 4 : view === "sent" ? 5 : 6;
};
const stamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export function selectPackets(packets: ApplyPacketSummary[], view: InboxView, query: string, sort: InboxSort, sendYourself = false) {
  const mine = (packet: ApplyPacketSummary) => sendYourself && packet.ats !== "orbit";
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return packets.filter((packet) => (view === "all" || packetView(packet.status, mine(packet)) === view) && terms.every((term) =>
    `${packet.title} ${packet.company} ${packet.site ?? ""} ${ATS_LABEL[packet.ats] ?? packet.ats} ${packetGuidance(packet, mine(packet)).label}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => (sort === "action" ? rank(a, mine(a)) - rank(b, mine(b)) : 0)
      || (sort === "oldest" ? stamp(a.updated_at) - stamp(b.updated_at) : stamp(b.updated_at) - stamp(a.updated_at))
      || a.id.localeCompare(b.id));
}
