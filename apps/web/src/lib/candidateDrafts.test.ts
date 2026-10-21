import { afterEach, expect, it } from "vitest";
import { clearCandidateDrafts, draftGeneration, readCandidateDraft, writeCandidateDraft } from "./candidateDrafts";
afterEach(clearCandidateDrafts);
it("separates account, job and input while restoring no approval state", () => {
  writeCandidateDraft("u1:a:reply", "Private reply", draftGeneration(), 1000);
  expect(readCandidateDraft("u1:a:reply", 2000)).toBe("Private reply");
  expect(readCandidateDraft("u2:a:reply", 2000)).toBe("");
  expect(readCandidateDraft("u1:b:reply", 2000)).toBe("");
  expect(readCandidateDraft("u1:a:invitation", 2000)).toBe("");
  expect(readCandidateDraft("u1:a:reply", 3_601_001)).toBe("");
});
it("clears drafts and rejects late writes on account change", () => {
  const stale = draftGeneration();
  writeCandidateDraft("u1:a:reply", "Private", stale);
  clearCandidateDrafts();
  writeCandidateDraft("u1:a:reply", "Late response", stale);
  expect(readCandidateDraft("u1:a:reply")).toBe("");
});
it("caps retained inputs and drops explicitly discarded text", () => {
  for (let n = 0; n < 11; n++) writeCandidateDraft(`${n}`, "Draft", draftGeneration());
  expect(readCandidateDraft("0")).toBe("");
  writeCandidateDraft("10", "", draftGeneration());
  expect(readCandidateDraft("10")).toBe("");
});
