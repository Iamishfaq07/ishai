// Runs one application packet on an ATS form, in the page: read the questions, match each to the packet (never
// guess), stop and hand over to the candidate on anything Orbit can't truthfully do, else fill at a person's pace and
// report back. Submitting and confirming are separate steps driven by the service worker (the page may navigate).
import { classifyField, type ProfileKey } from "../fields";
import type { Adapter } from "./adapters/types";
import type { ApplicationPacket, ApplyReason, ApplyStatusValue, PacketAnswer, SubmittedPayload, UnknownQuestion } from "./contract";
import { blocker, postingClosed } from "./detect";
import { click, emit, fileFromBase64, keydown, mouse, pause, selectNative, setFile, setNativeValue, shown, sleep, text, typeInto, waitFor, winOf, pace } from "./dom";
import { asBoolean, declineOption, isConsent, isEeo, matchAnswer, normalize, pickOption, pickOptions } from "./match";
import { comboboxValue, hasValue, kindOf, questionShown, staticOptions, type Question } from "./questions";

export interface ResumeFile {
  b64: string;
  filename: string;
  type: string;
}

export type Value = string | string[] | boolean;

export type Step =
  | { q: Question; source: "field"; key: string; value: string }
  | { q: Question; source: "answer"; answer: PacketAnswer; value: Value }
  | { q: Question; source: "eeo" }
  | { q: Question; source: "resume" }
  | { q: Question; source: "cover_letter"; value: string };

export interface Plan {
  steps: Step[];
  unknown: Question[];
}

const NOT_PROFILE = /preferred|nick ?name|pronoun|referr|emergency|reference/i;
const EXTRA_FIELDS: [RegExp, string][] = [
  [/^(country|country of residence|phone country)$/, "country"],
  [/^(current )?(company|employer)$|^current company$/, "current_company"],
];

/** The packet's value for a standard field the question asks for, with the field's key. */
export function profileValue(q: Question, packet: ApplicationPacket): { key: string; value: string } | null {
  if (q.widget.type !== "text" && q.widget.type !== "combobox") return null;
  if (NOT_PROFILE.test(q.label)) return null;
  const norm = normalize(q.label);
  for (const [re, key] of EXTRA_FIELDS) if (re.test(norm)) return { key, value: packet.fields[key] ?? "" };
  const key = classifyField({ ...q.attrs, label: q.label, type: q.widget.type === "combobox" ? "text" : q.attrs.type });
  if (!key) return null;
  // A dropdown is only a standard field when it's the location.
  if (q.widget.type === "combobox" && key !== "location") return null;
  const f = packet.fields;
  const value = key === "full_name" ? [f.first_name, f.last_name].filter(Boolean).join(" ") : (f[key as Exclude<ProfileKey, "full_name">] ?? "");
  return { key, value };
}

/** Whether an answer fits the question's options as shown now (comboboxes are checked once opened). */
function answerFits(q: Question, value: Value): boolean {
  const w = q.widget;
  const options = staticOptions(w);
  switch (w.type) {
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "combobox":
      return typeof value === "string" || typeof value === "boolean" || Array.isArray(value);
    case "select":
    case "radio":
    case "yesno":
      return !Array.isArray(value) && pickOption(options, value) >= 0;
    case "checkboxes":
      return pickOptions(options, Array.isArray(value) ? value : [String(value)]) !== null;
    case "checkbox":
      return asBoolean(value) !== null;
    case "file":
      return false;
  }
}

/** Decides how each question on show is answered, and which required ones Orbit can't answer. Pure apart from
 * reading the DOM. */
export function plan(questions: Question[], packet: ApplicationPacket): Plan {
  const steps: Step[] = [];
  const unknown: Question[] = [];
  const answers = packet.answers ?? [];
  for (const q of questions) {
    if (!questionShown(q)) continue;
    const w = q.widget;
    if (w.type === "file") {
      if (q.role === "resume") steps.push({ q, source: "resume" });
      else if (q.role === "cover_letter" && packet.cover_letter) steps.push({ q, source: "cover_letter", value: packet.cover_letter });
      else if (q.required) unknown.push(q);
      continue;
    }
    const byId = q.questionId ? matchAnswer({ questionId: q.questionId, label: "" }, answers) : null;
    if (byId && answerFits(q, byId.value)) {
      steps.push({ q, source: "answer", answer: byId, value: byId.value });
      continue;
    }
    // Consent, privacy and attestation questions ("I certify…", even a typed signature): only an explicit answer.
    const consent = isConsent(q.label);
    if (!consent) {
      const field = profileValue(q, packet);
      if (field) {
        if (field.value) steps.push({ q, source: "field", key: field.key, value: field.value });
        else if (q.required) unknown.push(q);
        continue;
      }
      if (q.role === "cover_letter" && w.type === "text") {
        if (packet.cover_letter) steps.push({ q, source: "cover_letter", value: packet.cover_letter });
        else if (q.required) unknown.push(q);
        continue;
      }
    }
    const answer = matchAnswer(q, answers);
    if (answer && answerFits(q, answer.value)) {
      steps.push({ q, source: "answer", answer, value: answer.value });
      continue;
    }
    if (!consent && packet.eeo === "decline" && isEeo(q.label, q.section) && w.type !== "text") {
      const options = staticOptions(w);
      if (w.type === "combobox" || declineOption(options) >= 0) {
        steps.push({ q, source: "eeo" });
        continue;
      }
    }
    if (q.required) unknown.push(q);
  }
  return { steps, unknown };
}

// ---- Filling ----------------------------------------------------------------------------------------------------

const key = keydown;

function optionsFor(input: HTMLInputElement, container: Element): HTMLElement[] {
  const doc = input.ownerDocument;
  const sel = "[role=option], .select__option";
  const ids = `${input.getAttribute("aria-controls") ?? ""} ${input.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const list = doc.getElementById(id);
    const found = list ? [...list.querySelectorAll<HTMLElement>(sel)].filter((o) => shown(o)) : [];
    if (found.length) return found;
  }
  const inside = [...container.querySelectorAll<HTMLElement>(sel)].filter((o) => shown(o));
  if (inside.length) return inside;
  return [...doc.querySelectorAll<HTMLElement>(`[role=listbox] ${sel}, .select__menu ${sel}`)].filter((o) => shown(o) && !o.closest(".iti__country-list"));
}

async function openCombobox(input: HTMLInputElement, container: Element): Promise<HTMLElement[]> {
  input.focus();
  emit(input, "focus");
  const control = input.closest(".select__control") ?? input.parentElement;
  if (control) mouse(control, "mousedown");
  if (!optionsFor(input, container).length) key(input, "ArrowDown");
  return (await waitFor(() => {
    const o = optionsFor(input, container);
    return o.length ? o : null;
  }, 3000 * Math.max(pace(), 0.3))) ?? [];
}

function closeCombobox(input: HTMLInputElement): void {
  key(input, "Escape");
  input.blur();
}

/** The options a dropdown offers (opened, read, closed), for reporting a question Orbit can't answer. */
export async function readComboboxOptions(q: Question): Promise<string[]> {
  if (q.widget.type !== "combobox") return staticOptions(q.widget);
  const opts = (await openCombobox(q.widget.el, q.container)).map((o) => text(o)).filter((t) => t && !/^no options$/i.test(t));
  closeCombobox(q.widget.el);
  return opts.slice(0, 50);
}

/**
 * Picks an option in a searchable dropdown. `search` is typed first when the value is text (locations and long lists
 * filter as you type); `choose` returns the index of the option to take, or -1. Returns the option chosen, or null.
 */
async function chooseInCombobox(q: Question, search: string | null, choose: (options: string[]) => number, alwaysType = false): Promise<string | null> {
  if (q.widget.type !== "combobox") return null;
  const input = q.widget.el;
  let options = await openCombobox(input, q.container);
  if (search && (alwaysType || !options.length || choose(options.map(text)) < 0)) {
    for (let i = 1; i <= search.length; i++) {
      setNativeValue(input, search.slice(0, i));
      await sleep((40 + Math.random() * 60) * pace());
    }
    // Lists that load as you type (locations) need a moment.
    options = (await waitFor(() => {
      const o = optionsFor(input, q.container).filter((el) => !/^(no options|loading)/i.test(text(el)));
      return o.length && choose(o.map(text)) >= 0 ? o : null;
    }, 6000 * Math.max(pace(), 0.3))) ?? optionsFor(input, q.container);
  }
  const index = choose(options.map((o) => text(o)));
  if (index < 0) {
    if (search) setNativeValue(input, "");
    closeCombobox(input);
    return null;
  }
  const option = options[index]!;
  const label = text(option);
  await pause(150, 400);
  click(option);
  const ok = await waitFor(() => normalize(comboboxValue(input, q.container)) === normalize(label) || (hasValue(q) && !optionsFor(input, q.container).length), 2000);
  if (!ok) {
    key(input, "Enter");
    await sleep(200);
  }
  return normalize(comboboxValue(input, q.container)).includes(normalize(label)) || hasValue(q) ? label : null;
}

export interface FillContext {
  adapter: Adapter;
  packet: ApplicationPacket;
  resume: ResumeFile | null;
  /** Purple outline on each filled field (the hand-off view), as the basic "fill" does. */
  mark?: boolean;
}

export interface Entered {
  ok: boolean;
  /** What was entered, for the result's `submitted`. */
  value?: Value;
  /** Why not (an unknown question, a file the page didn't take). */
  problem?: "unknown" | "upload";
  note?: string;
}

function markFilled(q: Question): void {
  const el = "el" in q.widget ? q.widget.el : q.container;
  const target = q.widget.type === "file" || q.widget.type === "radio" || q.widget.type === "checkboxes" || q.widget.type === "yesno" ? q.container : el;
  (target as HTMLElement).setAttribute("data-orbit-filled", "auto-apply");
  (target as HTMLElement).style.outline = "2px solid #8b5cf6";
  (target as HTMLElement).style.outlineOffset = "1px";
}

async function attach(ctx: FillContext, q: Question, file: File): Promise<Entered> {
  if (q.widget.type !== "file") return { ok: false, problem: "upload" };
  if (!setFile(q.widget.el, file)) return { ok: false, problem: "upload", note: "the file input didn't take the file" };
  const state = await waitFor(() => {
    const s = ctx.adapter.upload(q, file.name);
    return s === "pending" ? null : s;
  }, 20_000, 250);
  if (state === "ok") return { ok: true, value: file.name };
  return { ok: false, problem: "upload", note: state === "failed" ? "the page showed an upload error" : "the page never showed the file as attached" };
}

/** Enters one planned answer. */
export async function enter(ctx: FillContext, step: Step): Promise<Entered> {
  const { q } = step;
  const w = q.widget;
  if (step.source === "resume") {
    if (!ctx.resume) return { ok: false, problem: "upload" };
    return attach(ctx, q, fileFromBase64(q.container.ownerDocument, ctx.resume.b64, ctx.resume.filename, ctx.resume.type));
  }
  if (step.source === "cover_letter" && w.type === "file") {
    const name = `${[ctx.packet.fields.first_name, ctx.packet.fields.last_name].filter(Boolean).join(" ") || "Cover"} - cover letter.txt`;
    return attach(ctx, q, new (winOf(q.container).File)([step.value], name, { type: "text/plain" }));
  }
  if (step.source === "eeo") {
    const options = staticOptions(w);
    if (w.type === "combobox") {
      const chosen = await chooseInCombobox(q, null, declineOption);
      return chosen ? { ok: true, value: chosen } : { ok: !q.required, problem: q.required ? "unknown" : undefined };
    }
    const index = declineOption(options);
    return index >= 0 ? pickIndex(q, index, options) : { ok: !q.required };
  }
  const value: Value = step.value;
  switch (w.type) {
    case "text": {
      const v = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : value;
      await typeInto(w.el, v);
      await ctx.adapter.afterType?.(q, v);
      return { ok: w.el.value.trim() !== "", value: w.el.value };
    }
    case "combobox": {
      if (Array.isArray(value)) {
        const chosen: string[] = [];
        for (const v of value) {
          const c = await chooseInCombobox(q, v, (opts) => pickOption(opts, v));
          if (!c) return { ok: false, problem: "unknown" };
          chosen.push(c);
        }
        return { ok: true, value: chosen };
      }
      const search = typeof value === "string" ? value : null;
      const choose = step.source === "field" ? (opts: string[]) => pickPlace(opts, String(value)) : (opts: string[]) => pickOption(opts, value);
      const chosen = await chooseInCombobox(q, search, choose, step.source === "field");
      return chosen ? { ok: true, value: chosen } : { ok: false, problem: "unknown" };
    }
    case "select":
    case "radio":
    case "yesno": {
      const options = staticOptions(w);
      const index = Array.isArray(value) ? -1 : pickOption(options, value);
      return index >= 0 ? pickIndex(q, index, options) : { ok: false, problem: "unknown" };
    }
    case "checkboxes": {
      const options = staticOptions(w);
      const picks = pickOptions(options, Array.isArray(value) ? value : [String(value)]);
      if (!picks) return { ok: false, problem: "unknown" };
      for (const i of picks) {
        const box = w.inputs[i]!;
        if (!box.checked) click(box);
        await pause(150, 450);
      }
      return { ok: picks.every((i) => w.inputs[i]!.checked), value: picks.map((i) => options[i]!) };
    }
    case "checkbox": {
      const want = asBoolean(value);
      if (want === null) return { ok: false, problem: "unknown" };
      if (w.el.checked !== want) click(w.el);
      return { ok: w.el.checked === want, value: want };
    }
    default:
      return { ok: false, problem: "unknown" };
  }
}

/** A place (location, country) in a dropdown: the exact one, else the only one whose first part is it ("Pune" ->
 * "Pune, Maharashtra, India"), else the only one that starts with it ("India" -> "India +91"). Several: none. */
export function pickPlace(options: string[], value: string): number {
  const exact = pickOption(options, value);
  if (exact >= 0) return exact;
  const want = normalize(value);
  if (!want) return -1;
  const unique = (hits: number[]) => (hits.length === 1 ? hits[0]! : -1);
  // "Bengaluru, Karnataka, India" for "Bengaluru", not "Bengaluru Rural, Karnataka, India".
  const head = unique(options.map((o, i) => (normalize(o.split(/[,(]/)[0] ?? "") === want ? i : -1)).filter((i) => i >= 0));
  if (head >= 0) return head;
  return unique(options.map((o, i) => (normalize(o).startsWith(want + " ") ? i : -1)).filter((i) => i >= 0));
}

async function pickIndex(q: Question, index: number, options: string[]): Promise<Entered> {
  const w = q.widget;
  if (w.type === "select") {
    const real = [...w.el.options].filter((o) => o.value !== "" && !o.disabled);
    selectNative(w.el, [...w.el.options].indexOf(real[index]!));
    return { ok: w.el.value === real[index]!.value, value: options[index]! };
  }
  if (w.type === "radio") {
    const input = w.inputs[index]!;
    if (!input.checked) click(input);
    return { ok: input.checked, value: options[index]! };
  }
  if (w.type === "yesno") {
    const button = w.buttons[index]!;
    click(button);
    await sleep(100);
    return { ok: true, value: options[index]! };
  }
  return { ok: false };
}

// ---- One run ------------------------------------------------------------------------------------------------------

export type RunOutcome =
  | { kind: "ready"; submitted: SubmittedPayload }
  | { kind: "stop"; status: ApplyStatusValue; reason: ApplyReason | null; unknown: UnknownQuestion[]; submitted: SubmittedPayload; detail: string };

async function describeUnknown(qs: Question[]): Promise<UnknownQuestion[]> {
  const out: UnknownQuestion[] = [];
  for (const q of qs) {
    const options = q.widget.type === "combobox" ? await readComboboxOptions(q) : staticOptions(q.widget);
    out.push({ label: q.label || q.questionId || "Untitled question", kind: kindOf(q.widget), ...(options.length ? { options } : {}) });
  }
  return out;
}

function record(submitted: SubmittedPayload, step: Step, value: Value | undefined): void {
  if (value === undefined) return;
  if (step.source === "field") submitted.fields[step.key] = String(value);
  else if (step.source !== "resume") submitted.answers.push({ question_id: step.q.questionId, label: step.q.label, value });
}

export interface RunOptions {
  /** Hand-off: fill everything Orbit can and leave the rest (and the submit) to the candidate. */
  handoff?: boolean;
}

/** Fills the form from the packet. Never submits: returns "ready" (everything required is filled, the page shows no
 * errors) or why it stopped. */
export async function fillApplication(doc: Document, ctx: FillContext, opts: RunOptions = {}): Promise<RunOutcome> {
  const submitted: SubmittedPayload = { fields: {}, answers: [] };
  const stop = (status: ApplyStatusValue, reason: ApplyReason | null, detail: string, unknown: UnknownQuestion[] = []): RunOutcome => ({ kind: "stop", status, reason, unknown, submitted, detail });
  const { adapter } = ctx;

  // React boards render the form after load; a sign-in wall or a closed posting ends the wait early.
  await waitFor(() => adapter.form(doc) || blocker(doc, false) || postingClosed(doc), 15_000 * Math.max(pace(), 0.05), 300);
  const form = adapter.form(doc);
  const early = blocker(doc, !!form);
  if (early && !opts.handoff) return stop("needs_you", early, `Stopped before filling: ${early}.`);
  if (!form) {
    if (postingClosed(doc)) return stop("skipped", null, "This posting no longer takes applications.");
    return stop("needs_you", "form_changed", "Orbit didn't recognise this application form.");
  }
  const first = adapter.questions(form);
  if (!first.some((q) => q.attrs.type === "email" || /e-?mail/i.test(q.label)) || !first.some((q) => q.widget.type === "file" || q.role === "resume")) {
    if (!opts.handoff) return stop("needs_you", "form_changed", "The form doesn't have the fields Orbit expects (email and resume).");
  }

  const handled = new Set<Element>();
  const mainOf = (q: Question) => ("el" in q.widget ? q.widget.el : "inputs" in q.widget ? q.widget.inputs[0]! : q.widget.buttons[0] ?? q.container);
  const unknownAll: Question[] = [];
  let uploadFailed = false;

  for (let pass = 0; pass < 4; pass++) {
    const questions = adapter.questions(form).filter((q) => !handled.has(mainOf(q)));
    if (!questions.length) break;
    const { steps, unknown } = plan(questions, ctx.packet);
    for (const q of [...steps.map((s) => s.q), ...unknown]) handled.add(mainOf(q));
    unknownAll.push(...unknown);
    if (unknownAll.length && !opts.handoff) {
      return stop("needs_you", "unknown_question", "A required question has no approved answer.", await describeUnknown(unknownAll));
    }
    // Files first: Lever and Ashby read the resume and prefill fields, which the packet's values then replace.
    const ordered = [...steps.filter((s) => s.source === "resume" || (s.source === "cover_letter" && s.q.widget.type === "file")), ...steps.filter((s) => !(s.source === "resume" || (s.source === "cover_letter" && s.q.widget.type === "file")))];
    for (const step of ordered) {
      if (step.source !== "resume" && adapter.busy(doc)) await waitFor(() => !adapter.busy(doc), 20_000, 300);
      if (!questionShown(step.q)) continue;
      await pause();
      const got = await enter(ctx, step);
      if (got.ok) {
        record(submitted, step, got.value);
        if (ctx.mark) markFilled(step.q);
        continue;
      }
      if (got.problem === "upload") {
        uploadFailed = true;
        if (!opts.handoff) return stop("needs_you", "error", `${step.q.label || "A file"} couldn't be attached: ${got.note ?? "no file"}.`);
        continue;
      }
      if (step.q.required) {
        unknownAll.push(step.q);
        if (!opts.handoff) return stop("needs_you", "unknown_question", "A required question has no matching option.", await describeUnknown([step.q]));
      }
    }
    await pause(400, 900);
  }

  if (opts.handoff) {
    return stop("needs_you", uploadFailed ? "error" : unknownAll.length ? "unknown_question" : null, "Filled for the candidate to finish.", await describeUnknown(unknownAll));
  }

  // Everything required must now show a value, and the page itself must show no errors.
  const missing = adapter.questions(form).filter((q) => questionShown(q) && q.required && !hasValue(q));
  if (missing.length) return stop("needs_you", "form_changed", "Some required fields didn't take a value.", await describeUnknown(missing));
  await sleep(300);
  const errors = adapter.errors(doc);
  if (errors.length) return stop("needs_you", "form_changed", `The page reports: ${errors.slice(0, 3).join(" / ")}`);
  const late = blocker(doc, true);
  if (late) return stop("needs_you", late, `Stopped before submitting: ${late}.`);
  if (!adapter.submitButton(form)) return stop("needs_you", "form_changed", "No submit button found.");
  return { kind: "ready", submitted };
}

/** Presses the form's own submit button (only after fillApplication returned "ready"). */
export function pressSubmit(doc: Document, adapter: Adapter): boolean {
  const form = adapter.form(doc);
  const button = form && adapter.submitButton(form);
  if (!button || (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true") return false;
  click(button);
  return true;
}

export interface PageCheck {
  success: string | null;
  captcha: boolean;
  emailVerification: boolean;
  blocked: boolean;
  errors: string[];
  formPresent: boolean;
  url: string;
}

export function checkPage(doc: Document, adapter: Adapter): PageCheck {
  const form = adapter.form(doc);
  const reason = blocker(doc, !!form);
  return {
    success: adapter.success(doc),
    captcha: reason === "captcha",
    emailVerification: reason === "email_verification",
    blocked: reason === "blocked" || /flagged as (possible )?spam/i.test(adapter.errors(doc).join(" ")),
    errors: adapter.errors(doc),
    formPresent: !!form,
    url: doc.location?.href ?? "",
  };
}

export type Verdict =
  | { done: false }
  | { done: true; status: ApplyStatusValue; reason: ApplyReason | null; confirmation: string | null };

/**
 * What a check after pressing submit means. Success only from the ATS's own success state: no confirmation within the
 * timeout is a failure, never a claimed submission.
 */
export function verdict(check: PageCheck | null, elapsedMs: number, timeoutMs: number, errorSeenMs: number | null): Verdict {
  if (check?.success) return { done: true, status: "submitted", reason: null, confirmation: check.success };
  if (check?.captcha) return { done: true, status: "needs_you", reason: "captcha", confirmation: null };
  if (check?.emailVerification) return { done: true, status: "needs_you", reason: "email_verification", confirmation: null };
  if (check?.blocked) return { done: true, status: "failed", reason: "blocked", confirmation: null };
  // Errors that stay on show for a few seconds: the ATS refused something (invisible captcha may still be working).
  if (check?.errors.length && check.formPresent && errorSeenMs !== null && elapsedMs - errorSeenMs > 4000) {
    return { done: true, status: "needs_you", reason: "error", confirmation: null };
  }
  if (elapsedMs >= timeoutMs) {
    return { done: true, status: "failed", reason: check?.formPresent ? "form_changed" : "error", confirmation: null };
  }
  return { done: false };
}
