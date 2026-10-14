/**
 * Saving resumes one write at a time per resume (V3-06). The editor saves from three places: the autosave a moment
 * after an edit, the flush when the address moves to another resume, and the unmount. Without a queue those could
 * put two PUTs for the same resume in flight, and an older one landing last would overwrite newer text.
 *
 * - Per resume, at most one save is in flight. A save asked for meanwhile waits; if several are asked for, only the
 *   newest is sent (the in-between ones are already contained in it), and every caller's promise settles with it.
 * - Each save carries the revision the text was based on (`base_revision`), and the server refuses a stale one with a
 *   409, so another tab or device can't be overwritten silently either. The queue keeps the latest revision the
 *   server returned, so its own saves never conflict with each other.
 * - Different resumes don't wait on each other.
 */

export interface SaveResult {
  revision: number;
}

export type Send<P> = (id: string, payload: P, baseRevision: number | undefined) => Promise<SaveResult>;

interface Slot<P> {
  revision: number | undefined;
  running: Promise<void> | null;
  next: { payload: P; waiters: Array<{ resolve: (r: SaveResult) => void; reject: (e: unknown) => void }> } | null;
}

export interface SaveQueue<P> {
  /** Saves `payload` for resume `id` after anything already in flight for it. Resolves with the new revision. */
  save(id: string, payload: P): Promise<SaveResult>;
  /** The revision the server last confirmed (or the one the resume was loaded at). */
  revision(id: string): number | undefined;
  /** What the resume was loaded at, or what a conflict resolution settled on. */
  setRevision(id: string, revision: number | undefined): void;
  /** True while a save for `id` is in flight or waiting. */
  busy(id: string): boolean;
  /** Resolves once nothing for `id` is in flight or waiting (whether those saves worked or not). */
  idle(id: string): Promise<void>;
}

export function createSaveQueue<P>(send: Send<P>): SaveQueue<P> {
  const slots = new Map<string, Slot<P>>();
  const slot = (id: string): Slot<P> => {
    let s = slots.get(id);
    if (!s) {
      s = { revision: undefined, running: null, next: null };
      slots.set(id, s);
    }
    return s;
  };

  const pump = (id: string, s: Slot<P>): void => {
    if (s.running || !s.next) return;
    const { payload, waiters } = s.next;
    s.next = null;
    s.running = send(id, payload, s.revision)
      .then((result) => {
        s.revision = result.revision;
        for (const w of waiters) w.resolve(result);
      })
      .catch((err: unknown) => {
        for (const w of waiters) w.reject(err);
      })
      .finally(() => {
        s.running = null;
        pump(id, s);
      });
  };

  return {
    save(id, payload) {
      const s = slot(id);
      return new Promise<SaveResult>((resolve, reject) => {
        // A newer payload replaces one still waiting: it holds every edit the older one had.
        const waiters = s.next ? s.next.waiters : [];
        waiters.push({ resolve, reject });
        s.next = { payload, waiters };
        pump(id, s);
      });
    },
    revision: (id) => slots.get(id)?.revision,
    setRevision: (id, revision) => {
      slot(id).revision = revision;
    },
    busy: (id) => {
      const s = slots.get(id);
      return Boolean(s && (s.running || s.next));
    },
    idle: async (id) => {
      const s = slots.get(id);
      while (s && (s.running || s.next)) {
        await (s.running ?? Promise.resolve());
        await Promise.resolve(); // let the finished save's .finally start the next one
      }
    },
  };
}

// ---- unsaved drafts ------------------------------------------------------------------------------------------------

const DRAFT = "orbit.resume-draft.v1";

export interface Draft<P> {
  payload: P;
  savedAt: number;
  baseRevision: number | undefined;
}

function draftKey(userId: string | null | undefined, id: string): string {
  return `${DRAFT}:${userId ?? "anon"}:${id}`;
}

/** Edits the server hasn't confirmed yet, kept in this browser (per account and resume) until it does. */
export const drafts = {
  keep<P>(userId: string | null | undefined, id: string, payload: P, baseRevision: number | undefined): void {
    try {
      const d: Draft<P> = { payload, savedAt: Date.now(), baseRevision };
      localStorage.setItem(draftKey(userId, id), JSON.stringify(d));
    } catch {
      // storage full or blocked: the in-page copy still holds the edits while the tab is open
    }
  },
  load<P>(userId: string | null | undefined, id: string): Draft<P> | null {
    try {
      const raw = localStorage.getItem(draftKey(userId, id));
      const d = raw ? (JSON.parse(raw) as Draft<P>) : null;
      return d && typeof d === "object" && d.payload && typeof d.savedAt === "number" ? d : null;
    } catch {
      return null;
    }
  },
  clear(userId: string | null | undefined, id: string): void {
    try {
      localStorage.removeItem(draftKey(userId, id));
    } catch {
      /* nothing to clear */
    }
  },
};
