import { describe, expect, it } from "vitest";
import {
  KIT_SHOWN_FIRST,
  countWords,
  linesOver,
  loadKit,
  saveKit,
  shownFirst,
  skillList,
} from "./kit";
import type { KeyValueStore } from "./storage";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("counters and cut-offs", () => {
  it("counts words however they're spaced", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  Hi Priya,\n\nI'm a  data analyst. ")).toBe(6);
  });

  it("shows what a site shows first, ending on a whole word", () => {
    const headline = "Data Analyst | 3+ yrs | SQL, Python, Power BI | Retail analytics | Cut reporting time";
    const first = shownFirst(headline, KIT_SHOWN_FIRST.headline);
    expect(first.length).toBeLessThanOrEqual(KIT_SHOWN_FIRST.headline);
    expect(headline.startsWith(first)).toBe(true);
    expect(first).toBe("Data Analyst | 3+ yrs | SQL, Python, Power BI | Retail");
    expect(shownFirst("Short headline", 60)).toBe(""); // it all shows
  });

  it("reads a skills list typed any way, without repeats", () => {
    expect(skillList("Python, SQL; Power BI\nExcel, python,  ")).toEqual(["Python", "SQL", "Power BI", "Excel"]);
  });

  it("says how many printed lines a resume is over one page", () => {
    // 10 pt at 1.4 line height is about 18.7 px a line.
    expect(linesOver(1100, 1000, 10, 1.4)).toBe(6);
    expect(linesOver(1001, 1000, 10, 1.4)).toBe(1);
    expect(linesOver(999, 1000, 10, 1.4)).toBe(1); // asked only when it doesn't fit: never 0
    expect(linesOver(1e6, 1000, 10, 1.4)).toBe(200);
  });
});

describe("what the browser keeps", () => {
  it("saves profiles and messages per resume and drops what's malformed", () => {
    const store = memory();
    saveKit("r1", {
      naukri: { headline: "Data Analyst | SQL", summary: "I analyse sales data.", skills: ["SQL"] },
      messages: { referral: { kind: "referral", subject: "", connection_note: "Hi Priya", message: "Hi Priya,\n\nHello" } },
      inputs: { recipient: "Priya", company: "Acme" },
    }, store);
    const kit = loadKit("r1", store);
    expect(kit.naukri?.skills).toEqual(["SQL"]);
    expect(kit.messages?.referral?.connection_note).toBe("Hi Priya");
    expect(kit.inputs).toEqual({ recipient: "Priya", company: "Acme", role: "", details: "" });
    expect(loadKit("r2", store)).toEqual({});

    store.setItem("orbit.resumeKit.r3", JSON.stringify({ naukri: { headline: 5, skills: ["SQL", 7] }, linkedin: [], messages: { spam: {} } }));
    expect(loadKit("r3", store)).toEqual({ naukri: { headline: "", summary: "", skills: ["SQL"] }, messages: {} });
  });
});
