// DOM helpers for filling an application the way a person would: real values through the native setters (so React
// and other frameworks see them), the usual input/change events, files through DataTransfer, at a human pace.
// No synthetic "trusted" events, no fingerprint or automation-detection tricks of any kind.
import { boxOnPage } from "../fields";
import { cleanLabel } from "./match";

declare const __ORBIT_APPLY_PACE__: number;
/** 1 = human pace. Builds for the end-to-end tests set it lower (build.mjs ORBIT_APPLY_PACE); never at run time. */
const BUILD_PACE = typeof __ORBIT_APPLY_PACE__ === "number" ? __ORBIT_APPLY_PACE__ : 1;
let handoffSpeed = 1;
/** The hand-off fills the candidate's own tab while they watch: quicker than the unattended pace. */
export function setQuick(quick: boolean): void {
  handoffSpeed = quick ? 0.15 : 1;
}
export function pace(): number {
  return BUILD_PACE * handoffSpeed;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const pause = (lo = 350, hi = 1100) => sleep(between(lo, hi) * pace());

type Win = Window & typeof globalThis;
/** The window an element belongs to: events and files are made there (the page's realm, or a test's jsdom). */
export function winOf(node: Node): Win {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return (doc?.defaultView ?? globalThis) as Win;
}

export function emit(el: Element, type: string): void {
  el.dispatchEvent(new (winOf(el).Event)(type, { bubbles: true }));
}

export function mouse(el: Element, type: "mousedown" | "mouseup"): void {
  el.dispatchEvent(new (winOf(el).MouseEvent)(type, { bubbles: true, cancelable: true, button: 0 }));
}

export function keydown(el: Element, key: "ArrowDown" | "Enter" | "Escape"): void {
  const keyCode = key === "ArrowDown" ? 40 : key === "Enter" ? 13 : 27;
  el.dispatchEvent(new (winOf(el).KeyboardEvent)("keydown", { key, code: key, keyCode, bubbles: true, cancelable: true }));
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hasLayout(doc: Document): boolean {
  return doc.documentElement.getBoundingClientRect().width > 0;
}

/** Rendered and on show to the person: not display:none / hidden / see-through (itself or a parent), and, where the
 * page has layout, a real box on the page. Fields a person can't see are never filled. */
export function shown(el: Element | null): boolean {
  if (!el || !el.isConnected) return false;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (typeof (el as HTMLElement).checkVisibility === "function" && hasLayout(doc)) {
    if (!(el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return boxOnPage({ width: r.width, height: r.height, right: r.right, bottom: r.bottom, scrollX: win?.scrollX ?? 0, scrollY: win?.scrollY ?? 0 });
  }
  // No layout (unit tests): the cascade only.
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute("hidden")) return false;
    if ((node as HTMLInputElement).type === "hidden" && node.tagName === "INPUT") return false;
    const style = win?.getComputedStyle(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
  }
  return true;
}

/** Visually hidden on purpose but part of a visible widget (file inputs, radios styled as buttons). */
export function shownWithin(el: Element, container: Element | null): boolean {
  return shown(el) || (!!container && shown(container));
}

/** The text that labels a control: label[for], a wrapping label, aria-label(ledby). */
export function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  const id = el.getAttribute("id");
  if (id) {
    const byFor = doc.querySelector(`label[for="${cssEscape(id)}"]`);
    if (byFor) parts.push(text(byFor));
  }
  if (!parts.length) {
    const wrap = el.closest("label");
    if (wrap) parts.push(text(wrap));
  }
  const labelledBy = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (!parts.length && labelledBy.length) parts.push(labelledBy.map((i) => text(doc.getElementById(i))).join(" "));
  if (!parts.length && el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label")!);
  return cleanLabel(parts.join(" "));
}

export function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

type Settable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Sets a value through the element's native setter, then input + change, as typing would. */
export function setNativeValue(el: Settable, value: string): void {
  const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const proto =
    el.tagName === "TEXTAREA" ? win?.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? win?.HTMLSelectElement.prototype : win?.HTMLInputElement.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  emit(el, "input");
}

const fire = emit;

/** Types into a field at a person's pace: a character at a time for short values, a few words at a time for long
 * text (cover letters), then change + blur so the page validates it. */
export async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  el.focus();
  fire(el, "focus");
  if (el.value) setNativeValue(el, "");
  // Long text goes in a few words at a time. In a tab the browser has hidden (window covered) timers slow to one a
  // second, so short values go a few characters at a time there.
  const hidden = el.ownerDocument.visibilityState === "hidden";
  const step = value.length > 160 ? 24 : hidden ? 6 : 1;
  for (let i = step; i < value.length + step; i += step) {
    setNativeValue(el, value.slice(0, Math.min(i, value.length)));
    await sleep(between(step > 1 ? 60 : 35, step > 1 ? 140 : 110) * pace());
  }
  fire(el, "change");
  el.blur();
  fire(el, "blur");
  fire(el, "focusout");
}

export function selectNative(el: HTMLSelectElement, index: number): void {
  el.focus();
  setNativeValue(el, el.options[index]!.value);
  fire(el, "change");
  el.blur();
}

/** A real click on a control (radio, checkbox, button, option): the page's own handlers run. */
export function click(el: HTMLElement): void {
  el.scrollIntoView?.({ block: "center" });
  mouse(el, "mousedown");
  mouse(el, "mouseup");
  el.click();
}

/** Puts a file in a file input through DataTransfer and fires input + change, as choosing it would. */
export function setFile(input: HTMLInputElement, file: File): boolean {
  const win = input.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const DT = win?.DataTransfer ?? (typeof DataTransfer !== "undefined" ? DataTransfer : undefined);
  if (!DT) return false;
  const dt = new DT();
  dt.items.add(file);
  input.files = dt.files;
  fire(input, "input");
  fire(input, "change");
  return (input.files?.length ?? 0) > 0 && input.files![0]!.name === file.name;
}

export function fileFromBase64(doc: Document, b64: string, filename: string, type: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new (winOf(doc).File)([bytes], filename, { type: type || "application/octet-stream" });
}

/** Waits until check() returns something truthy (polling), or the timeout. */
export async function waitFor<T>(check: () => T | null | undefined | false, timeoutMs: number, everyMs = 200): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(everyMs);
  }
}

/** Visible text of elements matching a selector, e.g. validation messages. */
export function visibleTexts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].filter((el) => shown(el)).map((el) => text(el)).filter(Boolean);
}
