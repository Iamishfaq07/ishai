import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AudioLines, OrbitWordmark, PlanetHero, ShieldCheck, Sparkles, type LucideIcon } from "@orbit/ui";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";
import { Captcha, useCaptchaConfig } from "../components/Captcha";

const AUTH_POINTS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: AudioLines, text: "Hears the question the moment it’s asked" },
  { icon: Sparkles, text: "Answers in your voice, grounded in your resume" },
  { icon: ShieldCheck, text: "Your documents stay private to your account" },
];

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <aside className="dark relative hidden overflow-hidden border-r border-white/5 bg-zinc-950 p-12 text-white lg:flex lg:flex-col">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl"
        />
        <OrbitWordmark size={30} className="relative" />
        <div className="relative my-auto">
          <PlanetHero className="mx-auto w-80 motion-safe:animate-float xl:w-96" />
          <h2 className="mt-10 max-w-md font-display text-4xl font-semibold leading-tight tracking-tight">
            Walk into every interview <span className="text-gradient">with backup.</span>
          </h2>
          <ul className="mt-6 space-y-3">
            {AUTH_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <Icon className="h-4 w-4 text-indigo-200" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 text-center">
            <span className="mb-6 flex justify-center lg:hidden">
              <OrbitWordmark size={34} />
            </span>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          </div>
          <div className="glass-panel rounded-2xl p-6 sm:p-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

function useRedirectTarget(): string {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return from && from !== "/login" && from !== "/register" ? from : "/";
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={target} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password });
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to start a live session">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">
            Forgot your password?
          </Link>
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        New to Orbit?{" "}
        <Link to="/register" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        email,
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      navigate("/documents", { replace: true, state: { onboarding: true } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Your real-time interview and meeting copilot">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Name" htmlFor="name">
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {captcha && <Captcha config={captcha} onToken={setCaptchaToken} />}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy || captcha === undefined || (!!captcha && !captchaToken)} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

/** Reads ?token= once, then strips it from the address bar so it isn't left in history or screenshots. */
function useOneTimeToken(): string | null {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get("token"));
  useEffect(() => {
    // Keep React Router's own history entry state (key/index) — only the URL changes.
    if (token) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  return token;
}

const linkClass = "font-medium text-indigo-600 hover:underline dark:text-indigo-400";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(email, captchaToken ?? undefined);
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link that works once, for one hour">
      {sent ? (
        <div role="status" className="space-y-4 text-center text-sm">
          <p>
            If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox and spam folder.
          </p>
          <Link to="/login" className={linkClass}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {captcha && <Captcha config={captcha} onToken={setCaptchaToken} />}
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy || captcha === undefined || (!!captcha && !captchaToken)} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className={linkClass}>
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const token = useOneTimeToken();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <AuthShell title="Link missing" subtitle="Open the reset link from your email again">
        <p className="text-center text-sm">
          <Link to="/forgot-password" className={linkClass}>
            Request a new link
          </Link>
        </p>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.confirmPasswordReset(token, password);
      setUser(res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out on every other device">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && (
          <ErrorNote>
            {error}{" "}
            {/expired|invalid/i.test(error) && (
              <Link to="/forgot-password" className={linkClass}>
                Request a new link
              </Link>
            )}
          </ErrorNote>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthShell>
  );
}

type VerifyState = "working" | "done" | "failed";
const VERIFY_COPY: Record<VerifyState, [string, string]> = {
  working: ["Verifying…", "One moment"],
  done: ["Email verified", "Thanks — your account is confirmed."],
  failed: ["Couldn't verify", "The link may have expired or already been used"],
};

export function VerifyEmailPage() {
  const token = useOneTimeToken();
  const { user, setUser } = useAuth();
  const [state, setState] = useState<VerifyState>(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its token.");
  const started = useRef(false); // StrictMode runs effects twice; the token only works once

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .confirmVerification(token)
      .then((verified) => {
        setUser((current) => (current && current.id === verified.id ? verified : current));
        setState("done");
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setState("failed");
      });
  }, [token, setUser]);

  const [title, subtitle] = VERIFY_COPY[state];
  return (
    <AuthShell title={title} subtitle={subtitle}>
      <div role="status" className="space-y-4 text-center text-sm">
        {state === "failed" && error && <ErrorNote>{error}</ErrorNote>}
        {state === "failed" && user && !user.email_verified && <p>Request a fresh link from the banner at the top of any page.</p>}
        {state !== "working" && (
          <Link to={user ? "/" : "/login"} className={linkClass}>
            {user ? "Go to Orbit" : "Sign in"}
          </Link>
        )}
      </div>
    </AuthShell>
  );
}

export function ConfirmEmailChangePage() {
  const token = useOneTimeToken();
  const { setUser } = useAuth();
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its token.");
  const [email, setEmail] = useState<string | null>(null);
  const started = useRef(false); // StrictMode runs effects twice; the token only works once

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .confirmEmailChange(token)
      .then((res) => {
        setUser(res.user);
        setEmail(res.user.email);
        setState("done");
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setState("failed");
      });
  }, [token, setUser]);

  return (
    <AuthShell
      title={state === "done" ? "Email changed" : state === "working" ? "Confirming…" : "Link didn't work"}
      subtitle={state === "done" ? `You now sign in with ${email}. Other devices were signed out.` : ""}
    >
      <div role="status" className="space-y-4 text-center text-sm">
        {state === "failed" && error && <ErrorNote>{error}</ErrorNote>}
        {state !== "working" && (
          <Link to={state === "done" ? "/" : "/settings"} className={linkClass}>
            {state === "done" ? "Go to Orbit" : "Back to settings"}
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
