// Orbit for Business: the job assistant's editor state (D85). The pure part of the "Orbit assistant" panel: putting a
// fill or a refine into the job editor, remembering what each field held before the AI changed it (for the per-field
// and the global undo), forgetting that once the person edits the field, and the short summary of a refine
// ("Changed: experience band, description, 1 question added").
import type { BizAssistField, BizJobAssist, BizJobAssistCurrent, BizJobInput } from "@orbit/types";
import { commaList, lines } from "./model";

/** The job editor's state: the form, and the text areas it keeps as typed (one location or requirement per line). */
export interface EditorState {
  form: BizJobInput;
  locText: string;
  countriesText: string;
  mustText: string;
  niceText: string;
}

type Salary = Pick<BizJobInput, "salary_min" | "salary_max" | "salary_currency" | "salary_period" | "show_salary">;
type Value = string | BizJobInput[keyof BizJobInput] | Salary;

/** What each AI-changed field held before the AI first changed it. A field in here shows the "AI" mark. */
export type Marks = Partial<Record<BizAssistField, Value>>;

export const FIELD_LABEL: Record<BizAssistField, string> = {
  title: "title",
  department: "department",
  locations: "location",
  workplace: "workplace",
  allowed_countries: "who can apply",
  employment_type: "employment type",
  experience: "experience band",
  salary: "pay",
  description: "description",
  must_haves: "must-haves",
  nice_to_haves: "nice-to-haves",
  questions: "screening questions",
  stages: "stages",
};

export const ORDER: BizAssistField[] = ["title", "department", "description", "workplace", "employment_type", "experience", "locations", "allowed_countries", "salary", "must_haves", "nice_to_haves", "questions", "stages"];

export function editorState(form: BizJobInput): EditorState {
  return {
    form,
    locText: form.locations.join("\n"),
    countriesText: form.allowed_countries.join(", "),
    mustText: form.must_haves.join("\n"),
    niceText: form.nice_to_haves.join("\n"),
  };
}

/** The form as the API reads it: the text areas turned into lists. */
export function collect(s: EditorState): BizJobInput {
  return { ...s.form, locations: lines(s.locText), allowed_countries: commaList(s.countriesText, true), must_haves: lines(s.mustText), nice_to_haves: lines(s.niceText) };
}

/** The form for a refine (the assistant never touches the hiring team or the closing date). */
export function current(s: EditorState): BizJobAssistCurrent {
  const { hiring_team: _team, valid_through: _until, ...rest } = collect(s);
  void _team;
  void _until;
  return rest;
}

export function readField(s: EditorState, f: BizAssistField): Value {
  const { form } = s;
  switch (f) {
    case "locations":
      return s.locText;
    case "allowed_countries":
      return s.countriesText;
    case "must_haves":
      return s.mustText;
    case "nice_to_haves":
      return s.niceText;
    case "description":
      return form.description_html;
    case "salary":
      return { salary_min: form.salary_min ?? null, salary_max: form.salary_max ?? null, salary_currency: form.salary_currency, salary_period: form.salary_period, show_salary: form.show_salary };
    default:
      return form[f];
  }
}

export function writeField(s: EditorState, f: BizAssistField, v: Value): EditorState {
  switch (f) {
    case "locations":
      return { ...s, locText: v as string };
    case "allowed_countries":
      return { ...s, countriesText: v as string };
    case "must_haves":
      return { ...s, mustText: v as string };
    case "nice_to_haves":
      return { ...s, niceText: v as string };
    case "description":
      return { ...s, form: { ...s.form, description_html: v as string } };
    case "salary":
      return { ...s, form: { ...s.form, ...(v as Salary) } };
    default:
      return { ...s, form: { ...s.form, [f]: v } };
  }
}

/** The value an answer gives a field, in the editor's shape. */
function answerValue(a: BizJobAssist, f: BizAssistField): Value {
  switch (f) {
    case "locations":
      return a.locations.join("\n");
    case "allowed_countries":
      return a.allowed_countries.join(", ");
    case "must_haves":
      return a.must_haves.join("\n");
    case "nice_to_haves":
      return a.nice_to_haves.join("\n");
    case "description":
      return a.description_html;
    case "salary":
      return { salary_min: a.salary_min, salary_max: a.salary_max, salary_currency: a.salary_currency, salary_period: a.salary_period, show_salary: a.show_salary };
    case "stages":
      return a.stages ?? undefined;
    default:
      return a[f];
  }
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export interface Applied {
  state: EditorState;
  marks: Marks;
  /** The fields that really changed in the editor, in form order. */
  changed: BizAssistField[];
  summary: string;
}

/** Put an answer into the editor: only its `changed_fields` (a refine changes only what it was asked to). A field
 *  keeps the value it had before the AI first changed it, so undo after a fill and two refines gives the person's
 *  own value back. The salary is only ever written when the answer has one or clears one the AI set: a fill never
 *  wipes pay the person typed. */
export function applyAssist(s: EditorState, a: BizJobAssist, marks: Marks, kind: "fill" | "refine"): Applied {
  let state = s;
  const next: Marks = { ...marks };
  const changed: BizAssistField[] = [];
  for (const f of ORDER) {
    if (!a.changed_fields.includes(f)) continue;
    if (f === "stages" && a.stages == null) continue;
    const v = answerValue(a, f);
    if (f === "salary" && kind === "fill" && a.salary_min == null && a.salary_max == null) continue;
    const before = readField(state, f);
    if (same(before, v)) continue;
    if (!(f in next)) next[f] = before;
    state = writeField(state, f, v);
    changed.push(f);
  }
  return { state, marks: next, changed, summary: summarize(kind, s, state, changed) };
}

export function summarize(kind: "fill" | "refine", before: EditorState, after: EditorState, changed: BizAssistField[]): string {
  if (changed.length === 0) return kind === "fill" ? "Nothing to fill: the form already says this." : "No changes.";
  const parts: string[] = [];
  for (const f of changed) {
    if (f === "questions" && kind === "refine") {
      const was = before.form.questions;
      const now = after.form.questions;
      const added = now.filter((q) => !was.some((w) => w.id === q.id)).length;
      const removed = was.filter((w) => !now.some((q) => q.id === w.id)).length;
      if (added) parts.push(`${added} question${added === 1 ? "" : "s"} added`);
      if (removed) parts.push(`${removed} question${removed === 1 ? "" : "s"} removed`);
      if (!added && !removed) parts.push("screening questions");
    } else {
      parts.push(FIELD_LABEL[f]);
    }
  }
  if (kind === "fill") return `Filled ${changed.length} field${changed.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
  return `Changed: ${parts.join(", ")}.`;
}

/** Back to what the field held before the AI changed it. */
export function undoField(s: EditorState, marks: Marks, f: BizAssistField): { state: EditorState; marks: Marks } {
  if (!(f in marks)) return { state: s, marks };
  const { [f]: before, ...rest } = marks;
  return { state: writeField(s, f, before as Value), marks: rest };
}

export function undoAll(s: EditorState, marks: Marks): { state: EditorState; marks: Marks } {
  let state = s;
  for (const f of Object.keys(marks) as BizAssistField[]) state = writeField(state, f, marks[f] as Value);
  return { state, marks: {} };
}

/** The person edited the field: it's theirs now (no AI mark, no undo for it). */
export function touch(marks: Marks, f: BizAssistField): Marks {
  if (!(f in marks)) return marks;
  const { [f]: _gone, ...rest } = marks;
  void _gone;
  return rest;
}

/** Which assistant field a form key belongs to (for `touch` when the person edits). */
export function fieldOf(key: keyof BizJobInput): BizAssistField | null {
  switch (key) {
    case "salary_min":
    case "salary_max":
    case "salary_currency":
    case "salary_period":
    case "show_salary":
      return "salary";
    case "description_html":
      return "description";
    case "title":
    case "department":
    case "locations":
    case "workplace":
    case "allowed_countries":
    case "employment_type":
    case "experience":
    case "must_haves":
    case "nice_to_haves":
    case "questions":
    case "stages":
      return key;
    default:
      return null;
  }
}

/** One fill or refine, as the panel lists it. */
export interface AssistTurn {
  id: number;
  kind: "fill" | "refine";
  /** What the person typed (the description or the instruction). */
  said: string;
  summary: string;
  assumptions: string[];
  notes: string[];
  /** The AI couldn't be reached: what the words say, laid out. */
  template: boolean;
}

/** The panel's inputs and history, kept by the editor so they survive closing the phone sheet. */
export interface PanelState {
  prompt: string;
  title: string;
  location: string;
  salary: string;
  experience: string;
  pasted: string;
  more: boolean;
  instruction: string;
  turns: AssistTurn[];
}

export function emptyPanel(): PanelState {
  return { prompt: "", title: "", location: "", salary: "", experience: "", pasted: "", more: false, instruction: "", turns: [] };
}

export function turnFrom(id: number, kind: "fill" | "refine", said: string, a: BizJobAssist, applied: Applied): AssistTurn {
  return { id, kind, said, summary: applied.summary, assumptions: a.assumptions, notes: a.inclusive_language_notes, template: a.source === "template" };
}

export const EXAMPLES = [
  "Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ yrs",
  "Sales executive Mumbai, fresher OK",
  "Remote backend engineer, Go, Europe time zones, $90–120k",
];

export const REFINES = ["Make it more junior", "Shorter description", "Add a notice period question", "Add Hindi requirement"];

export const SALARY_HINT = "Add a range: jobs with salary get more applicants and show better on Google.";
