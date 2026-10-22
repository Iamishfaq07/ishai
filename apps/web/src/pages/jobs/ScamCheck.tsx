import { useId, useMemo, useState } from "react";
import { CircleAlert, ShieldCheck, cx } from "@orbit/ui";
import { Textarea } from "../../components/ui";
import { checkPosting } from "./scamCheck";

/**
 * Scam & safety check (scamCheck.ts): the job post, plus any recruiter message pasted here, read for scam
 * warning signs and for signs of a real role. In the browser only. Signals with their quoted words, never a verdict.
 */
export function ScamCheck({ posting = "", className }: { posting?: string; className?: string }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const report = useMemo(() => checkPosting(`${posting}\n${message}`), [posting, message]);
  const high = report.signals.filter((s) => s.level === "high").length;
  const tone = high ? "border-rose-300/70 bg-rose-50 dark:border-rose-400/20 dark:bg-rose-500/5"
    : report.signals.length ? "border-amber-300/70 bg-amber-50 dark:border-amber-400/20 dark:bg-amber-500/5"
    : "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-400/20 dark:bg-emerald-500/5";
  return <section aria-labelledby={`${id}-h`} className={cx("rounded-xl border p-4 sm:p-5", tone, className)}>
    <div className="flex items-start gap-3">
      {report.signals.length ? <CircleAlert className={cx("mt-0.5 h-5 w-5 shrink-0", high ? "text-rose-600" : "text-amber-600")} aria-hidden />
        : <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />}
      <div className="min-w-0 flex-1">
        <h3 id={`${id}-h`} className="font-semibold">Scam &amp; safety check</h3>
        <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300" aria-live="polite">
          {report.checked < 40 ? "Paste a recruiter's message below to check it too."
            : report.signals.length ? `${report.signals.length} warning sign${report.signals.length === 1 ? "" : "s"} found${high ? ", including serious ones" : ""}. Check before you share anything or pay anything.`
            : "No common scam warning signs found. Still check the company's own website before sharing documents."}
        </p>
      </div>
    </div>
    {report.signals.length > 0 && <ul className="mt-4 space-y-2">{report.signals.map((s) => <li key={s.id} className="rounded-lg bg-white/80 p-3 text-sm ring-1 ring-zinc-200 dark:bg-zinc-950/60 dark:ring-white/10">
      <p className="flex flex-wrap items-center gap-2 font-medium"><span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", s.level === "high" ? "bg-rose-600 text-white" : "bg-amber-500 text-white")}>{s.level === "high" ? "Serious" : "Caution"}</span>{s.label}</p>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{s.why}</p>
      <blockquote className="mt-2 break-words border-l-2 border-zinc-300 pl-3 text-xs italic text-zinc-600 dark:border-white/20 dark:text-zinc-400">{s.quote}</blockquote>
    </li>)}</ul>}
    {report.good.length > 0 && <div className="mt-4"><p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">Good signs</p>
      <ul className="mt-2 flex flex-wrap gap-2">{report.good.map((g) => <li key={g.id} title={g.quote} className="rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">{g.label}</li>)}</ul></div>}
    <details className="mt-4" open={!posting.trim() || undefined}><summary className="cursor-pointer text-sm font-medium">Check a recruiter's message</summary>
      <label htmlFor={`${id}-msg`} className="sr-only">Recruiter message</label>
      <Textarea id={`${id}-msg`} rows={4} maxLength={10000} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-2"
        placeholder="Paste the WhatsApp, email or LinkedIn message. It's checked here in your browser and never sent anywhere." />
    </details>
    <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">Signals, not a verdict. In India, report job fraud at cybercrime.gov.in or call 1930.</p>
  </section>;
}
