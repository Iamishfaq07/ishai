import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ApplyPacketSummary, ApplyPlanReport } from "@orbit/types";
import { ArrowRight, LoadGate, Pause, Play, Rocket, SlidersHorizontal, cx, focusRing } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select } from "../../../components/ui";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { Sheet } from "../Sheet";
import { linkButton } from "../links";
import { JOBS_AUTO_APPLY, JOBS_TRACKER } from "../paths";
import { applyApi } from "./applyApi";
import { ApplyEngine } from "./ApplyEngine";
import { ATS_LABEL, WHY_NOT, sendsItself } from "./model";
import { INBOX_VIEWS, inboxSort, inboxView, packetGuidance, packetView, selectPackets } from "./inbox";
import { PlanSummary } from "./Setup";

const PacketDetail = lazy(() => import("./PacketDetail"));

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
  const [params, setParams] = useSearchParams();
  const fieldId = useId();
  const view = inboxView(params.get("view"));
  const query = (params.get("q") ?? "").slice(0, 200);
  const sort = inboxSort(params.get("sort"));
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
  // The selected packet is independent of list filters, so emailed links always open their application.
  const packets = all.data ?? [];
  const opened = packets.find((p) => p.id === open);
  const filter = (key: "view" | "q" | "sort", value: string) => {
    const next = new URLSearchParams(params);
    const defaults = { view: "all", sort: "action", q: "" };
    if (value !== defaults[key]) next.set(key, value); else next.delete(key);
    setParams(next, { replace: key === "q" });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete("view"); next.delete("q"); next.delete("sort");
    setParams(next);
  };

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
  const sendYourself = configured && !sendsItself(setup.data);
  const mine = (packet: ApplyPacketSummary) => sendYourself && packet.ats !== "orbit";
  const attention = packets.filter((packet) => packetView(packet.status, mine(packet)) === "attention").length;
  const shown = selectPackets(packets, view, query, sort, sendYourself);
  const loading = (setup.loading && !setup.data) || (all.loading && !all.data);

  return (
    <>
      <PageHeader
        icon={Rocket}
        title="Needs you"
        subtitle="Applications to approve, answer or send, and the saved receipts for the ones already sent."
        actions={
          <Link to={JOBS_AUTO_APPLY} className={linkButton("secondary", "md")}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Auto-apply settings
          </Link>
        }
      />
      <LoadGate loading={loading} variant="card" count={2} label="Getting your applications">
        {setup.error && !setup.data ? (
          <ErrorNote onRetry={setup.reload}>{errorText(setup.error)}</ErrorNote>
        ) : all.error && !all.data ? (
          <ErrorNote onRetry={all.reload}>{errorText(all.error)}</ErrorNote>
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
            <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
              <summary className={cx("cursor-pointer rounded text-sm font-semibold", focusRing)}>Auto-apply controls{s?.paused ? " · Paused" : ""}</summary>
              <div className="mt-4 space-y-3">
            {configured && setup.data && <ApplyEngine setup={setup.data} />}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Today</dt>
                    <dd className="font-semibold tabular-nums">{s ? `${s.today} of ${s.limit}` : "…"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500 dark:text-zinc-400">Needs review</dt>
                    <dd className="font-semibold tabular-nums">{all.data ? attention : "…"}</dd>
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
              </div>
            </details>
            <div aria-live="polite" className="space-y-2">
              {error && <ErrorNote>{error}</ErrorNote>}
              {report && <PlanSummary report={report} />}
            </div>

            <section aria-label="Find applications" className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <Field htmlFor={`${fieldId}-search`} label="Search applications"><Input id={`${fieldId}-search`} type="search" maxLength={200} value={query}
                placeholder="Role, company, site or next step" onChange={(event) => filter("q", event.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field htmlFor={`${fieldId}-view`} label="Show applications"><Select id={`${fieldId}-view`} value={view} onChange={(event) => filter("view", event.target.value)}>
                  {INBOX_VIEWS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </Select></Field>
                <Field htmlFor={`${fieldId}-sort`} label="Sort applications"><Select id={`${fieldId}-sort`} value={sort} onChange={(event) => filter("sort", event.target.value)}>
                  <option value="action">Next action</option><option value="newest">Newest update</option><option value="oldest">Oldest update</option>
                </Select></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" aria-atomic="true" className="text-xs text-zinc-600 dark:text-zinc-400">{shown.length} of {packets.length} loaded applications shown</p>
                {(query || view !== "all" || sort !== "action") && <Button size="sm" variant="ghost" onClick={clearFilters}>Reset filters</Button>}</div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">For employer interviews and offers, <Link to={JOBS_TRACKER} className={cx("rounded underline underline-offset-4", focusRing)}>open your tracker</Link>.</p>
            </section>
            {shown.length === 0 ? (
              <EmptyState kind="no-results" title={packets.length ? "No applications match these filters" : "Your application inbox is ready"}
                body={packets.length ? "Try a different company, role or status. Your saved applications are still here." : "Prepare jobs with the application agent, then return here to review materials and outcomes."}
                action={packets.length ? <Button variant="secondary" onClick={clearFilters}>Show all applications</Button>
                  : <Link to="/jobs/journey" className={linkButton("primary")}>Open application agent</Link>} />
            ) : (
              <ul className="space-y-2">
                {shown.map((p) => (
                  <li key={p.id}>
                    <PacketRow packet={p} sendYourself={mine(p)} onOpen={() => openPacket(p.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </LoadGate>
      <Sheet open={Boolean(open)} title={opened ? `${opened.title} at ${opened.company}` : "Application"} onClose={() => openPacket(null)} wide>
        {open && <Suspense fallback={<p role="status" className="p-5 text-sm">Opening application…</p>}><PacketDetail key={open} id={open} onChanged={reload} /></Suspense>}
      </Sheet>
    </>
  );
}

function PacketRow({ packet: p, sendYourself, onOpen }: { packet: ApplyPacketSummary; sendYourself: boolean; onOpen: () => void }) {
  const guidance = packetGuidance(p, sendYourself);
  return (
    <button type="button" onClick={onOpen} className={cx("group w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-indigo-400 motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-900", focusRing)}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 max-w-full break-words font-semibold">
          {p.title} <span className="font-normal text-zinc-600 dark:text-zinc-400">at {p.company}</span>
        </span>
        <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{p.match_score}% match</span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className={cx("rounded-full px-2 py-0.5", packetView(p.status, sendYourself) === "attention" ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-zinc-100 dark:bg-white/10")}>{guidance.label}</span>
        <span className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-white/10">{p.site ?? ATS_LABEL[p.ats] ?? p.ats}</span>
        {p.missing > 0 && <span className="text-amber-800 dark:text-amber-300">{p.missing} question{p.missing === 1 ? "" : "s"} for you</span>}
      </span>
      <span className="mt-2 block text-sm text-zinc-600 dark:text-zinc-400">{guidance.detail}</span>
      <span className="mt-3 flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">Open application <ArrowRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" aria-hidden /></span>
    </button>
  );
}
