/**
 * What this browser remembers for the resume maker, per resume: the document "Use in Orbit" made from it (so a second
 * click updates that document instead of adding a copy), and (resume/kit.ts) the profiles and messages written for it.
 * A convenience only: the server has the real copies, so storage that's full or switched off just means it forgets.
 */

/** The parts of localStorage used here, so tests can pass their own. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage switched off
  }
}

export function read(store: KeyValueStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function write(store: KeyValueStore | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* full or switched off: it's a convenience, the server has the real copy */
  }
}

const DOCS_KEY = "orbit.resumeDocuments";
const MAX_REMEMBERED = 50;

/** The document "Use in Orbit" made from this resume, if this browser remembers one. */
export function linkedDocument(resumeId: string, store: KeyValueStore | null = browserStore()): string | null {
  const map = read(store, DOCS_KEY);
  const id = map && typeof map === "object" ? (map as Record<string, unknown>)[resumeId] : null;
  return typeof id === "string" && id ? id : null;
}

/** Remember the document made from this resume (the 50 most recent resumes are kept). */
export function rememberDocument(resumeId: string, documentId: string, store: KeyValueStore | null = browserStore()): void {
  const old = read(store, DOCS_KEY);
  const map: Record<string, string> = {};
  if (old && typeof old === "object") {
    for (const [k, v] of Object.entries(old as Record<string, unknown>)) if (typeof v === "string" && k !== resumeId) map[k] = v;
  }
  map[resumeId] = documentId; // last, so the oldest go first
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete map[k];
  write(store, DOCS_KEY, map);
}
