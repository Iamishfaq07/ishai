export interface CapacityWatch { revision: number; enabled: boolean; owner_id: string | null; owner_name: string | null; owner_available: boolean }
export interface CapacityItem {
  id: string; revision: number; title: string; department: string; request_state: string; state: string;
  positions: number; hired: number | null; active: number | null; remaining: number | null; overage: number | null;
  target_date: string; signals: string[]; currency: string; annual_budget_per_position: number | null;
  job_id: string | null; job_status: string | null; watch: CapacityWatch;
}
export interface CapacitySnapshot {
  items: CapacityItem[]; version: string; as_of: string; truncated: boolean; can_manage: boolean;
  owners: Array<{ id: string; name: string }>; facts: Array<{ id: string; text: string }>;
  envelopes: Array<{ currency: string; approved_annual_envelope: number; remaining_annual_envelope: number; unknown_remaining_requests: number }>;
}
export const CAPACITY_STATES: Record<string, string> = {
  awaiting_handoff: "Awaiting job handoff", missing_job: "Linked job unavailable", restricted_job: "Job outside your access",
  shared_job: "Job linked to multiple requests", filled: "Approved positions filled", overfilled: "Above approved positions",
  closed_unfilled: "Job closed with positions remaining", paused: "Recruiting paused", draft_job: "Job still in draft", recruiting: "Recruiting",
};
export const CAPACITY_SIGNALS: Record<string, string> = { target_due: "Target date reached", overfilled: "Over approved headcount", closed_unfilled: "Closed before filled", missing_job: "Job link needs review", shared_job: "Ambiguous job allocation" };
export function filterCapacity(items: CapacityItem[], query: string, mode: string): CapacityItem[] {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(r => (!term || `${r.title} ${r.department}`.toLocaleLowerCase().includes(term)) &&
    (mode === "all" || (mode === "attention" && r.signals.length > 0) || (mode === "remaining" && r.remaining !== null && r.remaining > 0) || (mode === "watched" && r.watch.enabled)));
}
export function capacityTotals(items: CapacityItem[]) {
  return { positions: items.reduce((n, r) => n + r.positions, 0), hired: items.reduce((n, r) => n + (r.hired ?? 0), 0),
    remaining: items.reduce((n, r) => n + (r.remaining ?? 0), 0), unknown: items.filter(r => r.remaining === null).length,
    attention: items.filter(r => r.signals.length > 0).length };
}
