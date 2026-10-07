import { describe, expect, it } from "vitest";
import { baseCommands, normalize, recentCommands, scoreCommand, searchCommands, type Command } from "./palette";
import { isTypingTarget } from "./shell";

const base = baseCommands({ mockEnabled: true });
const recent = recentCommands({
  resumes: [{ id: "r1", title: "Data analyst resume", score: 72 }],
  sessions: [
    { id: "s1", title: "Mock — HR round", status: "ended" },
    { id: "s2", title: "Razorpay call", status: "live" },
  ],
  tracker: [
    { id: "t1", listing_id: "L9", company: "Razorpay", title: "SDE-1", status: "applied" },
    { id: "t2", listing_id: "ext:abc", company: "Infosys", title: "Systems engineer", status: "saved" },
  ],
});
const all = [...recent, ...base];
const top = (q: string, list: Command[] = all) => searchCommands(q, list)[0]?.id;

describe("searchCommands (the command palette)", () => {
  it("finds pages and actions by their names", () => {
    expect(top("tracker")).toBe("go-tracker");
    expect(top("settings")).toBe("go-settings");
    expect(top("start a live")).toBe("do-live");
  });

  it("understands the words people type", () => {
    expect(top("cv")).toMatch(/^(do-resume|go-resume-ai|resume-r1)$/);
    expect(searchCommands("jd", all).map((c) => c.id)).toContain("go-documents");
    expect(top("upi")).toBe("do-credits");
    expect(top("logout")).toBe("do-sign-out");
    expect(top("dark mode")).toBe("do-theme");
    expect(top("whatsapp")).toBe("do-help");
  });

  it("puts a title that starts with the query first", () => {
    expect(top("job")).toBe("go-jobs");
    expect(top("story")).toBe("go-stories");
  });

  it("needs every word to match", () => {
    expect(searchCommands("resume zebra", all)).toHaveLength(0);
    // The session's title starts with the word, so it leads; the job has it later in its title.
    expect(searchCommands("razorpay", all).map((c) => c.id)).toEqual(["session-s2", "job-t1"]);
  });

  it("forgives a missing letter or two", () => {
    expect(searchCommands("trckr", all).map((c) => c.id)).toContain("go-tracker");
    expect(searchCommands("settngs", all).map((c) => c.id)).toContain("go-settings");
  });

  it("matches loose spelling within a word, not across a whole title", () => {
    const ids = searchCommands("trac", all).map((c) => c.id);
    expect(ids[0]).toBe("go-tracker");
    expect(ids).not.toContain("do-mock"); // "sTaRt A moCk interview"
  });

  it("ignores case, accents and punctuation", () => {
    expect(normalize("  Résumé AI! ")).toBe("resume ai");
    expect(top("RÉSUMÉ AI")).toBe("go-resume-ai");
  });

  it("lists everything in group order with no query", () => {
    const list = searchCommands("", all, 100);
    expect(list).toHaveLength(all.length);
    const groups = list.map((c) => c.group);
    expect(groups.indexOf("Actions")).toBeGreaterThan(groups.lastIndexOf("Recent"));
    expect(groups.indexOf("Go to")).toBeGreaterThan(groups.indexOf("Actions"));
  });

  it("caps the list", () => {
    expect(searchCommands("", all, 5)).toHaveLength(5);
  });

  it("scores nothing for a miss and something for an empty query", () => {
    const home = base.find((c) => c.id === "go-home") as Command;
    expect(scoreCommand("zzz", home)).toBe(0);
    expect(scoreCommand("", home)).toBeGreaterThan(0);
  });
});

describe("baseCommands and recentCommands", () => {
  it("leaves Practice out when mock interviews are off", () => {
    const ids = baseCommands({ mockEnabled: false }).map((c) => c.id);
    expect(ids).not.toContain("do-mock");
    expect(ids).not.toContain("go-practice");
    expect(ids).toContain("do-warmup");
  });

  it("has unique ids", () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("opens each recent thing in the right place", () => {
    const to = Object.fromEntries(recent.map((c) => [c.id, c.to]));
    expect(to).toEqual({
      "resume-r1": "/resume-ai/r1",
      "session-s1": "/sessions/s1",
      "session-s2": "/live/s2",
      "job-t1": "/jobs/listing/L9",
      "job-t2": "/jobs/tracker",
    });
    expect(recent.find((c) => c.id === "job-t1")?.title).toBe("SDE-1 at Razorpay");
    expect(recent.find((c) => c.id === "job-t1")?.hint).toBe("Tracker · Applied");
  });

  it("keeps five of each at most", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, title: `R${i}`, score: 50 }));
    expect(recentCommands({ resumes: many })).toHaveLength(5);
    expect(recentCommands({})).toEqual([]);
  });
});

describe("isTypingTarget (where '/' is typing, not search)", () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
  it("is true in text fields", () => {
    expect(isTypingTarget(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("is false elsewhere", () => {
    expect(isTypingTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(el("DIV", { isContentEditable: false }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
