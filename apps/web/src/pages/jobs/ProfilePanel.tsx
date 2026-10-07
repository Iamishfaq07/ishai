import { useId, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { JobPrefs, JobProfile } from "@orbit/types";
import { Sparkles, X, cx, focusRing, useFocusTrap } from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { RESUME_AI_HOME } from "../resume/paths";
import { JOB_TYPES, LEVELS, POSTED_WITHIN, WORKPLACES, addItem, toggle, toggleWorkplace } from "./model";

interface Props {
  profile: JobProfile;
  onClose: () => void;
  /** Saved: the new profile (the feed reloads with it). */
  onSaved: (profile: JobProfile) => void;
}

/** "Customise your feed": everything the AI filled in from the resume, the user's to change. */
export function ProfilePanel({ profile, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<JobPrefs>(profile.prefs);
  const [resumeId, setResumeId] = useState<string | null>(profile.resume?.id ?? null);
  const [aiLeft, setAiLeft] = useState(profile.ai_left);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Fill in with AI" saves the profile it reads, so closing after it still refreshes the feed.
  const [readBack, setReadBack] = useState<JobProfile | null>(null);
  const close = () => (readBack ? onSaved(readBack) : onClose());
  const ref = useFocusTrap<HTMLDivElement>(true, { onEscape: close });
  const set = <K extends keyof JobPrefs>(key: K, value: JobPrefs[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const readResume = async () => {
    setBusy("ai");
    setError(null);
    try {
      const p = await api.suggestJobProfile(resumeId);
      setReadBack(p);
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
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  // On the page body: a transformed ancestor (the page's enter animation) would otherwise hold "fixed" inside it.
  return createPortal(
    <div className="fixed inset-0 z-40 flex animate-fade-in justify-end bg-black/50 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-profile-title"
        className="flex h-full w-full max-w-xl animate-fade-up flex-col overflow-hidden border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:rounded-2xl sm:border"
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-white/10">
          <h2 id="job-profile-title" className="flex-1 font-display text-lg font-semibold">
            Customise your feed
          </h2>
          <button type="button" onClick={close} aria-label="Close" className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3 rounded-2xl bg-indigo-500/[0.06] p-4 ring-1 ring-indigo-500/15">
            {profile.resumes.length ? (
              <Field label="Match jobs to this resume" htmlFor="jp-resume">
                <Select id="jp-resume" value={resumeId ?? ""} onChange={(e) => setResumeId(e.target.value || null)}>
                  {profile.resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-sm">
                You don't have a resume yet.{" "}
                <Link to={RESUME_AI_HOME} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Make one in Resume AI
                </Link>{" "}
                and the AI fills this in from it.
              </p>
            )}
            {profile.resumes.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" disabled={busy !== null || aiLeft === 0} onClick={() => void readResume()}>
                  <Sparkles className="h-4 w-4" aria-hidden /> {busy === "ai" ? "Reading your resume…" : "Fill in from my resume with AI"}
                </Button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Free{aiLeft === null ? "" : aiLeft === 0 ? ". You've used today's AI reads; try again tomorrow" : `, ${aiLeft} left today`}.
                </span>
              </div>
            )}
            {note && <p className="text-xs text-indigo-900 dark:text-indigo-200">{note}</p>}
          </section>

          <ChipsField
            label="Job titles"
            hint="Best fit first. The feed looks for these and close variants."
            items={draft.titles}
            max={8}
            placeholder="e.g. Backend Engineer"
            onChange={(v) => set("titles", v)}
          />
          <ChipsField
            label="Your key skills"
            hint="Matched against what each job asks for. Only list skills you really have."
            items={draft.skills}
            max={25}
            placeholder="e.g. Python, Kubernetes"
            onChange={(v) => set("skills", v)}
          />
          <ChipsField
            label="Cities"
            hint="Empty means anywhere in India."
            items={draft.locations}
            max={8}
            placeholder="e.g. Bengaluru"
            suggestions={profile.cities}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Experience level" htmlFor="jp-level">
              <Select id="jp-level" value={draft.level ?? ""} onChange={(e) => set("level", (e.target.value || null) as JobPrefs["level"])}>
                <option value="">Any</option>
                {LEVELS.map((l) => (
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
                onChange={(e) => set("years", e.target.value === "" ? null : Math.min(50, Math.max(0, Number(e.target.value))))}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Job types</legend>
            <div className="flex flex-wrap gap-2">
              {JOB_TYPES.map((t) => (
                <ToggleChip key={t.id} on={draft.job_types.includes(t.id)} onClick={() => set("job_types", toggle(draft.job_types, t.id))}>
                  {t.label}
                </ToggleChip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">None picked: full-time, part-time and contract (and internships for freshers).</p>
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

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Where Orbit looks</legend>
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
              Sites Orbit can't read jobs from (like LinkedIn and Naukri): a link opens their own search, filled in from this profile.
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(profile.portals).map(([id, name]) => (
                <ToggleChip key={id} on={draft.portals.includes(id)} onClick={() => set("portals", toggle(draft.portals, id))}>
                  {name}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-white/10">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save and show jobs"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
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
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  max: number;
  placeholder?: string;
  suggestions?: string[];
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
              className={cx("rounded-full p-0.5 hover:bg-indigo-500/20", focusRing)}
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
              <option key={s} value={s === "India" ? "India" : s}>
                {s === "India" ? "Anywhere in India" : s}
              </option>
            ))}
          </datalist>
        )}
      </div>
    </Field>
  );
}
