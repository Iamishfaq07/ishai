import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LinkedInState, ResumeSummary } from "@orbit/types";
import { Check, CircleAlert, CircleCheck, IdCard, LinkedInScene, Upload, LoadGate, WorkingState, confirmDialog, cx, focusRing, safeLocal } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Textarea } from "../../components/ui";
import { SpotArt } from "../../components/SpotArt";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { AllowanceBanner, AllowanceContext, useResumeAllowance } from "../resume/allowance";
import { useLinkedInActions } from "./actions";
import { profileUrl, sections } from "./model";
import { BeyondThePdf, RaiseIt, useSource } from "./RaiseIt";
import { ScoreRing, ScoreWord, SectionBars } from "./ScorePanel";
import { SearchPreview } from "./SearchPreview";
import { Suggestions } from "./Suggestions";

const LINK_KEY = "orbit.linkedin.url";

/**
 * LinkedIn: your LinkedIn profile read from its "Save to PDF", scored section by section against the role you want
 * and the skills job posts for it ask for, shown the way a recruiter's search shows it, and fixed a part at a time
 * like Resume: each fix is a suggestion to copy into LinkedIn, apply to Orbit's copy (the score updates) and tick
 * off when it's done there.
 */
export function LinkedInPage() {
  const state = useAsync(() => api.linkedin(), [], "linkedin");
  const allowance = useResumeAllowance();
  const s = state.data;
  const set = (next: LinkedInState) => state.setData(() => next);
  const read = Boolean(s?.profile && s.audit);
  return (
    <AllowanceContext.Provider value={allowance}>
      <PageHeader eyebrow="Your career profile" icon={IdCard} title="LinkedIn Optimizer" subtitle="How your LinkedIn profile looks to a recruiter searching for your next role, and the fixes to paste in." art={read ? <SpotArt kind="profile" /> : undefined} />
      <LoadGate loading={state.loading && !s} variant="card" count={3} label="Getting your LinkedIn check">
        {state.error && !s ? (
          <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>
        ) : s ? (
          <div className="space-y-6">
            {read ? <Workbench state={s} onChange={set} /> : <Welcome />}
            <ReadProfile state={s} onRead={set} />
          </div>
        ) : null}
      </LoadGate>
    </AllowanceContext.Provider>
  );
}

function Welcome() {
  return (
    <EmptyState
      art={<LinkedInScene className="w-56" />}
      title="See your LinkedIn the way recruiters do"
      body="Orbit reads your profile, scores each section against the role you want, and writes the fixes: a headline, an About, your roles' bullets, skills in order. Copy each one into LinkedIn and tick it off."
    />
  );
}

function Workbench({ state, onChange }: { state: LinkedInState; onChange: (s: LinkedInState) => void }) {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const list: ResumeSummary[] = resumes.data ?? [];
  const actions = useLinkedInActions(state, onChange);
  const pick = useSource(list);
  return (
    <>
      <AllowanceBanner />
      <ScoreCard state={state} onChange={onChange} flash={actions.flash} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <RaiseIt state={state} actions={actions} resumes={list} pick={pick} />
        <div className="space-y-6">
          <SearchPreview profile={state.profile!} read={state.read ?? null} query={state.target_role} />
          <Keywords state={state} />
        </div>
      </div>
      <Suggestions state={state} actions={actions} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <BeyondThePdf state={state} actions={actions} pick={pick} />
        <div className="space-y-6">
          {state.audit!.mismatches.length > 0 && (
            <Card>
              <h2 className="font-display text-base font-semibold">LinkedIn and your resume disagree</h2>
              <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Recruiters check both. Make them tell the same story.</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">{state.audit!.mismatches.map((m) => <li key={m}>{m}</li>)}</ul>
            </Card>
          )}
          <EveryCheck state={state} />
          <WhatWasRead state={state} onChange={onChange} />
        </div>
      </div>
    </>
  );
}

function ScoreCard({ state, onChange, flash }: { state: LinkedInState; onChange: (s: LinkedInState) => void; flash: { id: string; at: number } | null }) {
  const a = state.audit!;
  const p = state.profile!;
  const [target, setTarget] = useState(state.target_role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTarget(state.target_role), [state.target_role]);
  const retarget = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.setLinkedInTarget(target.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const scores = state.scores;
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col items-center">
          <ScoreRing score={a.score} />
          <ScoreWord score={a.score} />
          {scores && scores.projected > scores.now && (
            <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {scores.projected} with every fix
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1 basis-72 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">{p.name || "Your profile"}</p>
              {p.headline && <p className="text-sm text-zinc-600 dark:text-zinc-300">{p.headline}</p>}
            </div>
            <form onSubmit={(e) => void retarget(e)} className="flex flex-wrap items-end gap-2">
              <Field label="The role you want" htmlFor="li-target">
                <Input id="li-target" value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} className="w-56" />
              </Field>
              <Button type="submit" variant="secondary" loading={busy} disabled={target.trim().length < 2 || target.trim() === state.target_role}>Check against it</Button>
            </form>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <SectionBars sections={sections(state)} flash={flash} />
        </div>
      </div>
    </Card>
  );
}

function Keywords({ state }: { state: LinkedInState }) {
  const a = state.audit!;
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">What employers ask for</h2>
      {a.keywords.length ? (
        <>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">The skills {a.posts} job posts for "{state.target_role}" ask for most. Recruiters search with these words.</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Skills, and whether your profile has them">
            {a.keywords.map((k) => {
              const has = a.found.includes(k);
              return (
                <li key={k} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm", has ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300")}>
                  {has ? <Check className="h-3.5 w-3.5" aria-label="On your profile" /> : <span className="sr-only">Missing: </span>}
                  {k}
                </li>
              );
            })}
          </ul>
          {a.missing.length > 0 && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Add the grey ones only if you have them: the fixes never claim a skill your profile or resume doesn't show.</p>}
        </>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Too few job posts for "{state.target_role}" to say, so keywords aren't scored. Try the title as job posts write it.</p>
      )}
    </Card>
  );
}

function EveryCheck({ state }: { state: LinkedInState }) {
  const checks = state.audit!.checks;
  const known = checks.filter((c) => c.known !== false);
  const failing = known.filter((c) => !c.ok).length;
  return (
    <Card>
      <details>
        <summary className={cx("cursor-pointer font-display text-base font-semibold", focusRing)}>
          Every check <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">({known.length - failing} of {known.length} pass)</span>
        </summary>
        <ul className="mt-3 space-y-2.5 text-sm">
          {known.map((c) => (
            <li key={c.id} className="flex gap-2">
              {c.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="Passes" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="To fix" />}
              <span className="min-w-0">
                <span className="font-medium">{c.title}</span>
                <span className="ml-1.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{c.points}/{c.max}{!c.ok && c.gain ? `, +${c.gain} if fixed` : ""}</span>
                {!c.ok && <span className="block text-zinc-600 dark:text-zinc-300">{c.tip}</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function WhatWasRead({ state, onChange }: { state: LinkedInState; onChange: (s: LinkedInState) => void }) {
  const p = state.read ?? state.profile!;
  const remove = async () => {
    if (!(await confirmDialog({ title: "Forget your LinkedIn profile?", body: "Orbit's copy, its check and your suggestions go. Your LinkedIn itself isn't touched.", confirmLabel: "Forget it", danger: true }))) return;
    await api.deleteLinkedIn();
    onChange({ ...state, profile: null, read: null, audit: null, read_at: null, suggestions: [], scores: null, progress: { done: 0, total: 0 } });
  };
  return (
    <Card>
      <details>
        <summary className={cx("cursor-pointer font-display text-base font-semibold", focusRing)}>What Orbit read from your profile</summary>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Headline ({p.headline.length}/220)</dt><dd>{p.headline || "–"}</dd></div>
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">About ({p.about.length.toLocaleString("en-IN")}/2,600)</dt><dd className="whitespace-pre-wrap">{p.about || "–"}</dd></div>
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Roles</dt><dd>{p.experience.map((r) => `${r.title} at ${r.company}`).join(" · ") || "–"}</dd></div>
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Skills ({p.skills.length})</dt><dd>{p.skills.join(", ") || "–"}</dd></div>
        </dl>
        <Button className="mt-3" size="sm" variant="danger" onClick={() => void remove()}>Forget my profile</Button>
      </details>
    </Card>
  );
}

function ReadProfile({ state, onRead }: { state: LinkedInState; onRead: (s: LinkedInState) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(() => {
    try {
      return safeLocal.getItem(LINK_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [linkSet, setLinkSet] = useState(() => Boolean(profileUrl(link)));
  const [dragging, setDragging] = useState(false);
  const url = profileUrl(link);
  const useLink = (e: FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLinkSet(true);
    try {
      safeLocal.setItem(LINK_KEY, url);
    } catch {
      /* the link is a convenience: fine to lose */
    }
  };
  const read = async (fn: () => Promise<LinkedInState>) => {
    setBusy(true);
    setError(null);
    try {
      onRead(await fn());
      setText("");
      setPaste(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const has = Boolean(state.profile);
  const readFile = (f: File | undefined) => {
    if (f) void read(() => api.readLinkedInFile(f, f.name));
  };
  return (
    <div
      className={cx("rounded-2xl", dragging && "ring-2 ring-indigo-500")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]); }}
    >
    <Card>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Upload className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden /> {has ? "Read your profile again" : "Start with your LinkedIn profile"}
      </h2>
      {has && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Pasted some fixes into LinkedIn? Read it again: your suggestions stay, and the ones LinkedIn now has are ticked done.</p>}
      <form onSubmit={useLink} className="mt-3 grid items-end gap-2 sm:grid-cols-[minmax(0,28rem)_auto] sm:justify-start">
        <Field label="Your LinkedIn profile link" htmlFor="li-link">
          <Input id="li-link" type="text" inputMode="url" autoComplete="url" placeholder="https://www.linkedin.com/in/your-name" value={link}
                 onChange={(e) => { setLink(e.target.value); setLinkSet(false); }} />
        </Field>
        <Button type="submit" variant="secondary" disabled={!url}>Use this link</Button>
      </form>
      {link.trim() && !url && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">That isn't a LinkedIn profile link. It looks like linkedin.com/in/your-name.</p>}
      {linkSet && url ? (
        <ol className="mt-3 list-decimal space-y-1.5 rounded-xl bg-indigo-500/[0.07] p-4 pl-8 text-sm">
          <li>
            <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 underline dark:text-indigo-400">Open your profile on LinkedIn</a> (it opens in a new tab).
          </li>
          <li>Click <strong>Resources</strong> (or <strong>More</strong>) under your name, then <strong>Save to PDF</strong>. It's on the desktop site, not the app.</li>
          <li>Drop that PDF on this box, or press <strong>Upload the PDF</strong>. Orbit reads everything from it.</li>
        </ol>
      ) : (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          LinkedIn doesn't let other sites read profiles from a link, so Orbit reads LinkedIn's own PDF of it: on your profile, <strong>Resources</strong> (or <strong>More</strong>) → <strong>Save to PDF</strong>, then upload it here. Orbit doesn't keep the file.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".pdf,application/pdf,.txt" className="sr-only" aria-label="Your LinkedIn PDF"
               onChange={(e) => {
                 const f = e.target.files?.[0];
                 e.target.value = "";
                 readFile(f);
               }} />
        <Button loading={busy} disabled={state.reads_left === 0} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" /> Upload the PDF
        </Button>
        <Button variant="ghost" onClick={() => setPaste((v) => !v)}>Or paste the profile</Button>
        {state.reads_left !== null && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{state.reads_left} free read{state.reads_left === 1 ? "" : "s"} left today</span>
        )}
      </div>
      {busy && <WorkingState compact kind="reading" label="Reading your profile" className="mt-3" />}
      {paste && (
        <form className="mt-3 space-y-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void read(() => api.readLinkedInText(text)); }}>
          <Field label="Your profile, copied" htmlFor="li-paste" hint="Select everything on your profile page and paste it here. A copied page can also show your Featured section, recommendations and activity, which the PDF leaves out.">
            <Textarea id="li-paste" rows={6} maxLength={60000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy || text.trim().length < 200}>Read it</Button>
        </form>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
    </div>
  );
}
