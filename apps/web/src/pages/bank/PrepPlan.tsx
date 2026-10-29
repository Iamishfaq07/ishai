import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, CalendarPlus, Check, CopyButton, cx, focusRing, safeLocal } from "@orbit/ui";
import { Button, Input } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { downloadText } from "../../lib/format";
import type { BankKind } from "./content";
import { entryPath } from "./content";
import { MAX_DAYS, buildPlan, daysBetween, isoDay, planIcs, planText, type PlanStep } from "./prepPlan";
import type { BankCompany, BankRole } from "./types";

const SITE = "https://orbitanswer.com";

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Ticked steps, per guide and interview date, kept on this device only. */
function useDone(key: string): [Set<string>, (id: string) => void] {
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setDone(new Set(JSON.parse(safeLocal.getItem(key) ?? "[]") as string[]));
    } catch {
      setDone(new Set());
    }
  }, [key]);
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        safeLocal.setItem(key, JSON.stringify([...next]));
      } catch {
        /* private mode: kept for this visit */
      }
      return next;
    });
  return [done, toggle];
}

/**
 * "Plan my prep": pick the interview date and get the days until then, each with what to do from this guide (read the
 * process, fit the resume, warm up, the AI's questions, stories, mock interviews, the tips), ticked off as you go and
 * added to your calendar in one file. Free, no account; the steps that need one say so.
 */
export function PrepPlan({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const id = useId();
  const { user } = useAuth();
  // Dates are worked out in the browser, not when the page is built.
  const [today, setToday] = useState("");
  useEffect(() => setToday(isoDay(new Date())), []);
  const storeKey = `orbit.prep-plan.${kind}:${entry.slug}`;
  const [date, setDate] = useState("");
  useEffect(() => {
    try {
      const saved = safeLocal.getItem(storeKey);
      if (saved && daysBetween(isoDay(new Date()), saved) >= 1) setDate(saved);
    } catch {
      /* nothing saved */
    }
  }, [storeKey]);
  const plan = useMemo(() => (date && today ? buildPlan(kind, entry, date, today) : null), [kind, entry, date, today]);
  const [done, toggle] = useDone(`${storeKey}.done.${date}`);
  const name = entry.name;
  const pageUrl = `${SITE}${entryPath(kind, entry.slug)}`;
  const min = today ? isoDay(new Date(Date.now() + 86_400_000)) : undefined;
  const max = today ? isoDay(new Date(Date.now() + 120 * 86_400_000)) : undefined;
  const all = plan?.days.flatMap((d) => d.steps.map((s) => `${d.date}:${s.id}`)) ?? [];
  const finished = all.filter((k) => done.has(k)).length;

  const pick = (value: string) => {
    setDate(value);
    try {
      if (value) safeLocal.setItem(storeKey, value);
    } catch {
      /* private mode */
    }
  };

  return (
    <section id="prep-plan" aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-24 rounded-2xl border mk-line mk-surface p-6">
      <h2 id={`${id}-title`} className="mk-h3 flex items-center gap-2 text-zinc-950 dark:text-white">
        <CalendarCheck className="h-5 w-5" aria-hidden /> Plan my {kind === "company" ? `${name} ` : ""}prep
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        When is your interview? Get a day-by-day plan from this guide up to the day, tick it off as you go and add it
        to your calendar. Free, no account needed.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label htmlFor={`${id}-date`} className="text-sm">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Interview date</span>
          <Input id={`${id}-date`} type="date" min={min} max={max} value={date}
            onChange={(e) => pick(e.target.value)} className="mt-1 min-h-11 w-auto" />
        </label>
        {plan && (
          <>
            <Button variant="secondary" onClick={() => downloadText(`${entry.slug}-interview-prep.ics`, planIcs(plan, name, pageUrl), "text/calendar;charset=utf-8")}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Add to calendar
            </Button>
            <CopyButton text={planText(plan, name, dayLabel)} label="Copy plan" />
          </>
        )}
      </div>
      {date && today && !plan && <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Pick a date after today.</p>}
      {plan && (
        <div className="mt-6">
          <p className="text-sm text-zinc-700 dark:text-zinc-300" role="status">
            {plan.starts !== today
              ? `Your interview is more than ${MAX_DAYS} days away, so the plan starts on ${dayLabel(plan.starts)}. `
              : ""}
            {finished}/{all.length} done
          </p>
          <ol className="mt-3 space-y-4">
            {plan.days.map((day) => (
              <li key={day.date}>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  {day.date === today ? "Today" : dayLabel(day.date)}
                </p>
                <ul className="mt-2 space-y-2">
                  {day.steps.map((s) => (
                    <Step key={s.id} step={s} done={done.has(`${day.date}:${s.id}`)} signedIn={Boolean(user)}
                      onToggle={() => toggle(`${day.date}:${s.id}`)} />
                  ))}
                </ul>
              </li>
            ))}
            <li>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{dayLabel(plan.interview)}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-950 dark:text-white">{kind === "company" ? `Your ${name} interview` : "Your interview"}. Good luck.</p>
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}

function Step({ step, done, signedIn, onToggle }: { step: PlanStep; done: boolean; signedIn: boolean; onToggle: () => void }) {
  const inPage = step.to.startsWith("#");
  const linkClass = cx("rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing);
  const needsAccount = step.account && !signedIn;
  return (
    <li className="flex items-start gap-3 rounded-xl border mk-line p-3">
      <button type="button" onClick={onToggle} aria-pressed={done} aria-label={`${done ? "Done" : "Mark done"}: ${step.title}`}
        className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border", done ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-400 dark:border-zinc-500", focusRing)}>
        {done && <Check className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <span className="min-w-0 flex-1 text-sm">
        <span className={cx("block font-medium text-zinc-950 dark:text-white", done && "line-through opacity-60")}>{step.title}</span>
        <span className="block text-zinc-600 dark:text-zinc-400">{step.detail}</span>
        <span className="mt-1 block text-xs">
          {inPage ? (
            <a href={step.to} className={linkClass}>Open</a>
          ) : needsAccount ? (
            <Link to="/register" state={{ from: step.to }} className={linkClass}>Start free to do this</Link>
          ) : (
            <Link to={step.to} className={linkClass}>Open</Link>
          )}
          {needsAccount && inPage && <span className="text-zinc-500"> · needs a free account</span>}
        </span>
      </span>
    </li>
  );
}
