import { describe, expect, it } from "vitest";
import type { ApplyPacketStatus, ApplyPacketSummary } from "@orbit/types";
import { inboxSort, inboxView, packetGuidance, packetView, selectPackets } from "./inbox";

function packet(id: string, status: ApplyPacketStatus, extra: Partial<ApplyPacketSummary> = {}): ApplyPacketSummary {
  return { id, status, listing_id: id, group: "prepared", ats: "workday", site: null, company: "Northstar", title: "Backend Engineer",
    url: "https://example.com/job", apply_url: "https://example.com/apply", match_score: 75, match_reason: "Matches saved skills",
    reason: "", missing: 0, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", submitted_at: null,
    has_proof: false, ...extra };
}

describe("Candidate application inbox", () => {
  it.each([
    ["needs_answer", "attention"], ["review", "attention"], ["needs_you", "attention"], ["handoff", "attention"],
    ["failed", "attention"], ["expired", "attention"], ["ready", "active"], ["leased", "active"],
    ["submitted", "sent"], ["applied", "sent"], ["cancelled", "history"], ["skipped", "history"],
  ] as const)("makes the state %s discoverable in %s", (status, view) => {
    expect(packetView(status)).toBe(view);
    expect(selectPackets([packet("p", status)], view, "", "action")).toHaveLength(1);
  });

  it("prioritises uncertain outcomes and required input without changing the source array", () => {
    const packets = [packet("sent", "submitted"), packet("review", "review"), packet("question", "needs_answer"),
      packet("uncertain", "failed", { submission_uncertain: true }), packet("cancelled", "cancelled", { submission_uncertain: true })];
    expect(selectPackets(packets, "all", "", "action").map((p) => p.id)).toEqual(["uncertain", "question", "review", "sent", "cancelled"]);
    expect(packets[0]!.id).toBe("sent");
  });

  it("searches multiple words across role, company, site and next action", () => {
    const packets = [packet("a", "review"), packet("b", "needs_answer", { ats: "smartrecruiters", company: "Acme" }),
      packet("c", "review", { company: "All Action Labs" })];
    expect(selectPackets(packets, "all", "  acME smartRECRUITERS answer ", "action").map((p) => p.id)).toEqual(["b"]);
    expect(selectPackets(packets, "all", "all", "action").map((p) => p.id)).toEqual(["c"]);
    expect(selectPackets(packets, "all", "action", "action").map((p) => p.id)).toEqual(["c"]);
    expect(selectPackets(packets, "sent", "Acme", "action")).toEqual([]);
  });

  it("sorts saved update times and handles invalid legacy dates consistently", () => {
    const packets = [packet("recent", "review", { updated_at: "2026-10-21T10:00:00Z" }), packet("old", "review"),
      packet("legacy", "review", { updated_at: "unknown" })];
    expect(selectPackets(packets, "all", "", "newest").map((p) => p.id)).toEqual(["recent", "old", "legacy"]);
    expect(selectPackets(packets, "all", "", "oldest").map((p) => p.id)).toEqual(["legacy", "old", "recent"]);
    expect(inboxSort("unsafe")).toBe("action"); expect(inboxView("unsafe")).toBe("all");
  });

  it("distinguishes prepared, processing, confirmed and self-reported outcomes", () => {
    expect(packetGuidance(packet("p", "review")).label).toBe("Review before sending");
    expect(packetGuidance(packet("p", "leased")).detail).toContain("not confirmed");
    expect(packetGuidance(packet("p", "submitted")).label).toBe("Submission recorded");
    expect(packetGuidance(packet("p", "applied")).label).toBe("Marked applied by you");
    expect(packetGuidance(packet("p", "failed", { submission_uncertain: true })).label).toBe("Employer outcome unconfirmed");
    expect(packetGuidance(packet("p", "submitted", { submission_uncertain: true })).label).toBe("Submission recorded");
    expect(packetGuidance(packet("p", "expired")).detail).toContain("before a new attempt");
  });
});
