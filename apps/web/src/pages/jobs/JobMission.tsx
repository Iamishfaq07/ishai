import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { JobMission, JobTrackerEntry, MissionFit, MissionNextStep } from "@orbit/types";
import {
  Spot,
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
import { BackLink } from "../../components/BackLink";
import { KashSecContext } from "../../components/KashSec";
import { Button, Card, ErrorNote, IconButton, Input, Select } from "../../components/ui";
import { isSecurityRole } from "../../lib/security";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { OFFERS_HOME, money, offerPath } from "../offers/model";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { scoreTone } from "../resume/product";
import { useJobsAi } from "./JobsAi";
import { CompanyPanel } from "./CompanyPanel";
import { Journey } from "./Journey";
import { PrepPlanPanel } from "./PrepPlan";
import { linkButton, textLink } from "./links";
import { MISSION_TOOLS, MISSION_STAGES, isSnoozed, requirementTone, snooze, stagesDone, type MissionTool } from "./mission";
import { StagePill } from "./StagePill";
import { RoomNavigation } from "./RoomNavigation";
import { useCandidateDraft } from "../../lib/useCandidateDraft";
import { SnapshotSource } from "./SnapshotSource";
import { JOBS_TRACKER, jobPath, missionPath } from "./paths";
import { JobSabaPractice, InterviewPrepPanel } from "./interview/InterviewPrep";

import { opportunityStart } from "./opportunity";
import { careerToolHref } from "../../lib/opportunityTrail";
import { Commitments } from "./Commitments";
import { FirstLook } from "./FirstLook";
import { PitchBuilder } from "./Pitch";
import { FirstNinety } from "./FirstNinety";
import { ReferenceBrief } from "./ReferenceBrief";
import { WithdrawNote } from "./WithdrawNote";
const Guided = lazy(() => import("./GuidedOpportunity").then((m) => ({ default: m.GuidedOpportunity })));
const VersionReview = lazy(() => import("./ResumeVersionReview").then((m) => ({ default: m.ResumeVersionReview })));
const SourceReview = lazy(() => import("./JobSourceReview").then((m) => ({ default: m.JobSourceReview })));
const RequirementWorkshop = lazy(() => import("./RequirementWorkshop").then((m) => ({ default: m.RequirementWorkshop })));
type Tab = MissionTool;

/**
 * Job Mission Room: one tracked job as a workspace. Its stages (each done only on a record), the next step with the
 * reason, what the job asks for against what the resume shows, the resume linked to it and saved source observations,
 * practice rounds, the journey so far and the offer. Nothing is linked by guessing: resumes and offers are picked.
 */
export function JobMissionPage() {
  const { entryId = "" } = useParams();
  const navigate = useNavigate();
  const roomVisit = useRef({ id: entryId, active: true });
  if (roomVisit.current.id !== entryId) roomVisit.current = { id: entryId, active: true };
  const visit = roomVisit.current;
  useEffect(() => { visit.active = true; return () => { visit.active = false; }; }, [visit]);
  const { tracker } = useJobsAi();
  const entry = tracker.data?.find((e) => e.id === entryId) ?? null;
  const mission = useAsync(() => api.jobMission(entryId), [entryId], `job-mission:${entryId}`);
  // `?tab=` opens one (the tracker's "Prepare for interview" opens Interview); else an interview on the calendar
  // opens on its plan, and otherwise the fit.
  const [params, setParams] = useSearchParams();
  const asked = MISSION_TOOLS.find((tool) => tool.id === params.get("tab"))?.id;
  // Legacy guide=0/1 remains bookmark-compatible; both resolve to the same owned room.
  const tab: Tab = asked ?? opportunityStart(entry?.status ?? "saved", mission.data);
  const selected = MISSION_TOOLS.find((tool) => tool.id === tab)!;
  const setTab = (value: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next);
  };

  useEffect(() => {
    if (asked || !mission.data || !entry) return;
    const next = new URLSearchParams(params); next.set("tab", tab); next.set("guide", "1");
    setParams(next, { replace: true });
  }, [asked, mission.data, entry, params, setParams, tab]);
  const reloadMission = mission.reload;
  const reloadTracker = tracker.reload;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") { reloadMission(); reloadTracker(); } };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [entryId, reloadMission, reloadTracker]);
  const openWorkshop = () => {
    const next = new URLSearchParams(params); next.set("tab", "fit"); next.set("workshop", "1"); setParams(next);
    requestAnimationFrame(() => { const heading = document.getElementById("requirement-practice-heading"); heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" }); });
  };

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

  const update = (m: JobMission) => {
    if (visit.active && roomVisit.current === visit && m.entry_id === visit.id) mission.setData(() => m);
  };
  const onEntry = (e: JobTrackerEntry) => tracker.setData((prev) => prev?.map((x) => (x.id === e.id ? e : x)) ?? null);
  const m = mission.data;

  return (
    <div className="workspace-page">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <BackLink to={JOBS_TRACKER}>Applications</BackLink>
        {entry && (tracker.data?.length ?? 0) > 1 && <label className="block min-w-0 w-full text-xs text-zinc-600 sm:w-auto sm:max-w-sm dark:text-zinc-400">Switch opportunity<Select aria-label="Switch opportunity" className="mt-1 w-full" value={entry.id} onChange={(event) => {
          const id = event.target.value;
          if (id !== entry.id && tracker.data?.some((job) => job.id === id)) navigate(`${missionPath(id)}?tab=${tab}`);
        }}>{tracker.data?.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.company}</option>)}</Select></label>}
      </div>

      {/* The heading's placeholder only while something is still loading: next to an error it read as stuck. */}
      {entry ? <Header entry={entry} /> : !tracker.error && !mission.error && <Skeleton variant="line" count={2} label="Loading the job" />}
      {tracker.error && !tracker.data && <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>}

      <LoadGate loading={mission.loading && !m} variant="card" count={2} label="Loading the mission">
        {mission.error && !m ? (
          <ErrorNote onRetry={mission.reload}>{errorText(mission.error)}</ErrorNote>
        ) : m && entry && m.entry_id === entry.id ? (
          <>
            <Stages mission={m} />
            <RoomNavigation tab={tab} onSelect={setTab} />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <aside aria-label="Next step" className="min-w-0 space-y-4 lg:order-last">
                <NextStepCard key={entry.id}
                  step={m.next}
                  entry={entry}
                  onTab={setTab}
                  onEntry={(e) => {
                    onEntry(e);
                    mission.reload();
                  }}
                />
                <section className="workspace-panel p-4 text-sm" aria-label="Opportunity briefing"><h2 className="font-semibold">This opportunity</h2><dl className="mt-4 space-y-4"><div><dt className="workspace-eyebrow">Linked editable resume</dt><dd className="mt-1 break-words">{m.resume?.title ?? "No resume linked"}</dd></div><div><dt className="workspace-eyebrow">Saved resume copies</dt><dd className="mt-1">{m.snapshots.length} · not delivery receipts</dd></div>{entry.next_at && <div><dt className="workspace-eyebrow">Recorded next date</dt><dd className="mt-1">{new Date(entry.next_at).toLocaleString()}</dd></div>}</dl><div className="mt-4 flex flex-col items-start gap-2"><Button variant="secondary" onClick={() => setTab("resume")}>Review materials</Button><Button variant="ghost" onClick={() => setTab("practice")}>Practice with Saba</Button><Button variant="ghost" onClick={() => setTab("timeline")}>Open application history</Button></div><p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">Job-specific copies stay separate from your master. Practice is separate from employer interview rounds.</p></section>
                {isSecurityRole(entry.title) && <KashSecContext placement="mission" />}
              </aside>
              <div className="min-w-0 space-y-4">
                <Suspense fallback={<p role="status">Opening opportunity context…</p>}><Guided key={entry.id} entry={entry} mission={m} tab={tab} onSaved={() => { tracker.reload(); mission.reload(); }} /></Suspense>

                <section id="mission-tool-panel" aria-label={selected.label}>
                  {(tab === "fit" || tab === "timeline") && <Suspense fallback={<p role="status">Opening job source review…</p>}><SourceReview key={entry.id} entryId={entry.id} /></Suspense>}
                  {tab === "interview" && <Commitments key={`commitments:${entry.id}`} entryId={entry.id} />}
                  {tab === "interview" && (
                    <InterviewPrepPanel key={entry.id}
                      entry={entry}
                      onEntry={() => {
                        tracker.reload();
                        mission.reload();
                      }}
                    />
                  )}
                  {tab === "interview" && (entry.status === "interviewing" || entry.status === "offer") && <ReferenceBrief key={`references:${entry.id}`} entryId={entry.id} company={entry.company} />}
                  {tab === "plan" && <PrepPlanPanel key={entry.id} entry={entry} onOpenInterview={() => setTab("interview")} />}
                  {tab === "fit" && <><FitPanel fit={m.fit} entry={entry} onPractice={openWorkshop} /><Suspense fallback={<p role="status">Opening requirement practice…</p>}><RequirementWorkshop key={entry.id} entryId={entry.id} onRehearse={() => setTab("practice")} /></Suspense></>}
                  {tab === "resume" && <ResumePanel key={entry.id} mission={m} entry={entry} onMission={update} />}
                  {tab === "resume" && <FirstLook key={`first-look:${entry.id}`} entryId={entry.id} resumeId={m.resume?.id} />}
                  {tab === "company" && <CompanyPanel key={entry.id} entry={entry} />}
                  {tab === "practice" && <PitchBuilder key={`pitch:${entry.id}`} entryId={entry.id} />}
                  {tab === "practice" && <PracticePanel key={entry.id} mission={m} entry={entry} onLinked={mission.reload} />}
                  {tab === "timeline" && (
                    <Card>
                      <h2 className="font-display text-base font-semibold">Journey</h2>
                      <Journey key={entry.id} entryId={entry.id} />
                    </Card>
                  )}
                  {tab === "timeline" && <WithdrawNote key={`withdraw:${entry.id}`} entry={entry} open={params.get("withdraw") === "1"} onDone={() => { tracker.reload(); mission.reload(); }} />}
                  {tab === "offer" && <OfferPanel key={entry.id} mission={m} entry={entry} onMission={update} />}
                  {tab === "offer" && (entry.status === "offer" || entry.status === "hired") && <FirstNinety key={`first-90:${entry.id}`} entryId={entry.id} role={`${entry.title} at ${entry.company}`} />}
                </section>
              </div>

            </div>
          </>
        ) : null}
      </LoadGate>
    </div>
  );
}

function Header({ entry }: { entry: JobTrackerEntry }) {
  return (
    <header className="workspace-heading">
      <div className="flex min-w-0 items-center gap-3">
        <CompanyLogo company={entry.company} size="lg" />
        <div className="min-w-0">
          <h1 className="break-words font-display text-xl font-semibold tracking-tight sm:text-2xl">{entry.title}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {[entry.company, entry.location, `added ${formatDate(entry.created_at)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StagePill status={entry.status} className="px-2.5 py-1" />
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
function FitPanel({ fit, entry, onPractice }: { fit: MissionFit | null; entry: JobTrackerEntry; onPractice: () => void }) {
  if (!fit) {
    return (
      <Card>
        <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="fit" />Not checked yet</h2>
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
        <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="fit" />{fit.verdict} fit</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Checked {formatDate(fit.checked_at)}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{fit.summary}</p>
      <p className="mt-3 rounded-xl bg-zinc-500/5 p-3 text-xs text-zinc-600 dark:text-zinc-400">This is a prior check. Its quotes may come from a different resume or evidence version. Relinking or editing a resume does not rerun it. Review your current resume and the original job before using these results.</p>
      {fit.requirements.length > 0 && <Button variant="secondary" className="mt-3" onClick={onPractice}>Turn one requirement into a practice plan</Button>}
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
                    <span className="font-medium">{r.resume_quote ? "Resume quoted in this check:" : "Evidence quoted in this check:"}</span> "{r.resume_quote || r.evidence_quote}"
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">No supporting quote was recorded in this check. Add details only if they are true.</p>
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
  const [note, setNote] = useCandidateDraft("resume-version-note", entry.id);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const versionsHeading = useRef<HTMLHeadingElement>(null);
  const selectedSnapshot = mission.snapshots.find((item) => item.id === params.get("snapshot"));
  const closeComparison = () => {
    const next = new URLSearchParams(params); next.delete("snapshot"); setParams(next);
    requestAnimationFrame(() => { versionsHeading.current?.focus({ preventScroll: true }); versionsHeading.current?.scrollIntoView({ block: "start" }); });
  };
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
        <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="resume" />The resume for this job</h2>
        {r ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={cx("inline-flex h-8 min-w-10 items-center justify-center rounded-lg px-1.5 text-sm font-semibold tabular-nums ring-1", scoreTone(r.score))}>{r.score}</span>
            <div className="min-w-0 flex-1">
              <Link to={`${resumePath(r.id)}?guide=1&job=${encodeURIComponent(entry.id)}`} className={cx("block truncate font-medium hover:underline", focusRing)}>{r.title}</Link>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">ATS check · edited {formatDate(r.updated_at)}</p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {mission.resume_missing ? "The resume linked here was deleted. " : "Not linked. "}
            Pick the one you'll send, or make one in{" "}
            <Link to={RESUME_AI_HOME} className={textLink}>Resume</Link>.
          </p>
        )}
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">Selecting your master or a resume used by another job creates an independent copy for this opportunity. Your master and other jobs stay unchanged.</p>
        {r && mission.resume_requires_copy && <Button className="mt-3" loading={busy} onClick={() => void run(() => api.linkMissionResume(entry.id, r.id), "Independent job copy created")}>Create an independent job copy</Button>}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{r ? "Change linked resume" : "Link a resume"}</span>
            <Select
              aria-label={r ? "Change linked resume" : "Link a resume"}
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
        <h2 ref={versionsHeading} tabIndex={-1} className="scroll-mt-28 rounded font-display text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Saved resume versions</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Keep the linked resume as a separate saved copy before sharing it. Later edits do not change that copy. Saving is not proof that an application was sent or received. A new saved copy becomes the default interview-preparation version; you can change the choice in Interview.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Version note (optional)</span>
            <Input disabled={busy} value={note} maxLength={200} placeholder="Why I saved this version" onChange={(e) => setNote(e.target.value)} />
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Temporary draft · save this version to keep the note.</p>
          </label>
          <Button
            disabled={!r || busy}
            onClick={() =>
              void run(async () => {
                const next = await api.freezeMissionResume(entry.id, note, r ? { resume_id: r.id, updated_at: r.updated_at } : undefined);
                if (active.current) setNote("");
                return next;
              }, "Version kept")
            }
          >
            Save this resume version
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
                    Saved {formatDate(s.created_at)}
                    {s.note ? ` · ${s.note}` : ""}
                    {s.origin?.kind === "resume" && !s.resume_id ? " · source resume deleted; saved content retained" : ""}
                  </p>
                  <SnapshotSource origin={s.origin} />
                </div>
                <Button size="sm" variant="secondary" aria-pressed={selectedSnapshot?.id === s.id} disabled={busy} onClick={() => { const next = new URLSearchParams(params); next.set("snapshot", s.id); setParams(next); }}>Compare with linked resume</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const { resume_id } = await api.copyMissionSnapshot(entry.id, s.id);
                      navigate(`${resumePath(resume_id)}?guide=1&job=${encodeURIComponent(entry.id)}`);
                    } catch (err) {
                      toast({ message: errorText(err), tone: "error" });
                    }
                  }}
                >
                  Open as a copy
                </Button>
                <IconButton
                  icon={Trash2}
                  label={`Delete the version saved ${formatDate(s.created_at)}`}
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: "Delete this saved version?", body: "This saved content and its source history will be removed. The editable resume and application packet stay. This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
                    void run(() => api.deleteMissionSnapshot(entry.id, s.id));
                  }}
                  className="text-zinc-500 hover:!bg-rose-500/10 hover:!text-rose-700 dark:hover:!text-rose-300"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {selectedSnapshot && <Suspense fallback={<p role="status">Opening saved-version comparison…</p>}><VersionReview key={`${entry.id}:${selectedSnapshot.id}:${r?.id}:${r?.updated_at}`} entryId={entry.id} snapshotId={selectedSnapshot.id} onClose={closeComparison} /></Suspense>}
    </div>
  );
}

function PracticePanel({ mission, entry, onLinked }: { mission: JobMission; entry: JobTrackerEntry; onLinked: () => void }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [params] = useSearchParams();
  const context = new URLSearchParams(params); context.set("job", entry.id); context.set("career_from", "practice");
  return (
    <div className="min-w-0 space-y-4">
      <JobSabaPractice entryId={entry.id} onChanged={onLinked} />
      <section aria-label="Build your answers" className="workspace-panel p-5"><h2 className="text-base font-semibold">Strengthen an answer before you rehearse</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Use your own examples or study a missing topic. Learning does not automatically become a career claim.</p><div className="mt-3 flex flex-wrap gap-x-5"><Link className={textLink} to={careerToolHref("/documents/stories", context)}>Review my real examples</Link><Link className={textLink} to={careerToolHref("/learn", context)}>Work on a skill gap</Link><Link className={textLink} to={careerToolHref("/code", context)}>Practice explaining code</Link></div></section>
      <details className="workspace-panel p-5" onToggle={(event) => setReviewOpen(event.currentTarget.open)}><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Review previous sessions and try again</summary>
        <dl className="mt-3 grid grid-cols-2 gap-3"><div><dt className="workspace-eyebrow">Completed practice</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{mission.practice_rounds}</dd></div><div><dt className="workspace-eyebrow">Completed live sessions</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{mission.live_rounds}</dd></div></dl>
        <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">These counts include explicitly linked sessions only. Practice and live sessions are separate. Possible company-name matches remain unconfirmed until you review and link them. Open a completed session for its report and targeted retry tools.</p>{reviewOpen && <Journey key={entry.id} entryId={entry.id} roundsOnly onLinked={onLinked} />}
      </details>
    </div>
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
      <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="offer" />Offer</h2>
      {o ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{o.company} · {o.role}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{money(o.currency, o.fixed)} fixed a year · {o.status}</p>
          </div>
          <div className="flex gap-2">
            <Link to={offerPath(o.id)} className={linkButton("primary", "sm")}>Open in Offers</Link>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void link(null)}>Unlink</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Not linked. {mission.offers.length ? "Pick the offer from this company, or add it in Offers." : "When an offer comes, add it in Offers and link it here."}
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
            <Link to={OFFERS_HOME} className={linkButton("secondary", "md")}>Add in Offers</Link>
          </div>
        </>
      )}
    </Card>
  );
}

/** The first gap, with the reason in words; "Not now" hides it for three days on this device. */
function NextStepCard({
  step: sourceStep,
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
  const step = sourceStep?.key === "fit" && !entry.live ? {
    ...sourceStep, title: "Review this job’s requirements", action: "Open job details", to: "interview",
    why: "This job has no live post in Orbit. Open its saved details or paste the description, then compare the requirements with your real evidence.",
  } : sourceStep;
  if (!step) {
    return (
      <Card>
        <h2 className="font-display text-base font-semibold">Nothing pressing</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">No next action is suggested from these saved records. Review your tracker when something changes.</p>
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
    if (step.to === "interview") return onTab("interview");
    if (step.to === "notes") return onTab("timeline");
    return undefined;
  };
  const internal = step.to.startsWith("/");
  return (
    <section aria-labelledby="next-title" className="glass-panel gradient-border rounded-2xl p-5">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Next step</p>
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
