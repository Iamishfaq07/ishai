// Shared pieces of the ATS adapters.
import { shown, text, visibleTexts } from "../dom";
import { normalize } from "../match";
import { CONTROLS, isPlumbing } from "../questions";

/** The controls inside an element that a person answers. */
export function controlsIn(root: Element): Element[] {
  return [...root.querySelectorAll(CONTROLS)].filter((el) => !isPlumbing(el));
}

/** A label marked required with an asterisk (or the ATS's "required" mark). */
export function markedRequired(label: Element | null): boolean {
  if (!label) return false;
  if (label.querySelector(".required, [class*=required], abbr[title*=required i]")) return true;
  return /[*✱]\s*$/.test(label.textContent ?? "") || /_required|required/.test(label.getAttribute("class") ?? "");
}

export function controlRequired(el: Element): boolean {
  return el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
}

const THANKS = /\b(thank(s| you) for (applying|your application|your interest)|application (has been |was )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|your application (has been|was) (submitted|received))\b/i;

/** Confirmation wording in the page's headings and main text (on show only). */
export function thanksText(doc: Document, scope = "h1, h2, h3, h4, [role=status], [role=alert], main p, .confirmation, [class*=success], [class*=thank]"): string | null {
  for (const t of visibleTexts(doc, scope)) if (THANKS.test(t)) return t.slice(0, 500);
  return null;
}

/** Whether a file upload area shows the chosen file's name (attached), an upload error, or neither yet. */
export function uploadShown(container: Element, filename: string, errorSelector: string): "ok" | "pending" | "failed" {
  if (visibleTexts(container, errorSelector).length) return "failed";
  const shownText = normalize(text(container));
  const stem = normalize(filename.replace(/\.[a-z0-9]+$/i, ""));
  if (stem && shownText.includes(stem)) return "ok";
  // Long names are often shortened on show: the first part is enough.
  if (stem.length > 12 && shownText.includes(stem.slice(0, 12))) return "ok";
  return "pending";
}

/** The visible element (button) whose text matches. */
export function buttonByText(root: ParentNode, re: RegExp, selector = "button, [role=button], input[type=submit]"): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    const label = el.tagName === "INPUT" ? (el as HTMLInputElement).value : text(el);
    if (re.test(label) && shown(el)) return el;
  }
  return null;
}
