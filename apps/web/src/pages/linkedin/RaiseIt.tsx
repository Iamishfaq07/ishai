import { useState } from "react";
import { Link } from "react-router-dom";
import type { LinkedInPart, LinkedInRaise, LinkedInState, ResumeSummary } from "@orbit/types";
import { Badge, SegmentedControl, Sparkles, Wand2, WorkingState, cx, safeLocal } from "@orbit/ui";
import { Button, Card, Field, Input, Select } from "../../components/ui";
import { AiErrorNote, useAllowance } from "../resume/allowance";
import { RESUME_AI_HOME } from "../resume/paths";
import { fixKey, type LinkedInActions } from "./actions";
import { AI_PARTS, fixCost } from "./model";

export type Source = "profile" | "resume" | "both";
const SOURCE_KEY = "orbit.linkedin.source";

const WORKING: Record<LinkedInPart, string> = {
  headline: "Writing three headlines",
  about: "Writing your About",
  experience: "Writing this role's bullets",
  skills: "Ordering your skills",
  url: "Working out your URL",
  featured: "Finding work to feature",
  photo: "Making the checklist",
  recommendation: "Writing the request",
  open_to_work: "Making the settings list",
};

const KIND_BADGE = { ai: ["accent", "AI fix"], auto: ["neutral", "Free"], you: ["neutral", "Only you"] } as const;

/** Where the fixes write from: the user's pick, kept on this device. */
export function useSource(resumes: ResumeSummary[]): { source: Source; setSource: (s: Source) => void; resumeId: string; setResumeId: (id: string) => void } {
  const [source, set] = useState<Source>(() => {
    const saved = safeLocal.getItem(SOURCE_KEY);
    return saved === "resume" || saved === "both" ? saved : "profile";
  });
  const [picked, setResumeId] = useState("");
  const setSource = (s: Source) => {
    set(s);
    safeLocal.setItem(SOURCE_KEY, s);
  };
  const resumeId = picked && resumes.some((r) => r.id === picked) ? picked : (resumes[0]?.id ?? "");
  return { source: resumes.length ? source : "profile", setSource, resumeId, setResumeId };
}

function FixButton({ part, label, busy, onClick, disabled = false, describedBy }: { part: LinkedInPart; label?: string; busy: boolean; onClick: () => void; disabled?: boolean; describedBy?: string }) {
  const ai = AI_PARTS.has(part);
  return (
    <Button size="sm" variant={ai ? "primary" : "secondary"} loading={busy} disabled={disabled} onClick={onClick} aria-describedby={describedBy}>
      {ai ? <Sparkles className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />} {label ?? (ai ? "Fix with AI" : "Fix it")}
    </Button>
  );
}

/**
 * "What would raise it": each fix with the points it adds, biggest first, and a Fix button that writes exactly that
 * part, from the profile, the resume or both (the user's pick). What it costs is said before anything is spent.
 */
export type SourcePick = ReturnType<typeof useSource>;

export function RaiseIt({ state, actions, resumes, pick }: { state: LinkedInState; actions: LinkedInActions; resumes: ResumeSummary[]; pick: SourcePick }) {
  const { allowance } = useAllowance();
  const { source, setSource, resumeId, setResumeId } = pick;
  const rows = (state.audit?.raise_it ?? []).filter((r) => r.gain > 0 || r.part);
  const has = (part: LinkedInPart, role: number | null) =>
    (state.suggestions ?? []).some((s) => s.part === part && (role === null || s.role_key === roleKey(state, role)));
  const run = (part: LinkedInPart, role: number | null = null, recipient = "") =>
    void actions.fix({ part, role, source, resume_id: source === "profile" ? null : resumeId, recipient });
  const errorFor = (key: string) => (actions.error?.key === key ? actions.error : null);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">What would raise it</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Each fix writes exactly that part, ready to paste. Biggest gain first.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <p id="li-source-label" className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">Write from</p>
          <SegmentedControl<Source>
            labelledBy="li-source-label"
            size="sm"
            value={source}
            onChange={setSource}
            options={[
              { value: "profile", label: "Your LinkedIn" },
              { value: "resume", label: "Your resume", disabled: !resumes.length },
              { value: "both", label: "Both", disabled: !resumes.length },
            ]}
          />
        </div>
        {source !== "profile" && resumes.length > 1 && (
          <Field label="Resume" htmlFor="li-fix-resume">
            <Select id="li-fix-resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
              {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </Field>
        )}
      </div>
      {!resumes.length && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Link to={RESUME_AI_HOME} className="font-medium text-indigo-700 underline dark:text-indigo-300">Make a resume in Resume AI</Link> to write from it too.
        </p>
      )}
      <p id="li-ai-cost" className="mt-3 rounded-lg bg-zinc-500/5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
        <strong className="font-medium">AI fixes:</strong> {fixCost(allowance, "headline")} <strong className="font-medium">Free fixes</strong> need no AI and no credit. Nothing is invented: a figure Orbit can't find in your {source === "profile" ? "profile" : source === "resume" ? "resume" : "profile or resume"} becomes a placeholder like [X%] for you to fill in.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">Every check Orbit can measure passes. Check the parts LinkedIn's PDF doesn't show, below.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-white/10">
          {rows.map((r) => {
            const key = fixKey({ part: r.part ?? "photo", role: r.role });
            const busy = r.part !== null && actions.busy === key;
            const err = r.part ? errorFor(key) : null;
            return (
              <li key={`${r.part}-${r.role}-${r.checks.join()}`} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-medium">
                      {r.label} <span className="ml-1 whitespace-nowrap text-xs font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">+{r.gain} point{r.gain === 1 ? "" : "s"}</span>
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{tipFor(state, r)}</p>
                  </div>
                  <Badge tone={KIND_BADGE[r.kind][0]}>{KIND_BADGE[r.kind][1]}</Badge>
                  {r.part === "recommendation" && <span className="text-xs text-zinc-500 dark:text-zinc-400">Write it under Beyond the PDF</span>}
                  {r.part && r.part !== "recommendation" && (
                    <FixButton part={r.part} busy={busy} disabled={Boolean(actions.busy) && !busy} describedBy={AI_PARTS.has(r.part) ? "li-ai-cost" : undefined}
                               label={has(r.part, r.role) ? "Write again" : undefined} onClick={() => run(r.part!, r.role)} />
                  )}
                </div>
                {busy && <WorkingState compact kind="writing" label={WORKING[r.part!]} className="mt-2" />}
                {err && <AiErrorNote className="mt-2" error={err.text} upgrade={err.upgrade} />}
              </li>
            );
          })}
        </ul>
      )}
      <Rewrite actions={actions} resumes={resumes} resumeId={resumeId} />
    </Card>
  );
}

function roleKey(state: LinkedInState, role: number): string {
  const r = state.profile?.experience[role];
  const norm = (x: string) => x.toLowerCase().trim().split(/\s+/).join(" ");
  return r ? `${norm(r.title)}|${norm(r.company)}` : "";
}

function tipFor(state: LinkedInState, r: LinkedInRaise): string {
  const checks = (state.audit?.checks ?? []).filter((c) => r.checks.includes(c.id));
  return checks[0]?.tip ?? "";
}

/** "Rewrite everything" from a resume: headline, About and skills in one go (Resume AI's LinkedIn writer, one credit). */
function Rewrite({ actions, resumes, resumeId }: { actions: LinkedInActions; resumes: ResumeSummary[]; resumeId: string }) {
  const { allowance } = useAllowance();
  const busy = actions.busy === "rewrite";
  const err = actions.error?.key === "rewrite" ? actions.error : null;
  return (
    <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium">Rewrite everything from your resume</p>
          <p id="li-rewrite-cost" className="text-xs text-zinc-500 dark:text-zinc-400">A new headline, About and skills in one go. {fixCost(allowance, "rewrite")}</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy} disabled={!resumeId || (Boolean(actions.busy) && !busy)} aria-describedby="li-rewrite-cost" onClick={() => void actions.rewrite(resumeId)}>
          <Sparkles className="h-3.5 w-3.5" /> Rewrite everything
        </Button>
      </div>
      {busy && <WorkingState compact kind="writing" label="Writing your headline, About and skills" className="mt-2" />}
      {err && <AiErrorNote className="mt-2" error={err.text} upgrade={err.upgrade} />}
      {!resumes.length && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">It needs a resume in Resume AI.</p>}
    </div>
  );
}

/**
 * What LinkedIn's PDF doesn't show, and the settings that aren't text: the photo and background, Featured, a
 * recommendation request, activity and Open to work. Orbit can't see them, so it offers the checklist (free) or the
 * words (an AI fix) and lets the user tick them done.
 */
export function BeyondThePdf({ state, actions, pick }: { state: LinkedInState; actions: LinkedInActions; pick: SourcePick }) {
  const { allowance } = useAllowance();
  const { source, resumeId } = pick;
  const roles = state.profile?.experience ?? [];
  const [role, setRole] = useState(roles.length > 1 ? 1 : 0);
  const [recipient, setRecipient] = useState("");
  const known = new Map((state.audit?.sections ?? []).map((s) => [s.id, s]));
  const run = (part: LinkedInPart, more: { role?: number; recipient?: string } = {}) =>
    void actions.fix({ part, source, resume_id: source === "profile" ? null : resumeId, ...more });
  const busyFor = (part: LinkedInPart, r?: number) => actions.busy === fixKey({ part, role: r ?? null });
  const err = (part: LinkedInPart, r?: number) => (actions.error?.key === fixKey({ part, role: r ?? null }) ? actions.error : null);
  const items: Array<{ part: LinkedInPart; title: string; body: string; seen: boolean }> = [
    { part: "photo", title: "Photo and background", body: "A clear, recent photo and a background about your work. Orbit can't see either in the PDF: tick them once they're up and they count.", seen: Boolean(known.get("photo")?.known) },
    { part: "featured", title: "Featured", body: "Two or three pieces of your best work pinned at the top of your profile, picked from what your profile and resume show.", seen: Boolean(known.get("featured")?.known) },
    { part: "open_to_work", title: "Open to work", body: "The settings recruiters filter on: titles, places, start date and who can see it.", seen: false },
  ];
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">Beyond the PDF</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">LinkedIn's PDF doesn't carry these, so Orbit can't score them until you tell it. Each is still worth doing.</p>
      <ul className="divide-y divide-zinc-200 dark:divide-white/10">
        {items.map((it) => (
          <li key={it.part} className="py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-medium">{it.title}{it.seen && <span className="ml-2 text-xs font-normal text-emerald-800 dark:text-emerald-300">Counted in your score</span>}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{it.body}</p>
              </div>
              <FixButton part={it.part} busy={busyFor(it.part)} disabled={Boolean(actions.busy) && !busyFor(it.part)} describedBy={AI_PARTS.has(it.part) ? "li-extra-cost" : undefined}
                         label={AI_PARTS.has(it.part) ? "Ideas with AI" : "Get the checklist"} onClick={() => run(it.part)} />
            </div>
            {busyFor(it.part) && <WorkingState compact kind="writing" label={WORKING[it.part]} className="mt-2" />}
            {err(it.part) && <AiErrorNote className="mt-2" error={err(it.part)!.text} upgrade={err(it.part)!.upgrade} />}
          </li>
        ))}
        <li className="py-3">
          <p className="text-sm font-medium">Ask for a recommendation</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">A short message to someone who saw your work, naming what they could mention. Two or more recommendations help.</p>
          {roles.length ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label="About your work at" htmlFor="li-rec-role">
                <Select id="li-rec-role" value={String(role)} onChange={(e) => setRole(Number(e.target.value))}>
                  {roles.map((r, i) => <option key={i} value={i}>{[r.title, r.company].filter(Boolean).join(" at ")}</option>)}
                </Select>
              </Field>
              <Field label="Their name (optional)" htmlFor="li-rec-name">
                <Input id="li-rec-name" value={recipient} maxLength={80} placeholder="Priya Nair" onChange={(e) => setRecipient(e.target.value)} className="w-48" />
              </Field>
              <FixButton part="recommendation" label="Write the request" busy={busyFor("recommendation", role)} disabled={Boolean(actions.busy) && !busyFor("recommendation", role)} describedBy="li-extra-cost"
                         onClick={() => run("recommendation", { role, recipient })} />
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Add a role to your profile first.</p>
          )}
          {busyFor("recommendation", role) && <WorkingState compact kind="writing" label={WORKING.recommendation} className="mt-2" />}
          {err("recommendation", role) && <AiErrorNote className="mt-2" error={err("recommendation", role)!.text} upgrade={err("recommendation", role)!.upgrade} />}
        </li>
        <li className={cx("py-3")}>
          <p className="text-sm font-medium">Activity</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Post or comment about your work every week or two: it shows on your profile and in recruiters' feeds. Orbit can't see it in the PDF.</p>
        </li>
      </ul>
      <p id="li-extra-cost" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Featured ideas and the recommendation request are AI fixes: {fixCost(allowance, "featured")} The checklists are free.</p>
    </Card>
  );
}
