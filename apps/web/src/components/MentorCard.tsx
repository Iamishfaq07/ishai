import { useEffect, useState } from "react";
import type { MentorShare } from "@orbit/types";
import { CopyButton, Users, cx, focusRing, toast } from "@orbit/ui";
import { Button, Card, ErrorNote, Input, Select } from "./ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";

/**
 * Ask a mentor: share this mock interview's report with someone you trust (a manager, a senior, a coach) by a private
 * link, and see their comments on each answer here. What they see is a snapshot of the report made now: the questions,
 * scores and feedback, and your answers only if you include them. Never your resume, documents or account.
 */
export function MentorCard({ sessionId, questions }: { sessionId: string; questions: string[] }) {
  const [shares, setShares] = useState<MentorShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [answers, setAnswers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);

  useEffect(() => {
    api.mentorShares(sessionId).then((all) => {
      setShares(all);
      if (all.some((s) => s.comments.some((c) => !c.read))) void api.markMentorRead(sessionId).catch(() => undefined);
    }, (err: unknown) => setError(errorText(err)));
  }, [sessionId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const share = await api.createMentorShare(sessionId, { label: label.trim(), days, answers });
      setMade(share.url);
      setShares((all) => [share, ...(all ?? [])]);
      setLabel("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeMentorShare(id);
      setShares((all) => all?.map((s) => (s.id === id ? { ...s, active: false } : s)) ?? null);
      toast("Link turned off. It no longer opens.");
    } catch (err) {
      setError(errorText(err));
    }
  };

  const comments = (shares ?? []).flatMap((s) => s.comments.map((c) => ({ ...c, who: s.label })));
  return (
    <Card id="mentor" className="scroll-mt-24">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden /> Ask a mentor
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        Send this report to someone whose judgement you trust: they open a private link (no account), see the questions,
        scores and feedback, and comment on each answer. Their notes show up here.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm">
          <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Who it's for (only you see this)</span>
          <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Priya, my old manager" className="mt-1" />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Link works for</span>
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="mt-1">
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </Select>
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />
        <span>Include what I said in each answer (and the stronger version). Untick to share only the questions, scores and feedback.</span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void create()}>{busy ? "Making the link…" : "Make a private link"}</Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Never includes your resume, documents, recording or email.</span>
      </div>
      {made && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm ring-1 ring-emerald-500/25">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{made}</span>
          <CopyButton text={made} label="Copy link" />
          <span className="basis-full text-xs text-zinc-600 dark:text-zinc-400">Copy it now: for your privacy Orbit keeps only a fingerprint of it, so it can't show it again.</span>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

      {shares && shares.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Your links</h3>
          <ul className="mt-2 divide-y divide-zinc-200 text-sm dark:divide-white/10">
            {shares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{s.label || "A mentor"}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {s.active ? `Works until ${formatDate(s.expires_at)}` : "Turned off or expired"} · opened {s.views} time{s.views === 1 ? "" : "s"}
                    {s.comments.length ? ` · ${s.comments.length} comment${s.comments.length === 1 ? "" : "s"}` : ""}
                    {s.answers_included ? "" : " · questions and scores only"}
                  </span>
                </span>
                {s.active && (
                  <button type="button" onClick={() => void revoke(s.id)} className={cx("rounded text-xs font-medium text-rose-700 hover:underline dark:text-rose-300", focusRing)}>
                    Turn off
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {comments.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">What your mentors said</h3>
          <ul className="mt-2 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{c.author}</span> on{" "}
                  {c.item === null ? "the whole interview" : `“${questions[c.item] ?? `answer ${c.item + 1}`}”`} · {formatDate(c.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-line">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
