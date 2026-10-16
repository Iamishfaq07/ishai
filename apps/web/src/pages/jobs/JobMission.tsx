import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { JobMission, JobTrackerEntry, MissionFit, MissionNextStep } from "@orbit/types";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CompanyLogo,
  LoadGate,
  Skeleton,
  Sparkles,
  Trash2,
  confirmDialog,
  cx,
  focusRing,
  toast,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Input, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { OFFERS_HOME, money, offerPath } from "../offers/model";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { scoreTone } from "../resume/product";
import { useJobsAi } from "./JobsAi";
import { Journey } from "./Journey";
import { PrepPlanPanel } from "./PrepPlan";
import { linkButton, textLink } from "./links";
import { MISSION_STAGES, isSnoozed, requirementTone, snooze, stagesDone } from "./mission";
import { STATUS_LABEL, STATUS_TONE, practiceLink } from "./model";
import { JOBS_TRACKER, jobPath } from "./paths";

type Tab = "plan" | "fit" | "resume" | "practice" | "timeline" | "offer";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "plan", label: "Prep plan" },
  { id: "fit", label: "Evidence & fit" },
  { id: "resume", label: "Resume kit" },
  { id: "practice", label: "Practice" },
  { id: "timeline", label: "Timeline" },
  { id: "offer", label: "Offer" },
];

/**
 * Job Mission Room: one tracked job as a workspace. Its stages (each done only on a record), the next step with the
 * reason, what the job asks for against what the resume shows, the resume linked to it and the exact versions sent,
 * practice rounds, the journey so far and the offer. Nothing is linked by guessing: resumes and offers are picked.
 */
export function JobMissionPage() {
  const { entryId = "" } = useParams();
  const { tracker } = useJobsAi();
  const entry = tracker.data?.find((e) => e.id === entryId) ?? null;
  const mission = useAsync(() => api.jobMission(entryId), [entryId], `job-mission:${entryId}`);
  // An interview on the calendar opens on its plan; otherwise on the fit.
  const [tab, setTab] = useState<Tab>(() => (entry?.next_at && (entry.status === "interviewing" || entry.status === "applied") ? "plan" : "fit"));

  if (tracker.data && !entry) {
    return (
      <Card>
        <h1 className="font-display text-lg font-semibold">This job isn't in your tracker</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">It may have been removed, or the link is from another account.</p>
        <Link to={JOBS_TRACKER} className={cx(linkButton("secondary", "md"), "mt-4")}>
          Open your tracker
        </Link>
      </Card>
    );
  }

  const update = (m: JobMission) => mission.setData(() => m);
  const onEntry = (e: JobTrackerEntry) => tracker.setData((prev) => prev?.map((x) => (x.id === e.id ? e : x)) ?? null);
  const m = mission.data;

  return (
    <div className="space-y-6">
      <Link to={JOBS_TRACKER} className={cx("inline-flex items-center gap-1.5 rounded text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white", focusRing)}>
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tracker
      </Link>

      {entry ? <Header entry={entry} /> : <Skeleton variant="line" count={2} label="Loading the job" />}

      <LoadGate loading={mission.loading && !m} variant="card" count={2} label="Loading the mission">
        {mission.error && !m ? (
          <ErrorNote onRetry={mission.reload}>{errorText(mission.error)}</ErrorNote>
        ) : m && entry ? (
          <>
            <Stages mission={m} />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0">
                <div role="tablist" aria-label="Mission" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-zinc-500/5 p-1">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      id={`tab-${t.id}`}
                      aria-selected={tab === t.id}
                      aria-controls={`panel-${t.id}`}
                      onClick={() => setTab(t.id)}
                      className={cx(
                        "min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors",
                        tab === t.id ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                        focusRing,
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                  {tab === "plan" && <PrepPlanPanel entry={entry} />}
                  {tab === "fit" && <FitPanel fit={m.fit} entry={entry} />}
                  {tab === "resume" && <ResumePanel mission={m} entry={entry} onMission={update} />}
                  {tab === "practice" && <PracticePanel mission={m} entry={entry} />}
                  {tab === "timeline" && (
                    <Card>
                      <h2 className="font-display text-base font-semibold">Journey</h2>
                      <Journey entryId={entry.id} />
                    </Card>
                  )}
                  {tab === "offer" && <OfferPanel mission={m} entry={entry} onMission={update} />}
                </div>
              </div>
              <aside aria-label="Next step" className="order-first min-w-0 space-y-4 lg:order-none">
                <NextStepCard
                  step={m.next}
                  entry={entry}
                  onTab={setTab}
                  onEntry={(e) => {
                    onEntry(e);
                    mission.reload();
                  }}
                />
              </aside>
            </div>
          </>
        ) : null}
      </LoadGate>
    </div>
  );
}

function Header({ entry }: { entry: JobTrackerEntry }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <CompanyLogo company={entry.company} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{entry.title}</h1>
          <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
            {[entry.company, entry.location, `added ${formatDate(entry.created_at)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium ring-1", STATUS_TONE[entry.status])}>{STATUS_LABEL[entry.status]}</span>
        {entry.live && (
          <Link to={jobPath(entry.listing_id)} className={linkButton("secondary", "sm")}>
            Job page
          </Link>
        )}
        {(entry.apply_url || entry.url) && (
          <a href={entry.apply_url || entry.url} target="_blank" rel="noopener noreferrer" className={linkButton("secondary", "sm")}>
            Original post <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
    </header>
  );
}

/** Six stages, each done only on a record (named in its tooltip and for screen readers). */
function Stages({ mission }: { mission: JobMission }) {
  const done = stagesDone(mission);
  return (
    <section aria-labelledby="stages-title">
      <h2 id="stages-title" className="sr-only">
        Stages: {done} of {MISSION_STAGES.length} have a record
      </h2>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {MISSION_STAGES.map((s, i) => {
          const ok = mission.stages[s.id];
          return (
            <li
              key={s.id}
              title={ok ? s.done : `Not yet: ${s.done.toLowerCase()}`}
              className={cx(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-200 dark:border-white/10",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  ok ? "bg-emerald-500 text-white" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
                )}
              >
                {ok ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cx("font-medium", !ok && "text-zinc-600 dark:text-zinc-400")}>{s.label}</span>
              <span className="sr-only">{ok ? `: done (${s.done})` : ": not yet"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const TONE = {
  good: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-200",
  partial: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-200",
  missing: "bg-rose-500/10 text-rose-800 ring-rose-500/25 dark:text-rose-200",
} as const;

/** What the job asks for, quoted, next to what the resume shows for it, quoted: never a claim without its source. */
function FitPanel({ fit, entry }: { fit: MissionFit | null; entry: JobTrackerEntry }) {
  if (!fit) {
    return (
      <Card>
        <h2 className="font-display text-base font-semibold">Not checked yet</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          A fit check reads the job post against your resume, requirement by requirement, and quotes both.
        </p>
        {entry.live ? (
          <Link to={jobPath(entry.listing_id)} className={cx(linkButton("primary", "md"), "mt-4")}>
            <Sparkles className="h-4 w-4" aria-hidden /> Check my fit
          </Link>
        ) : (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">This job was added by hand, so there's no post on file to check against.</p>
        )}
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold">{fit.verdict} fit</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Checked {formatDate(fit.checked_at)}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{fit.summary}</p>
      {fit.requirements.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-white/10">
          {fit.requirements.map((r, i) => {
            const t = requirementTone(r.status);
            return (
              <li key={`${r.requirement}-${i}`} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{r.requirement}</p>
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1", TONE[t.tone])}>{t.label}</span>
                </div>
                {r.job_quote && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"><span className="font-medium">The job:</span> "{r.job_quote}"</p>}
                {(r.resume_quote || r.evidence_quote) ? (
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium">{r.resume_quote ? "Your resume:" : "Your evidence:"}</span> "{r.resume_quote || r.evidence_quote}"
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">Nothing on your resume shows this yet. Add it only if it's true.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        fit.gaps.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            {fit.gaps.map((g) => <li key={g}>{g}</li>)}
          </ul>
        )
      )}
    </Card>
  );
}

function ResumePanel({ mission, entry, onMission }: { mission: JobMission; entry: JobTrackerEntry; onMission: (m: JobMission) => void }) {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<JobMission>, done?: string) => {
    setBusy(true);
    try {
      onMission(await fn());
      if (done) toast({ message: done, tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const r = mission.resume;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-display text-base font-semibold">The resume for this job</h2>
        {r ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={cx("inline-flex h-8 min-w-10 items-center justify-center rounded-lg px-1.5 text-sm font-semibold tabular-nums ring-1", scoreTone(r.score))}>{r.score}</span>
            <div className="min-w-0 flex-1">
              <Link to={resumePath(r.id)} className={cx("block truncate font-medium hover:underline", focusRing)}>{r.title}</Link>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">ATS check · edited {formatDate(r.updated_at)}</p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {mission.resume_missing ? "The resume linked here was deleted. " : "Not linked. "}
            Pick the one you'll send, or make one in{" "}
            <Link to={RESUME_AI_HOME} className={textLink}>Resume AI</Link>.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{r ? "Change it" : "Link a resume"}</span>
            <Select
              value={r?.id ?? ""}
              disabled={busy || !resumes.data}
              onChange={(e) => void run(() => api.linkMissionResume(entry.id, e.target.value || null), e.target.value ? "Resume linked" : "Unlinked")}
            >
              <option value="">{resumes.data?.length ? "None" : "No resumes yet"}</option>
              {resumes.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title} ({x.score})
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-semibold">Versions you sent</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Freeze the linked resume when you apply. Edits later never change the copy, so you always know what they have.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Note (optional)</span>
            <Input value={note} maxLength={200} placeholder="Sent through the careers page" onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button
            disabled={!r || busy}
            onClick={() =>
              void run(async () => {
                const next = await api.freezeMissionResume(entry.id, note);
                setNote("");
                return next;
              }, "Version kept")
            }
          >
            Freeze this resume
          </Button>
        </div>
        {mission.snapshots.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-white/10">
            {mission.snapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={cx("inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums ring-1", scoreTone(s.score))}>{s.score}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    Sent {formatDate(s.created_at)}
                    {s.note ? ` · ${s.note}` : ""}
                    {s.resume_id ? "" : " · original deleted"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const { resume_id } = await api.copyMissionSnapshot(entry.id, s.id);
                      navigate(resumePath(resume_id));
                    } catch (err) {
                      toast({ message: errorText(err), tone: "error" });
                    }
                  }}
                >
                  Open as a copy
                </Button>
                <button
                  type="button"
                  aria-label={`Delete the version sent ${formatDate(s.created_at)}`}
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: "Delete this sent version?", body: "The resume itself stays.", confirmLabel: "Delete", danger: true }))) return;
                    void run(() => api.deleteMissionSnapshot(entry.id, s.id));
                  }}
                  className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-rose-500/10 hover:text-rose-700", focusRing)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PracticePanel({ mission, entry }: { mission: JobMission; entry: JobTrackerEntry }) {
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">Practice for {entry.company}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div>
          <dt className="text-xs text-zinc-600 dark:text-zinc-400">Practice rounds</dt>
          <dd className="font-display text-2xl font-semibold tabular-nums">{mission.practice_rounds}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-600 dark:text-zinc-400">Live rounds</dt>
          <dd className="font-display text-2xl font-semibold tabular-nums">{mission.live_rounds}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Counted from sessions you named for {entry.company} since you saved this job.</p>
      <Link to={practiceLink(entry, jobPath)} className={cx(linkButton("primary", "md"), "mt-4")}>
        Practise for this job <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}

function OfferPanel({ mission, entry, onMission }: { mission: JobMission; entry: JobTrackerEntry; onMission: (m: JobMission) => void }) {
  const [busy, setBusy] = useState(false);
  const link = async (id: string | null) => {
    setBusy(true);
    try {
      onMission(await api.linkMissionOffer(entry.id, id));
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const o = mission.offer;
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">Offer</h2>
      {o ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{o.company} · {o.role}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{money(o.currency, o.fixed)} fixed a year · {o.status}</p>
          </div>
          <div className="flex gap-2">
            <Link to={offerPath(o.id)} className={linkButton("primary", "sm")}>Open in Offer AI</Link>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void link(null)}>Unlink</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Not linked. {mission.offers.length ? "Pick the offer from this company, or add it in Offer AI." : "When an offer comes, add it in Offer AI and link it here."}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {mission.offers.length > 0 && (
              <label className="min-w-0 flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Your offers</span>
                <Select value="" disabled={busy} onChange={(e) => e.target.value && void link(e.target.value)}>
                  <option value="">Choose…</option>
                  {mission.offers.map((x) => (
                    <option key={x.id} value={x.id}>{x.company} · {x.role}</option>
                  ))}
                </Select>
              </label>
            )}
            <Link to={OFFERS_HOME} className={linkButton("secondary", "md")}>Add in Offer AI</Link>
          </div>
        </>
      )}
    </Card>
  );
}

/** The first gap, with the reason in words; "Not now" hides it for three days on this device. */
function NextStepCard({
  step,
  entry,
  onTab,
  onEntry,
}: {
  step: MissionNextStep | null;
  entry: JobTrackerEntry;
  onTab: (t: Tab) => void;
  onEntry: (e: JobTrackerEntry) => void;
}) {
  const { user } = useAuth();
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!step) {
    return (
      <Card>
        <h2 className="font-display text-base font-semibold">Nothing pressing</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Every stage that can be done now has a record. Add a date in the tracker for a follow-up.</p>
      </Card>
    );
  }
  if (user && isSnoozed(user.id, entry.id, step.key)) {
    return (
      <Card>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Next step hidden for now ({step.title.toLowerCase()}).</p>
      </Card>
    );
  }
  const act = async () => {
    if (step.to === "link_resume" || step.to === "snapshot") return onTab("resume");
    if (step.to === "link_offer") return onTab("offer");
    if (step.to === "mark_applied") {
      setBusy(true);
      try {
        onEntry(await api.updateTrackedJob(entry.id, { status: "applied" }));
        toast({ message: "Marked as applied", tone: "success" });
      } catch (err) {
        toast({ message: errorText(err), tone: "error" });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step.to === "practise") return onTab("practice");
    if (step.to === "notes") return onTab("timeline");
    return undefined;
  };
  const internal = step.to.startsWith("/");
  return (
    <section aria-labelledby="next-title" className="glass-panel gradient-border rounded-2xl p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Next step</p>
      <h2 id="next-title" className="mt-1 font-display text-lg font-semibold">{step.title}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        <span className="font-medium">Why: </span>
        {step.why}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {internal ? (
          <Link to={step.to} className={linkButton("primary", "md")}>{step.action}</Link>
        ) : (
          <Button loading={busy} onClick={() => void act()}>{step.action}</Button>
        )}
        {user && (
          <Button
            variant="ghost"
            onClick={() => {
              snooze(user.id, entry.id, step.key);
              rerender((n) => n + 1);
            }}
          >
            Not now
          </Button>
        )}
      </div>
    </section>
  );
}
