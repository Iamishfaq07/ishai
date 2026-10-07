/**
 * Open the app shell's Help or search from any page (Home's "Need help?", Welcome). The layout listens; outside it
 * (sign-in, the public pages) nothing happens, so callers there link to the contact page instead.
 */
const HELP = "orbit:open-help";
const SEARCH = "orbit:open-search";

export function openHelp(): void {
  window.dispatchEvent(new Event(HELP));
}

export function openSearch(): void {
  window.dispatchEvent(new Event(SEARCH));
}

export const SHELL_EVENTS = { help: HELP, search: SEARCH } as const;

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
