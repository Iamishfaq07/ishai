// The questions on an application form, as the adapters read them: what's asked, whether it's required, and the
// control(s) that answer it.
import { labelOf, shown, text } from "./dom";
import { cleanLabel } from "./match";

export type Widget =
  | { type: "text"; el: HTMLInputElement | HTMLTextAreaElement }
  | { type: "select"; el: HTMLSelectElement }
  /** A searchable dropdown (react-select, Ashby autocomplete): options appear once it's opened or typed into. */
  | { type: "combobox"; el: HTMLInputElement }
  | { type: "radio"; inputs: HTMLInputElement[] }
  | { type: "checkbox"; el: HTMLInputElement }
  | { type: "checkboxes"; inputs: HTMLInputElement[] }
  /** Yes/No buttons (Ashby). */
  | { type: "yesno"; buttons: HTMLElement[] }
  | { type: "file"; el: HTMLInputElement };

export interface Question {
  /** The ATS's own id for the question when it has one (Greenhouse question_123, Lever cards[…][field0], Ashby uuid). */
  questionId: string | null;
  label: string;
  required: boolean;
  widget: Widget;
  /** The element holding the whole question (label, control, errors). */
  container: Element;
  /** Text of the section it's in (e.g. a voluntary self-identification notice). */
  section: string;
  /** For file inputs: what it's for. */
  role: "resume" | "cover_letter" | null;
  /** Attributes for recognising standard fields (fields.ts classifyField). */
  attrs: { name: string; id: string; autocomplete: string; placeholder: string; type: string };
}

export function attrsOf(el: Element): Question["attrs"] {
  return {
    name: el.getAttribute("name") ?? "",
    id: el.getAttribute("id") ?? "",
    autocomplete: el.getAttribute("autocomplete") ?? "",
    placeholder: el.getAttribute("placeholder") ?? "",
    type: (el.getAttribute("type") ?? (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase(),
  };
}

/** The option labels a widget offers now (a combobox's only once opened). */
export function staticOptions(w: Widget): string[] {
  switch (w.type) {
    case "select":
      return [...w.el.options].filter((o) => o.value !== "" && !o.disabled).map((o) => text(o));
    case "radio":
    case "checkboxes":
      return w.inputs.map(optionLabel);
    case "yesno":
      return w.buttons.map((b) => text(b));
    default:
      return [];
  }
}

export function optionLabel(input: HTMLInputElement): string {
  return labelOf(input) || cleanLabel(input.value);
}

/** How a question is reported to Orbit when it can't be answered. */
export function kindOf(w: Widget): string {
  switch (w.type) {
    case "text":
      return w.el.tagName === "TEXTAREA" ? "textarea" : "text";
    case "select":
    case "combobox":
      return "select";
    case "checkboxes":
      return "multi_select";
    case "yesno":
      return "boolean";
    default:
      return w.type;
  }
}

/** Whether the question has an answer on the page now (read back after filling, and the page's own state). */
export function hasValue(q: Question): boolean {
  const w = q.widget;
  switch (w.type) {
    case "text":
      return w.el.value.trim() !== "";
    case "select":
      return w.el.value !== "";
    case "combobox":
      return comboboxValue(w.el, q.container) !== "";
    case "radio":
    case "checkboxes":
      return w.inputs.some((i) => i.checked);
    case "checkbox":
      return w.el.checked;
    case "yesno":
      return w.buttons.some((b) => b.getAttribute("aria-pressed") === "true" || /selected|active/i.test(b.className));
    case "file":
      return (w.el.files?.length ?? 0) > 0;
  }
}

/** The value a searchable dropdown shows as chosen ("" if none). */
export function comboboxValue(input: HTMLInputElement, container: Element): string {
  const single = container.querySelector(".select__single-value, [class*=singleValue], [class*=single-value]");
  if (single) return text(single);
  const multi = [...container.querySelectorAll(".select__multi-value__label, [class*=multiValue] [class*=label]")].map(text);
  if (multi.length) return multi.join(", ");
  return input.value.trim();
}

/** Builds the widget for a set of controls that answer one question, or null when it isn't one Orbit knows. */
export function widgetFor(controls: Element[]): Widget | null {
  const inputs = controls.filter((c): c is HTMLInputElement => c.tagName === "INPUT");
  const file = inputs.find((i) => i.type === "file");
  if (file) return { type: "file", el: file };
  const combo = inputs.find((i) => i.getAttribute("role") === "combobox");
  if (combo) return { type: "combobox", el: combo };
  const select = controls.find((c): c is HTMLSelectElement => c.tagName === "SELECT");
  if (select) return { type: "select", el: select };
  const radios = inputs.filter((i) => i.type === "radio");
  if (radios.length) {
    const name = radios[0]!.name;
    return { type: "radio", inputs: name ? radios.filter((r) => r.name === name) : radios };
  }
  const boxes = inputs.filter((i) => i.type === "checkbox");
  if (boxes.length === 1) return { type: "checkbox", el: boxes[0]! };
  if (boxes.length > 1) return { type: "checkboxes", inputs: boxes };
  const area = controls.find((c): c is HTMLTextAreaElement => c.tagName === "TEXTAREA");
  if (area) return { type: "text", el: area };
  const field = inputs.find((i) => ["text", "email", "tel", "url", "number", "date", ""].includes(i.type));
  if (field) return { type: "text", el: field };
  return null;
}

/** Controls a person would answer (not hidden plumbing such as tokens and captcha responses). */
export const CONTROLS = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]), textarea, select";

export function isPlumbing(el: Element): boolean {
  const name = `${el.getAttribute("name") ?? ""} ${el.getAttribute("id") ?? ""}`;
  return /g-recaptcha-response|h-captcha-response|cf-turnstile|captcha/i.test(name);
}

/** The question's controls are on show to the person (file inputs and styled radios are hidden by design: their
 * container must be). */
export function questionShown(q: Question): boolean {
  const w = q.widget;
  if (w.type === "text" || w.type === "select" || w.type === "combobox") return shown(w.el);
  const els: Element[] = "el" in w ? [w.el] : "inputs" in w ? w.inputs : w.buttons;
  return els.some((e) => shown(e)) || shown(q.container);
}
