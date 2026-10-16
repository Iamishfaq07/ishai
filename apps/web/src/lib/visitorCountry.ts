import { COUNTRIES } from "@orbit/ui";

/**
 * The visitor's country as the web app's edge saw it (GET /v1/region, the country prices follow), for pages that
 * don't have a saved account country yet (signed out, or before the account has one). Asked at most once per page
 * load and kept in memory only: no cookie, nothing stored (the cookie notice promises only the sign-in cookie).
 * Kept free of React and the API client, so it's unit-tested (visitorCountry.test.ts).
 */

const KNOWN = new Set(COUNTRIES.map((c) => c.code));

/** The country to use: the account's saved one, then the visitor's (from the edge), then the browser's guess. */
export function pickCountry(saved: string | null | undefined, visitor: string | null | undefined, guess: string): string {
  return saved || visitor || guess;
}

export interface VisitorCountry {
  /** undefined until asked, null when the edge didn't say (or the request failed), else an ISO code ("US"). */
  get: () => string | null | undefined;
  subscribe: (listener: () => void) => () => void;
  /** Asks once; later calls share the first answer. Never rejects. */
  load: () => Promise<string | null>;
}

export function createVisitorCountry(fetchRegion: () => Promise<{ country: string | null }>): VisitorCountry {
  let value: string | null | undefined;
  let asking: Promise<string | null> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => {
      asking ??= fetchRegion()
        .then((r) => {
          const code = (r?.country ?? "").toUpperCase();
          // Only a country the app knows by name: anything else reads as "not known" and the guess stands.
          return KNOWN.has(code) ? code : null;
        })
        .catch(() => null)
        .then((code) => {
          value = code;
          for (const l of listeners) l();
          return code;
        });
      return asking;
    },
  };
}

/** This page's one copy. The API client is imported only when it's first asked, so tests can import this module. */
export const visitorCountry = createVisitorCountry(() => import("./api").then(({ api }) => api.visitorRegion()));

/** The visitor's country, waiting at most `ms` for the first answer (for sign-up, which saves it). */
export async function visitorCountryWithin(ms: number, store: VisitorCountry = visitorCountry): Promise<string | null> {
  const known = store.get();
  if (known !== undefined) return known;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([store.load(), late]);
  } finally {
    clearTimeout(timer);
  }
}
