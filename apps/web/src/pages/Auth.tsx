import { useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, cx, focusRing, passkeysSupported } from "@orbit/ui";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clearAsyncCache } from "../lib/useAsync";
import { errorText } from "../lib/format";
import { useWelcomeGrant } from "../lib/welcome";
import { Captcha, useCaptchaConfig } from "../components/Captcha";
import { useIndia } from "../lib/country";
import { BrandLogo } from "../marketing/BrandLogo";
import { PRODUCT_TILE, siteProducts } from "../marketing/catalog";
import { GoogleButton, type GoogleLabel } from "../marketing/GoogleButton";
import { IconTile } from "../marketing/primitives";
import { useSiteScope } from "../marketing/useSiteScope";
import { kashsecUrl } from "./learn/links";
import { CONTACT_PAGE, PRIVACY_PAGE, REFUND_PAGE, TERMS_PAGE, USE_WHERE_ALLOWED } from "../lib/contact";
import { storedRef } from "../lib/referral";
import { InviteNote } from "../components/InviteNote";
import { acknowledgeSecurityChanges } from "../lib/securityNotice";

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

/**
 * What one account gives you, on the sign-in and sign-up screens (the side panel on wide screens, under the form on
 * phones): the four main products with their marks, then the other tools in a line, and the privacy promise.
 */
function ProductPanel({ compact = false }: { compact?: boolean }) {
  const india = useIndia();
  const products = siteProducts(india);
  const main = products.filter((p) => p.main);
  const more = products.filter((p) => !p.main);
  return (
    <div className={compact ? "space-y-5" : "space-y-7"}>
      <ul className={cx("grid gap-4", compact && "sm:grid-cols-2")} aria-label="Orbit's products">
        {main.map((p) => (
          <li key={p.id} className="flex items-start gap-3.5">
            <IconTile icon={p.icon} tone={PRODUCT_TILE[p.id]} size={compact ? "sm" : "md"} />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-semibold text-zinc-950 dark:text-white">{p.name}</span>
              <span className="mt-0.5 block text-sm leading-snug text-zinc-600 dark:text-zinc-400">{p.line}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">Also in your account:</span> {more.map((p) => p.name).join(", ")}, and free
        cybersecurity lessons on{" "}
        <a href={kashsecUrl("signin")} target="_blank" rel="noopener" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
          KashSec<span className="sr-only"> (opens KashSec in a new tab)</span>
        </a>
        .
      </p>
      <p className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
        Your documents stay in your account, audio is never stored, and you can delete any of it at any time.
      </p>
    </div>
  );
}

/**
 * The sign-in and sign-up screens' frame, in the front door's look (html.site): the form on the white canvas, and on
 * wide screens a quiet panel beside it saying what the account gives you. No sky, no glow.
 */
function AuthShell({ title, subtitle, children, features = false }: { title: string; subtitle: string; children: ReactNode; features?: boolean }) {
  useSiteScope();
  const welcome = useWelcome();
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-h-full flex-col">
        <header className="flex h-16 items-center px-5 sm:px-8">
          <Link to="/" aria-label="Orbit: what it does" className={cx("-ml-1 rounded-lg p-1", focusRing)}>
            <BrandLogo height={26} decorative />
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 pb-12 pt-6 sm:px-8 sm:pt-12 lg:items-center lg:pt-0">
          <div className="w-full max-w-[24rem] animate-fade-up">
            <div className="mb-8">
              <h1 className="mk-h2 text-zinc-950 dark:text-white">{title}</h1>
              <p className="mt-3 text-[0.9375rem] text-zinc-600 dark:text-zinc-400">{subtitle}</p>
            </div>
            {children}
            {features && (
              <section aria-label="What Orbit does" className="mt-12 space-y-5 border-t mk-line pt-8 lg:hidden">
                {welcome && <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{welcome}</p>}
                <ProductPanel compact />
                <p className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {USE_WHERE_ALLOWED}
                </p>
              </section>
            )}
            <nav aria-label="About Orbit" className="mt-10 flex flex-wrap gap-x-5 text-xs">
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
      <aside className="hidden border-l mk-line mk-band lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-16 xl:px-20">
        <div className="max-w-md">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">One account</p>
          <h2 className="mk-h2 mt-4 text-zinc-950 dark:text-white">
            <span className="whitespace-nowrap">Interview-ready,</span> from resume to offer.
          </h2>
          <div className="mt-10">
            <ProductPanel />
          </div>
          {welcome && (
            <p className="mt-8 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {welcome}
            </p>
          )}
          <p className="mt-8 flex items-start gap-2.5 border-t mk-line pt-6 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> {USE_WHERE_ALLOWED}
          </p>
        </div>
      </aside>
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

const GOOGLE_ERROR: Record<string, string> = {
  google: "Google sign-in didn't finish. Try again, or use your email.",
  private: "This Orbit server is private. Ask the owner to add your email.",
  suspended: "This account is suspended.",
  unverified: "That Google account doesn't have a confirmed email. Use another, or sign up with email.",
  taken: "An account with this email already exists. Sign in with your password, or Continue with Google.",
  server: "Something went wrong on our side while signing you in. Try again in a minute.",
  busy: "Too many sign-in attempts from your network. Wait a minute, then try again.",
  google_off: "Google sign-in isn't available right now. Sign in with your email instead.",
};

function useGoogleOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    api.authConfig().then((c) => setOn(Boolean(c.google))).catch(() => setOn(false));
  }, []);
  return on;
}

/** Google sign-in or sign-up when the server has it set up (hidden otherwise), to Google's branding rules. */
function GoogleContinue({ next, label }: { next: string; label: GoogleLabel }) {
  const on = useGoogleOn();
  if (!on) return null;
  // A link's invite or creator code rides through Google's page to the new account (lib/referral.ts).
  const ref = storedRef();
  // Straight to the API's own address when the web app already calls it there (D80): one trip through the slow edge
  // proxy fewer. Google comes back through the site's /api (the redirect URI it has), and the state cookie is shared.
  const href = api.urlFor(`/v1/auth/google/start?next=${encodeURIComponent(next || "/")}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
  return (
    <div className="mb-4 space-y-4">
      <GoogleButton href={href} label={label} className="w-full" />
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        By continuing you agree to the{" "}
        {TERMS_PAGE && <><a href={TERMS_PAGE} className="underline underline-offset-2">terms</a>, the </>}
        <a href={PRIVACY_PAGE} className="underline underline-offset-2">privacy policy</a>
        {REFUND_PAGE && <> and the <a href={REFUND_PAGE} className="underline underline-offset-2">refund policy</a></>}
        .
      </p>
      <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="h-px flex-1 bg-[rgb(var(--site-line))]" />
        or use email
        <span className="h-px flex-1 bg-[rgb(var(--site-line))]" />
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login, finishSecondStep, loginWithPasskey } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const from = useCameFrom();
  const target = from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(GOOGLE_ERROR[search.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);
  // Two-step sign-in: after the password (a challenge) or after Google (?step=2fa: the challenge is in a cookie).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [secondStep, setSecondStep] = useState(search.get("step") === "2fa");
  const [code, setCode] = useState("");

  if (user) return <Navigate to={target} replace />;

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await loginWithPasskey()) navigate(target, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (secondStep) {
        await finishSecondStep(code, challenge);
        navigate(target, { replace: true });
        return;
      }
      const pending = await login({ email, password });
      if (pending) {
        setChallenge(pending.challenge);
        setSecondStep(true);
        return;
      }
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to Orbit AI" features>
      {secondStep ? (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Enter the 6-digit code from your authenticator app.</p>
          <Field label="Code" htmlFor="totp">
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="tracking-widest"
            />
          </Field>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Lost your phone? Enter one of your recovery codes instead.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy || code.trim().length < 6} className="w-full">
            {busy ? "Checking…" : "Verify and sign in"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setSecondStep(false);
              setChallenge(null);
              setCode("");
              setError(null);
            }}
            className={cx("mx-auto block rounded text-sm text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}
          >
            Start again
          </button>
        </form>
      ) : (
      <>
      <GoogleContinue next={target} label="Sign in with Google" />
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
        {passkeysSupported() && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void withPasskey()} className="w-full">
            <KeyRound className="h-4 w-4" aria-hidden /> Sign in with a passkey
          </Button>
        )}
        <p className="text-center text-sm">
          <Link
            to="/forgot-password"
            className={cx("inline-flex min-h-8 items-center rounded px-1 text-zinc-600 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200", focusRing)}
          >
            Forgot your password?
          </Link>
        </p>
      </form>
      </>
      )}
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
      <InviteNote />
      <GoogleContinue next={from ?? "/"} label="Sign up with Google" />
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
        <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setError(null);
            }}
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
        <Button type="submit" disabled={busy || captcha === undefined || (!!captcha && !captchaToken)} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
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
      acknowledgeSecurityChanges();
      // A reset link proves the inbox, not the authenticator: with two-step sign-in on, the code comes next (the
      // challenge waits in an httpOnly cookie, as after Google).
      if ("two_factor_required" in res) {
        navigate("/login?step=2fa", { replace: true });
        return;
      }
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

/** The job alert email's "stop these emails" link: a button, so a mail scanner opening the link changes nothing. */
export function StopJobAlertsPage() {
  const token = useOneTimeToken();
  const { user } = useAuth();
  const [state, setState] = useState<"ready" | "working" | "done" | "failed">(token ? "ready" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its token.");
  const stop = () => {
    if (!token) return;
    setState("working");
    api.stopJobAlerts(token).then(
      () => setState("done"),
      (err: unknown) => {
        setError(errorText(err));
        setState("failed");
      },
    );
  };
  return (
    <AuthShell
      title={state === "done" ? "Job alerts stopped" : "Stop job alert emails?"}
      subtitle={state === "done" ? "You won't get any more. Turn them back on any time in Jobs AI, Profile." : "Orbit will stop emailing you new job matches."}
    >
      <div role="status" className="space-y-4 text-center text-sm">
        {state === "failed" && error && <ErrorNote>{error}</ErrorNote>}
        {(state === "ready" || state === "working") && (
          <Button className="w-full" disabled={state === "working"} onClick={stop}>
            {state === "working" ? "Stopping…" : "Stop these emails"}
          </Button>
        )}
        {state !== "ready" && state !== "working" && (
          <Link to={user ? "/jobs/profile" : "/login"} className={cx(linkClass, "inline-block")}>
            {user ? "Go to your job profile" : "Sign in"}
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
  const [googleOff, setGoogleOff] = useState(false);

  const confirm = () => {
    if (!token) return;
    setState("working");
    api
      .confirmEmailChange(token)
      .then((res) => {
        clearAsyncCache(); // the old account's lists must not show after the address changes
        setUser(null); // every session was signed out: sign in again with the new address
        setEmail(res.email);
        setGoogleOff(Boolean(res.google_disconnected));
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
          ? `Sign in with ${email} and your password.${googleOff ? " Google was disconnected from the old inbox." : ""} Every device was signed out.`
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
