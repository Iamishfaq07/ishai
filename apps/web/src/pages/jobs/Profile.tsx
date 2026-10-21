import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { JobPrefs, JobProfile } from "@orbit/types";
import { Spot, type SpotKind, ArrowRight, Check, LoadGate, SlidersHorizontal, Sparkles, X, cx, focusRing, isIndia } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { useJobsAi } from "./JobsAi";
import { textLink, linkButton } from "./links";
import { ANYWHERE_TOKENS, JOB_TYPES, POSTED_WITHIN, levelsFor, WORKPLACES, addItem, anywhereLabel, profileSummary, samePrefs, toggle, toggleWorkplace } from "./model";
import { CountryField } from "../../components/CountryField";
import { useCountry } from "../../lib/country";
import { JOBS_MATCHES } from "./paths";
import { OnThisPage, type PageSection } from "../../components/OnThisPage";
import { AlertsSection } from "./AlertsSection";
import { adjacentTitles } from "./adjacentTitles";

/** Jobs → Profile: what the feed looks for, filled in by the AI from the resume, every part of it the user's. */
export function JobProfilePage() {
  const { profile, suggesting, setProfile } = useJobsAi();
  return (
    <>
      <PageHeader
        icon={SlidersHorizontal}
        title="Your search profile"
        subtitle="What Jobs looks for. The AI fills it in from your resume; change anything, and your matches follow."
      />
      <LoadGate loading={profile.loading && !profile.data} variant="card" count={3} label="Getting your job profile">
      {profile.error && !profile.data ? (
        <ErrorNote onRetry={profile.reload}>{errorText(profile.error)}</ErrorNote>
      ) : profile.data ? (
        <ProfileForm profile={profile.data} suggesting={suggesting} onSaved={setProfile} />
      ) : null}
      </LoadGate>
    </>
  );
}

function ProfileForm({ profile, suggesting, onSaved }: { profile: JobProfile; suggesting: boolean; onSaved: (profile: JobProfile) => void }) {
  const country = useCountry();
  const { profile: loaded } = useJobsAi();
  const sampleCity = profile.cities.find((c) => !ANYWHERE_TOKENS.includes(c));
  const savedResume = profile.resume?.id ?? null;
  const [draft, setDraft] = useState<JobPrefs>(profile.prefs);
  const [resumeId, setResumeId] = useState<string | null>(savedResume);
  // The saved profile the draft started from: when it changes elsewhere (the AI's first read of the resume), the
  // form shows the new one, unless there are edits here.
  const [base, setBase] = useState({ prefs: profile.prefs, resume: savedResume });
  if (base.prefs !== profile.prefs || base.resume !== savedResume) {
    setBase({ prefs: profile.prefs, resume: savedResume });
    if (samePrefs(draft, base.prefs) && resumeId === base.resume) {
      setDraft(profile.prefs);
      setResumeId(savedResume);
    }
  }
  const [aiLeft, setAiLeft] = useState(profile.ai_left);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = !samePrefs(draft, profile.prefs) || resumeId !== savedResume;
  const set = <K extends keyof JobPrefs>(key: K, value: JobPrefs[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  // Leaving with edits that aren't saved: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const readResume = async () => {
    setBusy("ai");
    setError(null);
    try {
      // The server saves what the AI read (with the rest of the saved profile); edits made here stay in the form.
      const p = await api.suggestJobProfile(resumeId);
      setBase({ prefs: p.prefs, resume: p.resume?.id ?? null });
      onSaved(p);
      // The AI's read replaces titles, skills, level, years and cities; the rest stays as edited here.
      setDraft((d) => ({ ...d, titles: p.prefs.titles, skills: p.prefs.skills, level: p.prefs.level, years: p.prefs.years, locations: p.prefs.locations }));
      setAiLeft(p.ai_left);
      setNote(p.note ?? (p.suggested?.by === "ai" ? "Filled in from your resume by the AI. Check it and change anything." : null));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      onSaved(await api.saveJobProfile(draft, resumeId));
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const discard = () => {
    setDraft(profile.prefs);
    setResumeId(savedResume);
  };

  const locked = busy !== null || suggesting;
  const actions = (
    <SaveBar dirty={dirty} saved={saved} busy={busy} locked={locked} onSave={() => void save()} onDiscard={discard} />
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-4">
        {suggesting && (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-200">
            <Sparkles className="h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden /> The AI is reading your resume into this profile…
          </p>
        )}

        <Section id="resume" spot="resume" title="Your resume" hint="Jobs are matched to it: its titles, skills and experience.">
          {profile.resumes.length ? (
            <div className="space-y-3">
              <Field label="Match jobs to this resume" htmlFor="jp-resume">
                <Select id="jp-resume" value={resumeId ?? ""} onChange={(e) => setResumeId(e.target.value || null)}>
                  {profile.resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button variant="secondary" size="sm" disabled={locked || aiLeft === 0} onClick={() => void readResume()}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === "ai" ? "Reading your resume…" : "Fill in from my resume with AI"}
                </Button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Free{aiLeft === null ? "" : aiLeft === 0 ? ". You've used today's AI reads; try again tomorrow" : `, ${aiLeft} left today`}.
                </span>
                {resumeId && (
                  <Link to={resumePath(resumeId)} className={cx(textLink, "ml-auto text-xs")}>
                    Open it in Resume
                  </Link>
                )}
              </div>
              {note && <p className="text-xs text-indigo-900 dark:text-indigo-200">{note}</p>}
            </div>
          ) : (
            <p className="text-sm">
              You don't have a resume yet.{" "}
              <Link to={RESUME_AI_HOME} className={textLink}>
                Make one in Resume
              </Link>{" "}
              and the AI fills this in from it.
            </p>
          )}
        </Section>

        <Section id="looking-for" spot="target" title="What you're looking for" hint="The roles and skills each job is scored against.">
          <div className="space-y-5">
            <ChipsField
              label="Job titles"
              hint="Best fit first. The feed looks for these and close variants."
              items={draft.titles}
              max={8}
              placeholder="e.g. Backend Engineer"
              onChange={(v) => set("titles", v)}
            />
            <AdjacentTitles titles={draft.titles} onAdd={(t) => set("titles", [...draft.titles, t].slice(0, 8))} />
            <ChipsField
              label="Your key skills"
              hint="Matched against what each job asks for. Only list skills you really have."
              items={draft.skills}
              max={25}
              placeholder="e.g. Python, Kubernetes"
              onChange={(v) => set("skills", v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Experience level" htmlFor="jp-level">
                <Select id="jp-level" value={draft.level ?? ""} onChange={(e) => set("level", (e.target.value || null) as JobPrefs["level"])}>
                  <option value="">Any</option>
                  {levelsFor(country).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label} ({l.hint})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Years of experience" htmlFor="jp-years" hint="Read from your resume's dates.">
                <Input
                  id="jp-years"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={50}
                  step={0.5}
                  value={draft.years ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      set("years", null);
                      return;
                    }
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) set("years", Math.min(50, Math.max(0, n)));
                  }}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section id="where" spot="place" title="Where" hint="The country you're applying in, cities, and how you'd like to work.">
          <div className="space-y-5">
            <div className="max-w-sm">
              <CountryField id="jobs-country" hint="Your matches, cities and job-site links follow it." onChanged={() => loaded.reload()} />
            </div>
            <ChipsField
              label="Cities"
              hint={`Empty means ${anywhereLabel(country).replace(/^Anywhere/, "anywhere")}.`}
              items={draft.locations}
              max={8}
              placeholder={sampleCity ? `e.g. ${sampleCity}` : "e.g. your city"}
              suggestions={profile.cities}
              labelFor={(s) => (ANYWHERE_TOKENS.includes(s) ? anywhereLabel(country) : s)}
              onChange={(v) => set("locations", v)}
            />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Work mode</legend>
              <div className="flex flex-wrap gap-2">
                {WORKPLACES.map((w) => (
                  <ToggleChip key={w.id} on={draft.workplace.includes(w.id)} onClick={() => set("workplace", toggleWorkplace(draft.workplace, w.id))}>
                    {w.label}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>
          </div>
        </Section>

        <Section id="which-jobs" spot="briefcase" title="Which jobs" hint="The kind of job, how recent, and what to leave out.">
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Job types</legend>
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map((t) => (
                  <ToggleChip key={t.id} on={draft.job_types.includes(t.id)} onClick={() => set("job_types", toggle(draft.job_types, t.id))}>
                    {t.label}
                  </ToggleChip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">None picked: full-time, part-time and contract (and internships for {isIndia(country) ? "freshers" : "entry-level roles"}).</p>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Posted within</legend>
              <div className="inline-flex flex-wrap gap-1 rounded-xl bg-zinc-500/10 p-1">
                {POSTED_WITHIN.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    aria-pressed={draft.posted_within === p.days}
                    onClick={() => set("posted_within", p.days)}
                    className={cx(
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      draft.posted_within === p.days ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                      focusRing,
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <ChipsField
              label="Leave out jobs that mention"
              hint="Words in the title, company or skills: e.g. sales, crypto, night shift."
              items={draft.exclude}
              max={20}
              placeholder="e.g. sales"
              onChange={(v) => set("exclude", v)}
            />

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={draft.needs_sponsorship ?? false} onChange={(e) => set("needs_sponsorship", e.target.checked)}
                     className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">I need visa sponsorship</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Leaves out posts that say they won't sponsor a work visa. Posts that don't say stay in.
                </span>
              </span>
            </label>
          </div>
        </Section>

        <Section id="sources" spot="globe" title="Where Orbit looks" hint="The job sources, and the big sites to search for you.">
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Job sources</legend>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Companies' own career pages and remote-job boards that allow it.</p>
              <div className="flex flex-wrap gap-2">
                {profile.sources.map((s) => (
                  <ToggleChip key={s.id} on={!draft.sources_off.includes(s.id)} onClick={() => set("sources_off", toggle(draft.sources_off, s.id))}>
                    {s.label}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">"Search on" links</legend>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                Sites Orbit can't read jobs from (like {isIndia(country) ? "LinkedIn and Naukri" : "LinkedIn and Indeed"}): a link opens their own search, filled in from this profile.
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(profile.portals).map(([id, name]) => (
                  <ToggleChip key={id} on={draft.portals.includes(id)} onClick={() => set("portals", toggle(draft.portals, id))}>
                    {name}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>
          </div>
        </Section>
        <AlertsSection onProfileSaved={() => !profile.saved && loaded.reload()} />
        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Phones and tablets: once there's something to save, saving stays in reach, above the tab bar. Solid, so the
            form doesn't show through. */}
        {(dirty || saved) && (
          <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 animate-fade-up md:bottom-4 lg:hidden">
            <div className="rounded-2xl bg-white p-3 shadow-popover ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">{actions}</div>
          </div>
        )}
      </div>

      <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start" aria-label="Your profile in a line">
        <Card className="!p-4">
          <h2 className="font-display text-sm font-semibold">Looking for</h2>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-200">{profileSummary(draft, country)}</p>
          {draft.exclude.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Leaving out: {draft.exclude.join(", ")}</p>
          )}
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-white/10">{actions}</div>
        </Card>
        <OnThisPage sections={PROFILE_SECTIONS} label="Profile sections" className="mt-6" />
      </aside>
    </div>
  );
}

/** Save, with whether there's anything to save; after saving, the way to the matches it gives. */
function SaveBar({
  dirty,
  saved,
  busy,
  locked,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saved: boolean;
  busy: "save" | "ai" | null;
  locked: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {dirty ? (
          "Unsaved changes"
        ) : saved ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" aria-hidden /> Saved
          </span>
        ) : (
          "Your matches use this profile."
        )}
      </p>
      {dirty ? (
        <>
          <Button variant="ghost" size="sm" disabled={locked} onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={locked} onClick={onSave}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </>
      ) : (
        <Link to={JOBS_MATCHES} className={linkButton(saved ? "primary" : "secondary", "sm")}>
          See your matches <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

const PROFILE_SECTIONS: PageSection[] = [
  { id: "resume", label: "Your resume" },
  { id: "looking-for", label: "What you're looking for" },
  { id: "where", label: "Where" },
  { id: "which-jobs", label: "Which jobs" },
  { id: "sources", label: "Where Orbit looks" },
  { id: "alerts", label: "Email alerts" },
];

function Section({ id, title, hint, spot, children }: { id: string; title: string; hint: string; spot: SpotKind; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="mb-4 flex items-center gap-3">
        <Spot kind={spot} />
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        on
          ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200"
          : "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-400 dark:hover:text-white",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/** A list edited as chips: type and press Enter (or a comma) to add, × to remove. */
function ChipsField({
  label,
  hint,
  items,
  max,
  placeholder,
  suggestions,
  labelFor = (s) => s,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  max: number;
  placeholder?: string;
  suggestions?: string[];
  /** How a suggestion reads ("India" → "Anywhere in India"). */
  labelFor?: (s: string) => string;
  onChange: (items: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const commit = () => {
    if (!text.trim()) return;
    onChange(addItem(items, text, max));
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !text && items.length) {
      onChange(items.slice(0, -1));
    }
  };
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/90 p-2 dark:border-white/10 dark:bg-zinc-950/60">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 py-0.5 pl-2.5 pr-1 text-sm text-indigo-800 dark:text-indigo-200">
            {item}
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x !== item))}
              aria-label={`Remove ${item}`}
              className={cx("tap rounded-full p-0.5 hover:bg-indigo-500/20", focusRing)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={items.length >= max ? "" : placeholder}
          disabled={items.length >= max}
          list={suggestions ? `${id}-list` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-zinc-400"
        />
        {suggestions && (
          <datalist id={`${id}-list`}>
            {suggestions.map((s) => (
              <option key={s} value={s}>
                {labelFor(s)}
              </option>
            ))}
          </datalist>
        )}
      </div>
    </Field>
  );
}

/** Titles that ask for much the same work (adjacentTitles.ts), to add to the search or try in Discover first. */
function AdjacentTitles({ titles, onAdd }: { titles: string[]; onAdd: (title: string) => void }) {
  const near = adjacentTitles(titles);
  if (!near.length) return null;
  const full = titles.length >= 8;
  return <div className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
    <p className="text-sm font-medium">Also worth searching</p>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">Titles employers use for similar work. Add one to your search, or try it in Discover first.</p>
    <ul className="mt-2 flex flex-wrap gap-2">{near.map((t) => <li key={t} className="flex items-center overflow-hidden rounded-full ring-1 ring-zinc-200 dark:ring-white/10">
      <button type="button" disabled={full} onClick={() => onAdd(t)} className={cx("min-h-9 px-3 text-sm hover:bg-white disabled:opacity-50 dark:hover:bg-white/10", focusRing)} aria-label={`Add ${t} to your job titles`}>+ {t}</button>
      <Link to={`${JOBS_MATCHES}?q=${encodeURIComponent(t)}`} className={cx("min-h-9 border-l border-zinc-200 px-2 py-2 text-xs text-indigo-700 hover:bg-white dark:border-white/10 dark:text-indigo-300 dark:hover:bg-white/10", focusRing)} aria-label={`Search ${t} jobs`}>Search</Link>
    </li>)}</ul>
  </div>;
}
