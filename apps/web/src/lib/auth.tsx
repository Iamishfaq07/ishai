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
import { visitorCountryWithin } from "./visitorCountry";

export type RegisterOutcome = "signed_in" | "verify_email";

/** The last interview prep (Practice), kept in this browser between visits. */
export const LAST_PREP_KEY = "orbit.lastPrep";
// Account data this browser keeps outside the page cache. localStorage is shared by everyone who signs in on the
// browser, so it goes with the page cache whenever the account changes.
const ACCOUNT_STORAGE_KEYS = [LAST_PREP_KEY];
const ACCOUNT_ID_KEY = "orbit.browser-account-id";

function acceptAccount(account: User): User {
  try {
    const previous = safeLocal.getItem(ACCOUNT_ID_KEY);
    if (previous && previous !== account.id) forgetAccount();
    safeLocal.setItem(ACCOUNT_ID_KEY, account.id);
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

  useEffect(() => {
    setUnauthorizedHandler(() => {
      forgetAccount();
      setUser(null);
    });
    api
      .me()
      .then((account) => setUser(acceptAccount(account)))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError) || err.status !== 401) console.warn("Session check failed", err);
        setUser(null);
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, []);

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
    // The country they apply in: where the web app's edge saw the visit come from, else the browser's guess.
    const res = await api.register({ country: (await visitorCountryWithin(1500)) ?? detectCountry(), ...req });
    if ("status" in res && res.status === "verify_email") return "verify_email";
    forgetAccount();
    setUser(acceptAccount(await confirmSession()));
    return "signed_in";
  }, []);

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
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, finishSecondStep, loginWithPasskey, register, logout, setUser }),
    [user, loading, login, finishSecondStep, loginWithPasskey, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
