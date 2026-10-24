import { beforeEach, describe, expect, it } from "vitest";
import { safeLocal } from "@orbit/ui";
import { clearWorkspaceDrafts, readWorkspaceDraft, workspaceKey } from "./careerWorkspace";
import { validCampus, validPriority, validReadiness } from "./workspaceValidation";
import { prepPackHtml } from "./prepPack";
import { validProjects } from "../pages/learn/projects";

describe("career workspace boundaries", () => {
  beforeEach(clearWorkspaceDrafts);
  it("scopes recovery to the account and clears it at sign-out", () => {
    safeLocal.setItem(workspaceKey("alice", "readiness"), JSON.stringify({ revision: 2, data: [{ skill: "SQL", evidence: [] }] }));
    expect(readWorkspaceDraft("alice", "readiness", validReadiness)?.revision).toBe(2);
    expect(readWorkspaceDraft("bob", "readiness", validReadiness)).toBeNull();
    clearWorkspaceDrafts();
    expect(readWorkspaceDraft("alice", "readiness", validReadiness)).toBeNull();
  });
  it("rejects malformed recovered data before rendering it", () => {
    expect(validReadiness([{ skill: 42, evidence: [] }])).toBe(false);
    expect(validReadiness([{ skill: "SQL", evidence: {} }])).toBe(false);
    expect(validCampus({ marks: null, drives: [] })).toBe(false);
    expect(validPriority({ weights: {}, ratings: { id: "bad" }, resumeId: null })).toBe(false);
    expect(validProjects({ work: { data: null } })).toBe(false);
    safeLocal.setItem(workspaceKey("alice", "readiness"), JSON.stringify({ revision: -1, data: [] }));
    expect(readWorkspaceDraft("alice", "readiness", validReadiness)).toBeNull();
  });
  it("renders portable prep as escaped text with no executable or remote content", () => {
    const html = prepPackHtml({ title: '<img src="https://evil.test">', generated_at: "today", sections: [{ title: "Notes", text: "</pre><script>alert(1)</script>" }] });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
});
