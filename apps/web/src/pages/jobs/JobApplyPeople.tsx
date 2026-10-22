import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobTrackerEntry, NetworkContext } from "@orbit/types";
import { ArrowRight, Send, UsersRound, cx, focusRing } from "@orbit/ui";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { applyApi } from "./autoapply/applyApi";
import { STATUS_LABEL as PACKET_LABEL } from "./autoapply/model";
import { COVERAGE, useCoverage } from "./autoapply/Coverage";
import { JOBS_AUTO_APPLY } from "./paths";

const ContactResearch = lazy(() => import("./ContactResearch"));
const card = "workspace-panel route-card flex min-w-0 flex-col gap-3 p-5";
const textLink = cx("inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300", focusRing);

/**
 * The two things every job needs next to its next step: an application prepared for it (Orbit Apply, with the
 * resume tailored to this job from true facts only) and the people at the company (HR, recruiters and the team).
 * Both are drafts until the candidate acts: nothing is sent from here.
 */
export function JobApplyPeople({ entry }: { entry: JobTrackerEntry }) {
  // Tracker cards and Discover link here with ?contacts=1, finder already open.
  const [params] = useSearchParams();
  return <div className="grid min-w-0 gap-4 md:grid-cols-2">
    <AutoApplyCard entry={entry} />
    <JobPeople company={entry.company} listingId={entry.listing_id} applicationId={entry.id} defaultOpen={params.get("contacts") === "1"} />
  </div>;
}

/**
 * People at the company, for one job: the contacts saved there and the contact finder (recruiters, HR and the team,
 * each with its source). The finder works on a saved job; an unsaved one offers to save it first. On a narrow grid
 * cell the finder opens full width under the card's row.
 */
export function JobPeople({ company, listingId, applicationId, defaultOpen = false, onSave, saving = false }: {
  company: string; listingId: string; applicationId: string | null; defaultOpen?: boolean; onSave?: () => void; saving?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Opened from a link (?contacts=1): bring the finder into view once it's there.
  useEffect(() => {
    if (defaultOpen) requestAnimationFrame(() => document.getElementById("job-contact-finder")?.scrollIntoView({ block: "start" }));
  }, [defaultOpen]);
  return <>
    <PeopleCard company={company} listingId={listingId} applicationId={applicationId} finder={open}
      onFinder={() => { if (!applicationId) onSave?.(); setOpen((o) => applicationId ? !o : true); }} saving={saving} />
    {open && applicationId && <div id="job-contact-finder" className="workspace-panel p-5 md:col-span-2">
      <Suspense fallback={<p role="status" className="text-sm">Opening the contact finder…</p>}>
        <ContactResearch key={applicationId} listingId={listingId} applicationId={applicationId} onSaved={() => undefined} autoRun />
      </Suspense>
    </div>}
  </>;
}

function AutoApplyCard({ entry }: { entry: JobTrackerEntry }) {
  const setup = useAsync(() => applyApi.getApplySetup(), [], "apply-setup");
  const packets = useAsync(() => applyApi.applyPackets(), [], "apply-packets");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The newest application prepared for this job, if any.
  const packet = (packets.data ?? []).filter((p) => p.listing_id === entry.listing_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const ready = Boolean(setup.data?.configured && setup.data.consent_at);
  // Where this job's application goes: sent by Orbit, prepared for you to send, or on a job board (coverage.py).
  const coverage = useCoverage();
  const here = coverage.data?.jobs.find((j) => j.entry_id === entry.id);
  const approve = async (id: string) => {
    setBusy(true); setError(null);
    try { await applyApi.approveApplyPacket(id); packets.reload(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const prepare = async () => {
    setBusy(true); setNote(null); setError(null);
    try {
      const report = await applyApi.planShortlist([entry.listing_id]);
      if (report.created > 0) packets.reload();
      else setNote(report.blocked ?? report.skipped[0]?.reason ?? "Orbit Apply couldn't prepare this one. Its form may need you to apply on the job's own site.");
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return <article className={card} aria-labelledby="auto-apply-title">
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><Send className="h-4 w-4" aria-hidden /></span>
      <h2 id="auto-apply-title" className="font-semibold">Auto-apply with a tailored resume</h2>
    </div>
    {here && <p className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400">
      <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", COVERAGE[here.kind].tone)}>{COVERAGE[here.kind].label}</span>{here.where} · {here.note}</p>}
    {setup.loading && !setup.data || packets.loading && !packets.data ? <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">Checking Orbit Apply…</p>
      : packet ? <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Prepared for this job: your resume reordered and reworded for it from your real experience, a short cover letter and the form's answers.</p>
        <p className="text-sm font-medium">{PACKET_LABEL[packet.status]}{packet.missing > 0 ? ` · ${packet.missing} question${packet.missing === 1 ? "" : "s"} to answer` : ""}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Review-first: approve it here once you've looked; it then goes out within your limits. */}
          {packet.status === "review" && <Button size="sm" loading={busy} onClick={() => void approve(packet.id)}>Approve and send</Button>}
          <Link to={`/jobs/applications?packet=${encodeURIComponent(packet.id)}`} className={textLink}>{packet.status === "review" ? "Check it first" : "Open the application"} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </div>
      </>
      : !ready ? <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Set it up once: approve your master resume and the facts forms ask for. After that, every job you save can be prepared with a resume tailored to it.</p>
        <Link to={JOBS_AUTO_APPLY} className={textLink}>Set up auto-apply <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </>
      : entry.status !== "saved" ? <p className="text-sm text-zinc-600 dark:text-zinc-400">This job is already past saved, so there's nothing to apply to. Auto-apply prepares saved jobs.</p>
      : <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Orbit tailors your resume to this job from your real experience, writes a short cover letter and fills the form's answers. {setup.data?.mode === "review" ? "You review it before anything is sent." : "It's sent within your daily limit and quiet hours."}</p>
        <div><Button loading={busy} onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare this application"}</Button></div>
        {busy && <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">Reading the form and tailoring your resume. This can take a minute.</p>}
      </>}
    {note && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{note}</p>}
    {(error || packets.error) && <ErrorNote onRetry={packets.reload}>{error ?? errorText(packets.error)}</ErrorNote>}
  </article>;
}

function PeopleCard({ company, listingId, applicationId, finder, onFinder, saving }: {
  company: string; listingId: string; applicationId: string | null; finder: boolean; onFinder: () => void; saving: boolean;
}) {
  const network = useAsync(() => applicationId ? api.call<NetworkContext>(`/v1/jobs/network/${encodeURIComponent(applicationId)}`) : Promise.resolve(null),
    [applicationId], applicationId ? `network:${applicationId}` : undefined);
  const people = network.data?.saved_contacts ?? [];
  return <article className={card} aria-labelledby={`people-${listingId}`}>
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><UsersRound className="h-4 w-4" aria-hidden /></span>
      <h2 id={`people-${listingId}`} className="font-semibold">People at {company}</h2>
    </div>
    {applicationId && network.loading && !network.data ? <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">Checking who you've saved here…</p>
      : people.length ? <ul className="divide-y divide-zinc-200 dark:divide-white/10">{people.slice(0, 3).map((p) => <li key={p.id} className="py-2">
        <p className="text-sm font-medium">{p.name}</p>
        <p className="text-[13px] text-zinc-600 dark:text-zinc-400">{p.title || "Role not recorded"}</p>
      </li>)}</ul>
      : <p className="text-sm text-zinc-600 dark:text-zinc-400">Find the recruiter, HR and team members for this role from public sources, each with the page it came from. You choose who to save; nothing is sent.{applicationId ? "" : " The job is saved to your tracker first."}</p>}
    {network.error && <ErrorNote onRetry={network.reload}>{errorText(network.error)}</ErrorNote>}
    <div className="mt-auto flex flex-wrap items-center gap-x-4">
      <Button variant="secondary" loading={saving} aria-expanded={finder} aria-controls="job-contact-finder" onClick={onFinder}>
        {!applicationId ? "Save and find contacts" : finder ? "Close the finder" : people.length ? "Find more contacts" : "Find HR and team contacts"}</Button>
      {people.length > 3 && <Link to={`/jobs/outreach?job=${encodeURIComponent(listingId)}&network=1`} className={textLink}>All {people.length}</Link>}
    </div>
  </article>;
}
