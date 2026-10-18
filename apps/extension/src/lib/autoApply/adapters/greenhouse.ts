// Greenhouse hosted job boards (job-boards.greenhouse.io, and the older boards.greenhouse.io). The form is on the
// job's page: text inputs, react-select dropdowns (role=combobox), file uploads for the resume and cover letter,
// custom questions with ids like question_123, and the voluntary EEO section. Success is its confirmation page.
import { cssEscape, labelOf, text, visibleTexts } from "../dom";
import { cleanLabel } from "../match";
import { attrsOf, widgetFor, type Question } from "../questions";
import type { Adapter } from "./types";
import { buttonByText, controlRequired, controlsIn, markedRequired, thanksText, uploadShown } from "./common";

const SKIP = ".iti__country-list, .iti__dropdown-content, .select__menu, [class*=requiredInput]";

function labelElement(form: Element, el: Element): Element | null {
  const id = el.getAttribute("id");
  if (id) {
    const byId = form.ownerDocument.getElementById(`${id}-label`) ?? form.ownerDocument.getElementById(`upload-label-${id}`);
    if (byId) return byId;
    const byFor = form.querySelector(`label[for="${cssEscape(id)}"]`);
    if (byFor && !byFor.classList.contains("visually-hidden")) return byFor;
  }
  return el.closest("fieldset")?.querySelector("legend") ?? null;
}

function questionsIn(form: Element): Question[] {
  const out: Question[] = [];
  const grouped = new Set<Element>();
  for (const el of controlsIn(form)) {
    if (grouped.has(el) || el.closest(SKIP)) continue;
    // react-select keeps a hidden copy for native "required" validation: not a question.
    if (el.getAttribute("aria-hidden") === "true" && el.getAttribute("tabindex") === "-1") continue;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "search") continue;
    let controls: Element[] = [el];
    let container: Element = el.closest(".select__container, .input-wrapper, .file-upload, .field-wrapper") ?? el.parentElement ?? form;
    if (type === "checkbox" || type === "radio") {
      const set = el.closest("fieldset, .checkbox, [role=group]") ?? el.parentElement!;
      controls = controlsIn(set).filter((c) => c.getAttribute("type") === type);
      controls.forEach((c) => grouped.add(c));
      container = set;
    }
    const widget = widgetFor(controls);
    if (!widget) continue;
    const labelEl = widget.type === "checkboxes" || widget.type === "radio" ? container.querySelector("legend, .label") : labelElement(form, el);
    const label = cleanLabel(labelEl ? text(labelEl) : labelOf(el));
    const group = el.closest("[role=group]");
    const required =
      controlRequired(el) || markedRequired(labelEl) || group?.getAttribute("aria-required") === "true" || controls.some((c) => controlRequired(c));
    const id = el.getAttribute("id");
    const section = text(el.closest("[class*=eeoc], [class*=demographic], [class*=voluntary]")?.querySelector("p, h2, h3, legend")).slice(0, 300);
    out.push({
      questionId: widget.type === "radio" || widget.type === "checkboxes" ? (el.getAttribute("name") || id) : id,
      label,
      required,
      widget,
      container: widget.type === "file" ? (group ?? container) : container,
      section,
      role: widget.type === "file" ? (id === "resume" ? "resume" : id === "cover_letter" || /cover/i.test(label) ? "cover_letter" : null) : null,
      attrs: attrsOf(el),
    });
  }
  return out;
}

export const greenhouse: Adapter = {
  ats: "greenhouse",
  hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  form(doc) {
    return doc.querySelector("form#application-form, form#application_form, form.application--form") ?? doc.querySelector("#first_name, #email")?.closest("form") ?? null;
  },
  questions: questionsIn,
  submitButton(form) {
    return form.querySelector<HTMLElement>("button[type=submit], input[type=submit]") ?? buttonByText(form, /submit/i);
  },
  success(doc) {
    const onConfirmation = /\/confirmation\b/.test(doc.location?.pathname ?? "");
    const thanks = thanksText(doc);
    if (thanks && (onConfirmation || !this.form(doc))) return thanks;
    return null;
  },
  errors(doc) {
    return visibleTexts(doc, ".helper-text--error, [id$='-error']:not(:empty), .error-message, .field-error, .application--error, [role=alert]").filter((t) => t.length > 1);
  },
  upload(q, filename) {
    return uploadShown(q.container, filename, ".helper-text--error, [id$='-error'], [class*=error]");
  },
  busy() {
    return false;
  },
};
