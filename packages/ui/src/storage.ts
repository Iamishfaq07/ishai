/**
 * Browser storage that never throws. `localStorage` and `sessionStorage` throw a SecurityError when site data is
 * blocked (Safari "Block all cookies", Firefox with cookies off, some enterprise policies, sandboxed frames), and
 * `setItem` throws when the quota is full. A throw in a render path would take a screen down (mid-interview, for
 * the live answer panel), so every read and write in the apps goes through these instead (eslint enforces it).
 *
 * When the real storage can't be used, values are kept in memory for the life of the page, so a setting still
 * applies until the tab closes.
 */
export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Every key currently stored (real storage and the in-memory fallback). */
  keys(): string[];
}

function make(resolve: () => Storage | undefined): SafeStorage {
  const memory = new Map<string, string>();
  const real = (): Storage | null => {
    try {
      return resolve() ?? null;
    } catch {
      return null;
    }
  };
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        return real()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        const s = real();
        if (s) {
          s.setItem(key, value);
          memory.delete(key);
          return;
        }
      } catch {
        /* Blocked or full: keep it for this page instead. */
      }
      memory.set(key, value);
    },
    removeItem(key) {
      memory.delete(key);
      try {
        real()?.removeItem(key);
      } catch {
        /* Blocked: nothing stored there to remove. */
      }
    },
    keys() {
      const found = new Set(memory.keys());
      try {
        const s = real();
        for (let i = 0; s && i < s.length; i += 1) {
          const k = s.key(i);
          if (k !== null) found.add(k);
        }
      } catch {
        /* Blocked: only the in-memory keys. */
      }
      return [...found];
    },
  };
}

/* eslint-disable no-restricted-globals -- the one place the raw storages are touched */
export const safeLocal: SafeStorage = make(() => (typeof localStorage === "undefined" ? undefined : localStorage));
export const safeSession: SafeStorage = make(() => (typeof sessionStorage === "undefined" ? undefined : sessionStorage));
/* eslint-enable no-restricted-globals */

/** A JSON value from storage, or `fallback` when it's missing, unreadable or fails `valid`. */
export function readJSON<T>(storage: SafeStorage, key: string, fallback: T, valid?: (v: unknown) => v is T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return valid && !valid(parsed) ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** One of `allowed` from storage, or `fallback` (a tampered or stale value never gets through). */
export function readChoice<T extends string>(storage: SafeStorage, key: string, allowed: readonly T[], fallback: T): T {
  const v = storage.getItem(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
