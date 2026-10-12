import { useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import {
  AudioLines,
  Briefcase,
  Eye,
  EyeOff,
  MessagesSquare,
  OrbitWordmark,
  PlanetHero,
  ShieldCheck,
  Sparkles,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";
import { useWelcomeGrant } from "../lib/welcome";
import { Captcha, useCaptchaConfig } from "../components/Captcha";
import { AiPill } from "../components/products";
import { CONTACT_PAGE, PRIVACY_PAGE, REFUND_PAGE, TERMS_PAGE, USE_WHERE_ALLOWED } from "../lib/contact";

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
        <Link to="/" aria-label="Orbit: what it does" className={cx("relative w-fit rounded-lg", focusRing)}>
          <OrbitWordmark size={30} />
        </Link>
        <div className="relative my-auto pt-6 [@media(min-height:800px)]:pt-8">
          <h2 className="max-w-md text-balance font-display text-3xl font-semibold leading-tight tracking-tight [@media(min-height:800px)]:text-4xl">
            Practise interviews, fix your resume, find jobs. One account.
          </h2>
          <div className="mt-5 max-w-md [@media(min-height:800px)]:mt-6">
            <FeatureList />
          </div>
          {welcome && (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-300 ring-1 ring-emerald-400/30">
              <Sparkles className="h-4 w-4" aria-hidden /> {welcome}
            </p>
          )}
          <p className="mt-5 flex max-w-md items-start gap-2 text-xs text-zinc-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> {USE_WHERE_ALLOWED}
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 text-center">
            <Link to="/" aria-label="Orbit: what it does" className={cx("mx-auto mb-6 flex w-fit justify-center rounded-lg lg:hidden", focusRing)}>
              <OrbitWordmark size={34} />
            </Link>
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
              <p className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {USE_WHERE_ALLOWED}
              </p>
            </section>
          )}
          <nav aria-label="About Orbit" className="mt-6 flex flex-wrap justify-center gap-x-4 text-xs">
            <Link to="/" className={smallLink}>
              What Orbit does
            </Link>
            {TERMS_PAGE && (
              <a href={TERMS_PAGE} className={smallLink}>
                Terms
              </a>
            )}
            <a href={PRIVACY_PAGE} className={smallLink}>
              Privacy
            </a>
            <Link to={CONTACT_PAGE} className={smallLink}>
              Contact
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}

/** Under-the-form links: tall enough to tap (24 px and more). */
const smallLink = cx("inline-flex min-h-8 items-center rounded text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100", focusRing);

/**
 * A password box with a show/hide button: people on phones mistype, and seeing what you typed (like pasting) should
 * stay possible (WCAG 3.3.8). The button sits inside the field's right edge.
 */
function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="pr-12" autoCapitalize="none" spellCheck={false} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-controls={props.id}
        className={cx("absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

/** A plain-words strength hint for a new password: length matters most, then mixing kinds of characters. */
function passwordStrength(password: string): { label: string; level: 0 | 1 | 2 | 3 } {
  if (!password) return { label: "", level: 0 };
  if (password.length < 10) {
    const left = 10 - password.length;
    return { label: `${left} more character${left === 1 ? "" : "s"} needed`, level: 1 };
  }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 14 || (password.length >= 12 && kinds >= 3)) return { label: "Strong password", level: 3 };
  return { label: "Good. Longer is stronger: a short sentence works well.", level: 2 };
}

function StrengthHint({ password, id }: { password: string; id: string }) {
  const { label, level } = passwordStrength(password);
  return (
    <div id={id} className="space-y-1.5">
      <div aria-hidden="true" className="grid grid-cols-3 gap-1">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cx(
              "h-1 rounded-full",
              level >= n ? (level === 1 ? "bg-amber-500" : level === 2 ? "bg-indigo-500" : "bg-emerald-500") : "bg-zinc-200 dark:bg-white/10",
            )}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{label || "At least 10 characters. A short sentence is easy to remember."}</p>
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
          <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          <Link
            to="/forgot-password"
            className={cx("inline-flex min-h-8 items-center rounded px-1 text-zinc-600 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200", focusRing)}
          >
            Forgot your password?
          </Link>
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        New to Orbit?{" "}
        <Link
          to="/register"
          state={from ? { from } : undefined}
          className={cx("inline-flex min-h-8 items-center rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
        >
          Create a free account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  // Then the three welcome questions; from Resume AI's or Jobs AI's "Start free", back there after them.
  const from = useCameFrom();
  // Set just before the account is made: the sign-in that comes with it re-renders this page signed in, and that
  // redirect must go to the welcome questions, not straight on (it used to win over the navigation after sign-up).
  const signedUp = useRef(false);
  const strengthId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (user) {
    return signedUp.current ? (
      <Navigate to="/welcome" replace state={from ? { from } : undefined} />
    ) : (
      <Navigate to={from ?? "/"} replace />
    );
  }
  if (sentTo) return <CheckInbox email={sentTo} from={from} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    if (!agreed) {
      setError("Tick the box to agree to the terms.");
      return;
    }
    setBusy(true);
    setError(null);
    signedUp.current = true;
    try {
      const outcome = await register({
        email,
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      // Signed in: this page re-renders with the account and goes to the welcome questions (above).
      if (outcome === "verify_email") setSentTo(email.trim().toLowerCase());
    } catch (err) {
      signedUp.current = false;
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your free account" subtitle="Takes about a minute. Interview copilot, Resume AI and Jobs AI, in one account." features>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Name" htmlFor="name">
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            aria-describedby={strengthId}
            onChange={(e) => setPassword(e.target.value)}
          />
          <StrengthHint password={password} id={strengthId} />
        </Field>
        {captcha && <Captcha config={captcha} onToken={setCaptchaToken} />}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy || !agreed || captcha === undefined || (!!captcha && !captchaToken)} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
          />
          <span>
            I agree to the{" "}
            {TERMS_PAGE && (
              <>
                <a href={TERMS_PAGE} className="underline underline-offset-2">terms</a>, the{" "}
              </>
            )}
            <a href={PRIVACY_PAGE} className="underline underline-offset-2">privacy policy</a>
            {REFUND_PAGE && (
              <>
                {" "}and the <a href={REFUND_PAGE} className="underline underline-offset-2">refund policy</a>
              </>
            )}
            .
          </span>
        </label>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link
          to="/login"
          state={from ? { from } : undefined}
          className={cx("inline-flex min-h-8 items-center rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
        >
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
          <PasswordInput id="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <PasswordInput id="confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
          <Link to={user ? "/" : "/login"} className={cx(linkClass, "inline-block")}>
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
          <Link to={state === "done" ? "/login" : "/settings"} className={cx(linkClass, "inline-block")}>
            {state === "done" ? "Sign in" : "Back to settings"}
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
