import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ApplyGroup, ApplyPacketDetail, ApplyPacketSummary, ApplyPlanReport } from "@orbit/types";
import { Copy, ExternalLink, FileText, LoadGate, Pause, Play, Rocket, SlidersHorizontal, cx, focusRing, useCopy } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { practiceHref } from "../../../lib/onboarding";
import { useAsync } from "../../../lib/useAsync";
import { Sheet } from "../Sheet";
import { linkButton, textLink } from "../links";
import { JOBS_AUTO_APPLY, missionPath, outreachPath } from "../paths";
import { applyApi } from "./applyApi";
import { ExtensionNeeded } from "./ExtensionNeeded";
import { ATS_LABEL, GROUPS, SOURCE_LABEL, STATUS_LABEL, WHY_NOT, actionsFor, answerText } from "./model";
import { PlanSummary } from "./Setup";

const ApplicationReview = lazy(() => import("./ApplicationReview"));

/** Jobs AI → Applications: what Orbit Apply prepared, sent, and needs you for, each with exactly what was sent. */
export function ApplicationsPage() {
  const setup = useAsync(() => applyApi.getApplySetup(), [], "apply-setup");
  const status = useAsync(() => applyApi.applyStatus(), [], "apply-status");
  const all = useAsync(() => applyApi.applyPackets(), [], "apply-packets");
  const reloadSetup = setup.reload, reloadStatus = status.reload, reloadPackets = all.reload;
  useEffect(() => {
    const timer = window.setInterval(() => { reloadSetup(); reloadStatus(); reloadPackets(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [reloadSetup, reloadStatus, reloadPackets]);
  const [group, setGroup] = useState<ApplyGroup>("prepared");
  const [params, setParams] = useSearchParams();
  const open = params.get("packet");
  const [busy, setBusy] = useState<"plan" | "pause" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ApplyPlanReport | null>(null);

  const reload = () => {
    status.reload();
    all.reload();
  };
  const openPacket = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("packet", id);
    else next.delete("packet");
    setParams(next, { replace: !id });
  };
  // A link to one application ("Finish in one click") shows its tab behind it.
  const packets = all.data ?? [];
  const opened = packets.find((p) => p.id === open);
  useEffect(() => {
    if (opened) setGroup(opened.group);
  }, [opened]);

  const run = async (what: "plan" | "pause", fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      const out = await fn();
      if (what === "plan") setReport(out as ApplyPlanReport);
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const s = status.data;
  const configured = setup.data?.configured ?? false;
  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, packets.filter((p) => p.group === g.id).length])) as Record<ApplyGroup, number>;
  const shown = packets.filter((p) => p.group === group);
  const loading = (setup.loading && !setup.data) || (all.loading && !all.data);

  return (
    <>
      <PageHeader
        icon={Rocket}
        title="Application review"
        subtitle="What Orbit Apply prepared and sent with your approved answers, using hosted applying or your connected browser."
        actions={
          <Link to={JOBS_AUTO_APPLY} className={linkButton("secondary", "md")}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Setup
          </Link>
        }
      />
      <LoadGate loading={loading} variant="card" count={2} label="Getting your applications">
        {setup.error && !setup.data ? (
          <ErrorNote onRetry={setup.reload}>{errorText(setup.error)}</ErrorNote>
        ) : !configured && packets.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="Orbit Apply isn't set up yet"
            body="Approve your resume, confirm your facts and answers, choose your filters and limits, and give your consent. Then Orbit prepares applications for jobs that fit."
            action={
              <Link to={JOBS_AUTO_APPLY} className={linkButton("primary", "md")}>
                Set up Orbit Apply
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {configured && <ExtensionNeeded seenAt={s?.executor_seen_at ?? setup.data?.executor_seen_at} setup={setup.data} />}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Today</dt>
                    <dd className="font-semibold tabular-nums">{s ? `${s.today} of ${s.limit}` : "…"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Needs you</dt>
                    <dd className="font-semibold tabular-nums">{s?.needs_you ?? "…"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Applications left</dt>
                    <dd className="font-semibold tabular-nums">{s?.quota_left ?? "…"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Next</dt>
                    <dd className="font-semibold">
                      {!s ? "…" : s.why_not ? WHY_NOT[s.why_not] : s.next_due_at ? new Date(s.next_due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : setup.data?.execution === "hosted" ? "When the hosted worker is ready" : "When your browser asks"}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {s?.paused ? (
                    <Button variant="secondary" loading={busy === "pause"} onClick={() => void run("pause", applyApi.resumeApply)}>
                      <Play className="h-4 w-4" aria-hidden /> Resume
                    </Button>
                  ) : (
                    <Button variant="secondary" loading={busy === "pause"} onClick={() => void run("pause", applyApi.pauseApply)} disabled={!configured}>
                      <Pause className="h-4 w-4" aria-hidden /> Pause
                    </Button>
                  )}
                  <Button loading={busy === "plan"} loadingText="Finding jobs…" onClick={() => void run("plan", applyApi.planApplications)} disabled={!configured}>
                    Find jobs now
                  </Button>
                </div>
              </div>
              {s && s.sites_paused.length > 0 && (
                <p className="border-t border-zinc-200 px-4 py-2 text-sm text-amber-800 dark:border-white/10 dark:text-amber-300">
                  Paused on {s.sites_paused.map((x) => ATS_LABEL[x] ?? x).join(", ")} for now: too many blocks there recently. Those wait.
                </p>
              )}
            </Card>
            <div aria-live="polite" className="space-y-2">
              {error && <ErrorNote>{error}</ErrorNote>}
              {report && <PlanSummary report={report} />}
            </div>

            <div role="group" aria-label="Show applications" className="flex flex-wrap gap-2">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={group === g.id}
                  onClick={() => setGroup(g.id)}
                  className={cx(
                    "rounded-full border px-3 py-1 text-sm",
                    focusRing,
                    group === g.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-200 text-zinc-700 dark:border-white/10 dark:text-zinc-200",
                  )}
                >
                  {g.label} <span className="tabular-nums">({counts[g.id]})</span>
                </button>
              ))}
            </div>
            {all.error && !all.data ? (
              <ErrorNote onRetry={all.reload}>{errorText(all.error)}</ErrorNote>
            ) : shown.length === 0 ? (
              <EmptyState kind="no-results" title={GROUPS.find((g) => g.id === group)?.empty ?? "Nothing here."} />
            ) : (
              <ul className="space-y-2">
                {shown.map((p) => (
                  <li key={p.id}>
                    <PacketRow packet={p} onOpen={() => openPacket(p.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </LoadGate>
      <Sheet open={Boolean(open)} title={opened ? `${opened.title} at ${opened.company}` : "Application"} onClose={() => openPacket(null)} wide>
        {open && <PacketDetail id={open} onChanged={reload} />}
      </Sheet>
    </>
  );
}

function PacketRow({ packet: p, onOpen }: { packet: ApplyPacketSummary; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cx("w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left hover:border-zinc-300 dark:border-white/10 dark:bg-zinc-900", focusRing)}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {p.title} <span className="font-normal text-zinc-600 dark:text-zinc-400">at {p.company}</span>
        </span>
        <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{p.match_score}% match</span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-white/10">{STATUS_LABEL[p.status] ?? p.status}</span>
        <span className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-white/10">{p.site ?? ATS_LABEL[p.ats] ?? p.ats}</span>
        {p.missing > 0 && <span className="text-amber-800 dark:text-amber-300">{p.missing} question{p.missing === 1 ? "" : "s"} for you</span>}
      </span>
      {p.reason && <span className="mt-1 block text-sm text-zinc-700 dark:text-zinc-300">{p.reason}</span>}
      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{p.match_reason}</span>
    </button>
  );
}

function useBlobUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let made: string | null = null;
    let alive = true;
    applyApi
      .applyFile(path)
      .then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url;
}

function PacketDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [showReview, setShowReview] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const detail = useAsync(() => applyApi.applyPacket(id), [id], `apply-packet|${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = detail.data;
  const confirmationKey = `${id}:${p?.updated_at}`;
  const confirmNotSubmitted = confirmedFor === confirmationKey;
  const shot = useBlobUrl(p?.screenshot_url ?? null);

  const act = async (what: string, fn: () => Promise<ApplyPacketDetail>) => {
    setBusy(what);
    setError(null);
    try {
      const next = await fn();
      detail.setData(() => next);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const openPdf = async () => {
    if (!p) return;
    try {
      const blob = await applyApi.applyFile(p.resume_pdf_url);
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (detail.error && !p) return <ErrorNote onRetry={detail.reload}>{errorText(detail.error)}</ErrorNote>;
  if (!p) return <p className="text-sm">Loading…</p>;
  const can = actionsFor(p.status);
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-sm">
        <p>
          <span className="font-medium">{STATUS_LABEL[p.status] ?? p.status}</span>
          {p.reason ? `: ${p.reason}` : ""}
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">{p.match_reason}</p>
        <p>
          <a href={p.url} target="_blank" rel="noreferrer" className={textLink}>
            The job post <ExternalLink className="inline h-3.5 w-3.5" aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {p.tracker_id && (
            <>
              {" · "}
              <Link to={missionPath(p.tracker_id)} className={textLink}>
                Open this job workspace
              </Link>
            </>
          )}
        </p>
      </div>

      <nav aria-label="Tools for this application" className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
        <p className="break-words text-xs text-zinc-600 dark:text-zinc-400">For {p.title} at {p.company}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {p.tracker_id && <Link to={`${missionPath(p.tracker_id)}?tab=plan`} className={cx(textLink, focusRing)}>Prepare for this role</Link>}
          <Link to={`${outreachPath({ job: p.listing_id })}&network=1`} className={cx(textLink, focusRing)}>Find people at this company</Link>
          <Link to={outreachPath({ job: p.listing_id })} className={cx(textLink, focusRing)}>Write a message for this job</Link>
        </div>
      </nav>

      <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>

      <details className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
        <summary className={cx("cursor-pointer rounded font-semibold", focusRing)}>Job posting captured with this application</summary>
        <p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{p.posting_text ?? "No posting archive was captured for this older application. Open the employer’s current post to check its requirements."}</p>
      </details>

      {showReview ? <Suspense fallback={<p className="text-sm">Opening application reviewer…</p>}><ApplicationReview key={p.id} id={p.id} revision={p.updated_at} /></Suspense>
        : <Button variant="secondary" onClick={() => setShowReview(true)}>Open AI second reader</Button>}

      {p.missing_questions.length > 0 && <MissingForm packet={p} busy={busy === "answers"} onSubmit={(answers) => void act("answers", () => applyApi.answerApplyPacket(p.id, answers))} />}

      {p.submission_uncertain && <label className="flex items-start gap-2 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
        <input type="checkbox" checked={confirmNotSubmitted} onChange={(e) => setConfirmedFor(e.target.checked ? confirmationKey : null)} className={cx("mt-1", focusRing)} />
        <span>Orbit started submission but could not confirm the outcome. I checked the employer site and my email and confirm this application was not submitted. Only then should Orbit try again.</span>
      </label>}

      <div className="flex flex-wrap gap-2">
        {can.finish && (
          <a href={p.apply_url} target="_blank" rel="noreferrer" className={linkButton("primary", "md")}>
            Finish in one click <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only"> (opens the job in a new tab)</span>
          </a>
        )}
        {can.finish && (
          <Button variant="secondary" loading={busy === "done"} onClick={() => void act("done", () => applyApi.doneApplyPacket(p.id))}>
            I applied
          </Button>
        )}
        {can.approve && (
          <Button loading={busy === "approve"} onClick={() => void act("approve", () => applyApi.approveApplyPacket(p.id))}>
            Approve and send
          </Button>
        )}
        {can.retry && (
          <Button variant="secondary" loading={busy === "retry"} disabled={p.missing_questions.length > 0 || (!!p.submission_uncertain && !confirmNotSubmitted)} disabledReason="Answer its questions and confirm any uncertain submission first." onClick={() => void act("retry", () => applyApi.retryApplyPacket(p.id, confirmNotSubmitted))}>
            Try again
          </Button>
        )}
        {can.dontApply && (
          <Button variant="ghost" loading={busy === "dont"} onClick={() => void act("dont", () => applyApi.dontApplyPacket(p.id))}>
            Don't apply
          </Button>
        )}
        <Button variant="ghost" onClick={() => void openPdf()}>
          <FileText className="h-4 w-4" aria-hidden /> The resume sent (PDF)
        </Button>
        <Link to={practiceHref({ role: p.title, company: p.company })} className={linkButton("secondary", "md")}>Prepare for this interview with Saba</Link>
      </div>

      {(p.confirmation_text || p.final_url || shot) && (
        <section className="space-y-2">
          <h3 className="font-semibold">{p.group === "applied" ? "Proof" : "Where it stopped"}</h3>
          {p.employer_status_path?.startsWith("/application/") && <p><Link to={p.employer_status_path} className={textLink}>Manage employer application</Link><span className="mt-1 block text-xs text-zinc-500">Read employer updates, interviews and offers, or withdraw this application.</span></p>}
          {p.confirmation_text && (
            <blockquote className="rounded-xl bg-emerald-500/10 p-3 text-sm" data-testid="confirmation-text">
              {p.group === "applied" && <span className="block text-xs font-medium text-emerald-800 dark:text-emerald-300">The site's confirmation</span>}
              {p.confirmation_text}
            </blockquote>
          )}
          {p.final_url && (
            <p className="break-all text-xs text-zinc-600 dark:text-zinc-400">
              {p.group === "applied" ? "Confirmation page" : "Last page"}:{" "}
              {p.final_url.toLowerCase().startsWith("https://") ? (
                <a href={p.final_url} target="_blank" rel="noopener noreferrer" className={textLink} data-testid="final-url">
                  {p.final_url}
                </a>
              ) : (
                p.final_url
              )}
            </p>
          )}
          {!p.screenshot_url && p.group === "applied" && p.ats !== "orbit" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">No picture of the page: the browser extension keeps the site's own confirmation and its address as the proof.</p>
          )}
          {shot && <img src={shot} alt={`The page after applying to ${p.company}`} className="max-h-96 rounded-xl border border-zinc-200 dark:border-white/10" />}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">What we {p.group === "applied" ? "sent" : "will send"}</h3>
        <AnswerTable packet={p} copyable={can.finish} />
      </section>

      {p.cover_letter && (
        <section className="space-y-2">
          <h3 className="font-semibold">Cover letter</h3>
          <p className="whitespace-pre-line rounded-xl bg-zinc-100 p-3 text-sm dark:bg-white/5">{p.cover_letter}</p>
          {can.finish && <CopyButton text={p.cover_letter} label="cover letter" />}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">Your resume, tailored for this job</h3>
        {p.resume_diff.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sent as you approved it, with no changes.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Only reordered and reworded: nothing was added.</p>
            <ul className="space-y-3">
              {p.resume_diff.map((c, i) => (
                <li key={i} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
                  <p className="font-medium">
                    {c.kind === "reorder" ? "Reordered" : "Reworded"}: {c.label}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Before</p>
                      <p className="whitespace-pre-line">{c.before}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">After</p>
                      <p className="whitespace-pre-line">{c.after}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, copy] = useCopy();
  return (
    <Button variant="ghost" size="sm" onClick={() => void copy(text)}>
      <Copy className="h-3.5 w-3.5" aria-hidden /> {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
      <span className="sr-only"> {label}</span>
    </Button>
  );
}

function AnswerTable({ packet: p, copyable }: { packet: ApplyPacketDetail; copyable: boolean }) {
  const fields = Object.entries(p.fields).filter(([, v]) => v);
  const sent = p.submitted?.answers as Array<{ label?: string; value?: unknown }> | undefined;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">The answers {p.group === "applied" ? "sent" : "prepared"} for this application</caption>
        <thead>
          <tr className="border-b border-zinc-200 dark:border-white/10">
            <th scope="col" className="py-2 pr-3 font-medium">Question</th>
            <th scope="col" className="py-2 pr-3 font-medium">Answer</th>
            <th scope="col" className="py-2 font-medium">From</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-100 align-top dark:border-white/5">
              <th scope="row" className="py-2 pr-3 font-normal text-zinc-600 dark:text-zinc-400">{k.replace(/_/g, " ")}</th>
              <td className="break-words py-2 pr-3">{String(v)}</td>
              <td className="py-2">{copyable ? <CopyButton text={String(v)} label={k} /> : "Your profile"}</td>
            </tr>
          ))}
          {p.answers.map((a, i) => (
            <tr key={`${a.question_id ?? "a"}-${i}`} className="border-b border-zinc-100 align-top dark:border-white/5">
              <th scope="row" className="py-2 pr-3 font-normal text-zinc-600 dark:text-zinc-400">{a.label}</th>
              <td className="whitespace-pre-line break-words py-2 pr-3">{answerText(a.value)}</td>
              <td className="py-2">
                {SOURCE_LABEL[a.source] ?? a.source}
                {copyable && <CopyButton text={answerText(a.value)} label={a.label} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sent && sent.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className={cx("cursor-pointer", focusRing)}>As your browser reported it sent ({sent.length})</summary>
          <ul className="mt-2 list-disc pl-5">
            {sent.map((a, i) => (
              <li key={i}>
                {String(a.label ?? "")}: {Array.isArray(a.value) ? a.value.join("; ") : String(a.value ?? "")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function MissingForm({
  packet: p,
  busy,
  onSubmit,
}: {
  packet: ApplyPacketDetail;
  busy: boolean;
  onSubmit: (answers: Array<{ question_id: string | null; label: string; value: string }>) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<number, string>>({});
  const filled = p.missing_questions.every((_, i) => (values[i] ?? "").trim());
  return (
    <form
      className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(p.missing_questions.map((m, i) => ({ question_id: m.question_id, label: m.label, value: (values[i] ?? "").trim() })));
      }}
    >
      <fieldset className="space-y-3">
        <legend className="font-semibold">Only you can answer {p.missing_questions.length === 1 ? "this" : "these"}</legend>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">Answer once: it's saved, so the next form asking the same is filled in for you.</p>
        {p.missing_questions.map((m, i) => {
          const fid = `${id}-${i}`;
          const hint = [m.legal ? "A legal question: only you can answer it." : "", m.why].filter(Boolean).join(" ");
          const set = (v: string) => setValues((x) => ({ ...x, [i]: v }));
          return (
            <Field key={`${m.question_id}-${i}`} label={m.label} htmlFor={fid} hint={hint} required>
              {m.options && m.options.length > 0 ? (
                <Select id={fid} value={values[i] ?? ""} onChange={(e) => set(e.target.value)} required>
                  <option value="">Choose…</option>
                  {m.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : m.kind === "boolean" || m.kind === "checkbox" ? (
                <Select id={fid} value={values[i] ?? ""} onChange={(e) => set(e.target.value)} required>
                  <option value="">Choose…</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </Select>
              ) : m.kind === "textarea" ? (
                <Textarea id={fid} rows={4} value={values[i] ?? ""} onChange={(e) => set(e.target.value)} required />
              ) : (
                <Input id={fid} value={values[i] ?? ""} onChange={(e) => set(e.target.value)} required />
              )}
            </Field>
          );
        })}
      </fieldset>
      <Button type="submit" loading={busy} disabled={!filled} disabledReason="Answer each question first.">
        Save my answers
      </Button>
    </form>
  );
}
