import { describe, expect, it } from "vitest";
import { capacityTotals, filterCapacity, type CapacityItem } from "./capacityModel";
const row = (extra: Partial<CapacityItem> = {}): CapacityItem => ({ id: "req", revision: 1, title: "Engineer", department: "Platform", request_state: "converted", state: "recruiting", positions: 3, hired: 1, active: 4, remaining: 2, overage: 0, target_date: "2027-01-01", signals: [], currency: "INR", annual_budget_per_position: 100, job_id: "job", job_status: "open", watch: { revision: 0, enabled: false, owner_id: null, owner_name: null, owner_available: false }, ...extra });
describe("capacity accounting", () => {
  it("keeps unknown fulfillment separate from known remaining totals", () => {
    expect(capacityTotals([row(), row({ hired: null, remaining: null, signals: ["missing_job"] })])).toEqual({ positions: 6, hired: 1, remaining: 2, unknown: 1, attention: 1 });
  });
  it("does not subtract overages from another request's remaining positions", () => {
    expect(capacityTotals([row(), row({ hired: 5, remaining: 0, overage: 2 })]).remaining).toBe(2);
  });
  it("combines department search with actionable filters", () => {
    const first = row({ signals: ["target_due"] });
    const watched = row({ id: "watch", watch: { revision: 1, enabled: true, owner_id: "owner", owner_name: "Alex", owner_available: true } });
    const items = [first, watched, row({ id: "unknown", remaining: null })];
    expect(filterCapacity(items, " PLATFORM ", "attention")).toEqual([first]);
    expect(filterCapacity(items, "", "watched")).toEqual([watched]);
    expect(filterCapacity(items, "", "remaining")).toEqual([first, watched]);
    expect(filterCapacity(items, "missing", "all")).toEqual([]);
  });
});
