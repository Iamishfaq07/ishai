// Ashby hosted job boards (jobs.ashbyhq.com/<org>/<id>/application). A React app: each question is a
// [data-field-path] entry (system fields like _systemfield_email, custom ones by uuid), Yes/No questions are buttons,
// location is an autocomplete, and the EEO survey sits below. Success replaces the form in place.
// Ashby's spam protection can reject an application silently and still show success; Orbit reports what the page
// shows and never more.
import { shown, text, visibleTexts } from "../dom";
import { cleanLabel } from "../match";
import { attrsOf, widgetFor, type Question } from "../questions";
import type { Adapter } from "./types";
import { controlRequired, controlsIn, markedRequired, thanksText, uploadShown } from "./common";

function questionsIn(root: Element): Question[] {
  const out: Question[] = [];
  for (const entry of root.querySelectorAll("[data-field-path]")) {
    if (entry.parentElement?.closest("[data-field-path]")) continue;
    if (entry.closest(".ashby-application-form-autofill-input-root")) continue;
    const path = entry.getAttribute("data-field-path")!;
    const labelEl = entry.querySelector(".ashby-application-form-question-title, label, legend");
    const label = cleanLabel(text(labelEl));
    const yesno = entry.querySelector(".ashby-application-form-input-yesno");
    const controls = controlsIn(entry);
    const widget = yesno
      ? { type: "yesno" as const, buttons: [...yesno.querySelectorAll<HTMLElement>("button")] }
      : widgetFor(controls);
    if (!widget) continue;
    const main = controls[0] ?? entry;
    out.push({
      questionId: path,
      label,
      required: markedRequired(labelEl) || controls.some((c) => controlRequired(c)),
      widget,
      container: entry,
      section: entry.closest(".ashby-survey-form-container") ? "Voluntary self-identification (EEO)" : text(entry.closest(".ashby-application-form-section-container")?.querySelector(".ashby-application-form-section-header")).slice(0, 300),
      role: widget.type === "file" ? (path === "_systemfield_resume" ? "resume" : /cover/i.test(label) ? "cover_letter" : null) : /cover letter/i.test(label) && widget.type === "text" ? "cover_letter" : null,
      attrs: attrsOf(main),
    });
  }
  return out;
}

function formRoot(doc: Document): Element | null {
  const submit = doc.querySelector(".ashby-application-form-submit-button");
  const email = doc.querySelector("[data-field-path='_systemfield_email']");
  if (!submit || !email) return null;
  let node: Element | null = submit.parentElement;
  while (node && !node.contains(email)) node = node.parentElement;
  return node;
}

export const ashby: Adapter = {
  ats: "ashby",
  hosts: ["jobs.ashbyhq.com"],
  form: formRoot,
  questions: questionsIn,
  submitButton(root) {
    return root.querySelector<HTMLElement>(".ashby-application-form-submit-button");
  },
  success(doc) {
    const box = doc.querySelector(".ashby-application-form-success-container");
    if (box && shown(box)) return text(box).slice(0, 500) || "Application submitted";
    const thanks = thanksText(doc);
    if (thanks && !formRoot(doc)) return thanks;
    return null;
  },
  errors(doc) {
    return visibleTexts(
      doc,
      ".ashby-application-form-field-entry-error, .ashby-application-form-failure-container, [class*=_error_], [class*=errorMessage], [role=alert]",
    ).filter((t) => t.length > 1);
  },
  upload(q, filename) {
    return uploadShown(q.container, filename, "[class*=_error], [class*=errorMessage], [role=alert]");
  },
  busy(doc) {
    const layer = doc.querySelector(".ashby-application-form-autofill-input-pending-layer");
    return !!layer && layer.getAttribute("data-state") !== "hidden" && shown(layer);
  },
};
