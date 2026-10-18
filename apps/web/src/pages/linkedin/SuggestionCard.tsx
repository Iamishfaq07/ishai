import { useEffect, useMemo, useState } from "react";
import type { LinkedInSuggestion, LinkedInSuggestionPatch } from "@orbit/types";
import { Badge, Check, Checkbox, ChevronDown, Copy, ExternalLink, PenLine, Trash2, Undo2, Wand2, cx, toast, wordDiff } from "@orbit/ui";
import { Button, IconButton, Textarea } from "../../components/ui";
import type { LinkedInActions } from "./actions";
import { charState, chosenText, placeholders } from "./model";

const SOURCE: Record<LinkedInSuggestion["source"], string> = { profile: "From your profile", resume: "From your resume", both: "From your profile and resume" };
const EDITABLE = new Set<LinkedInSuggestion["part"]>(["headline", "about", "experience", "recommendation"]);
const CHECKLIST = new Set<LinkedInSuggestion["part"]>(["photo", "open_to_work"]);
const PLACEHOLDER = /(\[[^\]\n]{1,24}\])/;
const IS_PLACEHOLDER = /^\[[^\]\n]{1,24}\]$/;
type DiffToken = ReturnType<typeof wordDiff>[number];

/** What Copy puts on the clipboard: the text to paste, or a list one item a line. */
export function copyText(s: LinkedInSuggestion): string {
  if (s.part === "skills") return s.items.join(", ");
  if (CHECKLIST.has(s.part)) return s.items.join("\n");
  return chosenText(s);
}

function copy(text: string, what: string) {
  if (!navigator.clipboard) {
    toast({ message: "Couldn't copy", detail: "The browser blocked the clipboard: select the text and copy it.", tone: "error" });
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast({ message: "Copied", detail: what }),
    () => toast({ message: "Couldn't copy", detail: "The browser blocked the clipboard: select the text and copy it.", tone: "error" }),
  );
}

/** A text with its [X%] placeholders marked, so they're not pasted as they are. */
function Marked({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(PLACEHOLDER).map((part, i) =>
        i % 2 === 1 && IS_PLACEHOLDER.test(part) ? (
          <mark key={i} className="rounded bg-amber-400/30 px-0.5 text-amber-950 dark:bg-amber-400/25 dark:text-amber-100">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/** One side of the before → after: the words that go struck through (before), the words that come in marked (after). */
function DiffSide({ tokens, side }: { tokens: DiffToken[]; side: "before" | "after" }) {
  // Runs of the same kind, so a placeholder of two words ("[N users]") is marked as one.
  const runs: DiffToken[] = [];
  for (const t of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.kind === t.kind) last.text += t.text;
    else runs.push({ ...t });
  }
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {runs.map((t, i) => {
        if (t.kind === "equal") return <Marked key={i} text={t.text} />;
        if (side === "before" && t.kind === "removed") return <del key={i} className="text-rose-800/80 decoration-rose-500/60 dark:text-rose-200/80">{t.text}</del>;
        if (side === "after" && t.kind === "added") return <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-900 no-underline dark:text-emerald-100"><Marked text={t.text} /></ins>;
        return null;
      })}
    </p>
  );
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  const tokens = useMemo(() => wordDiff(before, after), [before, after]);
  if (before.trim() && before.trim() === after.trim()) {
    return (
      <div className="rounded-xl bg-emerald-500/5 p-3 ring-1 ring-inset ring-emerald-500/20">
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300"><Check className="h-3.5 w-3.5" aria-hidden /> LinkedIn has this now</p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><Marked text={after} /></p>
      </div>
    );
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-inset ring-zinc-500/10">
        <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">On LinkedIn now</p>
        {before.trim() ? <DiffSide tokens={tokens} side="before" /> : <p className="text-sm italic text-zinc-500 dark:text-zinc-400">Empty</p>}
      </div>
      <div className="rounded-xl bg-emerald-500/5 p-3 ring-1 ring-inset ring-emerald-500/20">
        <p className="mb-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">Paste this</p>
        <DiffSide tokens={tokens} side="after" />
      </div>
    </div>
  );
}

/** A message to send (not text on the profile): no "before", just the words. */
function SendThis({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-emerald-500/5 p-3 ring-1 ring-inset ring-emerald-500/20">
      <p className="mb-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">Send this</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><Marked text={text} /></p>
    </div>
  );
}

/** What LinkedIn's limit counts: a custom URL's last part, else the whole text. */
const counted = (s: LinkedInSuggestion, text: string): number => (s.part === "url" ? text.replace(/^.*\/in\//, "").length : text.length);

function Counter({ length, limit }: { length: number; limit: number }) {
  const state = charState(length, limit);
  return (
    <span className={cx("text-xs tabular-nums", state === "over" ? "font-medium text-rose-700 dark:text-rose-300" : state === "near" ? "text-amber-800 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")}>
      {length.toLocaleString("en-IN")}/{limit.toLocaleString("en-IN")} characters
      {state === "over" && " (over LinkedIn's limit)"}
    </span>
  );
}

/** What LinkedIn shows before it cuts the text off (search results, "see more"). */
function ShownFirst({ text, chars, part }: { text: string; chars: number; part: LinkedInSuggestion["part"] }) {
  const flat = text.replace(/\s*\n+\s*/g, " ").trim();
  if (!chars || flat.length <= chars) return null;
  const cut = flat.slice(0, chars + 1);
  const end = cut.lastIndexOf(" ") > chars / 2 ? cut.lastIndexOf(" ") : chars;
  return (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">
      {part === "about" ? "Shows before “see more”" : "A search result shows about"}: <span className="text-zinc-700 dark:text-zinc-300">“{flat.slice(0, end)}…”</span>
    </p>
  );
}

/**
 * One suggestion, ready to paste on LinkedIn: before → after with the changed words marked, the character count
 * against LinkedIn's limit, Copy, Apply to Orbit's copy (the score updates) or Put it back, and "Done on LinkedIn",
 * which is kept with the profile. Where to paste it is spelled out step by step, with LinkedIn's help page.
 */
export function SuggestionCard({ s: saved, actions, sweepAt }: { s: LinkedInSuggestion; actions: LinkedInActions; sweepAt: number | null }) {
  // A pick, a tick or "done" shows at once; the server's answer then replaces it (or takes it back on an error).
  const [local, setLocal] = useState<Pick<LinkedInSuggestionPatch, "choice" | "done" | "checked">>({});
  useEffect(() => setLocal({}), [saved]);
  const s: LinkedInSuggestion = { ...saved, ...local } as LinkedInSuggestion;
  const change = (p: Pick<LinkedInSuggestionPatch, "choice" | "done" | "checked">) => {
    setLocal((l) => ({ ...l, ...p }));
    void actions.patch(saved, p).then((ok) => { if (!ok) setLocal({}); });
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // One already done on LinkedIn opens folded, so the list shows what's left; ticking one done here leaves it open.
  const [open, setOpen] = useState(() => !saved.done);
  const busy = actions.busy === `s:${s.id}`;
  const error = actions.error?.key === `s:${s.id}` ? actions.error.text : null;
  const text = chosenText(s);
  const holes = placeholders(text);
  const textual = !CHECKLIST.has(s.part) && s.part !== "skills" && s.part !== "featured";
  const titleId = `li-s-${s.id}-title`;
  const save = async () => {
    if (await actions.patch(s, { after: draft })) setEditing(false);
  };
  return (
    <article id={`li-s-${s.id}`} aria-labelledby={titleId} className={cx("relative overflow-hidden rounded-2xl border bg-white p-4 dark:bg-zinc-950", s.done ? "border-emerald-500/30 dark:border-emerald-400/20" : "border-zinc-200 dark:border-white/10")}>
      {sweepAt !== null && <span key={sweepAt} aria-hidden className="li-sweep" />}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} data-card-title tabIndex={-1} className="font-display text-base font-semibold outline-none">{s.label}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={s.ai ? "accent" : "neutral"}>{s.ai ? "Written by AI" : "Worked out by Orbit"}</Badge>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{SOURCE[s.source]}</span>
            {s.applied && <Badge tone="success" dot>In Orbit's copy</Badge>}
            {s.done && <Badge tone="success">Done on LinkedIn</Badge>}
          </div>
        </div>
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={`${titleId}-body`} aria-label={`${open ? "Hide" : "Show"} ${s.label}`} onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={cx("h-3.5 w-3.5 motion-ok:transition-transform motion-ok:duration-quick", !open && "-rotate-90")} /> {open ? "Hide" : "Show"}
        </Button>
        <IconButton label={`Remove the ${s.label} suggestion`} icon={Trash2} size="sm" onClick={() => void actions.remove(s)} disabled={busy} />
      </div>

      <div id={`${titleId}-body`} hidden={!open} className="mt-3 space-y-3">
        {s.options.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Pick one</legend>
            {s.options.map((o, i) => (
              <label key={i} className={cx("flex cursor-pointer gap-2.5 rounded-xl border p-3 text-sm", s.choice === i ? "border-indigo-500/60 bg-indigo-500/5 dark:border-indigo-400/50" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10 dark:hover:border-white/20")}>
                <input type="radio" name={`opt-${s.id}`} checked={s.choice === i} onChange={() => change({ choice: i })} className="mt-1 h-4 w-4 shrink-0 accent-indigo-600 dark:accent-indigo-400" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{o.label}</span>
                    {s.limit > 0 && <Counter length={counted(s, o.text)} limit={s.limit} />}
                  </span>
                  <Marked text={o.text} className="mt-0.5 block break-words" />
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {textual && !editing && (s.applies ? <BeforeAfter before={s.before} after={text} /> : <SendThis text={text} />)}
        {textual && !editing && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {s.limit > 0 ? <Counter length={counted(s, text)} limit={s.limit} /> : <span />}
            <ShownFirst text={text} chars={s.shown} part={s.part} />
          </div>
        )}
        {editing && (
          <div className="space-y-2">
            <label htmlFor={`edit-${s.id}`} className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Your version</label>
            <Textarea id={`edit-${s.id}`} rows={s.part === "headline" ? 3 : 8} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              {s.limit > 0 && <Counter length={draft.trim().length} limit={s.limit} />}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" variant="secondary" loading={busy} disabled={!draft.trim() || (s.limit > 0 && draft.trim().length > s.limit)} onClick={() => void save()}>Save</Button>
            </div>
          </div>
        )}

        {s.part === "skills" && <SkillsList s={s} />}
        {s.part === "featured" && (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {s.after.split("\n").filter(Boolean).map((line, i) => {
              const [title, ...rest] = line.split(": ");
              return <li key={i}><span className="font-medium">{title}</span>{rest.length ? `: ${rest.join(": ")}` : ""}</li>;
            })}
          </ol>
        )}
        {CHECKLIST.has(s.part) && (
          <ul className="space-y-2" aria-label="Steps">
            {s.items.map((item, i) => (
              <li key={i}>
                <Checkbox
                  label={item}
                  checked={s.checked.includes(i)}
                  onChange={(e) => change({ checked: e.target.checked ? [...s.checked, i] : s.checked.filter((x) => x !== i) })}
                />
              </li>
            ))}
          </ul>
        )}

        {holes.length > 0 && (
          <p role="note" className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-500/25 dark:text-amber-100">
            <strong>{holes.length} placeholder{holes.length === 1 ? "" : "s"} to fill in</strong> ({[...new Set(holes)].join(", ")}): put in your real figure, or take that part out, before you paste it. Orbit never guesses a number.
          </p>
        )}
        {s.note && !holes.length && <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.note}</p>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => copy(copyText(s), `Now paste it into LinkedIn: ${s.where[0] ?? ""}`.trim())}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          {s.applies && (s.applied ? (
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void actions.apply(s, false)}>
              <Undo2 className="h-3.5 w-3.5" /> Put it back
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void actions.apply(s, true)}>
              <Wand2 className="h-3.5 w-3.5" /> Apply to my Orbit copy
            </Button>
          ))}
          {EDITABLE.has(s.part) && !editing && (
            <Button size="sm" variant="ghost" onClick={() => { setDraft(text); setEditing(true); }}>
              <PenLine className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
          <span className="flex-1" />
          <Checkbox label="Done on LinkedIn" checked={s.done} onChange={(e) => change({ done: e.target.checked })} />
        </div>

        {s.where.length > 0 && (
          <div className="rounded-xl bg-zinc-500/5 px-3 py-2.5 text-sm">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Where to paste it on LinkedIn</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-700 dark:text-zinc-300">
              {s.where.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            {s.help_url && (
              <a href={s.help_url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline dark:text-indigo-300">
                LinkedIn's help page for this <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Skills in the order to list them: the first five to feature, the ones new to the profile marked. */
function SkillsList({ s }: { s: LinkedInSuggestion }) {
  const had = new Set(s.before.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
  return (
    <div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Skills, most searched first">
        {s.items.map((skill, i) => {
          const isNew = !had.has(skill.toLowerCase());
          return (
            <li key={skill} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ring-1 ring-inset",
              isNew ? "bg-emerald-500/10 text-emerald-900 ring-emerald-500/25 dark:text-emerald-100" : "bg-zinc-500/5 text-zinc-700 ring-zinc-500/15 dark:text-zinc-300",
              i < 5 && "font-medium")}>
              {i < 5 && <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{i + 1}</span>}
              {skill}
              {isNew && <><Check className="h-3 w-3" aria-hidden /><span className="sr-only"> (new on LinkedIn)</span></>}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{s.items.length} skills, in the order to list them; LinkedIn allows 100. Ticked: not on your LinkedIn yet.</p>
    </div>
  );
}
