import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ContactContext, ContactTopic } from "@orbit/types";
import {
  ArrowLeft,
  Briefcase,
  CircleAlert,
  Clock,
  Mail,
  MessageCircle,
  OrbitWordmark,
  Send,
  ShieldCheck,
  buttonClass,
  cx,
  focusRing,
  isIndia,
  scamReport,
} from "@orbit/ui";
import { Captcha, useCaptchaConfig } from "../components/Captcha";
import { Footer } from "../components/Footer";
import { RelayLaunch } from "../components/RelayLaunch";
import { SiteMenu } from "../components/SiteMenu";
import { Button, Card, ErrorNote, Input, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCountry } from "../lib/country";
import { SUPPORT_EMAIL, mailLink, whatsappLink } from "../lib/contact";
import {
  MESSAGE_MAX,
  contactTopics,
  NAME_MAX,
  PHONE_MAX,
  buildContactRequest,
  contactErrorText,
  fieldErrors,
  messageCounter,
  readPrefill,
  startingMessage,
  type ContactFields,
  type FieldErrors,
} from "../lib/contactForm";

interface ReportedJob {
  title: string;
  company: string;
  url: string;
}

/**
 * The Contact page (`/contact`, public: signed in or out). A form whose messages wait in the admin's Inbox, with a
 * short reference to quote. Signed in, the name and email start filled in from the account (still editable); a link
 * can start it on a topic (`?topic=`) or with a job to report (`?listing=`, `?reason=`, from Jobs AI's "Report this
 * job"). A hidden honeypot field and, signed out, the bot check when the server asks for it; the server holds the
 * limits and says when someone has sent too many.
 */
export function ContactPage() {
  const country = useCountry();
  const india = isIndia(country);
  const topics = contactTopics(country);
  const scam = scamReport(country);
  const { user } = useAuth();
  const { search } = useLocation();
  const prefill = useMemo(() => readPrefill(search), [search]);
  const [fields, setFields] = useState<ContactFields>(() => ({
    name: "",
    email: "",
    phone: "",
    topic: prefill.topic ?? "",
    message: startingMessage(prefill),
  }));
  const [job, setJob] = useState<ReportedJob | null>(null);
  const [keepJob, setKeepJob] = useState(true);
  const [website, setWebsite] = useState(""); // the honeypot
  const captcha = useCaptchaConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const onCaptcha = useCallback((t: string | null) => setCaptchaToken(t), []);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ reference: string; email: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();

  // Signed in: the account's name and email, unless something's typed already.
  useEffect(() => {
    if (user) setFields((f) => ({ ...f, name: f.name || user.name || "", email: f.email || user.email }));
  }, [user]);

  // The reported job's title and company, for the sender to see what they're reporting (Jobs AI needs a session).
  useEffect(() => {
    if (!user || !prefill.listing) return;
    let cancelled = false;
    api
      .jobListing(prefill.listing)
      .then((d) => !cancelled && setJob({ title: d.job.title, company: d.job.company, url: d.job.url }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, prefill.listing]);

  const errors: FieldErrors = tried ? fieldErrors(fields) : {};
  const counter = messageCounter(fields.message);
  const needsCaptcha = !user && Boolean(captcha);
  const topic = topics.find((t) => t.id === fields.topic);
  const set = <K extends keyof ContactFields>(key: K, value: ContactFields[K]) => setFields((f) => ({ ...f, [key]: value }));

  const context: ContactContext | null = useMemo(() => {
    const ctx: ContactContext = { platform: "web" };
    if (prefill.listing && keepJob) {
      ctx.listing_id = prefill.listing;
      if (job) Object.assign(ctx, { listing_title: job.title, listing_company: job.company, listing_url: job.url });
      if (prefill.reason) ctx.reason = prefill.reason;
    }
    if (prefill.from) ctx.page = prefill.from;
    return Object.keys(ctx).length ? ctx : null;
  }, [prefill, job, keepJob]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    const problems = fieldErrors(fields);
    if (Object.keys(problems).length) {
      // Focus the first field that needs attention, so a keyboard or screen reader user lands on it.
      const first = (["topic", "name", "email", "phone", "message"] as const).find((k) => problems[k]);
      formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    if (needsCaptcha && !captchaToken) {
      setError("Please complete the security check first.");
      return;
    }
    setBusy(true);
    try {
      const receipt = await api.sendContact(buildContactRequest(fields, context, needsCaptcha ? captchaToken : null, website));
      setSent({ reference: receipt.reference, email: fields.email.trim() });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(contactErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setSent(null);
    setTried(false);
    setCaptchaToken(null);
    setFields((f) => ({ ...f, phone: "", message: "", topic: "" }));
    setKeepJob(false);
  };

  const whatsapp = whatsappLink("Hi Orbit, I need help with: ");
  const mail = mailLink("Help with Orbit");

  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <header className="relative mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
          <OrbitWordmark size={26} />
        </Link>
        <span className="hidden h-5 w-px bg-zinc-300 sm:block dark:bg-white/15" aria-hidden="true" />
        <span className="hidden font-display text-sm font-semibold sm:inline">Contact</span>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <SiteMenu />
          {user ? (
            <Link to={prefill.from ?? "/"} className={buttonClass("secondary", "md", "min-h-10")}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Orbit
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass("secondary", "md", "hidden min-h-10 sm:inline-flex")}>
                Sign in
              </Link>
              <Link to="/register" className={buttonClass("primary", "md", "hidden min-h-10 min-[400px]:inline-flex")}>
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-2 sm:px-6 sm:pt-6">
        <div className="mb-6 max-w-2xl animate-fade-up">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Contact us</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">
            A question, a payment, a problem, or a job that looks wrong: tell us here and a person reads it. We reply by email.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          {sent ? (
            <Card className="animate-fade-up">
              <div role="status" aria-live="polite">
                <RelayLaunch />
                <h2 className="mt-4 font-display text-xl font-semibold">Thanks, we've got your message</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  We'll reply to <strong className="break-all">{sent.email}</strong>. Your reference is{" "}
                  <strong className="font-mono tabular-nums">{sent.reference}</strong>: quote it if you write again.
                </p>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Check your spam folder if nothing arrives.</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={user ? prefill.from ?? "/" : "/"} className={buttonClass("primary", "md")}>
                  {user ? "Back to Orbit" : "Go to Orbit's home page"}
                </Link>
                <Button variant="secondary" onClick={again}>
                  Send another message
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="animate-fade-up">
              <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate aria-describedby={`${ids}-required`} className="space-y-5">
                <p id={`${ids}-required`} className="text-xs text-zinc-500 dark:text-zinc-400">
                  Every field is needed except the phone number.
                </p>

                <fieldset>
                  <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">What's it about?</legend>
                  <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-describedby={errors.topic ? `${ids}-topic-error` : `${ids}-topic-hint`}>
                    {topics.map((t, i) => (
                      <label
                        key={t.id}
                        className={cx(
                          "inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500",
                          fields.topic === t.id
                            ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-800 dark:text-indigo-200"
                            : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20",
                        )}
                      >
                        <input
                          type="radio"
                          name="topic"
                          value={t.id}
                          checked={fields.topic === t.id}
                          onChange={() => set("topic", t.id as ContactTopic)}
                          className="sr-only"
                          {...(i === 0 ? { "data-field": "topic" } : {})}
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                  {errors.topic ? (
                    <FieldError id={`${ids}-topic-error`}>{errors.topic}</FieldError>
                  ) : (
                    <p id={`${ids}-topic-hint`} className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {topic?.hint ?? "Pick the closest one: it helps the right answer reach you sooner."}
                    </p>
                  )}
                </fieldset>

                {prefill.listing && keepJob && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3 text-sm">
                    <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        Reporting: {job ? `${job.title} at ${job.company}` : "a job from Jobs AI"}
                      </p>
                      {prefill.reason && <p className="text-xs text-zinc-600 dark:text-zinc-400">What's wrong: {prefill.reason}</p>}
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">We'll see which job it is. Add anything that helps, like what they asked you for.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setKeepJob(false)}
                      className={cx("shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-500/10 dark:text-zinc-300", focusRing)}
                    >
                      Not about this job
                    </button>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id={`${ids}-name`} label="Your name" error={errors.name}>
                    <Input
                      id={`${ids}-name`}
                      data-field="name"
                      autoComplete="name"
                      value={fields.name}
                      maxLength={NAME_MAX}
                      onChange={(e) => set("name", e.target.value)}
                      aria-invalid={Boolean(errors.name) || undefined}
                      aria-describedby={errors.name ? `${ids}-name-error` : undefined}
                      required
                    />
                  </FormField>
                  <FormField id={`${ids}-email`} label="Email" error={errors.email} hint="We reply here.">
                    <Input
                      id={`${ids}-email`}
                      data-field="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={fields.email}
                      maxLength={320}
                      onChange={(e) => set("email", e.target.value)}
                      aria-invalid={Boolean(errors.email) || undefined}
                      aria-describedby={errors.email ? `${ids}-email-error` : `${ids}-email-hint`}
                      required
                    />
                  </FormField>
                </div>

                <FormField id={`${ids}-phone`} label="Phone or WhatsApp (optional)" error={errors.phone} hint="Leave this blank unless you want a call. We reply by email without it.">
                  <Input
                    id={`${ids}-phone`}
                    data-field="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={india ? "+91 98765 43210" : "+1 415 555 0132"}
                    value={fields.phone}
                    maxLength={PHONE_MAX}
                    onChange={(e) => set("phone", e.target.value)}
                    aria-invalid={Boolean(errors.phone) || undefined}
                    aria-describedby={errors.phone ? `${ids}-phone-error` : `${ids}-phone-hint`}
                    className="sm:max-w-xs"
                  />
                </FormField>

                <div>
                  <div className="flex items-end justify-between gap-3">
                    <label htmlFor={`${ids}-message`} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Message
                    </label>
                    <span
                      id={`${ids}-count`}
                      className={cx(
                        "text-xs tabular-nums",
                        counter.over ? "font-medium text-rose-700 dark:text-rose-300" : counter.near ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400",
                      )}
                    >
                      <span className="sr-only">Characters: </span>
                      {counter.text}
                    </span>
                  </div>
                  <Textarea
                    id={`${ids}-message`}
                    data-field="message"
                    rows={7}
                    value={fields.message}
                    maxLength={MESSAGE_MAX + 200}
                    onChange={(e) => set("message", e.target.value)}
                    aria-invalid={Boolean(errors.message) || undefined}
                    aria-describedby={`${errors.message ? `${ids}-message-error ` : ""}${ids}-count`}
                    placeholder="Tell us what happened, or what you'd like to know."
                    className="mt-1.5 min-h-40 resize-y"
                    required
                  />
                  {errors.message && <FieldError id={`${ids}-message-error`}>{errors.message}</FieldError>}
                </div>

                {/* The honeypot: hidden from people and from screen readers, so only a bot fills it in. */}
                <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                  <label htmlFor={`${ids}-website`}>Website</label>
                  <input id={`${ids}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </div>

                {needsCaptcha && captcha && <Captcha config={captcha} onToken={onCaptcha} />}
                {error && <ErrorNote>{error}</ErrorNote>}

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" size="lg" loading={busy} disabled={!user && captcha === undefined} className="w-full sm:w-auto">
                    <Send className="h-4 w-4" aria-hidden /> {busy ? "Sending…" : "Send message"}
                  </Button>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    We keep your message to answer it.{" "}
                    <a href="/privacy.html" className={cx("underline underline-offset-2", focusRing)}>
                      Privacy
                    </a>
                  </p>
                </div>
              </form>
            </Card>
          )}

          <aside className="space-y-4" aria-label="More ways to get help">
            <Card>
              <h2 className="flex items-center gap-2 font-display text-base font-semibold">
                <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden /> What happens next
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                <li>A person on the Orbit team reads every message.</li>
                <li>We reply by email, usually within a working day.</li>
                <li>
                  {india
                    ? "Payments: add the UTR so we can find yours fast."
                    : "Payments: add the ORB… reference from Plan & billing, or the PayPal transaction ID."}
                </li>
              </ul>
            </Card>
            {(whatsapp || mail) && (
              <Card>
                <h2 className="font-display text-base font-semibold">Prefer to chat?</h2>
                <div className="mt-3 flex flex-col gap-2">
                  {whatsapp && (
                    <a href={whatsapp} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "justify-start")}>
                      <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden /> WhatsApp us
                    </a>
                  )}
                  {mail && (
                    <a href={mail} className={buttonClass("secondary", "md", "justify-start break-all")}>
                      <Mail className="h-4 w-4" aria-hidden /> {SUPPORT_EMAIL}
                    </a>
                  )}
                </div>
              </Card>
            )}
            <Card>
              <h2 className="font-display text-base font-semibold">Who runs Orbit</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                {india
                  ? "Orbit is an individual service. The price on the site is the full amount in rupees. No fee is added at the last step, and these pages don't list a GSTIN."
                  : "Orbit is an individual service based in India. The price on the site is the full amount in US dollars. No fee is added at the last step; your bank or card may add its own fee for a payment abroad."}{" "}
                Refunds, complaints and requests to delete your data come through this form. If you can sign in,
                Settings also downloads your data or deletes the account.
              </p>
            </Card>
            <Card>
              <h2 className="flex items-center gap-2 font-display text-base font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Job scams
              </h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Real employers never ask for a fee or an OTP. Lost money already?{" "}
                {scam ? (
                  <>
                    Report it at{" "}
                    {scam.links.map(([label, url], i) => (
                      <span key={url}>
                        {i > 0 && " and "}
                        <a href={url} target="_blank" rel="noopener noreferrer" className={cx("font-medium text-indigo-700 underline dark:text-indigo-300", focusRing)}>
                          {label}
                        </a>
                      </span>
                    ))}
                    {scam.phone && (
                      <>
                        {" "}or call{" "}
                        <a href={`tel:${scam.phone.replace(/\s/g, "")}`} className={cx("font-medium text-indigo-700 underline dark:text-indigo-300", focusRing)}>
                          {scam.phone}
                        </a>
                      </>
                    )}
                    .
                  </>
                ) : (
                  "Tell your bank straight away, then report it to your local police or consumer-protection agency."
                )}
              </p>
            </Card>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default ContactPage;

function FormField({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </label>
      {children}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {children}
    </p>
  );
}
