/**
 * Open support or search from any page (Home's "Support", the account menu, the footer). The support chat listens.
 * Search is handled by the signed-in layout; outside it (sign-in, the public pages) nothing happens.
 */
const SUPPORT = "orbit:open-support";
const SEARCH = "orbit:open-search";

export function openSupport(): void {
  window.dispatchEvent(new Event(SUPPORT));
}

/** The old name. Opens the support chat. */
export function openHelp(): void {
  openSupport();
}

export function openSearch(): void {
  window.dispatchEvent(new Event(SEARCH));
}

export const SHELL_EVENTS = { help: SUPPORT, support: SUPPORT, search: SEARCH } as const;

/** True for a keypress in a text field, where "/" is typing, not "open search". */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(type);
  }
  return el.isContentEditable === true;
}