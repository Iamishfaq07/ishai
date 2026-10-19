import { describe, expect, it } from "vitest";
import { requestKey, type PendingRequests } from "./requestKey";

describe("saved-request retries", () => {
  it("reuses the identity for an unchanged retry and replaces it after editing or refreshing a revision", () => {
    const pending: PendingRequests = {};
    const original = requestKey(pending, "offer", { terms: "Original terms", base_offer_id: null });
    expect(requestKey(pending, "offer", { terms: "Original terms", base_offer_id: null })).toBe(original);
    const revised = requestKey(pending, "offer", { terms: "Revised terms", base_offer_id: null });
    expect(revised).not.toBe(original);
    expect(requestKey(pending, "offer", { terms: "Revised terms", base_offer_id: "latest" })).not.toBe(revised);
    expect(requestKey(pending, "respond", { terms: "Revised terms", base_offer_id: "latest" })).not.toBe(revised);
  });
});
