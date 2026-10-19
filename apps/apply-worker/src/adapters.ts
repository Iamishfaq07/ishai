import type { Adapter } from "../../extension/src/lib/autoApply/adapters/types";
import { ADAPTERS } from "../../extension/src/lib/autoApply/adapters";
import { buttonByText, controlRequired, controlsIn, markedRequired, thanksText, uploadShown } from "../../extension/src/lib/autoApply/adapters/common";
import { labelOf, shown, text, visibleTexts, cssEscape } from "../../extension/src/lib/autoApply/dom";
import { attrsOf, widgetFor, type Question } from "../../extension/src/lib/autoApply/questions";
import { cleanLabel } from "../../extension/src/lib/autoApply/match";

export const HOSTED_SITES = ["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable", "recruitee"] as const;
export type HostedAts = typeof HOSTED_SITES[number];

const FIELD = "[data-automation-id^=formField], [data-testid=form-field], [data-test=form-field], [role=radiogroup], [role=group], .form-field, .form-group, .field, fieldset";
const ERRORS = "[data-automation-id=errorMessage], [data-automation-id=errorBanner], [role=alert], .field-error, .error-message, [data-testid=field-error]";
const NEXT = /^(save (and|&) continue|continue|next|review|review application)$/i;
const SUBMIT = /^(submit|submit application|send application|apply now|send my application|send)$/i;

function semanticText(el: Element | null): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("svg, script, style, [aria-hidden=true]").forEach((node) => node.remove());
  return cleanLabel(text(clone));
}

function linkedLabel(control: Element): Element | null {
  const ids = (control.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  // A file chooser's label and descriptive instructions are often separate ids. The label comes first.
  const aria = ids.map((id) => control.ownerDocument.getElementById(id)).find((node) => semanticText(node));
  return aria ?? (control.id ? control.ownerDocument.querySelector(`label[for="${cssEscape(control.id)}"]`) : null);
}

/** The whole question, including its label and required marker. Each separate control keeps its own label. */
export function readQuestions(form: Element): Question[] {
  const out: Question[] = [];
  const seen = new Set<Element>();
  const controls = [...controlsIn(form), ...form.querySelectorAll<HTMLElement>("button[aria-haspopup=listbox], button[role=combobox]")];
  for (const control of controls) {
    if (seen.has(control)) continue;
    seen.add(control);
    const attrs = attrsOf(control);
    if (control.getAttribute("aria-hidden") === "true" && !["file", "radio", "checkbox"].includes(attrs.type)) continue;
    const associated = linkedLabel(control);
    let group = control.closest(FIELD) ?? control.parentElement ?? form;
    if (associated && !group.contains(associated)) {
      for (let parent = control.parentElement; parent && parent !== form; parent = parent.parentElement) {
        if (parent.contains(associated)) { group = parent; break; }
      }
    }
    let grouped = [control];
    if ((attrs.type === "radio" || attrs.type === "checkbox") && attrs.name) {
      grouped = controls.filter((c) => c.getAttribute("name") === attrs.name && c.getAttribute("type") === attrs.type);
      grouped.forEach((c) => seen.add(c));
    }
    const widget = control.tagName === "BUTTON"
      ? { type: "selectbutton" as const, el: control as HTMLElement } : widgetFor(grouped);
    if (!widget) continue;
    const groupLabel = (attrs.name && form.ownerDocument.getElementById(`${attrs.name}_label`)) || linkedLabel(group) || group.querySelector("legend, [data-automation-id=formLabel], label");
    const label = cleanLabel((grouped.length > 1 ? semanticText(groupLabel) : semanticText(associated)) || labelOf(control).replace(/SVGs not supported by this browser\./gi, "") || semanticText(groupLabel) || attrs.placeholder);
    const fileLabel = `${label} ${attrs.name} ${attrs.id} ${control.getAttribute("data-ui") ?? ""}`;
    out.push({ questionId: attrs.name || attrs.id || control.getAttribute("data-automation-id"),
      label: widget.type === "file" && !label ? "Resume/CV" : label,
      widget, container: group, attrs, required: grouped.some(controlRequired) || markedRequired(groupLabel),
      section: text(group.closest("section")?.querySelector("h2, h3, legend")),
      role: /cover.?letter|message to.{0,15}hiring manager/i.test(fileLabel) ? "cover_letter"
        : widget.type === "file" && /resume|curriculum|\bcv\b/i.test(fileLabel) ? "resume" : null });
  }
  return out;
}

export function finalButton(root: ParentNode): HTMLElement | null {
  return buttonByText(root, SUBMIT);
}

export function nextButton(root: ParentNode): HTMLElement | null {
  return buttonByText(root, NEXT);
}

function hostedAdapter(ats: HostedAts, formSelector: string): Adapter {
  return {
    ats, hosts: [],
    form(doc) {
      const known = doc.querySelector(formSelector);
      if (known) return known;
      const main = doc.querySelector("main, [role=main]");
      return main && (nextButton(main) || finalButton(main)) ? main : null;
    },
    questions(form) {
      const questions = readQuestions(form);
      if (ats === "workable") {
        // Workable calls its city/region/country location box "Address". A street-address field on another ATS
        // must never receive just a city, so keep this mapping specific to Workable's documented field.
        for (const q of questions) if (q.attrs.name === "address") q.attrs.autocomplete = "address-level2";
      }
      return questions;
    },
    submitButton: (form) => finalButton(form) ?? nextButton(form),
    success(doc) {
      // Only a dedicated confirmation region or heading. Job-description prose cannot prove submission.
      return thanksText(doc, "[data-automation-id=applicationConfirmation], [data-testid=application-success], .application-success, .application-confirmation, h1, h2, [role=status]");
    },
    errors: (doc) => visibleTexts(doc, ERRORS).filter((s) => s.length > 1),
    upload(q, filename) {
      const root = q.container.ownerDocument.querySelector("main, [role=main], form") ?? q.container;
      if ([...root.querySelectorAll("[role=progressbar], [aria-busy=true]")].some(shown)) return "pending";
      return uploadShown(root, filename, ERRORS);
    },
    busy(doc) { return [...doc.querySelectorAll("[role=progressbar], [aria-busy=true]")].some(shown); },
  };
}

export const HOSTED_ADAPTERS: Record<HostedAts, Adapter> = {
  ...ADAPTERS,
  workday: hostedAdapter("workday", "[data-automation-id=jobApplicationPage], [data-automation-id=applicationForm], form[data-automation-id]"),
  smartrecruiters: hostedAdapter("smartrecruiters", "form[data-test=application-form], form#application-form, form[data-testid=application-form]"),
  workable: hostedAdapter("workable", "form[data-ui=application-form], form[data-testid=application-form], form#application-form"),
  recruitee: hostedAdapter("recruitee", "form#offer-application-form, form#new_candidate, form[data-testid=application-form], form[action*=candidates]"),
};
