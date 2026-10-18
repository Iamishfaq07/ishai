import { describe, expect, it } from "vitest";
import type { BizApplicationListItem } from "@orbit/types";
import {
  DEFAULT_STAGES,
  applyMove,
  checkSlots,
  commaList,
  describeKnockout,
  domainOf,
  embedSnippet,
  fillTemplate,
  groupByStage,
  knockoutForm,
  knockoutRule,
  lines,
  matchLabel,
  mentionedMembers,
  moveItem,
  neighbourStage,
  passesKnockout,
  questionProblems,
  resumeFileProblem,
  salaryLine,
  sortApplications,
  stageProblems,
  toggleId,
} from "./model";
import { markdownToHtml, safeHref } from "./richText";

const app = (over: Partial<BizApplicationListItem>): BizApplicationListItem => ({
  id: "a",
  reference: "A-1",
  name: "Asha",
  email: "a@x.com",
  headline: null,
  stage_id: "applied",
  status: "active",
  source: "careers",
  tags: [],
  applied_at: "2026-10-01T10:00:00Z",
  stage_changed_at: "2026-10-01T10:00:00Z",
  email_confirmed: true,
  via_orbit: false,
  knockout_failed: false,
  knockout_reasons: [],
  ranking_status: "done",
  score: 50,
  must_haves_met: 3,
  must_haves_total: 4,
  match_label: null,
  deletion_requested: false,
  ...over,
});

describe("knock-out rules", () => {
  it("round-trips the editor form to the saved rule per kind", () => {
    expect(knockoutRule("yes_no", { ...knockoutForm({ kind: "yes_no", knockout: null }), on: true, equals: "no" })).toEqual({ equals: "no" });
    expect(knockoutRule("yes_no", knockoutForm({ kind: "yes_no", knockout: null }))).toBeNull(); // off
    const f = knockoutForm({ kind: "choice", knockout: { any_of: ["A", "Z"] } });
    expect(f.on).toBe(true);
    expect(knockoutRule("choice", f, ["A", "B"])).toEqual({ any_of: ["A"] }); // a removed choice drops out
    expect(knockoutRule("choice", { ...f, anyOf: [] }, ["A"])).toBeNull();
    expect(knockoutRule("number", { ...f, min: "2", max: "" })).toEqual({ min: 2 });
    expect(knockoutRule("number", { ...f, min: "x", max: "" })).toBeNull();
    expect(knockoutRule("short_text", { ...f, on: true })).toBeNull();
    expect(knockoutForm({ kind: "number", knockout: { min: 0, max: 5 } })).toMatchObject({ min: "0", max: "5" });
  });

  it("describes and checks rules", () => {
    expect(describeKnockout("yes_no", { equals: "yes" })).toBe("Must answer yes");
    expect(describeKnockout("number", { min: 1, max: 5 })).toBe("Between 1 and 5");
    expect(describeKnockout("number", { max: 5 })).toBe("At most 5");
    expect(describeKnockout("choice", null)).toBeNull();
    expect(passesKnockout("yes_no", { equals: "yes" }, "Yes")).toBe(true);
    expect(passesKnockout("yes_no", { equals: "yes" }, "no")).toBe(false);
    expect(passesKnockout("number", { min: 2 }, "1")).toBe(false);
    expect(passesKnockout("number", { min: 2 }, "")).toBe(false);
    expect(passesKnockout("choice", { any_of: ["B"] }, "B")).toBe(true);
    expect(passesKnockout("short_text", null, "")).toBe(true);
  });

  it("finds question problems", () => {
    expect(questionProblems([{ id: "1", text: "", kind: "yes_no", required: true }])).toEqual(["Question 1 has no text."]);
    expect(questionProblems([{ id: "1", text: "Pick", kind: "choice", choices: ["A", " "], required: true }])).toEqual([
      "Question 1 needs at least two choices.",
    ]);
  });
});

describe("stages and the kanban", () => {
  it("requires applied and rejected stages with unique names", () => {
    expect(stageProblems(DEFAULT_STAGES)).toEqual([]);
    expect(stageProblems(DEFAULT_STAGES.filter((s) => s.kind !== "rejected"))).toEqual(["Keep a Rejected stage."]);
    expect(stageProblems([...DEFAULT_STAGES, { id: "x", name: "screen", kind: "screen" }])).toContain("Two stages have the same name.");
  });

  it("moves list items", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 9)).toEqual([1, 2, 3]);
  });

  it("sorts knock-out failures last, then by score", () => {
    const items = [app({ id: "1", score: 90, knockout_failed: true }), app({ id: "2", score: 40 }), app({ id: "3", score: 70 }), app({ id: "4", score: null })];
    expect(sortApplications(items, "score").map((a) => a.id)).toEqual(["3", "2", "4", "1"]);
    expect(sortApplications([app({ id: "b", name: "Zed" }), app({ id: "a", name: "Ann" })], "name").map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("groups by stage and moves optimistically", () => {
    const items = [app({ id: "1" }), app({ id: "2", stage_id: "screen" })];
    const cols = groupByStage(DEFAULT_STAGES, items);
    expect(cols.map((c) => c.items.length)).toEqual([1, 1, 0, 0, 0, 0]);
    const moved = applyMove(items, ["1"], "interview", "2026-10-02T00:00:00Z");
    expect(moved[0]).toMatchObject({ stage_id: "interview", stage_changed_at: "2026-10-02T00:00:00Z" });
    expect(moved[1]).toBe(items[1]);
  });

  it("keyboard neighbours skip the rejected stage", () => {
    expect(neighbourStage(DEFAULT_STAGES, "applied", 1)?.id).toBe("screen");
    expect(neighbourStage(DEFAULT_STAGES, "applied", -1)).toBeNull();
    expect(neighbourStage(DEFAULT_STAGES, "hired", 1)).toBeNull();
  });

  it("toggles selection and labels matches", () => {
    expect(toggleId(["a"], "a")).toEqual([]);
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(matchLabel(app({ must_haves_met: 6, must_haves_total: 8 }))).toBe("Matches 6/8 must-haves");
    expect(matchLabel(app({ must_haves_met: null }))).toBeNull();
    expect(matchLabel(app({ match_label: "Matches all 3 must-haves" }))).toBe("Matches all 3 must-haves");
  });
});

describe("notes, templates, scheduling", () => {
  const members = [
    { user_id: "u1", name: "Asha Rao", email: "asha@acme.com" },
    { user_id: "u2", name: null, email: "dev.k@acme.com" },
  ];
  it("finds @mentions by first name, email name or email", () => {
    expect(mentionedMembers("cc @asha please", members)).toEqual(["u1"]);
    expect(mentionedMembers("@dev.k and @asha@acme.com", members).sort()).toEqual(["u1", "u2"]);
    expect(mentionedMembers("email me at x@y.com", members)).toEqual([]);
  });

  it("fills template variables and leaves unknown ones", () => {
    expect(fillTemplate("Hi {{candidate_name}}, re {{ job_title }} {{nope}}", { candidate_name: "Asha", job_title: "Dev" })).toBe("Hi Asha, re Dev {{nope}}");
  });

  it("checks interview slots", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(checkSlots(["2026-10-05T10:00", "2026-10-05T11:00"], now)).toEqual({ error: "Offer between 3 and 5 times." });
    expect(checkSlots(["2026-09-05T10:00", "2026-10-05T11:00", "2026-10-06T11:00"], now)).toEqual({ error: "Every time must be in the future." });
    expect(checkSlots(["2026-10-05T10:00Z", "2026-10-05T10:00Z", "2026-10-06T11:00Z"], now)).toEqual({ error: "Two of the times are the same." });
    const ok = checkSlots(["2026-10-06T11:00Z", "2026-10-05T10:00Z", "2026-10-05T12:00Z", ""], now);
    expect("slots" in ok && ok.slots[0]).toBe("2026-10-05T10:00:00.000Z");
  });
});

describe("careers page helpers", () => {
  it("writes salary lines", () => {
    expect(salaryLine({ min: 1200000, max: 1800000, currency: "INR", period: "year" })).toMatch(/12,00,000.*18,00,000 per year/);
    expect(salaryLine({ min: null, max: 50, currency: "USD", period: "hour" })).toBe("Up to $50 per hour");
    expect(salaryLine({ min: null, max: null, currency: "USD", period: "hour" })).toBeNull();
    expect(salaryLine(null)).toBeNull();
  });

  it("makes the embed snippet and checks resume files", () => {
    expect(embedSnippet("https://orbitanswer.com/", "acme")).toBe('<div data-orbit-jobs="acme"></div>\n<script async src="https://orbitanswer.com/embed.js"></script>');
    expect(resumeFileProblem({ name: "cv.pdf", size: 1000 })).toBeNull();
    expect(resumeFileProblem({ name: "cv.exe", size: 1000 })).toMatch(/PDF/);
    expect(resumeFileProblem({ name: "cv.docx", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });

  it("reads domains and lists", () => {
    expect(domainOf("https://www.Acme.com/about")).toBe("acme.com");
    expect(domainOf("acme.co.in")).toBe("acme.co.in");
    expect(domainOf("localhost")).toBeNull();
    expect(lines("- React\n\n* react\nTypeScript ")).toEqual(["React", "TypeScript"]);
    expect(commaList("in, us,IN", true)).toEqual(["IN", "US"]);
  });
});

describe("rich text", () => {
  it("only allows http(s) and mailto links", () => {
    expect(safeHref("https://acme.com")).toBe("https://acme.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" mailto:a@b.c")).toBe("mailto:a@b.c");
  });
  it("turns the AI writer's markdown into escaped HTML", () => {
    expect(markdownToHtml("## About\nWe **build** <b>things</b>\n- one\n- two\n1. first")).toBe(
      "<h3>About</h3><p>We <strong>build</strong> &lt;b&gt;things&lt;/b&gt;</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>",
    );
  });
});
