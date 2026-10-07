import { useState } from "react";
import type { AdminUser } from "@orbit/types";
import { Minus, Plus, confirmDialog, cx } from "@orbit/ui";
import { Button, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { plannedRemoval, wholeNumber } from "./logic";

const plural = (n: number, word: string) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${word}${n === 1 ? "" : "s"}`;

/**
 * Give or take away resume AI credits and interview minutes. Taking away needs a reason (it goes in the account's
 * history) and never goes below zero: the preview says what will actually be removed, and "Set to zero" takes it all.
 */
export function CreditsAdjust({ user, onChange }: { user: AdminUser; onChange: (row: AdminUser, message: string) => void }) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [resume, setResume] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = wholeNumber(resume);
  const m = wholeNumber(minutes);
  const reason = note.trim();
  const removing = mode === "remove";
  const pr = plannedRemoval(user.resume_credits, r);
  const pm = plannedRemoval(user.interview_minutes_left, m);
  const reset = () => {
    setResume("");
    setMinutes("");
    setNote("");
  };

  const run = async (call: () => Promise<{ row: AdminUser; message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { row, message } = await call();
      onChange(row, message);
      reset();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const row = await api.giveCredits(user.id, { resume: r, interview_minutes: m, ...(reason ? { note: reason } : {}) });
      const what = [r ? plural(r, "resume credit") : "", m ? plural(m, "interview minute") : ""].filter(Boolean).join(" and ");
      return { row, message: `Added ${what}.` };
    });

  const remove = async (all?: "resume" | "interview") => {
    const what = all
      ? all === "resume"
        ? `all ${plural(user.resume_credits, "resume credit")}`
        : `all ${plural(user.interview_minutes_left, "interview minute")}`
      : [pr.take ? plural(pr.take, "resume credit") : "", pm.take ? plural(pm.take, "interview minute") : ""].filter(Boolean).join(" and ");
    const ok = await confirmDialog({
      title: `Remove ${what} from ${user.email}?`,
      body: `Reason, shown in their history: "${reason}". This can't be undone, but you can add credits back.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const res = await api.removeCredits(user.id, {
        reason,
        ...(all === "resume" ? { all_resume: true } : all === "interview" ? { all_interview: true } : { resume: r, interview_minutes: m }),
      });
      return { row: res.user, message: res.message };
    });
  };

  const canSubmit = removing ? reason.length >= 3 && (pr.take > 0 || pm.take > 0) : r > 0 || m > 0;
  return (
    <div className="space-y-2 text-sm">
      <div role="tablist" aria-label="Add or remove" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
        {(["add", "remove"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
            className={cx("inline-flex items-center gap-1 rounded-lg px-3 py-1 text-sm", mode === id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500")}
          >
            {id === "add" ? <Plus className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
            {id === "add" ? "Add" : "Remove"}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Now: {plural(user.resume_credits, "resume credit")} · {plural(user.interview_minutes_left, "interview minute")} left. They never expire.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit || busy) return;
          void (removing ? remove() : add());
        }}
      >
        <Input aria-label="Resume credits" inputMode="numeric" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="resume" className="!w-24" />
        <Input aria-label="Interview minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="minutes" className="!w-24" />
        <Input
          aria-label={removing ? "Reason (required, shown in their history)" : "Note (optional, shown in their history)"}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder={removing ? "Reason (required)" : "Note (optional)"}
          className="!w-auto min-w-0 flex-1"
        />
        <Button size="sm" type="submit" variant={removing ? "secondary" : "primary"} disabled={busy || !canSubmit}>
          {removing ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {removing ? "Remove" : "Add"}
        </Button>
      </form>
      {removing && (
        <>
          {(r > 0 || m > 0) && (
            <p className={cx("text-xs", pr.clamped || pm.clamped ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")} role="status">
              Removes{" "}
              {[
                r ? `${plural(pr.take, "resume credit")} (${user.resume_credits} → ${pr.after})` : "",
                m ? `${plural(pm.take, "minute")} (${Math.round(user.interview_minutes_left * 10) / 10} → ${pm.after})` : "",
              ]
                .filter(Boolean)
                .join(" and ")}
              {pr.clamped || pm.clamped ? ". That's all there is: a balance never goes below zero." : "."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">Set to zero:</span>
            <Button size="sm" variant="ghost" disabled={busy || reason.length < 3 || user.resume_credits <= 0} onClick={() => void remove("resume")}>
              Resume credits
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || reason.length < 3 || user.interview_minutes_left <= 0} onClick={() => void remove("interview")}>
              Interview minutes
            </Button>
            {reason.length < 3 && <span className="text-xs text-zinc-500">Write the reason first.</span>}
          </div>
        </>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
