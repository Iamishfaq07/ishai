import { useState, type FormEvent } from "react";
import type { User } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, DEFAULT_API_URL, WEB_URL, api, setAccessToken, setApiUrl, validateApiUrl } from "../api";
import { saveToken } from "../native";
import { TitleBar } from "../TitleBar";

const input =
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900";

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingServer, setEditingServer] = useState(false);
  const [server, setServer] = useState(API_URL);
  const serverCheck = validateApiUrl(server);
  const serverValid = serverCheck.ok;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login({ email, password });
      setAccessToken(res.access_token);
      await saveToken(res.access_token).catch((err: unknown) =>
        console.warn("Couldn't store token in the OS keychain; you'll need to sign in next launch.", err),
      );
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 flex-col justify-center px-6">
        <span className="mx-auto mb-3 h-9 w-9 rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 ring-4 ring-indigo-400/20" aria-hidden="true" />
        <h1 className="text-center text-lg font-semibold">Sign in to Orbit</h1>
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-3">
          <label className="block text-xs font-medium">
            Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cx(input, "mt-1", focusRing)} />
          </label>
          <label className="block text-xs font-medium">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cx(input, "mt-1", focusRing)}
            />
          </label>
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className={cx("w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => void openUrl(`${WEB_URL}/register`)}
          className={cx("mx-auto mt-4 text-xs text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}
        >
          Create an account in the browser
        </button>
        <button
          type="button"
          onClick={() => void openUrl(`${WEB_URL}/forgot-password`)}
          className={cx("mx-auto mt-2 text-xs text-zinc-500 hover:underline", focusRing)}
        >
          Forgot your password?
        </button>
        <div className="mt-6 text-center text-xs text-zinc-500">
          {editingServer ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (serverCheck.ok) setApiUrl(serverCheck.url === DEFAULT_API_URL ? null : serverCheck.url);
              }}
              className="flex flex-wrap items-center gap-1.5"
            >
              <label className="sr-only" htmlFor="server-url">Server URL</label>
              <input
                id="server-url"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                aria-invalid={!serverValid}
                aria-describedby={serverCheck.ok ? undefined : "server-url-error"}
                className={cx(input, "min-w-0 flex-1 py-1 text-xs", focusRing)}
              />
              <button type="submit" disabled={!serverValid} className={cx("rounded px-2 py-1 font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-400", focusRing)}>
                Save
              </button>
              {!serverCheck.ok && server.trim() && (
                <p id="server-url-error" role="alert" className="w-full text-left text-xs text-rose-600 dark:text-rose-400">
                  {serverCheck.reason}
                </p>
              )}
            </form>
          ) : (
            <button type="button" onClick={() => setEditingServer(true)} className={cx("hover:underline", focusRing)}>
              Server: {API_URL} · change
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
