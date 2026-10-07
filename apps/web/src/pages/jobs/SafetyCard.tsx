import { useState } from "react";
import { Check, CircleAlert, Copy, ExternalLink, Mail, MessageSquare, ShieldCheck, cx, focusRing } from "@orbit/ui";
import { Card } from "../../components/ui";
import { textLink } from "./links";

/** Where a report about a job goes, when this build has a contact (VITE_SUPPORT_EMAIL, VITE_SUPPORT_WHATSAPP). */
// TODO(ws-b): use the Contact details from the new trust pages (X3) once they're in, and drop these two.
const SUPPORT_EMAIL = String(import.meta.env.VITE_SUPPORT_EMAIL ?? "").trim();
const SUPPORT_WHATSAPP = String(import.meta.env.VITE_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");

/** India's national cyber-crime portal and helpline (I4C), for a job scam that has already cost money or details. */
export const CYBERCRIME_URL = "https://cybercrime.gov.in/";
export const CYBERCRIME_HELPLINE = "1930";

/** The warning signs, in the order they're most often seen in Indian job scams. */
export const SCAM_SIGNS = [
  "Real employers never ask for a fee: not for registration, training, a laptop or a “security deposit”.",
  "Never share an OTP, your UPI PIN or bank details to “confirm” a job.",
  "Be careful when “HR” talks only on WhatsApp or Telegram: check the company's own website and email address.",
  "An offer with no interview, or pay far above the usual, is a warning sign.",
];

export const REPORT_REASONS = [
  "Asked me to pay a fee",
  "Asked for an OTP or bank details",
  "WhatsApp or Telegram only",
  "Fake or copied company",
  "Job is closed or wrong",
] as const;

export interface ReportedJob {
  /** Orbit's id for it (a listing id, or a tracker entry's), so a report can be matched. */
  id: string;
  title: string;
  company: string;
  url: string;
}

/** The report as plain text: what's copied, emailed or sent on WhatsApp. */
export function reportText(job: ReportedJob, reason: string): string {
  return [`Report a job on Orbit: ${reason}`, `${job.title} at ${job.company}`, `Orbit id: ${job.id}`, job.url && `Link: ${job.url}`]
    .filter(Boolean)
    .join("\n");
}

/**
 * Staying safe with jobs: the signs of a job scam, and "Report this job" (to Orbit when this build has a contact, and
 * always the national cyber-crime portal). Nothing is stored: a report is an email, a WhatsApp message or copied text.
 * `compact` is the one-line version for the tracker.
 */
export function SafetyCard({ job, compact = false, className }: { job?: ReportedJob; compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <details className={cx("group rounded-2xl border border-zinc-200 bg-white/60 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]", className)}>
        <summary className={cx("flex cursor-pointer list-none items-center gap-2 font-medium", focusRing)}>
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="min-w-0 flex-1">Real employers never ask you to pay. How to spot a job scam</span>
          <span aria-hidden className="text-xs text-zinc-500 group-open:hidden">Show</span>
        </summary>
        <SafetyList className="mt-3" />
        <ScamHelp className="mt-3" />
      </details>
    );
  }
  return (
    <Card className={className}>
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Stay safe
      </h2>
      <SafetyList className="mt-3" />
      {job && <ReportJob job={job} className="mt-4 border-t border-zinc-200 pt-3 dark:border-white/10" />}
      <ScamHelp className="mt-3" />
    </Card>
  );
}

function SafetyList({ className }: { className?: string }) {
  return (
    <ul className={cx("space-y-2 text-sm text-zinc-700 dark:text-zinc-300", className)}>
      {SCAM_SIGNS.map((s) => (
        <li key={s} className="flex gap-2">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function ScamHelp({ className }: { className?: string }) {
  return (
    <p className={cx("text-xs text-zinc-600 dark:text-zinc-400", className)}>
      Paid money or shared details already? Report it at{" "}
      <a href={CYBERCRIME_URL} target="_blank" rel="noopener noreferrer" className={textLink}>
        cybercrime.gov.in
      </a>{" "}
      or call{" "}
      <a href={`tel:${CYBERCRIME_HELPLINE}`} className={textLink}>
        {CYBERCRIME_HELPLINE}
      </a>
      , the national cyber-crime helpline.
    </p>
  );
}

/** "Report this job": pick what's wrong, then email or WhatsApp it to Orbit (when configured) or copy it. */
function ReportJob({ job, className }: { job: ReportedJob; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [copied, setCopied] = useState(false);
  const text = reportText(job, reason);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      // TODO(ws-a): a toast ("Copied") instead of the button's own label.
    } catch {
      setCopied(false);
    }
  };
  const action = cx(
    "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-200 dark:hover:border-white/20",
    focusRing,
  );
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx("inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-rose-700 hover:underline dark:text-rose-300", focusRing)}
      >
        <CircleAlert className="h-4 w-4" aria-hidden /> Report this job
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <fieldset>
            <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">What's wrong?</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  className={cx(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500",
                    reason === r ? "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200" : "border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300",
                  )}
                >
                  <input type="radio" name={`report-${job.id}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Report a job: ${job.company}`)}&body=${encodeURIComponent(text)}`} className={action}>
                <Mail className="h-3.5 w-3.5" aria-hidden /> Email Orbit
              </a>
            )}
            {SUPPORT_WHATSAPP && (
              <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={action}>
                <MessageSquare className="h-3.5 w-3.5" aria-hidden /> WhatsApp Orbit
              </a>
            )}
            <button type="button" onClick={() => void copy()} className={action}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy the details"}
            </button>
            <a href={CYBERCRIME_URL} target="_blank" rel="noopener noreferrer" className={action}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Report at cybercrime.gov.in
            </a>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400" role="status">
            {SUPPORT_EMAIL || SUPPORT_WHATSAPP
              ? "Reports go to the Orbit team. Nothing is sent until you press send."
              : "Copy the details to report it to the site it came from, or to the police if it's a scam."}
          </p>
        </div>
      )}
    </div>
  );
}
