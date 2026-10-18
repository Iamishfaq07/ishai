import { useCallback, useEffect, useRef, useState } from "react";
import { clearLegacyBrowserAccount } from "./browserAccount";
import { resetJobsSession } from "./jobsSession";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

// Last result per cache key, for this signed-in user only (cleared on sign-in and sign-out).
const cache = new Map<string, unknown>();
// A request already running for that key. Home mounts the same list in two places; without this both hit the API.
const inflight = new Map<string, Promise<unknown>>();
// Bumped when the account changes, so a request started for the previous account can't be reused.
let generation = 0;

export function clearAsyncCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
  resetJobsSession();
  clearLegacyBrowserAccount();
}

/** One network call while several callers ask for the same key. A new call after it finishes starts another. */
export function shareInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const gen = generation;
  const promise = run().finally(() => {
    if (generation === gen && inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Minimal data loader: runs `fn` on mount and whenever `deps` change; ignores stale results.
 *
 * With `key`, it's stale-while-revalidate: a page you've seen before renders its last data instantly (no spinner)
 * while a fresh copy loads in the background, and pages that share a key (the document list on Home, New session and
 * Documents) share it. A failed background refresh keeps the data on screen instead of replacing it with an error.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], key?: string): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(() => (key && cache.has(key) ? (cache.get(key) as T) : null));
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(() => !(key && cache.has(key)));
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // A new key (another tab of a list, another session) swaps in that key's cached data, or nothing, during this
  // render: the old key's data must not stay on screen until the fetch lands (the "Waiting" list under "Everyone").
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    const hit = key !== undefined && cache.has(key);
    setDataState(hit ? (cache.get(key) as T) : null);
    setLoading(!hit);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const gen = generation;
    const cached = key !== undefined && cache.has(key);
    if (!cached) setLoading(true);
    setError(null);
    const run = () => fnRef.current();
    const request = key ? shareInflight(key, run) : run();
    request
      .then((value) => {
        if (cancelled || generation !== gen) return;
        if (key) cache.set(key, value);
        setDataState(value);
      })
      .catch((err: unknown) => {
        if (cancelled || generation !== gen || (cached && key && cache.has(key))) return; // keep showing what we had
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (updater: (prev: T | null) => T | null) =>
      setDataState((prev) => {
        const next = updater(prev);
        if (key) {
          if (next === null) cache.delete(key);
          else cache.set(key, next);
        }
        return next;
      }),
    [key],
  );
  return { data, error, loading, reload, setData };
}

/**
 * True once every one of these loads has answered (data or an error) at least once, and from then on. A page that
 * draws its data-filled sections only then, with one placeholder in their place before, never moves under the
 * reader as each answer lands one after another (layout shift: Plan & billing measured 0.4-0.8 CLS that way). A
 * later refresh doesn't hide anything again.
 */
export function useSettledOnce(...states: ReadonlyArray<{ loading: boolean; data: unknown; error: unknown }>): boolean {
  const settled = useRef(false);
  if (!settled.current && states.every((st) => !st.loading || st.data !== null || st.error !== null)) settled.current = true;
  return settled.current;
}
