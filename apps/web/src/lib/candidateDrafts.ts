/** Private draft text stays in this tab's memory only, expires after an hour, and clears on account change. */
const drafts = new Map<string, { value: string; at: number }>();
let generation = 0;
export const draftGeneration = () => generation;
export function clearCandidateDrafts(): void { generation++; drafts.clear(); }
export function readCandidateDraft(key: string, now = Date.now()): string {
  const found = drafts.get(key);
  if (!found || now - found.at > 3_600_000) { drafts.delete(key); return ""; }
  return found.value;
}
export function writeCandidateDraft(key: string, value: string, expected: number, now = Date.now()): void {
  if (expected !== generation) return; // ignore late work from a signed-out account
  if (!value || value.length > 131072) { drafts.delete(key); return; }
  drafts.delete(key);
  if (drafts.size >= 10) drafts.delete(drafts.keys().next().value!);
  drafts.set(key, { value, at: now });
}
