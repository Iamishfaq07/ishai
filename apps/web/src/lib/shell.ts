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
