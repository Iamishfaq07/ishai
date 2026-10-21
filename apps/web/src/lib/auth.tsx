import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { LoginRequest, RegisterRequest, User } from "@orbit/types";
import { ApiError, detectCountry, getPasskey, passkeyErrorText, safeLocal } from "@orbit/ui";
import { api, setUnauthorizedHandler } from "./api";
import { clearAsyncCache } from "./useAsync";
import { clearPrepContext } from "./prepContext";
import { clearRef, storedRef } from "./referral";
import { visitorCountryWithin } from "./visitorCountry";

export type RegisterOutcome = "signed_in" | "verify_email";

/** Why the session check couldn't be answered, in words (the API client's own text for offline and timeouts). */
export function unreachableText(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) return err.message;
  if (err instanceof ApiError && err.status >= 500) return "Orbit is having a moment (it may be restarting). Try again in a few seconds.";
  return "Can't reach Orbit right now. Check your connection and try again.";
}

/** The last interview prep (Practice), kept in this browser between visits. */
export const LAST_PREP_KEY = "orbit.lastPrep";
// Account data this browser keeps outside the page cache. localStorage is shared by everyone who signs in on the
// browser, so it goes with the page cache whenever the account changes.
const ACCOUNT_STORAGE_KEYS = [LAST_PREP_KEY];
const ACCOUNT_ID_KEY = "orbit.browser-account-id";

/**
 * Whether anyone has signed in on this browser before. When nobody has, a signed-out page with a public face (the
 * front page) can be drawn while the session check is still out, instead of a spinner: a first visit's first paint.
 */
export function signedInHereBefore(): boolean {
  try {
    return Boolean(safeLocal.getItem(ACCOUNT_ID_KEY));
  } catch {
    return true;
  }
}

// Same-origin notification only; the receiving tab still authenticates with the server.
const authChannel = "orbit-account-change";
const authSender = Math.random().toString(36);
function announceAccount(id: string): void {
  try {
    const channel = new BroadcastChannel(authChannel);
    channel.postMessage([authSender, id]); channel.close();
  } catch { /* Storage events remain available when BroadcastChannel is unsupported. */ }
}

function acceptAccount(account: User): User {
  try {
    const previous = safeLocal.getItem(ACCOUNT_ID_KEY);
    if (previous && previous !== account.id) forgetAccount();
    safeLocal.setItem(ACCOUNT_ID_KEY, account.id);
    if (previous !== account.id) announceAccount(account.id);
  } catch { /* Cookie auth works even when browser storage is unavailable. */ }
  return account;
}

function forgetAccount(): void {
  clearAsyncCache();
  clearPrepContext();
  try {
    for (const key of ACCOUNT_STORAGE_KEYS) safeLocal.removeItem(key);
  } catch {
    // storage unavailable: nothing was kept there either
  }
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /**
   * The session check couldn't get an answer (offline, a timeout, the server restarting): not the same as signed
   * out, so a signed-in person isn't sent to the sign-in page by a blip. The message says what happened; `recheck`
   * asks again (it's also asked again when the browser comes back online).
   */
  unreachable: string | null;
  recheck: () => void;
  /** Signs in, or returns the challenge when two-step sign-in is on (then `finishSecondStep` with the code). */
  login: (req: LoginRequest) => Promise<{ challenge: string } | null>;
  /** The authenticator code (or a recovery code). `challenge` is null after Google: it's in a cookie. */
  finishSecondStep: (code: string, challenge: string | null) => Promise<void>;
  /** Sign in with a passkey: false when it was cancelled (nobody signed in, nothing to say). */
  loginWithPasskey: () => Promise<boolean>;
  register: (req: RegisterRequest) => Promise<RegisterOutcome>;
  logout: () => Promise<void>;
  setUser: Dispatch<SetStateAction<User | null>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Re-reads the session right after sign-in. If the browser refused to store the session cookie (blocked
 * third-party/site cookies), the next request would 401 and silently bounce back to the login page; say so instead.
 */
async function confirmSession(): Promise<User> {
  try {
    return await api.me();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new ApiError(
        401,
        "You were signed in, but your browser didn't keep the session. Allow cookies for this site " +
          "(or turn off \"Prevent cross-site tracking\" / private browsing) and try again.",
        "session_cookie_blocked",
      );
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      forgetAccount();
      setUnreachable(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then((account) => {
        if (!live) return;
        setUnreachable(null);
        setUser(acceptAccount(account));
      })
      .catch((err: unknown) => {
        if (!live) return;
        // Only the server saying "not signed in" signs anyone out. Anything else (offline, a timeout, a 5xx while it
        // restarts) is "couldn't check": the page says so and offers to try again.
        const signedOut = err instanceof ApiError && (err.status === 401 || err.status === 403);
        if (!signedOut) console.warn("Session check failed", err);
        setUnreachable(signedOut ? null : unreachableText(err));
        setUser(null);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [attempt]);

  // Back online after the check failed: ask again by itself.
  useEffect(() => {
    if (!unreachable) return;
    window.addEventListener("online", recheck);
    return () => window.removeEventListener("online", recheck);
  }, [unreachable, recheck]);

  // Cookies are shared across tabs. Discard private state before reading the new authenticated identity.
  useEffect(() => {
    const sync = (id: unknown) => {
      if (typeof id !== "string" || id === (user?.id ?? "")) return;
      forgetAccount(); setUser(null); recheck();
    };
    const changed = (event: StorageEvent) => { if (event.key === ACCOUNT_ID_KEY) sync(event.newValue); };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(authChannel);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (Array.isArray(event.data) && event.data[0] !== authSender) sync(event.data[1]);
      };
    } catch { /* Some browsers disable channels; retain storage-event synchronization. */ }
    window.addEventListener("storage", changed);
    return () => { channel?.close(); window.removeEventListener("storage", changed); };
  }, [user?.id, recheck]);

  // Cached page data (and the account's saved bits) belongs to one account: dropped before the user changes, so
  // nobody sees the last person's.
  const login = useCallback(async (req: LoginRequest) => {
    const res = await api.login(req);
    if ("two_factor_required" in res) return { challenge: res.challenge };
    forgetAccount();
    setUser(acceptAccount(await confirmSession()));
    return null;
  }, []);

  const finishSecondStep = useCallback(async (code: string, challenge: string | null) => {
    await api.loginSecondStep(code, challenge);
    forgetAccount();
    setUser(acceptAccount(await confirmSession()));
  }, []);

  const loginWithPasskey = useCallback(async () => {
    const { options } = await api.passkeyLoginOptions();
    let credential: Record<string, unknown>;
    try {
      credential = await getPasskey(options);
    } catch (err) {
      const text = passkeyErrorText(err);
      if (text) throw new Error(text, { cause: err });
      return false;
    }
    await api.loginWithPasskey(credential);
    forgetAccount();
    setUser(acceptAccount(await confirmSession()));
    return true;
  }, []);

  /** "signed_in", or "verify_email" when the server wants the inbox proven first (nobody is signed in then). */
  const register = useCallback(async (req: RegisterRequest): Promise<RegisterOutcome> => {
    // The country they apply in: where the web app's edge saw the visit come from, else the browser's guess. The
    // invite or creator code of a link they followed goes with it (lib/referral.ts); the account is made either way.
    const ref = storedRef();
    const res = await api.register({ country: (await visitorCountryWithin(1500)) ?? detectCountry(), ...(ref ? { ref } : {}), ...req });
    clearRef();
    if ("status" in res && res.status === "verify_email") return "verify_email";
    forgetAccount();
    setUser(acceptAccount(await confirmSession()));
    return "signed_in";
  }, []);

  // Signed in (a sign-up through Google lands here too): a link's code has done its job, or isn't for this account.
  useEffect(() => {
    if (user) clearRef();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // An account without a country (from before there was one) gets the visitor's country (or the browser's guess),
  // once; Settings changes it.
  const needsCountry = Boolean(user && !user.country);
  useEffect(() => {
    if (!needsCountry) return;
    let cancelled = false;
    visitorCountryWithin(3000)
      .then((visitor) => api.updateRegion(visitor ?? detectCountry()))
      .then((u) => !cancelled && setUser((prev) => (prev && prev.id === u.id ? { ...prev, country: u.country } : prev)))
      .catch(() => undefined); // the guess is still used on screen; it's tried again next visit
    return () => {
      cancelled = true;
    };
  }, [needsCountry]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      forgetAccount();
      safeLocal.setItem(ACCOUNT_ID_KEY, ""); announceAccount("");
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, unreachable, recheck, login, finishSecondStep, loginWithPasskey, register, logout, setUser }),
    [user, loading, unreachable, recheck, login, finishSecondStep, loginWithPasskey, register, logout],
  );
  return <AuthContext.Provider key={user?.id ?? "guest"} value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
