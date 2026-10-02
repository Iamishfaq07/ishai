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
import { ApiError } from "@orbit/ui";
import { api, setUnauthorizedHandler } from "./api";
import { clearAsyncCache } from "./useAsync";

export type RegisterOutcome = "signed_in" | "verify_email";

/** The last interview prep (Practice), kept in this browser between visits. */
export const LAST_PREP_KEY = "orbit.lastPrep";
// Account data this browser keeps outside the page cache. localStorage is shared by everyone who signs in on the
// browser, so it goes with the page cache whenever the account changes.
const ACCOUNT_STORAGE_KEYS = [LAST_PREP_KEY];

function forgetAccount(): void {
  clearAsyncCache();
  try {
    for (const key of ACCOUNT_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing was kept there either
  }
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (req: LoginRequest) => Promise<void>;
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
      clearAsyncCache();
      setUser(null);
    });
    api
      .me()
      .then(setUser)
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
    await api.login(req);
    forgetAccount();
    setUser(await confirmSession());
  }, []);

  /** "signed_in", or "verify_email" when the server wants the inbox proven first (nobody is signed in then). */
  const register = useCallback(async (req: RegisterRequest): Promise<RegisterOutcome> => {
    const res = await api.register(req);
    if ("status" in res && res.status === "verify_email") return "verify_email";
    forgetAccount();
    setUser(await confirmSession());
    return "signed_in";
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      forgetAccount();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setUser }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
