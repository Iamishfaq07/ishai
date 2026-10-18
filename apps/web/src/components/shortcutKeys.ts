/** "?" pressed where it means "show the shortcuts": not while typing, not with Ctrl/⌘ or Alt. */
export function asksForShortcuts(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, typing: boolean): boolean {
  return e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
}
