import { describe, expect, it } from "vitest";
import { cleanPrepContext, prepParams, readPrepContext } from "./prepContext";

describe("prep context", () => {
  it("survives reload in search params, including the technology and requirements", () => {
    const context = cleanPrepContext({ role: "Platform engineer", company: "Acme", interview_stage: "Final",
      tech_stack: ["Go", "Postgres"], key_requirements: ["Design a queue"] });
    expect(readPrepContext(prepParams(context, new URLSearchParams("preset=tech15")), "user")).toEqual(context);
    expect(prepParams(context, new URLSearchParams("preset=tech15")).get("preset")).toBe("tech15");
  });
  it("keeps account context isolated and lets an explicit URL override stored data", () => {
    const store = { getItem: (k: string) => k.endsWith(":alice") ? JSON.stringify({ role: "Engineer", company: "Acme" }) : null } as Storage;
    expect(readPrepContext(new URLSearchParams(), "bob", store).role).toBe("");
    expect(readPrepContext(new URLSearchParams("company=Other"), "alice", store)).toMatchObject({ role: "Engineer", company: "Other" });
  });
  it("recovers from corrupt or blocked storage and invalid list parameters", () => {
    const store = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readPrepContext(new URLSearchParams("role=Engineer&tech_stack=invalid"), "alice", store).tech_stack).toEqual([]);
  });
});
