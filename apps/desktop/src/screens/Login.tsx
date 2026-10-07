import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@orbit/types";
import {
  AudioLines,
  Briefcase,
  Button,
  Code2,
  Eye,
  EyeOff,
  FileText,
  MessagesSquare,
  OrbitWordmark,
  PlanetHero,
  ShieldCheck,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { API_URL, DEFAULT_API_URL, WEB_URL, api, setAccessToken, setApiUrl, validateApiUrl } from "../api";
import { saveToken } from "../native";
import { TitleBar } from "../TitleBar";

const input =
  "block w-full rounded-xl border border-zinc-200 bg-white/90 px-3.5 py-2.5 text-sm transition-colors hover:border-zinc-300 focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-950/60 dark:hover:border-white/20 dark:focus:border-indigo-400";

/** What Orbit does, beside the sign-in form (under it in a narrow window). */
const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: AudioLines, title: "Live interview copilot", text: "Hears the question as it's asked and answers in your voice, from your resume." },
  { icon: FileText, title: "Resume AI", text: "ATS score out of 100, AI rewrites for every job, cover letters and interview prep." },
  { icon: Briefcase, title: "Jobs AI", text: "The latest jobs from companies' career pages, matched to your resume, and outreach to get referred." },
  { icon: Code2, title: "Coding rounds", text: "Screenshot a problem for the approach, the code and its complexity." },
  { icon: MessagesSquare, title: "Mock interviews", text: "Practise with an AI interviewer, then get a scorecard and the questions to redo." },
  { icon: ShieldCheck, title: "Private", text: "Your documents and transcripts stay in your account. Delete them any time." },
];

/** "Free to start: 20 interview minutes + 1 Resume AI credit", from the server (it decides the welcome credits). */
function useWelcome(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    api
      .listPlans()
      .then((plans) => {
        const w = plans.find((p) => p.welcome)?.welcome;
        if (!w || !(w.resume_credits || w.interview_minutes)) return;
        const parts = [
          w.interview_minutes ? `${w.interview_minutes} interview minutes` : "",
          w.resume_credits ? `${w.resume_credits} Resume AI credit${w.resume_credits === 1 ? "" : "s"}` : "",
        ].filter(Boolean);
        setText(`Free to start: ${parts.join(" + ")}. No card needed.`);
      })
      .catch(() => undefined);
  }, []);
  return text;
}

/** A saved server override (or a dev build) shows the server switch; otherwise Ctrl+Shift+S reveals it. */
const CUSTOM_SERVER = API_URL !== DEFAULT_API_URL;

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverShown, setServerShown] = useState(CUSTOM_SERVER || import.meta.env.DEV);
  const welcome = useWelcome();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setServerShown(true);
        setServerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login({ email: email.trim(), password });
      if (!res.access_token) throw new Error("Sign-in didn't finish. Please try again.");
      setAccessToken(res.access_token);
      await saveToken(res.access_token).catch((err: unknown) =>
        console.warn("Couldn't store token in the OS keychain; you'll need to sign in next launch.", err),
      );
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-y-auto">
        <aside className="relative hidden w-[42%] shrink-0 flex-col justify-center overflow-hidden bg-gradient-to-br from-indigo-950 via-zinc-950 to-zinc-950 p-8 text-white sm:flex">
          <PlanetHero className="pointer-events-none absolute right-5 top-5 w-24 opacity-90 motion-safe:animate-float" />
          <OrbitWordmark size={26} className="relative" />
          <p className="relative mt-3 max-w-xs font-display text-xl font-semibold leading-snug tracking-tight">
            Your interview copilot, Resume AI and Jobs AI, in one account.
          </p>
          <FeatureList className="relative mt-6" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col justify-center px-6 py-6">
          <div className="mx-auto w-full max-w-sm">
            <div className="sm:hidden">
              <OrbitWordmark size={26} className="mx-auto" />
            </div>
            <h1 className="mt-3 text-center font-display text-xl font-semibold tracking-tight sm:mt-0 sm:text-left">Welcome back</h1>
            <p className="mt-1 text-center text-xs text-zinc-500 sm:text-left dark:text-zinc-400">Sign in to start a live session.</p>
            <form onSubmit={(e) => void submit(e)} className="glass-panel mt-5 space-y-3 rounded-2xl p-4">
              <label className="block text-xs font-medium">
                Email
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cx(input, "mt-1", focusRing)} />
              </label>
              <div>
                <label htmlFor="login-password" className="block text-xs font-medium">
                  Password
                </label>
                <div className="relative mt-1">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cx(input, "pr-10", focusRing)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                    className={cx("absolute inset-y-0 right-0 flex items-center rounded-r-xl px-3 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100", focusRing)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => void openUrl(`${WEB_URL}/forgot-password`)}
                className={cx("mx-auto block text-xs text-zinc-500 hover:underline", focusRing)}
              >
                Forgot your password?
              </button>
            </form>

            <div className="mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-center">
              <p className="text-sm font-medium">New to Orbit?</p>
              {welcome && <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{welcome}</p>}
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void openUrl(`${WEB_URL}/register`)}>
                Create a free account
              </Button>
              <p className="mt-2 text-[11px] text-zinc-500">Opens in your browser. Then come back and sign in here.</p>
            </div>

            <FeatureList compact className="mt-6 sm:hidden" />

            {serverShown && (
              <ServerSwitch open={serverOpen} onOpen={() => setServerOpen(true)} onClose={() => setServerOpen(false)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureList({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <ul className={cx("space-y-3.5", className)}>
      {FEATURES.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex items-start gap-3">
          <span
            className={cx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              compact ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" : "bg-white/10 text-indigo-200 ring-1 ring-white/10",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className={cx("block text-sm font-medium", compact ? "" : "text-white")}>{title}</span>
            <span className={cx("block text-xs", compact ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400")}>{text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** For self-hosting and testing: point the app at another Orbit server, or back at the standard one. */
function ServerSwitch({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [server, setServer] = useState(API_URL);
  const check = validateApiUrl(server);
  if (!open) {
    return (
      <p className="mt-6 text-center text-xs text-zinc-500">
        {CUSTOM_SERVER ? "Using a custom server. " : ""}
        <button type="button" onClick={onOpen} className={cx("hover:underline", focusRing)}>
          Server settings
        </button>
      </p>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (check.ok) setApiUrl(check.url === DEFAULT_API_URL ? null : check.url);
      }}
      className="mt-6 space-y-1.5 text-xs text-zinc-500"
    >
      <label htmlFor="server-url" className="block font-medium">
        Server address
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="server-url"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          aria-invalid={!check.ok}
          aria-describedby={check.ok ? undefined : "server-url-error"}
          className={cx(input, "min-w-0 flex-1 py-1 text-xs", focusRing)}
        />
        <button type="submit" disabled={!check.ok} className={cx("rounded px-2 py-1 font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-400", focusRing)}>
          Save
        </button>
        <button type="button" onClick={onClose} className={cx("rounded px-2 py-1", focusRing)}>
          Cancel
        </button>
      </div>
      {CUSTOM_SERVER && (
        <button type="button" onClick={() => setApiUrl(null)} className={cx("hover:underline", focusRing)}>
          Use the standard Orbit server
        </button>
      )}
      {!check.ok && server.trim() && (
        <p id="server-url-error" role="alert" className="text-rose-600 dark:text-rose-400">
          {check.reason}
        </p>
      )}
    </form>
  );
}
