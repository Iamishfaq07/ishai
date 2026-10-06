import { useState, type FormEvent } from "react";
import type { User } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { api, setAccessToken, signInRequest } from "./api";
import { saveToken } from "./native";

const input =
  "min-w-0 flex-1 rounded-md border border-amber-300/70 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-amber-800 dark:bg-zinc-950 dark:text-zinc-100";

/**
 * A notice with an inline "Sign in again": the user signs in where they are, so an expiring sign-in never costs a
 * running session (the live screen) or the setup they've made. `message` says what's going on.
 */
export function SignInAgain({
  email,
  message,
  onSignedIn,
}: {
  /** The account to sign back into (asked for if unknown, e.g. Orbit started offline). */
  email: string | null;
  message: string;
  onSignedIn: (user: User) => void;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signInRequest(() => api.login({ email: address.trim(), password }));
      if (!res.access_token) throw new Error("Sign-in didn't finish. Please try again.");
      setAccessToken(res.access_token);
      await saveToken(res.access_token).catch((err: unknown) =>
        console.warn("Couldn't store token in the OS keychain; you'll need to sign in next launch.", err),
      );
      setPassword("");
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-center gap-2">
        <span className="flex-1">{message}</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={cx("shrink-0 font-medium underline", focusRing)}>
            Sign in again
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={(e) => void submit(e)} className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {!email && (
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="Email"
              aria-label="Email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={cx(input, focusRing)}
            />
          )}
          <input
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            placeholder={email ? `Password for ${email}` : "Password"}
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cx(input, focusRing)}
          />
          <button
            type="submit"
            disabled={busy || !password}
            className={cx("shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
      {error && <p className="mt-1 text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
