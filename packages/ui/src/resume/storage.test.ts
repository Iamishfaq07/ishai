import { describe, expect, it } from "vitest";
import { linkedDocument, rememberDocument, type KeyValueStore } from "./storage";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("what the browser remembers", () => {
  it("remembers the document made from each resume, the most recent 50", () => {
    const store = memory();
    expect(linkedDocument("r1", store)).toBeNull();
    rememberDocument("r1", "d1", store);
    rememberDocument("r2", "d2", store);
    rememberDocument("r1", "d3", store); // a new copy replaced the deleted one
    expect(linkedDocument("r1", store)).toBe("d3");
    expect(linkedDocument("r2", store)).toBe("d2");
    for (let i = 0; i < 60; i++) rememberDocument(`x${i}`, `d${i}`, store);
    expect(linkedDocument("r2", store)).toBeNull(); // the oldest went
    expect(linkedDocument("x59", store)).toBe("d59");
    store.setItem("orbit.resumeDocuments", "not json");
    expect(linkedDocument("x59", store)).toBeNull();
    expect(linkedDocument("r1", null)).toBeNull(); // no storage at all
  });
});
