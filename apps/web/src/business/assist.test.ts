import { describe, expect, it } from "vitest";
import type { BizJobAssist } from "@orbit/types";
import { applyAssist, collect, current, editorState, fieldOf, summarize, touch, undoAll, undoField, type Marks } from "./assist";
import { emptyJob } from "./model";

const answer = (over: Partial<BizJobAssist> = {}): BizJobAssist => ({
  title: "Senior React Developer",
  department: "Engineering",
  locations: ["Bengaluru, IN"],
  workplace: "hybrid",
  allowed_countries: [],
  employment_type: "full_time",
  experience: "senior",
  salary_min: 1_800_000,
  salary_max: 2_800_000,
  salary_currency: "INR",
  salary_period: "year",
  show_salary: true,
  description_html: "<h3>About the role</h3><p>You'll build the screens.</p>",
  must_haves: ["React", "5+ years of professional experience"],
  nice_to_haves: [],
  questions: [{ id: "q1", text: "Are you authorised to work in India?", kind: "yes_no", required: true, knockout: { equals: "yes" } }],
  stages: null,
  assumptions: ["Assumed full-time because you didn't say otherwise."],
  inclusive_language_notes: [],
  changed_fields: ["title", "department", "locations", "workplace", "employment_type", "experience", "salary", "description", "must_haves", "questions"],
  source: "ai",
  ...over,
});

describe("the job assistant's editor state", () => {
  it("fills every changed field and marks it", () => {
    const s = editorState(emptyJob());
    const r = applyAssist(s, answer(), {}, "fill");
    const input = collect(r.state);
    expect(input.title).toBe("Senior React Developer");
    expect(input.locations).toEqual(["Bengaluru, IN"]);
    expect(input.must_haves).toEqual(["React", "5+ years of professional experience"]);
    expect([input.salary_min, input.salary_max, input.salary_currency]).toEqual([1_800_000, 2_800_000, "INR"]);
    expect(input.questions).toHaveLength(1);
    // employment_type was already full-time: not a change, so no mark.
    expect(r.changed).not.toContain("employment_type");
    expect(Object.keys(r.marks).sort()).toEqual([...r.changed].sort());
    expect(r.summary).toMatch(/^Filled 9 fields: title, department, description/);
    // Stages stay as they are when the answer has none.
    expect(input.stages).toEqual(emptyJob().stages);
  });

  it("never wipes pay the person typed when the fill has none", () => {
    const s = editorState({ ...emptyJob(), salary_min: 500_000, salary_max: 700_000 });
    const r = applyAssist(s, answer({ salary_min: null, salary_max: null }), {}, "fill");
    expect([r.state.form.salary_min, r.state.form.salary_max]).toEqual([500_000, 700_000]);
    expect("salary" in r.marks).toBe(false);
  });

  it("undoes one field back to the person's own value, even after a refine", () => {
    const s = editorState({ ...emptyJob(), title: "Frontend dev" });
    const fill = applyAssist(s, answer(), {}, "fill");
    const refine = applyAssist(fill.state, answer({ title: "React Developer", changed_fields: ["title"] }), fill.marks, "refine");
    expect(refine.state.form.title).toBe("React Developer");
    const u = undoField(refine.state, refine.marks, "title");
    expect(u.state.form.title).toBe("Frontend dev");
    expect("title" in u.marks).toBe(false);
    expect(u.state.form.department).toBe("Engineering"); // the rest stays filled
    expect(u.state.mustText).toBe("React\n5+ years of professional experience");
  });

  it("undoes the whole fill", () => {
    const s = editorState(emptyJob());
    const fill = applyAssist(s, answer(), {}, "fill");
    const u = undoAll(fill.state, fill.marks);
    expect(collect(u.state)).toEqual(collect(s));
    expect(u.marks).toEqual({});
  });

  it("a field the person edits loses its mark", () => {
    const marks: Marks = { title: "", experience: "mid" };
    expect(touch(marks, "title")).toEqual({ experience: "mid" });
    expect(touch(marks, "salary")).toBe(marks);
    expect(fieldOf("salary_max")).toBe("salary");
    expect(fieldOf("description_html")).toBe("description");
    expect(fieldOf("hiring_team")).toBeNull();
  });

  it("a refine changes only its fields and says what changed", () => {
    const fill = applyAssist(editorState(emptyJob()), answer(), {}, "fill");
    const before = fill.state;
    const r = applyAssist(
      before,
      answer({
        experience: "mid",
        description_html: "<p>Shorter.</p>",
        questions: [...answer().questions, { id: "q2", text: "How soon could you start?", kind: "choice", choices: ["Immediately", "Within 30 days"], required: true, knockout: null }],
        title: "Something else entirely",
        changed_fields: ["experience", "description", "questions"],
      }),
      fill.marks,
      "refine",
    );
    expect(r.state.form.title).toBe("Senior React Developer"); // not in changed_fields
    expect(r.changed).toEqual(["description", "experience", "questions"]);
    expect(r.summary).toBe("Changed: description, experience band, 1 question added.");
    expect(summarize("refine", before, before, [])).toBe("No changes.");
  });

  it("sends the form without the hiring team for a refine", () => {
    const s = editorState({ ...emptyJob(), hiring_team: ["u1"], title: "X" });
    const c = current(s);
    expect("hiring_team" in c).toBe(false);
    expect("valid_through" in c).toBe(false);
    expect(c.title).toBe("X");
  });
});
