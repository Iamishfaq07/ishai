import { safeLocal } from "@orbit/ui";
import { clearLegacyBrowserAccount } from "../../lib/browserAccount";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discussionPhase, secondsLeft } from "../../lib/practiceClock";
import { gapAnswer } from "./gaps";
import { parseUsername, projectEntry, toRepo } from "./github";
import { importGitHub } from "./githubImport";
import { validAptitudeHistory, validDiscussionHistory } from "./practiceHistory";
import { validBulletDraft, validGapDraft, validStarDraft } from "./toolDrafts";

const repo = (name: string) => ({ name, html_url: `https://github.com/alice/${name}`, pushed_at: "invalid" });
afterEach(() => vi.unstubAllGlobals());
describe("practice deadlines", () => {
  it("catches up after a suspended tab and rounds remaining seconds up", () => {
    expect(secondsLeft(10000, 9001)).toBe(1);
    expect(secondsLeft(10000, 20000)).toBe(0);
    expect(discussionPhase(120000, 121000, 300)).toEqual({ phase: "talk", deadline: 420000, left: 299 });
    expect(discussionPhase(120000, 500000, 300)).toEqual({ phase: "review", deadline: 420000, left: 0 });
    expect(discussionPhase(120000, 0, 300).phase).toBe("prep");
  });
});
it("rejects malformed or oversized drafts and histories before rendering", () => {
  expect(validBulletDraft({ did: "", result: "", measure: "" })).toBe(true);
  expect(validBulletDraft({ did: "", result: null, measure: "" })).toBe(false);
  expect(validStarDraft({ question: "Q", answer: "x".repeat(20001) })).toBe(false);
  expect(validGapDraft({ reason: "health", from: "2024", to: "", during: "", role: "" })).toBe(true);
  expect(validGapDraft({ reason: "other" })).toBe(false);
  expect(validAptitudeHistory([{ at: new Date().toISOString(), score: 11, total: 10, sections: ["quant"] }])).toBe(false);
  expect(validDiscussionHistory([{ at: "bad", topic: "T", ticks: 1 }])).toBe(false);
});
it("does not invent recovery or layoff circumstances", () => {
  const draft = { from: "2024", to: "2025", during: "", role: "" };
  expect(gapAnswer({ ...draft, reason: "health" })).not.toMatch(/resolved|behind me|full-time|skills current/);
  expect(gapAnswer({ ...draft, reason: "layoff" })).not.toContain("company-wide");
});
it("accepts profiles but rejects repository URLs and lookalike hosts", () => {
  expect(parseUsername("https://github.com/octocat/")).toBe("octocat");
  expect(parseUsername("@octocat")).toBe("octocat");
  for (const url of ["https://github.com/owner/repo", "https://github.com.evil.org/alice", "https://alice@github.com/alice"]) expect(parseUsername(url)).toBeNull();
  expect(toRepo({ ...repo("app"), private: true })).toBeNull();
  expect(toRepo({ ...repo("app"), html_url: "javascript:alert(1)" })).toBeNull();
  const valid = toRepo({ ...repo("app"), stargazers_count: -4 })!;
  expect(valid.pushedAt).toBe(""); expect(valid.stars).toBe(0);
  expect(projectEntry(valid).bullet).toContain("your own contribution");
  expect(projectEntry(valid).bullet).not.toContain("Built");
});
it("paginates, deduplicates repositories and reports partial failures", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => repo(`app-${i}`)))))
    .mockResolvedValueOnce(new Response(JSON.stringify([repo("extra"), repo("app-0")])));
  vi.stubGlobal("fetch", fetcher);
  const result = await importGitHub("alice", new AbortController().signal);
  expect(result.repos).toHaveLength(101); expect(result.warning).toBeNull();
  expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  fetcher.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => repo(`app-${i}`)))))
    .mockResolvedValueOnce(new Response("{}", { status: 429 }));
  const partial = await importGitHub("alice", new AbortController().signal);
  expect(partial.repos).toHaveLength(100); expect(partial.warning).toContain("Only some");
});
it("rejects malformed imports and propagates cancellation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"message":"unexpected"}')));
  await expect(importGitHub("alice", new AbortController().signal)).rejects.toThrow("unexpected response");
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
  await expect(importGitHub("alice", controller.signal)).rejects.toThrow("Aborted");
});

it("clears device-only tool history and unowned legacy drafts at account change", () => {
  safeLocal.setItem("orbit.tool-local.alice.aptitude", "private-score");
  safeLocal.setItem("orbit.tool-local.alice.github-user", "alice");
  safeLocal.setItem("orbit.star-check.draft", "private-answer");
  clearLegacyBrowserAccount();
  expect(safeLocal.getItem("orbit.tool-local.alice.aptitude")).toBeNull();
  expect(safeLocal.getItem("orbit.tool-local.alice.github-user")).toBeNull();
  expect(safeLocal.getItem("orbit.star-check.draft")).toBeNull();
});
