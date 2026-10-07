import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AudioLines, Briefcase, MessagesSquare, OrbitWordmark, PlanetHero, ShieldCheck, Sparkles, cx, type LucideIcon } from "@orbit/ui";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";
import { useWelcomeGrant } from "../lib/welcome";
import { Captcha, useCaptchaConfig } from "../components/Captcha";
import { AiPill } from "../components/products";

type Feature = { icon: LucideIcon; title: string; text: string; ai?: boolean };

/**
 * What Orbit does, on the sign-in and sign-up screens (the side panel on wide screens, under the form on phones):
 * its three products first, then what comes with them. (Interview prep is part of Resume AI and Jobs AI now; two lines
 * here keep it all on a 1024 x 720 screen.)
 */
const PRODUCTS: Feature[] = [
  { icon: AudioLines, title: "Interview copilot", text: "Hears the question the moment it's asked and answers in your voice, from your resume." },
  { icon: Sparkles, title: "Resume", ai: true, text: "ATS score out of 100, AI rewrites for every job, cover letters and interview prep." },
  { icon: Briefcase, title: "Jobs", ai: true, text: "The latest jobs from companies' career pages, matched to your resume, and outreach to get referred." },
];
const FEATURES: Feature[] = [
  { icon: MessagesSquare, title: "Mock interviews", text: "Practise with an AI interviewer, then get a scorecard and the questions to redo." },
  { icon: ShieldCheck, title: "Private", text: "Your documents and transcripts stay in your account. Delete them any time." },
];

/** "Free to start: 20 interview minutes + 1 Resume AI credit", from the server (it decides the welcome credits). */
function useWelcome(): string | null {
  const w = useWelcomeGrant();
  if (!w) return null;
  const parts = [
    w.interview_minutes ? `${w.interview_minutes} interview minutes` : "",
    w.resume_credits ? `${w.resume_credits} Resume AI credit${w.resume_credits === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Free to start: ${parts.join(" + ")}. No card needed.`;
}

/** "Resume AI" and "Jobs AI" as the nav shows them: the word and the AI pill. */
function FeatureTitle({ title, ai }: Pick<Feature, "title" | "ai">) {
  return ai ? (
    <>
      {title} <AiPill className="align-[1px]" />
    </>
  ) : (
    <>{title}</>
  );
}

function FeatureList({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      <ul className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"} aria-label="Orbit's three products">
        {PRODUCTS.map(({ icon: Icon, title, text, ai }) => (
          <li
            key={title}
            className={cx(
              "flex items-start gap-3 rounded-2xl p-3 ring-1 [@media(min-height:800px)]:p-3.5",
              compact ? "glass-panel ring-0" : "bg-white/[0.04] ring-white/10",
            )}
          >
            <span
              className={cx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                ai
                  ? "bg-gradient-to-br from-indigo-500 to-aurora-500 text-white shadow-glow-sm"
                  : compact
                    ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                    : "bg-white/10 text-indigo-200 ring-1 ring-white/10",
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className={cx("block font-display text-[0.9375rem] font-semibold", compact ? "" : "text-white")}>
                <FeatureTitle title={title} ai={ai} />
              </span>
              <span className={cx("mt-0.5 block text-xs", compact ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-300")}>{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3.5 px-1"}>
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
              <span className={cx("block text-xs", compact ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-300")}>{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthShell({ title, subtitle, children, features = false }: { title: string; subtitle: string; children: ReactNode; features?: boolean }) {
  const welcome = useWelcome();
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Roomier on tall screens; tighter on short ones, so the three products and what comes with them fit a laptop
          screen (1024 or 1280 x 720). */}
      <aside className="dark relative hidden overflow-hidden border-r border-white/5 bg-zinc-950 p-10 text-white lg:flex lg:flex-col [@media(min-height:800px)]:p-12">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl"
        />
        {/* In the corner, so the three products and what comes with them fit a laptop screen. */}
        <PlanetHero className="pointer-events-none absolute right-6 top-6 w-28 motion-safe:animate-float xl:right-10 xl:top-8 xl:w-44" />
        <OrbitWordmark size={30} className="relative" />
        <div className="relative my-auto pt-6 [@media(min-height:800px)]:pt-8">
          <h2 className="max-w-md font-display text-3xl font-semibold leading-tight tracking-tight [@media(min-height:800px)]:text-4xl">
            Get the interview, then walk in <span className="text-gradient">with backup.</span>
          </h2>
          <div className="mt-5 max-w-md [@media(min-height:800px)]:mt-6">
            <FeatureList />
          </div>
          {welcome && (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-300 ring-1 ring-emerald-400/30">
              <Sparkles className="h-4 w-4" aria-hidden /> {welcome}
            </p>
          )}
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 text-center">
            <span className="mb-6 flex justify-center lg:hidden">
              <OrbitWordmark size={34} />
            </span>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          </div>
          <div className="glass-panel rounded-2xl p-6 sm:p-7">{children}</div>
          {features && (
            <section aria-label="What Orbit does" className="mt-6 space-y-4 lg:hidden">
              {welcome && (
                <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-center text-sm font-medium text-emerald-800 ring-1 ring-emerald-500/25 dark:text-emerald-200">
                  {welcome}
                </p>
              )}
              <FeatureList compact />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

/** Where the visitor was headed (the page that asked them to sign in, or a product page's "Start free"), if anywhere. */
function useCameFrom(): string | null {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return from && from.startsWith("/") && from !== "/login" && from !== "/register" ? from : null;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = useCameFrom();
  const target = from ?? "/";
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
    <AuthShell title="Welcome back" subtitle="Sign in to Orbit AI" features>
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
        <Link to="/register" state={from ? { from } : undefined} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  // From Resume AI's or Jobs AI's "Start free": back there after sign-up. Otherwise Documents, to add a resume and a job
  // post.
  const from = useCameFrom();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (user) return <Navigate to={from ?? "/"} replace />;
  if (sentTo) return <CheckInbox email={sentTo} from={from} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await register({
        email,
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      if (outcome === "verify_email") setSentTo(email.trim().toLowerCase());
      else if (from) navigate(from, { replace: true });
      else navigate("/documents", { replace: true, state: { onboarding: true } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Interview copilot, Resume AI and Jobs AI, in one account" features>
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
        <Link to="/login" state={from ? { from } : undefined} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

/** After sign-up when the server wants the inbox proven first. Worded the same whether or not the address was new. */
function CheckInbox({ email, from }: { email: string; from: string | null }) {
  return (
    <AuthShell title="Check your inbox" subtitle="One step left">
      <div role="status" className="space-y-4 text-sm">
        <p>
          We sent an email to <strong className="break-all">{email}</strong>. Open the link in it to confirm your
          address, then sign in with the password you just chose.
        </p>
        <p className="text-zinc-500 dark:text-zinc-400">
          Nothing there after a few minutes? Check spam. If you already had an Orbit account, the email explains how
          to sign in or reset your password instead.
        </p>
        <Link to="/login" state={from ? { from } : undefined} className={`block text-center ${linkClass}`}>
          Go to sign in
        </Link>
      </div>
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
  // A button, not on page load: a link someone else sent can't change an email without a deliberate click.
  const [state, setState] = useState<"ready" | "working" | "done" | "failed">(token ? "ready" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its token.");
  const [email, setEmail] = useState<string | null>(null);

  const confirm = () => {
    if (!token) return;
    setState("working");
    api
      .confirmEmailChange(token)
      .then((res) => {
        setUser(null); // every session was signed out: sign in again with the new address
        setEmail(res.email);
        setState("done");
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setState("failed");
      });
  };

  return (
    <AuthShell
      title={state === "done" ? "Email changed" : state === "failed" ? "Link didn't work" : "Change your Orbit email?"}
      subtitle={
        state === "done"
          ? `Sign in with ${email} and your password. Every device was signed out.`
          : state === "failed"
            ? ""
            : "Confirm to make this inbox the account's email."
      }
    >
      <div role="status" className="space-y-4 text-center text-sm">
        {state === "failed" && error && <ErrorNote>{error}</ErrorNote>}
        {(state === "ready" || state === "working") && (
          <Button className="w-full" disabled={state === "working"} onClick={confirm}>
            {state === "working" ? "Confirming…" : "Confirm new email"}
          </Button>
        )}
        {(state === "done" || state === "failed") && (
          <Link to={state === "done" ? "/login" : "/settings"} className={linkClass}>
            {state === "done" ? "Sign in" : "Back to settings"}
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
