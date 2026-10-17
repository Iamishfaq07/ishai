import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { LinkedInProfile, LinkedInState, ResumeSummary } from "@orbit/types";
import { Check, CircleAlert, CircleCheck, Copy, FileText, IdCard, LinkedInScene, Sparkles, Trash2, Upload, LoadGate, confirmDialog, cx, focusRing, safeLocal, useCountUp, useInView } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { RESUME_AI_HOME } from "../resume/paths";
import { profileUrl, rewriteBrief, scoreWord, sectionScores, topFixes } from "./model";

const LINK_KEY = "orbit.linkedin.url";

/**
 * LinkedIn AI: your LinkedIn profile read from its "Save to PDF", audited section by section against the role you
 * want and the skills job posts for it ask for, with where it disagrees with your resume, and a rewrite of the
 * headline and About from your resume (Resume AI's writer).
 */
export function LinkedInPage() {
  const state = useAsync(() => api.linkedin(), [], "linkedin");
  const s = state.data;
  const set = (next: LinkedInState) => state.setData(() => next);
  return (
    <>
      <PageHeader icon={IdCard} title="LinkedIn AI" subtitle="How your LinkedIn profile looks to a recruiter searching for your next role, and what to fix first." art={<LinkedInScene />} />
      <LoadGate loading={state.loading && !s} variant="card" count={3} label="Getting your LinkedIn check">
        {state.error && !s ? (
          <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>
        ) : s ? (
          <div className="space-y-6">
            {s.profile && s.audit ? <Audit state={s} onChange={set} /> : null}
            <ReadProfile state={s} onRead={set} />
          </div>
        ) : null}
      </LoadGate>
    </>
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
          <li>Click <strong>Resources</strong> (or <strong>More</strong>) under your name, then <strong>Save to PDF</strong>.</li>
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
        <Button disabled={busy || state.reads_left === 0} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" /> {busy ? "Reading your profile…" : "Upload the PDF"}
        </Button>
        <Button variant="ghost" onClick={() => setPaste((v) => !v)}>Or paste the profile</Button>
        {state.reads_left !== null && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{state.reads_left} free read{state.reads_left === 1 ? "" : "s"} left today</span>
        )}
      </div>
      {paste && (
        <form className="mt-3 space-y-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void read(() => api.readLinkedInText(text)); }}>
          <Field label="Your profile, copied" htmlFor="li-paste" hint="Select everything on your profile page and paste it here.">
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

function Audit({ state, onChange }: { state: LinkedInState; onChange: (s: LinkedInState) => void }) {
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
  const remove = async () => {
    if (!(await confirmDialog({ title: "Forget your LinkedIn profile?", body: "Orbit's copy and its check go. Your LinkedIn itself isn't touched.", confirmLabel: "Forget it", danger: true }))) return;
    await api.deleteLinkedIn();
    onChange({ ...state, profile: null, audit: null, read_at: null });
  };
  const sections = sectionScores(a.checks);
  const fixes = topFixes(a.checks);
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start gap-6">
          <div className="text-center">
            <ScoreRing score={a.score} />
            <p className="mt-1 text-sm font-medium">{scoreWord(a.score)}</p>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="font-display text-lg font-semibold">{p.name || "Your profile"}</p>
              {p.headline && <p className="text-sm text-zinc-600 dark:text-zinc-300">{p.headline}</p>}
            </div>
            <form onSubmit={(e) => void retarget(e)} className="flex flex-wrap items-end gap-2">
              <Field label="The role you want" htmlFor="li-target">
                <Input id="li-target" value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} className="w-64" />
              </Field>
              <Button type="submit" variant="secondary" size="sm" disabled={busy || target.trim().length < 2 || target.trim() === state.target_role}>Check against it</Button>
            </form>
            {error && <ErrorNote>{error}</ErrorNote>}
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{s.label}</span>
                    <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{s.points}/{s.max}</span>
                  </div>
                  <span aria-hidden className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-zinc-500/15">
                    <span className={cx("block h-full rounded-full", s.points === s.max ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${(s.points / s.max) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {fixes.length > 0 && (
          <div className="mt-5 rounded-xl bg-indigo-500/[0.07] p-4">
            <h2 className="mb-2 font-display text-base font-semibold">Fix these first</h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {fixes.map((f) => <li key={f.id}><strong>{f.title.replace(/^(You have|Your|The) /, "")}:</strong> {f.tip}</li>)}
            </ol>
          </div>
        )}
      </Card>

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
          </>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Too few job posts for "{state.target_role}" to say. Try the title as job posts write it.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-display text-base font-semibold">Every check</h2>
          <ul className="space-y-2.5 text-sm">
            {a.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                {c.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="Done" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="To fix" />}
                <span>
                  <span className="font-medium">{c.title}</span>
                  {!c.ok && <span className="block text-zinc-600 dark:text-zinc-300">{c.tip}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          {a.mismatches.length > 0 && (
            <Card>
              <h2 className="font-display text-base font-semibold">LinkedIn and your resume disagree</h2>
              <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Recruiters check both. Make them tell the same story.</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">{a.mismatches.map((m) => <li key={m}>{m}</li>)}</ul>
            </Card>
          )}
          <Rewrite role={state.target_role} keywords={a.keywords} />
          <Card>
            <details>
              <summary className={cx("cursor-pointer font-display text-base font-semibold", focusRing)}>What Orbit read from your profile</summary>
              <dl className="mt-3 space-y-2 text-sm">
                <div><dt className="text-xs text-zinc-500">Headline ({p.headline.length}/220)</dt><dd>{p.headline || "–"}</dd></div>
                <div><dt className="text-xs text-zinc-500">About ({p.about.length}/2,600)</dt><dd className="whitespace-pre-wrap">{p.about || "–"}</dd></div>
                <div><dt className="text-xs text-zinc-500">Roles</dt><dd>{p.experience.map((r) => `${r.title} at ${r.company}`).join(" · ") || "–"}</dd></div>
                <div><dt className="text-xs text-zinc-500">Skills ({p.skills.length})</dt><dd>{p.skills.join(", ") || "–"}</dd></div>
              </dl>
              <Button className="mt-3" size="sm" variant="ghost" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Forget my profile</Button>
            </details>
          </Card>
        </div>
      </div>
    </>
  );
}

/** A new headline, About and skills from a resume (Resume AI's LinkedIn writer, 1 resume credit). */
function Rewrite({ role, keywords }: { role: string; keywords: string[] }) {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const list: ResumeSummary[] = resumes.data ?? [];
  const [resumeId, setResumeId] = useState("");
  const [out, setOut] = useState<LinkedInProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = resumeId || list[0]?.id || "";
  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.getResume(chosen);
      setOut(await api.linkedinProfile(r.data, rewriteBrief(role, keywords)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <Sparkles className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden /> Rewrite it from your resume
      </h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">A new headline, About and skills for "{role}", using the skills above that your resume shows. Nothing your resume doesn't say. Uses 1 resume credit.</p>
      {list.length === 0 && !resumes.loading ? (
        <p className="text-sm"><FileText className="mr-1 inline h-4 w-4" aria-hidden /><Link to={RESUME_AI_HOME} className="text-indigo-600 underline dark:text-indigo-400">Make a resume in Resume AI</Link> first: the rewrite is written from it.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {list.length > 1 && (
            <Field label="Resume" htmlFor="li-resume">
              <Select id="li-resume" value={chosen} onChange={(e) => setResumeId(e.target.value)}>
                {list.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            </Field>
          )}
          <Button disabled={busy || !chosen} onClick={() => void write()}>{busy ? "Writing…" : out ? "Write again" : "Write it"}</Button>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {out && (
        <div className="mt-4 space-y-3">
          <CopyBlock label={`Headline (${out.headline.length}/220)`} text={out.headline} />
          <CopyBlock label={`About (${out.about.length}/2,600)`} text={out.about} />
          <CopyBlock label="Skills to add" text={out.skills.join(", ")} />
        </div>
      )}
    </Card>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <button type="button" className={cx("inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400", focusRing)}
                onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => undefined)}>
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">{text}</p>
    </div>
  );
}

// A score's ring: the fill says how it went; the track is a pale step of the same colour, so the whole ring reads.
const RING_TONE = {
  good: ["stroke-emerald-500", "stroke-emerald-500/15"],
  fair: ["stroke-indigo-500", "stroke-indigo-500/15"],
  low: ["stroke-amber-500", "stroke-amber-500/20"],
} as const;

/**
 * The score as a ring: the number in the middle says it; the ring is decoration. The first time it's in view the ring
 * draws round and the number counts up with it (Full motion; otherwise both are there at once).
 */
function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const [ref, seen] = useInView<HTMLDivElement>();
  const shown = useCountUp(score, seen, { duration: 900 });
  const [fill, track] = RING_TONE[score >= 85 ? "good" : score >= 65 ? "fair" : "low"];
  return (
    <div ref={ref} className="relative h-24 w-24">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className={track} />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)}
                className={cx(fill, shown < 1 && "opacity-0")} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="stat-value font-display text-2xl font-semibold">
          <span aria-hidden>{Math.round(shown)}</span>
          <span className="sr-only">{score}</span>
        </span>
        <span className="text-[10px] text-zinc-500">out of 100</span>
      </span>
    </div>
  );
}
