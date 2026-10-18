// Orbit for Business (D82): one applicant, inside the company: what they shared (resume, answers), Orbit's ranking
// with its evidence, the team's notes and scorecards, scheduling, email, and the timeline. Everything here is what
// they sent this company when they applied; nothing else from Orbit.
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { BizApplicationDetail, BizMember, BizMet, BizRequirementMatch, BizScoreItem, BizTemplateKind } from "@orbit/types";
import {
  ArrowLeft,
  Badge,
  Button,
  CalendarIcon,
  Callout,
  CircleCheck,
  X,
  Circle,
  Field,
  Input,
  Mail,
  RefreshCw,
  Select,
  Sparkles,
  Textarea,
  Trash2,
  Video,
  confirmDialog,
  cx,
  focusRing,
  toast,
  buttonClass,
} from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import { RejectDialog } from "./Pipeline";
import {
  WAITING_FOR_CONFIRMATION,
  checkSlots,
  companyPath,
  dayTime,
  jobPath,
  matchLabel,
  mentionedMembers,
  rejectedMessage,
  relTime,
  scoreTone,
} from "./model";
import { Loading, LoadError, Panel, errorText } from "./ui";

const MET: Record<BizMet, { label: string; icon: typeof CircleCheck; tone: string }> = {
  yes: { label: "Met", icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-300" },
  partly: { label: "Partly", icon: Circle, tone: "text-amber-700 dark:text-amber-300" },
  no: { label: "Not shown", icon: X, tone: "text-zinc-500 dark:text-zinc-400" },
};

function Requirements({ title, items }: { title: string; items: BizRequirementMatch[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((r) => {
          const m = MET[r.met];
          return (
            <li key={r.requirement} className="flex items-start gap-2 text-sm">
              <m.icon className={cx("mt-0.5 h-4 w-4 shrink-0", m.tone)} aria-hidden />
              <span className="min-w-0">
                <span className="font-medium">{r.requirement}</span> <span className={cx("text-xs", m.tone)}>({m.label})</span>
                {r.evidence && <span className="block text-xs text-zinc-600 dark:text-zinc-400">“{r.evidence}”</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Consensus({ cards }: { cards: BizApplicationDetail["scorecards"] }) {
  if (cards.length < 2) return null;
  const hire = cards.filter((c) => c.recommendation === "hire").length;
  const scores = cards.flatMap((c) => c.ratings.map((r) => r.score));
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const split = hire > 0 && hire < cards.length;
  // Per-criterion averages
  const crits: Record<string, number[]> = {};
  for (const c of cards) for (const r of c.ratings) {
    (crits[r.criterion] ||= []).push(r.score);
  }
  return (
    <div className={cx("mb-3 rounded-xl border p-3 text-sm", split ? "border-amber-300 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10" : "border-zinc-200 dark:border-white/10")}>
      <p className="font-medium">{hire} hire · {cards.length - hire} no hire{avg ? ` · average ${avg.toFixed(1)}/4` : ""}</p>
      {split && <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">The team disagrees. Read the notes before deciding.</p>}
      {Object.keys(crits).length > 0 && (
        <div className="mt-2 space-y-1">
          {Object.entries(crits).map(([c, ss]) => {
            const a = ss.reduce((x, y) => x + y, 0) / ss.length;
            const pct = (a / 4) * 100;
            const color = a >= 3.5 ? "bg-emerald-500" : a >= 2.5 ? "bg-amber-500" : "bg-rose-500";
            return (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className="w-32 truncate">{c}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                  <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 tabular-nums">{a.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SuggestedAction({ a }: { a: BizApplicationDetail }) {
  const score = a.score ?? 0;
  const cards = a.scorecards ?? [];
  const hireCount = cards.filter(c => c.recommendation === "hire").length;
  let suggestion = "Review the ranking and notes.";
  let tone = "neutral";
  if (cards.length >= 2 && hireCount === cards.length && score >= 70) {
    suggestion = "Strong consensus and high match. Consider moving to next stage or offer.";
    tone = "success";
  } else if (score < 40 || (cards.length >= 2 && hireCount === 0)) {
    suggestion = "Low match or no hire consensus. Consider rejection with a clear reason.";
    tone = "warning";
  } else if (cards.length >= 1 && hireCount > 0) {
    suggestion = "Mixed signals. Schedule a debrief or request more evidence.";
    tone = "info";
  }
  return (
    <Callout tone={tone as any}>
      <strong>Suggested next step:</strong> {suggestion} (AI suggestion only — you decide.)
    </Callout>
  );
}

function PracticeBrief({ a }: { a: BizApplicationDetail }) {
  const { company } = useCompany();
  const [kit, setKit] = useState<Array<{ id: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    biz.job(company.id, a.job_id).then((j) => setKit(j.interview_kit ?? [])).catch(() => undefined);
  }, [company.id, a.job_id]);
  const practice = `/mock?role=${encodeURIComponent(a.job_title)}&company=${encodeURIComponent(company.name)}`;
  const send = async () => {
    setBusy(true);
    try {
      await biz.practiceBrief(company.id, a.id);
      toast({ message: "Practice brief sent", tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">Email this person the interview questions and a link to practise on Orbit. Practice does not decide the hire.</p>
      {kit.length > 0 ? (
        <ol className="list-decimal space-y-1 pl-4">
          {kit.map((q) => (
            <li key={q.id}>{q.text}</li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No interview questions yet. Add them on the job.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} disabled={!a.email_confirmed} disabledReason="Waiting for them to confirm their email." onClick={() => void send()}>
          Email practice brief
        </Button>
        <Link to={practice} className={buttonClass("secondary", "sm")}>
          Open in Orbit Mock
        </Link>
      </div>
    </div>
  );
}

const RUBRIC = ["Skills for the role", "Experience", "Communication", "Problem solving"];
const SCORE_WORDS = ["", "1: Weak", "2: Mixed", "3: Good", "4: Strong"];

function ScorecardForm({ a, onSaved }: { a: BizApplicationDetail; onSaved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [stageId, setStageId] = useState(a.stage_id);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [rec, setRec] = useState<"hire" | "no_hire" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stages = useStages(a);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const items: BizScoreItem[] = RUBRIC.filter((c) => ratings[c]).map((c) => ({ criterion: c, score: ratings[c] as 1 | 2 | 3 | 4 }));
    if (items.length === 0) return setError("Rate at least one part.");
    if (!rec) return setError("Choose hire or no hire.");
    setBusy(true);
    setError(null);
    try {
      onSaved(await biz.addScorecard(company.id, a.id, { stage_id: stageId, ratings: items, notes: notes.trim(), recommendation: rec }));
      setRatings({});
      setNotes("");
      setRec("");
      toast({ message: "Scorecard saved", tone: "success" });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Stage" htmlFor={`${id}-st`}>
        <Select id={`${id}-st`} value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      {RUBRIC.map((c, i) => (
        <fieldset key={c}>
          <legend className="text-sm">{c}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <label key={s} className={cx("cursor-pointer rounded-lg border px-2.5 py-1 text-xs has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-400/10", "border-zinc-200 dark:border-white/10", "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500")}>
                <input type="radio" className="sr-only" name={`${id}-r${i}`} value={s} checked={ratings[c] === s} onChange={() => setRatings({ ...ratings, [c]: s })} />
                {SCORE_WORDS[s]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Field label="Notes" htmlFor={`${id}-n`} hint="What they said or did that backs your scores.">
        <Textarea id={`${id}-n`} rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">Recommendation</legend>
        <div className="mt-1 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name={`${id}-rec`} checked={rec === "hire"} onChange={() => setRec("hire")} className={cx("h-4 w-4", focusRing)} /> Hire
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name={`${id}-rec`} checked={rec === "no_hire"} onChange={() => setRec("no_hire")} className={cx("h-4 w-4", focusRing)} /> No hire
          </label>
        </div>
      </fieldset>
      {error && <Callout tone="error">{error}</Callout>}
      <Button type="submit" size="sm" loading={busy}>
        Save scorecard
      </Button>
    </form>
  );
}

/** The job's stages, from the application list (the detail carries the stage id only); falls back to the one stage. */
function useStages(a: BizApplicationDetail) {
  const { company } = useCompany();
  const [stages, setStages] = useState<Array<{ id: string; name: string; kind: string }>>([{ id: a.stage_id, name: a.stage_id, kind: "applied" }]);
  useEffect(() => {
    biz.job(company.id, a.job_id).then((j) => setStages(j.stages)).catch(() => undefined);
  }, [company.id, a.job_id]);
  return stages;
}

function Notes({ a, members, onSaved }: { a: BizApplicationDetail; members: BizMember[]; onSaved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mentions = mentionedMembers(text, members);
  const names = mentions.map((m) => members.find((x) => x.user_id === m)?.name || members.find((x) => x.user_id === m)?.email).filter(Boolean);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      onSaved(await biz.addNote(company.id, a.id, text.trim()));
      setText("");
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <Field label="Add a note" htmlFor={`${id}-t`} hint="Type @ and a teammate's first name or email to tell them.">
          <Textarea id={`${id}-t`} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {names.length > 0 && <p className="text-xs text-zinc-600 dark:text-zinc-400">Will notify: {names.join(", ")}</p>}
        <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
          Add note
        </Button>
      </form>
      <ul className="space-y-2">
        {a.notes.map((n) => (
          <li key={n.id} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/[0.03]">
            <p className="whitespace-pre-line">{n.body}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {n.author} · {relTime(n.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Scheduling({ a, onSaved }: { a: BizApplicationDetail; onSaved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [slots, setSlots] = useState<string[]>(() => {
    const base = new Date(Date.now() + 2 * 86400_000);
    base.setMinutes(0, 0, 0);
    base.setHours(11);
    return [0, 1, 2].map((i) => localInput(new Date(base.getTime() + i * 86400_000)));
  });
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (a.interview?.chosen) {
    return (
      <p className="text-sm">
        Booked: <strong>{dayTime(a.interview.chosen)}</strong> ({a.interview.duration_min} min{a.interview.location ? `, ${a.interview.location}` : ""}). The invite (.ics) went to both of you.
      </p>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const checked = checkSlots(slots);
    if ("error" in checked) return setError(checked.error);
    setBusy(true);
    setError(null);
    try {
      onSaved(await biz.proposeSlots(company.id, a.id, { slots: checked.slots, duration_min: duration, location: location.trim(), ...(message.trim() ? { message: message.trim() } : {}) }));
      toast({ message: "Times sent. They'll pick one from their status page.", tone: "success" });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {a.interview && <Callout tone="info">Waiting for them to pick one of {a.interview.slots.length} times. Sending new times replaces those.</Callout>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Offer 3 to 5 times (your time zone)</legend>
        {slots.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input type="datetime-local" aria-label={`Time ${i + 1}`} value={s} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))} />
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove time ${i + 1}`} disabled={slots.length <= 3} onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" disabled={slots.length >= 5} onClick={() => setSlots([...slots, ""])}>
          Add a time
        </Button>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label="Minutes" htmlFor={`${id}-d`}>
          <Input id={`${id}-d`} type="number" min={15} max={240} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} />
        </Field>
        <Field label="Where" htmlFor={`${id}-l`} hint="A video link or an address.">
          <Input id={`${id}-l`} value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
      <Field label="Message (optional)" htmlFor={`${id}-m`}>
        <Textarea id={`${id}-m`} rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {error && <Callout tone="error">{error}</Callout>}
      <Button type="submit" size="sm" loading={busy}>
        <CalendarIcon className="h-4 w-4" aria-hidden /> Send times
      </Button>
    </form>
  );
}

function EmailForm({ a, onSaved }: { a: BizApplicationDetail; onSaved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [mode, setMode] = useState<BizTemplateKind | "custom">("stage");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "custom" && (!subject.trim() || !body.trim())) return toast({ message: "Add a subject and a message.", tone: "error" });
    setBusy(true);
    try {
      onSaved(await biz.sendEmail(company.id, a.id, mode === "custom" ? { subject: subject.trim(), body: body.trim() } : { kind: mode }));
      toast({ message: "Email sent", tone: "success" });
      setSubject("");
      setBody("");
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Send" htmlFor={`${id}-k`} hint="From Orbit, with replies going to you.">
        <Select id={`${id}-k`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="stage">Stage update (template)</option>
          <option value="received">Application received (template)</option>
          <option value="custom">A message I write</option>
        </Select>
      </Field>
      {mode === "custom" && (
        <>
          <Field label="Subject" htmlFor={`${id}-s`}>
            <Input id={`${id}-s`} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message" htmlFor={`${id}-b`}>
            <Textarea id={`${id}-b`} rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </>
      )}
      <Button type="submit" size="sm" variant="secondary" loading={busy}>
        <Mail className="h-4 w-4" aria-hidden /> Send email
      </Button>
    </form>
  );
}

function Interviewers({ a, members, onSaved }: { a: BizApplicationDetail; members: BizMember[]; onSaved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const interviewers = members.filter((m) => m.role === "interviewer" || m.role === "hiring_manager");
  if (interviewers.length === 0) return <p className="text-sm text-zinc-600 dark:text-zinc-400">Invite interviewers in Team to assign them here.</p>;
  const toggle = async (uid: string, on: boolean) => {
    const next = on ? [...a.interviewers, uid] : a.interviewers.filter((x) => x !== uid);
    try {
      onSaved(await biz.updateApplication(company.id, a.id, { interviewers: next }));
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };
  return (
    <ul className="space-y-1.5">
      {interviewers.map((m) => (
        <li key={m.user_id}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={a.interviewers.includes(m.user_id)} onChange={(e) => void toggle(m.user_id, e.target.checked)} className={cx("h-4 w-4", focusRing)} />
            {m.name || m.email}
          </label>
        </li>
      ))}
    </ul>
  );
}

function Tags({ a, onSaved, canEdit }: { a: BizApplicationDetail; onSaved: (d: BizApplicationDetail) => void; canEdit: boolean }) {
  const { company } = useCompany();
  const [text, setText] = useState("");
  const save = async (tags: string[]) => {
    try {
      onSaved(await biz.updateApplication(company.id, a.id, { tags }));
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {a.tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <Badge>{t}</Badge>
          {canEdit && (
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => void save(a.tags.filter((x) => x !== t))} className={cx("inline-flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-500 hover:text-rose-600", focusRing)}>
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim().slice(0, 30);
            if (t && !a.tags.includes(t)) void save([...a.tags, t]);
            setText("");
          }}
        >
          <Input aria-label="Add a tag" placeholder="Add tag" className="!w-28 !py-1 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
      )}
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Panel title={title} id={id}>
      {children}
    </Panel>
  );
}

export function Candidate() {
  const { company } = useCompany();
  const { aid = "" } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState<BizApplicationDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [members, setMembers] = useState<BizMember[]>([]);
  const [reveal, setReveal] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    biz.application(company.id, aid, reveal).then(setA).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id, aid, reveal, n]);
  useEffect(() => {
    biz.members(company.id).then((m) => setMembers(m.members)).catch(() => undefined);
  }, [company.id]);
  if (error) return <LoadError error={error} onRetry={() => setN((x) => x + 1)} />;
  if (!a) return <Loading />;
  const p = company.permissions;
  const canMove = p.move_applicants && company.status === "active";
  const blind = company.blind_review && !reveal;
  const match = matchLabel(a);

  const rerank = async () => {
    try {
      setA(await biz.rerank(company.id, a.id));
      toast({ message: "Ranking again. It takes a few seconds.", tone: "info" });
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${a.name}'s application?`, body: "Their resume, answers, notes and scorecards are deleted for good. The audit log keeps only the reference.", confirmLabel: "Delete", danger: true, typeToConfirm: "DELETE" }))) return;
    try {
      await biz.deleteApplication(company.id, a.id);
      toast({ message: "Deleted", tone: "success" });
      navigate(jobPath(company.id, a.job_id));
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };

  return (
    <div className="space-y-5">
      <Link to={jobPath(company.id, a.job_id)} className={cx("inline-flex items-center gap-1 rounded text-sm text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {a.job_title}
      </Link>
      <PageTitle
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {a.headline && <span>{a.headline}</span>}
            {!blind && a.email && (
              <a href={`mailto:${a.email}`} className="underline">
                {a.email}
              </a>
            )}
            {!blind && a.phone && <span>{a.phone}</span>}
            {!blind && a.location && <span>{a.location}</span>}
            <span>
              Applied {relTime(a.applied_at)}
              {a.via_orbit ? " with Orbit" : ""}
            </span>
          </span>
        }
        actions={
          <>
            {company.blind_review && (p.manage_company || company.role === "recruiter") && (
              <Button variant="ghost" size="sm" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
                {reveal ? "Hide details (blind review)" : "Show name and contact"}
              </Button>
            )}
            {canMove && a.status === "rejected" && (
              <Button variant="secondary" onClick={async () => setA(await biz.unreject(company.id, a.id).catch((e: unknown) => (toast({ message: errorText(e), tone: "error" }), a)))}>
                Undo reject
              </Button>
            )}
            {canMove && a.status !== "rejected" && (
              <Button variant="danger" onClick={() => setRejecting(true)}>
                Reject…
              </Button>
            )}
          </>
        }
      />
      {a.deletion_requested && (
        <Callout tone="warning" title="They asked to have their data deleted">
          Delete the application at the bottom of this page when you're done with it (within 30 days).
        </Callout>
      )}
      {a.knockout_failed && (
        <Callout tone="warning" title="A screening answer doesn't meet a knock-out rule">
          {a.knockout_reasons.join("; ")}. This is a flag for your team; nothing is rejected automatically.
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Stage:</span>
        {canMove && a.status !== "rejected" ? <StageSelect a={a} onMoved={setA} /> : <Badge>{a.status === "rejected" ? "Rejected" : a.stage_id}</Badge>}
        <Tags a={a} onSaved={setA} canEdit={canMove} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Section title="Orbit's ranking" id="ranking">
            {a.ranking_status === "pending" ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
                Ranking this applicant…
              </p>
            ) : !a.ranking ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Not ranked. {canMove && <button type="button" onClick={() => void rerank()} className="underline">Rank now</button>}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={scoreTone(a.ranking.score)}>{a.ranking.score} / 100</Badge>
                  {match && <span className="text-sm font-medium">{match}</span>}
                </div>
                <p className="text-sm">{a.ranking.summary}</p>
                <Requirements title="Must-haves" items={a.ranking.must_haves} />
                <Requirements title="Nice to have" items={a.ranking.nice_to_haves} />
                {a.ranking.cautions.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold">Worth checking</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                      {a.ranking.cautions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <Sparkles className="h-3 w-3" aria-hidden /> Read from the resume and answers only (never name, photo, age or other personal traits). It sorts; your team decides.{a.basic_match ? " Basic match: keywords only, as the AI model wasn't available." : ""} Ranked {relTime(a.ranking.ranked_at)}.
                  {canMove && (
                    <button type="button" onClick={() => void rerank()} className={cx("inline-flex items-center gap-1 rounded underline", focusRing)}>
                      <RefreshCw className="h-3 w-3" aria-hidden /> Rank again
                    </button>
                  )}
                </p>
              </div>
            )}
          </Section>

          <Section title="Screening answers" id="answers">
            {a.answers.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">This job asked no questions.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {a.answers.map((x) => (
                  <div key={x.question_id}>
                    <dt className="text-zinc-600 dark:text-zinc-400">{x.question}</dt>
                    <dd className={cx("font-medium", x.knockout_failed && "text-amber-800 dark:text-amber-300")}>
                      {x.answer || "(no answer)"} {x.knockout_failed && "· doesn't meet the knock-out"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Resume" id="resume">
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              {a.resume_source === "upload" ? `Uploaded${a.resume_filename ? `: ${a.resume_filename}` : ""} (the text read from it)` : "Shared from their Orbit resume"}
            </p>
            {a.parsed && (
              <div className="mb-3 space-y-2 text-sm">
                {a.parsed.total_years !== null && <p>About {a.parsed.total_years} years of experience</p>}
                {a.parsed.skills.length > 0 && (
                  <ul className="flex flex-wrap gap-1" aria-label="Skills">
                    {a.parsed.skills.slice(0, 30).map((s) => (
                      <li key={s}>
                        <Badge>{s}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {a.parsed.experience.length > 0 && (
                  <ul className="space-y-1">
                    {a.parsed.experience.slice(0, 6).map((x, i) => (
                      <li key={i}>
                        <strong>{x.title}</strong>
                        {x.company ? `, ${x.company}` : ""} <span className="text-xs text-zinc-500">{[x.start, x.end].filter(Boolean).join(" – ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 font-sans text-sm leading-relaxed dark:bg-white/[0.03]">{a.resume_text}</pre>
          </Section>

          <Section title="Timeline" id="timeline">
            <ol className="space-y-2 text-sm">
              {a.timeline.map((t) => (
                <li key={t.id} className="flex gap-3">
                  <span className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{relTime(t.created_at)}</span>
                  <span>
                    {t.text}
                    {t.actor ? <span className="text-zinc-500 dark:text-zinc-400"> · {t.actor}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-5">
          <Panel title="Practice this role" hint="Practice does not decide the hire.">
            <PracticeBrief a={a} />
          </Panel>
          <Panel title="Scorecards">
            <Consensus cards={a.scorecards} />
            <SuggestedAction a={a} />
            {a.scorecards.length > 0 && (
              <ul className="mb-4 space-y-2">
                {a.scorecards.map((s) => (
                  <li key={s.id} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/[0.03]">
                    <p className="font-medium">
                      {s.author}: {s.recommendation === "hire" ? "Hire" : "No hire"}
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{s.ratings.map((r) => `${r.criterion} ${r.score}/4`).join(" · ")}</p>
                    {s.notes && <p className="mt-1 whitespace-pre-line">{s.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            <ScorecardForm a={a} onSaved={setA} />
          </Panel>
          <Panel title="Notes">
            <Notes a={a} members={members} onSaved={setA} />
          </Panel>
          {canMove && (
            <>
              <Panel title="Interviewers" hint="They can see this applicant and add notes and scorecards.">
                <Interviewers a={a} members={members} onSaved={setA} />
              </Panel>
              {a.email_confirmed ? (
                <>
                  <Panel title="Schedule an interview">
                    <Scheduling a={a} onSaved={setA} />
                  </Panel>
                  <Panel title="Email">
                    <EmailForm a={a} onSaved={setA} />
                  </Panel>
                </>
              ) : (
                <Panel title="Email and interviews">
                  <Callout tone="info">{WAITING_FOR_CONFIRMATION}</Callout>
                </Panel>
              )}
            </>
          )}
          <Panel title="Consent">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Agreed to the applicant notice (version {a.consent.notice_version}) on {new Date(a.consent.accepted_at).toLocaleString()}.
            </p>
          </Panel>
          {p.delete_applicants && (
            <Panel title="Delete" hint="When they ask, or you no longer need it.">
              <Button variant="danger" size="sm" onClick={() => void remove()}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete application
              </Button>
            </Panel>
          )}
          <Link to={companyPath(company.id, "jobs")} className="sr-only">
            All jobs
          </Link>
        </div>
      </div>
      <RejectDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        count={1}
        onReject={async (send, s, b, reason) => {
          const r = await biz.reject(company.id, { ids: [a.id], send_email: send, ...(s ? { subject: s } : {}), ...(b ? { body: b } : {}), ...(reason ? { reason } : {}) });
          toast({ message: rejectedMessage(r.moved, send, r.emails_waiting), tone: "success" });
          setN((x) => x + 1);
        }}
      />
    </div>
  );
}

function StageSelect({ a, onMoved }: { a: BizApplicationDetail; onMoved: (d: BizApplicationDetail) => void }) {
  const { company } = useCompany();
  const stages = useStages(a);
  return (
    <Select
      aria-label="Stage"
      className="!w-auto"
      value={a.stage_id}
      onChange={async (e) => {
        const to = e.target.value;
        try {
          await biz.move(company.id, { ids: [a.id], stage_id: to });
          onMoved(await biz.application(company.id, a.id));
          toast({ message: `Moved to ${stages.find((s) => s.id === to)?.name ?? "the stage"}`, tone: "success" });
        } catch (err) {
          toast({ message: errorText(err), tone: "error" });
        }
      }}
    >
      {stages
        .filter((s) => s.kind !== "rejected")
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </Select>
  );
}
