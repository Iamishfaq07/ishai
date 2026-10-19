// Orbit for Business (D82), public: a company's careers page, a job with its Apply form, a candidate's status page.
// The Worker serves the first two as full HTML (worker/careers.js) for search engines; this is the same page with
// the form, and takes over once its data is here (lib/prerender.tsx).
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { BizApplicationStatus, BizApplyPreview, BizApplyResult, BizJobReport, BizPublicCompany, BizPublicJob, BizQuestion } from "@orbit/types";
import {
  ArrowLeft,
  ShieldCheck,
  Briefcase,
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogActions,
  EmptyState,
  Field,
  Flag,
  Input,
  MapPin,
  Select,
  Textarea,
  buttonClass,
  cx,
  focusRing,
  toast,
} from "@orbit/ui";
import { Captcha, useCaptchaConfig } from "../components/Captcha";
import { useAuth } from "../lib/auth";
import { handOff } from "../lib/prerender";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { biz } from "./api";

import { CandidateChallenge } from "./CandidateChallenge";
import { hiringApi } from "./hiringApi";
import { EMAIL_RE, EMPLOYMENT_LABEL, EXPERIENCE_LABEL, careersPath, dayTime, publicJobPath, resumeFileProblem, salaryLine } from "./model";
import { errorText } from "./ui";

const CandidateWithdrawal = lazy(async () => ({ default: (await import("./CandidateWithdrawal")).CandidateWithdrawal }));

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: Error | null; status: number | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((d) => live && (setData(d), setStatus(200)))
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus((e as { status?: number }).status ?? 0);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, status, reload: () => setN((x) => x + 1) };
}

function Shell({ children, company }: { children: ReactNode; company?: { name: string; slug: string } | undefined }) {
  // The built (Worker) copy stays until this copy has its data; then it hands over in the same frame.
  useEffect(() => {
    if (company) handOff();
  }, [company]);
  return (
    <div className="min-h-full bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-white/10">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          {company ? (
            <Link to={careersPath(company.slug)} className={cx("truncate rounded font-semibold", focusRing)}>
              {company.name} careers
            </Link>
          ) : (
            <Link to="/" className={cx("rounded font-semibold", focusRing)}>
              Orbit
            </Link>
          )}
          <Link to="/business" className={cx("shrink-0 rounded text-xs text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
            Hiring with Orbit for Business
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}

function CompanyMark({ name, logo, size = "h-14 w-14" }: { name: string; logo: string | null; size?: string }) {
  return logo ? (
    <img src={logo} alt={`${name} logo`} width={56} height={56} className={cx(size, "shrink-0 rounded-xl border border-zinc-200 bg-white object-contain dark:border-white/10")} />
  ) : (
    <span aria-hidden="true" className={cx(size, "flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xl font-semibold text-zinc-600 dark:bg-white/5 dark:text-zinc-300")}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Verified: acme.com": the badge names the domain the company proved, so a look-alike name can't borrow it. */
function Verified({ on, domain }: { on: boolean; domain: string | null }) {
  if (!on) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-200"
      title={domain ? `This company proved it controls ${domain}` : undefined}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden /> {domain ? `Verified: ${domain}` : "Verified company"}
    </span>
  );
}

function NotHere({ what }: { what: string }) {
  return (
    <Shell>
      <EmptyState kind="no-results" title={`This ${what} isn't here`} body="The link may be old, or the job was taken down." action={<Link to="/" className={buttonClass("secondary")}>Go to Orbit</Link>} />
    </Shell>
  );
}

// ---- /company/:slug -----------------------------------------------------------------------------------------------

export function CompanyCareersPage() {
  const { slug = "" } = useParams();
  const { data, error, status, reload } = useLoad<BizPublicCompany>(() => biz.publicCompany(slug), [slug]);
  useDocumentTitle(data ? `Jobs at ${data.name} | Orbit` : "Jobs | Orbit", null, true);
  if (status === 404) return <NotHere what="careers page" />;
  if (error) return <Shell><Callout tone="error" action={<Button size="sm" variant="secondary" onClick={reload}>Try again</Button>}>{errorText(error)}</Callout></Shell>;
  if (!data) return <Shell><p role="status" className="text-sm text-zinc-500">Loading jobs…</p></Shell>;
  return (
    <Shell company={data}>
      <header className="flex items-center gap-4">
        <CompanyMark name={data.name} logo={data.logo_url} />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Jobs at {data.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            {data.website && (
              <a href={/^https?:\/\//.test(data.website) ? data.website : `https://${data.website}`} rel="nofollow noopener" className={cx("rounded underline", focusRing)}>
                {data.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            )}
            <Verified on={data.verified} domain={data.verified_domain} />
          </p>
        </div>
      </header>
      {data.about && <p className="mt-6 max-w-2xl whitespace-pre-line text-[0.9375rem] leading-relaxed text-zinc-700 dark:text-zinc-300">{data.about}</p>}
      <h2 className="mt-10 text-lg font-semibold">Open jobs ({data.jobs.length})</h2>
      {data.jobs.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">No open jobs right now. Check back soon.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">
          {data.jobs.map((j) => (
            <li key={j.id} className="p-4">
              <Link to={publicJobPath(data.slug, j.slug)} className={cx("rounded text-base font-semibold text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                {j.title}
              </Link>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{[j.department, j.location_line, EMPLOYMENT_LABEL[j.employment_type]].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// ---- /company/:slug/jobs/:jobSlug ---------------------------------------------------------------------------------

export function PublicJobPage() {
  const { slug = "", jobSlug = "" } = useParams();
  const { data, error, status, reload } = useLoad<BizPublicJob>(() => biz.publicJob(slug, jobSlug), [slug, jobSlug]);
  const [reporting, setReporting] = useState(false);
  useDocumentTitle(data ? `${data.title} at ${data.company.name} | Orbit` : "Job | Orbit", null, true);
  if (status === 404) return <NotHere what="job" />;
  if (error) return <Shell><Callout tone="error" action={<Button size="sm" variant="secondary" onClick={reload}>Try again</Button>}>{errorText(error)}</Callout></Shell>;
  if (!data) return <Shell><p role="status" className="text-sm text-zinc-500">Loading the job…</p></Shell>;
  const salary = salaryLine(data.salary);
  const facts = [data.location_line, EMPLOYMENT_LABEL[data.employment_type], EXPERIENCE_LABEL[data.experience], data.department, salary].filter(Boolean) as string[];
  return (
    <Shell company={data.company}>
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to={careersPath(data.company.slug)} className={cx("inline-flex items-center gap-1 rounded text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Jobs at {data.company.name}
        </Link>
      </nav>
      <header className="mt-4 flex items-start gap-4">
        <CompanyMark name={data.company.name} logo={data.company.logo_url} />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{data.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span>{data.company.name}</span> <Verified on={data.company.verified} domain={data.company.verified_domain} />
          </p>
        </div>
      </header>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {facts.map((f, i) => (
          <li key={f} className="inline-flex items-center gap-1">
            {i === 0 && <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden />}
            {f}
          </li>
        ))}
        {data.published_at && <li>Posted {new Date(data.published_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</li>}
      </ul>
      {data.workplace === "remote" && data.allowed_countries.length > 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Remote, for people living in: {data.allowed_countries.join(", ")}</p>
      )}
      {data.status === "closed" && (
        <Callout tone="info" className="mt-6">
          This job is closed and no longer takes applications. <Link to={careersPath(data.company.slug)} className="underline">See the open jobs</Link>.
        </Callout>
      )}
      {data.status === "paused" && <Callout tone="warning" className="mt-6">This job isn't taking applications right now.</Callout>}
      {data.status === "open" && (
        <p className="mt-6">
          <a href="#apply" className={buttonClass("primary", "lg")}>
            <Briefcase className="h-4 w-4" aria-hidden /> Apply for this job
          </a>
        </p>
      )}
      {/* The API sanitizes the description to the editor's few tags (p, lists, headings, links). */}
      <div className="biz-prose mt-8 text-[0.9375rem] leading-relaxed text-zinc-800 dark:text-zinc-200" dangerouslySetInnerHTML={{ __html: data.description_html }} />
      {data.status === "open" && <ApplyPanel job={data} />}
      <p className="mt-10 text-sm">
        <button type="button" onClick={() => setReporting(true)} className={cx("inline-flex items-center gap-1.5 rounded text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
          <Flag className="h-3.5 w-3.5" aria-hidden /> Report this job
        </button>
      </p>
      <ReportDialog jobId={data.id} open={reporting} onClose={() => setReporting(false)} />
    </Shell>
  );
}

const REPORT_REASONS: Array<{ value: BizJobReport["reason"]; label: string }> = [
  { value: "scam", label: "It looks like a scam (asks for money, or personal details up front)" },
  { value: "fake_company", label: "The company isn't real, or isn't who it says" },
  { value: "discriminatory", label: "It discriminates against people" },
  { value: "misleading", label: "The pay, place or role is misleading" },
  { value: "other", label: "Something else" },
];

function ReportDialog({ jobId, open, onClose }: { jobId: string; open: boolean; onClose: () => void }) {
  const id = useId();
  const [reason, setReason] = useState<BizJobReport["reason"]>("scam");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await biz.reportJob(jobId, { reason, details: details.trim(), ...(email.trim() ? { email: email.trim() } : {}) });
      toast({ message: "Thanks. The Orbit team will look at this job.", tone: "success" });
      onClose();
      setDetails("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Report this job" size="md">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">The Orbit team reviews every report and can take a job or a company down.</p>
        <Field label="What's wrong?" htmlFor={`${id}-r`}>
          <Select id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value as BizJobReport["reason"])}>
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Details" htmlFor={`${id}-d`} hint="What happened, or what in the post is wrong." counter={{ value: details.length, max: 2000 }}>
          <Textarea id={`${id}-d`} rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <Field label="Your email (optional)" htmlFor={`${id}-e`} hint="Only if you'd like us to reply.">
          <Input id={`${id}-e`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
        <DialogActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Send report
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ---- applying ------------------------------------------------------------------------------------------------------

function sourceFromUrl(search: string): "careers" | "widget" | "google" | "linkedin" | "orbit" | "direct" | "other" {
  const s = new URLSearchParams(search).get("source") ?? new URLSearchParams(search).get("utm_source") ?? "";
  if (/^(widget|google|linkedin|orbit|direct)$/.test(s)) return s as "widget";
  if (typeof document !== "undefined" && /google\./.test(document.referrer)) return "google";
  return "careers";
}

function QuestionInput({ q, value, onChange, idBase }: { q: BizQuestion; value: string; onChange: (v: string) => void; idBase: string }) {
  const id = `${idBase}-${q.id}`;
  if (q.kind === "yes_no" || q.kind === "choice") {
    const options = q.kind === "yes_no" ? ["yes", "no"] : (q.choices ?? []);
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {q.text}
          {q.required && <span aria-hidden="true" className="ml-0.5 text-rose-700 dark:text-rose-400">*</span>}
          {q.required && <span className="sr-only"> (required)</span>}
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name={id} value={o} checked={value === o} onChange={() => onChange(o)} required={q.required} className={cx("h-4 w-4", focusRing)} />
              {q.kind === "yes_no" ? (o === "yes" ? "Yes" : "No") : o}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <Field label={q.text} htmlFor={id} required={q.required}>
      <Input id={id} type={q.kind === "number" ? "number" : "text"} inputMode={q.kind === "number" ? "decimal" : undefined} value={value} required={q.required} maxLength={500} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Questions({ job, answers, setAnswers, idBase }: { job: BizPublicJob; answers: Record<string, string>; setAnswers: (a: Record<string, string>) => void; idBase: string }) {
  if (job.questions.length === 0) return null;
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold">Questions from {job.company.name}</legend>
      {job.questions.map((q) => (
        <QuestionInput key={q.id} q={q} idBase={idBase} value={answers[q.id] ?? ""} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />
      ))}
    </fieldset>
  );
}

function missingAnswer(job: BizPublicJob, answers: Record<string, string>): string | null {
  const q = job.questions.find((x) => x.required && !(answers[x.id] ?? "").trim());
  return q ? `Answer "${q.text}".` : null;
}

function Notice({ job, consent, setConsent, idBase }: { job: BizPublicJob; consent: boolean; setConsent: (v: boolean) => void; idBase: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-sm dark:border-white/10 dark:bg-white/[0.03]">
      <p id={`${idBase}-notice`} className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        {job.notice.text}
      </p>
      <Checkbox className="mt-3" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby={`${idBase}-notice`} label="I've read this and agree to share my application with the company" />
    </div>
  );
}

function Applied({ result }: { result: BizApplyResult }) {
  return (
    <Callout tone="success" title={result.status === "already_applied" ? "You've already applied" : "Application sent"}>
      <p>{result.message}</p>
      {result.status_url && (
        <p className="mt-1">
          <a href={result.status_url} className="font-medium underline">
            See where your application is
          </a>
        </p>
      )}
      {result.tracker_id && (
        <p className="mt-1">
          It's in your <Link to="/jobs/tracker" className="font-medium underline">Jobs AI tracker</Link>, and moves as the company moves it.
        </p>
      )}
    </Callout>
  );
}

function ApplyPanel({ job }: { job: BizPublicJob }) {
  const { user, loading } = useAuth();
  return (
    <section id="apply" aria-labelledby="apply-title" className="mt-10 scroll-mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
      <h2 id="apply-title" className="text-lg font-semibold">
        Apply for {job.title}
      </h2>
      {loading ? <p className="mt-3 text-sm text-zinc-500">One moment…</p> : user ? <OneClickApply job={job} /> : <SignedOutApply job={job} />}
    </section>
  );
}

function OneClickApply({ job }: { job: BizPublicJob }) {
  const idBase = useId();
  const location = useLocation();
  const [pick, setPick] = useState<{ resume_id?: string; document_id?: string }>({});
  const [preview, setPreview] = useState<BizApplyPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BizApplyResult | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    let live = true;
    biz
      .applyPreview(job.id, pick)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setPhone((cur) => cur || p.phone || "");
      })
      .catch((e: unknown) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [job.id, pick]);

  if (loadError) return <Callout tone="error" className="mt-3">{loadError}</Callout>;
  if (!preview) return <p className="mt-3 text-sm text-zinc-500" role="status">Getting your resumes…</p>;
  if (result) return <div className="mt-3"><Applied result={result} /></div>;
  if (preview.already_applied) return <div className="mt-3"><Applied result={{ status: "already_applied", message: "You applied to this job with your Orbit account.", status_url: null, tracker_id: null }} /></div>;
  if (preview.resumes.length === 0) {
    return (
      <div className="mt-3 space-y-3 text-sm">
        <p>Applying in one click shares one of your Orbit resumes, and you have none yet.</p>
        <Link to="/resume-ai" state={{ from: location.pathname }} className={buttonClass("secondary")}>
          Make a resume in Resume AI
        </Link>
      </div>
    );
  }
  const current = preview.resumes.find((r) => r.id === (pick.resume_id ?? pick.document_id)) ?? preview.resumes[0]!;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = missingAnswer(job, answers);
    if (missing) return setError(missing);
    if (!consent) return setError("Tick the box to agree to share your application.");
    setBusy(true);
    setError(null);
    try {
      const r = await biz.applyOneClick(job.id, {
        ...(current.kind === "orbit_resume" ? { resume_id: current.id } : { document_id: current.id }),
        phone: phone.trim() || null,
        answers: job.questions.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? "" })),
        consent: true,
        notice_version: job.notice.version,
        source: sourceFromUrl(location.search),
      });
      setResult(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Apply with your Orbit account. Here's exactly what {job.company.name} gets; nothing else from Orbit is shared.</p>
      <Field label="Resume to share" htmlFor={`${idBase}-resume`}>
        <Select
          id={`${idBase}-resume`}
          value={current.id}
          onChange={(e) => {
            const r = preview.resumes.find((x) => x.id === e.target.value);
            if (r) setPick(r.kind === "orbit_resume" ? { resume_id: r.id } : { document_id: r.id });
          }}
        >
          {preview.resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} {r.kind === "orbit_document" ? "(document)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-zinc-200 p-3.5 text-sm dark:border-white/10 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Name</dt>
          <dd>{preview.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Email</dt>
          <dd className="break-all">{preview.email}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Resume: {preview.resume_title}</dt>
          <dd>
            <button type="button" aria-expanded={showText} onClick={() => setShowText((v) => !v)} className={cx("mt-1 rounded text-sm font-medium text-indigo-700 underline dark:text-indigo-300", focusRing)}>
              {showText ? "Hide" : "Show"} the text that's shared
            </button>
            {showText && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-sans text-xs dark:bg-white/5">{preview.resume_text}</pre>}
          </dd>
        </div>
      </dl>
      <Field label="Phone (optional)" htmlFor={`${idBase}-phone`}>
        <Input id={`${idBase}-phone`} type="tel" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Questions job={job} answers={answers} setAnswers={setAnswers} idBase={idBase} />
      <Notice job={job} consent={consent} setConsent={setConsent} idBase={idBase} />
      {error && <Callout tone="error">{error}</Callout>}
      <Button type="submit" size="lg" loading={busy} loadingText="Sending">
        Apply in one click
      </Button>
    </form>
  );
}

function SignedOutApply({ job }: { job: BizPublicJob }) {
  const idBase = useId();
  const location = useLocation();
  const captcha = useCaptchaConfig();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [honey, setHoney] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BizApplyResult | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const fileProblem = file ? resumeFileProblem(file) : null;

  if (result) return <div className="mt-3"><Applied result={result} /></div>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Add your name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Add an email address we can reach you at.");
    if (!file) return setError("Add your resume (PDF or Word).");
    if (fileProblem) return setError(fileProblem);
    const missing = missingAnswer(job, answers);
    if (missing) return setError(missing);
    if (!consent) return setError("Tick the box to agree to share your application.");
    if (captcha && !token) return setError("Complete the check below.");
    const form = new FormData();
    form.append("name", name.trim());
    form.append("email", email.trim());
    form.append("phone", phone.trim());
    form.append("answers", JSON.stringify(job.questions.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? "" }))));
    form.append("consent", "true");
    form.append("notice_version", job.notice.version);
    form.append("source", sourceFromUrl(location.search));
    form.append("website", honey);
    if (token) form.append("captcha_token", token);
    form.append("file", file, file.name);
    setBusy(true);
    setError(null);
    try {
      setResult(await biz.applySignedOut(job.id, form));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Have an Orbit account?{" "}
        <Link to="/login" state={{ from: `${location.pathname}#apply` }} className="font-medium text-indigo-700 underline dark:text-indigo-300">
          Sign in to apply in one click
        </Link>
        .
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor={`${idBase}-n`} required>
          <Input id={`${idBase}-n`} autoComplete="name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email" htmlFor={`${idBase}-e`} required hint="We'll send a link to confirm it.">
          <Input id={`${idBase}-e`} type="email" autoComplete="email" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Phone (optional)" htmlFor={`${idBase}-p`}>
          <Input id={`${idBase}-p`} type="tel" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Resume" htmlFor={`${idBase}-f`} required hint="PDF or Word (.docx), up to 5 MB." error={fileProblem}>
          <Input id={`${idBase}-f`} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </Field>
      </div>
      {/* For bots only: people never see or fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website <input tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} />
        </label>
      </div>
      <Questions job={job} answers={answers} setAnswers={setAnswers} idBase={idBase} />
      <Notice job={job} consent={consent} setConsent={setConsent} idBase={idBase} />
      {captcha && <Captcha config={captcha} onToken={onToken} />}
      {error && <Callout tone="error">{error}</Callout>}
      <Button type="submit" size="lg" loading={busy} loadingText="Sending">
        Send application
      </Button>
    </form>
  );
}

// ---- /application/:token ------------------------------------------------------------------------------------------

export function ApplicationStatusPage() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState<BizApplicationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>("");
  const [changingTime, setChangingTime] = useState(false);
  useDocumentTitle("Your application | Orbit", null, true);
  const confirmNow = params.get("confirm") === "1";

  useEffect(() => {
    let live = true;
    setData(null); setError(null); setSlot(""); setChangingTime(false);
    (confirmNow ? biz.confirm(token) : biz.status(token))
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [token, confirmNow]);

  const act = async (what: string, run: () => Promise<BizApplicationStatus>, done: string) => {
    setBusy(what);
    try {
      setData(await run());
      toast({ message: done, tone: "success" });
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const slots = useMemo(() => data?.interview?.slots ?? [], [data]);
  if (error) {
    return (
      <Shell>
        <EmptyState kind="no-results" title="This link doesn't work" body={error} />
      </Shell>
    );
  }
  if (!data) return <Shell><p role="status" className="text-sm text-zinc-500">Loading your application…</p></Shell>;
  return (
    <Shell company={data.company}>
      <div className="flex items-center gap-4">
        <CompanyMark name={data.company.name} logo={data.company.logo_url} size="h-12 w-12" />
        <div className="min-w-0">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Your application to {data.company.name}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{data.job_title}</h1>
        </div>
      </div>
      {confirmNow && data.email_confirmed && <Callout tone="success" className="mt-6">Thanks, your email is confirmed.</Callout>}
      <section aria-labelledby="stage-title" className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Where it is</p>
        <h2 id="stage-title" className="mt-1 text-xl font-semibold">
          {data.stage_label}
        </h2>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{data.stage_detail}</p>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Applied {new Date(data.applied_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} ·{" "}
          <Link to={data.job_url.replace(/^https?:\/\/[^/]+/, "")} className="underline">
            The job post
          </Link>
        </p>
        {!data.email_confirmed && (
          <div className="mt-4">
            <Button size="sm" variant="secondary" loading={busy === "confirm"} onClick={() => void act("confirm", () => biz.confirm(token), "Email confirmed.")}>
              Confirm my email
            </Button>
          </div>
        )}
      </section>

      {data.interview && (
        <section aria-labelledby="slots-title" className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
          <h2 id="slots-title" className="text-lg font-semibold">
            Your interview
          </h2>
          {data.interview.chosen && !changingTime ? (
            <div className="mt-2 space-y-3"><p className="text-sm">
              Booked for <strong>{dayTime(data.interview.chosen)}</strong> ({data.interview.duration_min} min). {data.interview.location && <>Where: {data.interview.location}</>}
            </p><div className="flex flex-wrap items-center gap-3"><a href={hiringApi.calendar(token)} referrerPolicy="no-referrer" className="text-sm underline" download>Download calendar event (.ics)</a>
              <Button size="sm" variant="secondary" onClick={() => setChangingTime(true)}>Choose another offered time</Button></div>
            <p className="text-xs text-zinc-500">Times use your local zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Update your imported calendar if your booking changes.</p></div>
          ) : (
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (slot) void act("book", async () => { const result = await biz.book(token, slot); setChangingTime(false); return result; }, "Your time is booked. Your calendar event is available here.");
              }}
            >
              <fieldset>
                <legend className="text-sm">Pick a time that works ({data.interview.duration_min} min{data.interview.location ? `, ${data.interview.location}` : ""}):</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {slots.filter((s) => new Date(s).getTime() > Date.now()).map((s) => (
                    <label key={s} className={cx("flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm", slot === s ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-400/10" : "border-zinc-200 dark:border-white/10")}>
                      <input type="radio" name="slot" value={s} checked={slot === s} onChange={() => setSlot(s)} className={cx("h-4 w-4", focusRing)} />
                      {dayTime(s)}
                    </label>
                  ))}
                </div>
                {!slots.some((s) => new Date(s).getTime() > Date.now()) && <p className="mt-3 text-sm text-zinc-500">No offered times are available. Ask the hiring team for new times below.</p>}
              </fieldset>
              <Button type="submit" disabled={!slot} loading={busy === "book"}>
                Book this time
              </Button>
              {data.interview.chosen && <Button type="button" variant="ghost" onClick={() => setChangingTime(false)}>Keep current booking</Button>}
            </form>
          )}
        </section>
      )}

      <CandidateChallenge key={`${token}/${data.application_state}`} token={token} confirmed={data.email_confirmed} deletionRequested={data.deletion_requested} />
      <Suspense fallback={<p role="status">Loading application controls…</p>}><CandidateWithdrawal key={token} token={token} data={data} onSaved={setData} /></Suspense>
      <section aria-labelledby="data-title" className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 id="data-title" className="font-semibold text-zinc-800 dark:text-zinc-200">
          Your data
        </h2>
        {data.deletion_requested ? (
          <p className="mt-1">You asked {data.company.name} to delete your application. They've been told.</p>
        ) : (
          <p className="mt-1">
            You can ask {data.company.name} to delete your application and resume.{" "}
            <button
              type="button"
              className={cx("rounded font-medium text-rose-700 underline dark:text-rose-300", focusRing)}
              onClick={() => void act("delete", () => biz.requestDeletion(token), "Your request was sent.")}
            >
              Ask them to delete it
            </button>
          </p>
        )}
      </section>
    </Shell>
  );
}
